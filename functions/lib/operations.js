import { createHash } from 'node:crypto';
import { fail, text, integer, money, key, ref, created, meta, mulCents, journal } from './core.js';
import { loadStockItem, applyStockChange } from './catalog.js';

const MAX_LINES = 20;
const roles = ['admin'];
const command = (run) => ({ roles, run });
const sumMoney = (values) => money(values.reduce((sum, value) => sum + money(value), 0));
const inventoryAccount = (item) => item.data.kind === 'material' ? '1405' : '1435';
const debit = (account, amount) => ({ account, debitCents: amount, creditCents: 0 });
const credit = (account, amount) => ({ account, debitCents: 0, creditCents: amount });
const positiveMoney = (value, label) => {
  const amount = money(value, label);
  if (!amount) fail('invalid-argument', `${label} debe ser mayor que cero.`);
  return amount;
};
const optionalText = (value, label, max = 500) => text(value ?? '', label, max, false);
const date = (value, label = 'Fecha') => {
  const result = text(value, label, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00Z`)) || new Date(`${result}T00:00:00Z`).toISOString().slice(0, 10) !== result) fail('invalid-argument', `${label} debe tener formato AAAA-MM-DD y ser válida.`);
  return result;
};
const strictBoolean = (value, label, defaultValue = true) => {
  if (value === undefined) return defaultValue;
  if (typeof value !== 'boolean') fail('invalid-argument', `${label} debe ser verdadero o falso.`);
  return value;
};
const lineList = (value) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_LINES) fail('invalid-argument', `Incluye entre 1 y ${MAX_LINES} líneas.`);
  const seen = new Set();
  return value.map((line) => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) fail('invalid-argument', 'La línea no es válida.');
    const variantId = key(line.variantId, 'Variante');
    if (seen.has(variantId)) fail('invalid-argument', 'Cada variante debe aparecer una sola vez; suma las cantidades en la misma línea.');
    seen.add(variantId);
    return { ...line, variantId, quantity: integer(line.quantity, 'Cantidad', 1) };
  });
};
const snapshot = (item) => ({
  variantId: item.ref.id,
  referenceKey: item.data.referenceKey,
  sku: item.data.sku,
  name: item.referenceData.name,
  size: item.data.size || '', color: item.data.color || '', lot: item.data.lot || '',
});
const assertExists = (snap, label) => {
  if (!snap.exists) fail('not-found', `${label} no existe.`);
  return snap.data();
};
const assertActive = (item) => {
  if (item.data.active !== true) fail('failed-precondition', `La variante ${item.data.sku} está archivada.`);
};
const ensureState = (doc, expected, label) => {
  const accepted = Array.isArray(expected) ? expected : [expected];
  if (!accepted.includes(doc.status)) fail('failed-precondition', `${label} está en estado ${doc.status}.`);
};
const payment = (tx, ctx, sourceType, sourceId, amountCents, extra = {}) => {
  const paymentRef = ref(ctx, 'payments');
  tx.create(paymentRef, { sourceType, sourceId, amountCents, ...extra, ...created(ctx) });
  return paymentRef.id;
};
const accountLines = (entries, side) => [...entries.entries()].filter(([, amount]) => amount > 0).map(([account, amount]) => side(account, amount));
const addAccount = (map, account, value) => map.set(account, sumMoney([map.get(account) || 0, value]));
const stableId = (prefix, ...parts) => `${prefix}_${createHash('sha256').update(parts.join('\u0000')).digest('hex')}`;

async function loadParty(tx, ctx, payload, type) {
  if (!payload.contactId) return { id: '', name: text(type === 'customer' ? payload.customerName : payload.supplierName, type === 'customer' ? 'Cliente' : 'Proveedor', 150) };
  const id = key(payload.contactId, 'Contacto');
  const contact = assertExists(await tx.get(ref(ctx, 'contacts', id)), 'El contacto');
  if (contact.type !== type) fail('invalid-argument', type === 'customer' ? 'Selecciona un contacto de tipo cliente.' : 'Selecciona un contacto de tipo proveedor.');
  return { id, name: text(contact.name, 'Nombre del contacto', 150) };
}

async function createSale(tx, ctx, payload) {
  const customer = await loadParty(tx, ctx, payload, 'customer');
  const customerName = customer.name;
  const lines = lineList(payload.lines);
  const items = await Promise.all(lines.map((line) => loadStockItem(tx, ctx, line.variantId)));
  const normalized = lines.map((line, index) => {
    const item = items[index];
    assertActive(item);
    if (item.data.kind !== 'finished') fail('invalid-argument', 'Las ventas requieren productos terminados.');
    if (item.data.stock < line.quantity) fail('failed-precondition', `Stock insuficiente para ${item.data.sku}.`);
    const unitPriceCents = money(line.unitPriceCents ?? item.data.priceCents, 'Precio de venta');
    return { ...snapshot(item), quantity: line.quantity, unitPriceCents, totalCents: mulCents(unitPriceCents, line.quantity), inventoryAccount: inventoryAccount(item) };
  });
  const totalCents = sumMoney(normalized.map((line) => line.totalCents));
  if (!totalCents) fail('invalid-argument', 'La venta debe tener un valor mayor que cero.');
  const paidCents = money(payload.paidCents ?? 0, 'Pago inicial');
  if (paidCents > totalCents) fail('invalid-argument', 'El pago no puede superar el total de la venta.');
  const notes = optionalText(payload.notes, 'Notas', 2000);
  const saleRef = ref(ctx, 'sales');
  const inventoryCredits = new Map();
  normalized.forEach((line, index) => {
    const unknownBefore = items[index].costData.unvaluedQuantity ?? (items[index].data.stock && !items[index].costData.stockValueCents ? items[index].data.stock : 0);
    const result = applyStockChange(tx, ctx, items[index], -line.quantity, { sourceType: 'sale', sourceId: saleRef.id, reason: `Venta a ${customerName}` });
    line.costCents = result.valueCents;
    line.unvaluedQuantity = unknownBefore - result.unvaluedQuantity;
    addAccount(inventoryCredits, line.inventoryAccount, result.valueCents);
  });
  const costCents = sumMoney(normalized.map((line) => line.costCents));
  tx.create(saleRef, { customerName, customerId: customer.id, lines: normalized, totalCents, costCents, hasUnvaluedCost: normalized.some((line) => line.unvaluedQuantity > 0), paidCents, balanceCents: totalCents - paidCents, notes, status: 'posted', ...created(ctx) });
  journal(tx, ctx, { sourceType: 'sale', sourceId: saleRef.id, note: `Venta: ${customerName}`, lines: [debit('1305', totalCents), credit('4135', totalCents)] });
  if (costCents) journal(tx, ctx, { sourceType: 'sale-cost', sourceId: saleRef.id, note: 'Costo de los productos vendidos', lines: [debit('6135', costCents), ...accountLines(inventoryCredits, credit)] });
  if (paidCents) {
    payment(tx, ctx, 'sale', saleRef.id, paidCents);
    journal(tx, ctx, { sourceType: 'sale-payment', sourceId: saleRef.id, note: 'Cobro inicial de venta', lines: [debit('1105', paidCents), credit('1305', paidCents)] });
  }
  return { id: saleRef.id, totalCents, paidCents, costCents };
}

async function paySale(tx, ctx, payload) {
  const saleRef = ref(ctx, 'sales', key(payload.saleId, 'Venta'));
  const sale = assertExists(await tx.get(saleRef), 'La venta');
  ensureState(sale, 'posted', 'La venta');
  const amountCents = positiveMoney(payload.amountCents, 'Pago');
  const paidCents = sumMoney([sale.paidCents, amountCents]);
  if (paidCents > sale.totalCents) fail('invalid-argument', 'El pago supera el saldo pendiente.');
  const paymentId = payment(tx, ctx, 'sale', saleRef.id, amountCents);
  tx.update(saleRef, { paidCents, balanceCents: sale.totalCents - paidCents, ...meta(ctx) });
  journal(tx, ctx, { sourceType: 'sale-payment', sourceId: saleRef.id, note: 'Cobro de cuenta por cobrar', lines: [debit('1105', amountCents), credit('1305', amountCents)] });
  return { id: saleRef.id, paymentId, paidCents };
}

async function voidSale(tx, ctx, payload) {
  const saleRef = ref(ctx, 'sales', key(payload.saleId, 'Venta'));
  const sale = assertExists(await tx.get(saleRef), 'La venta');
  ensureState(sale, 'posted', 'La venta');
  const reason = text(payload.reason, 'Motivo de anulación', 500);
  const items = await Promise.all(sale.lines.map((line) => loadStockItem(tx, ctx, line.variantId)));
  const inventoryDebits = new Map();
  sale.lines.forEach((line, index) => {
    applyStockChange(tx, ctx, items[index], line.quantity, { sourceType: 'sale-void', sourceId: saleRef.id, reason, valueCents: line.costCents, unvaluedQuantity: line.unvaluedQuantity ?? 0, reactivate: true });
    addAccount(inventoryDebits, line.inventoryAccount, line.costCents);
  });
  journal(tx, ctx, { sourceType: 'sale-void', sourceId: saleRef.id, note: reason, lines: [debit('4135', sale.totalCents), credit('1305', sale.totalCents)] });
  if (sale.costCents) journal(tx, ctx, { sourceType: 'sale-cost-void', sourceId: saleRef.id, note: 'Reintegro del costo histórico', lines: [...accountLines(inventoryDebits, debit), credit('6135', sale.costCents)] });
  if (sale.paidCents) {
    payment(tx, ctx, 'sale-refund', saleRef.id, sale.paidCents, { direction: 'out' });
    journal(tx, ctx, { sourceType: 'sale-refund', sourceId: saleRef.id, note: 'Devolución de cobros al anular venta', lines: [debit('1305', sale.paidCents), credit('1105', sale.paidCents)] });
  }
  tx.update(saleRef, { status: 'void', voidReason: reason, refundedCents: sale.paidCents, balanceCents: 0, voidedAt: ctx.now, voidedBy: ctx.uid, ...meta(ctx) });
  return { id: saleRef.id, refundedCents: sale.paidCents };
}

async function createPurchase(tx, ctx, payload) {
  const supplier = await loadParty(tx, ctx, payload, 'supplier');
  const supplierName = supplier.name;
  const lines = lineList(payload.lines);
  const items = await Promise.all(lines.map((line) => loadStockItem(tx, ctx, line.variantId)));
  const normalized = lines.map((line, index) => {
    assertActive(items[index]);
    const unitCostCents = money(line.unitCostCents, 'Costo unitario');
    return { ...snapshot(items[index]), quantity: line.quantity, unitCostCents, totalCents: mulCents(unitCostCents, line.quantity), inventoryAccount: inventoryAccount(items[index]) };
  });
  const totalCents = sumMoney(normalized.map((line) => line.totalCents));
  if (!totalCents) fail('invalid-argument', 'La compra debe tener valor mayor que cero; para inventario sin valorar utiliza ingreso de stock.');
  const paidCents = money(payload.paidCents ?? 0, 'Pago inicial');
  if (paidCents > totalCents) fail('invalid-argument', 'El pago supera el valor de la compra.');
  const notes = optionalText(payload.notes, 'Notas', 2000);
  const purchaseRef = ref(ctx, 'purchases');
  const inventoryDebits = new Map();
  normalized.forEach((line, index) => {
    applyStockChange(tx, ctx, items[index], line.quantity, { sourceType: 'purchase', sourceId: purchaseRef.id, reason: `Compra a ${supplierName}`, valueCents: line.totalCents });
    addAccount(inventoryDebits, line.inventoryAccount, line.totalCents);
  });
  tx.create(purchaseRef, { supplierName, supplierId: supplier.id, lines: normalized, totalCents, paidCents, balanceCents: totalCents - paidCents, notes, status: 'posted', ...created(ctx) });
  journal(tx, ctx, { sourceType: 'purchase', sourceId: purchaseRef.id, note: `Compra: ${supplierName}`, lines: [...accountLines(inventoryDebits, debit), credit('2205', totalCents)] });
  if (paidCents) {
    payment(tx, ctx, 'purchase', purchaseRef.id, paidCents, { direction: 'out' });
    journal(tx, ctx, { sourceType: 'purchase-payment', sourceId: purchaseRef.id, note: 'Pago inicial de compra', lines: [debit('2205', paidCents), credit('1105', paidCents)] });
  }
  return { id: purchaseRef.id, totalCents, paidCents };
}

async function payPurchase(tx, ctx, payload) {
  const purchaseRef = ref(ctx, 'purchases', key(payload.purchaseId, 'Compra'));
  const purchase = assertExists(await tx.get(purchaseRef), 'La compra');
  ensureState(purchase, 'posted', 'La compra');
  const amountCents = positiveMoney(payload.amountCents, 'Pago');
  const paidCents = sumMoney([purchase.paidCents, amountCents]);
  if (paidCents > purchase.totalCents) fail('invalid-argument', 'El pago supera el saldo pendiente.');
  const paymentId = payment(tx, ctx, 'purchase', purchaseRef.id, amountCents, { direction: 'out' });
  tx.update(purchaseRef, { paidCents, balanceCents: purchase.totalCents - paidCents, ...meta(ctx) });
  journal(tx, ctx, { sourceType: 'purchase-payment', sourceId: purchaseRef.id, note: 'Pago de cuenta por pagar', lines: [debit('2205', amountCents), credit('1105', amountCents)] });
  return { id: purchaseRef.id, paymentId, paidCents };
}

async function voidPurchase(tx, ctx, payload) {
  const purchaseRef = ref(ctx, 'purchases', key(payload.purchaseId, 'Compra'));
  const purchase = assertExists(await tx.get(purchaseRef), 'La compra');
  ensureState(purchase, 'posted', 'La compra');
  const reason = text(payload.reason, 'Motivo de devolución de compra', 500);
  const items = await Promise.all(purchase.lines.map((line) => loadStockItem(tx, ctx, line.variantId)));
  purchase.lines.forEach((line, index) => {
    if (items[index].data.stock < line.quantity) fail('failed-precondition', `No puedes devolver la compra: stock insuficiente para ${items[index].data.sku}.`);
  });
  const inventoryCredits = new Map();
  const reversals = purchase.lines.map((line, index) => {
    const result = applyStockChange(tx, ctx, items[index], -line.quantity, { sourceType: 'purchase-void', sourceId: purchaseRef.id, reason, reactivate: true });
    addAccount(inventoryCredits, line.inventoryAccount, result.valueCents);
    return { variantId: line.variantId, quantity: line.quantity, costCents: result.valueCents };
  });
  const removedCostCents = sumMoney(reversals.map((line) => line.costCents));
  const lines = [debit('2205', purchase.totalCents), ...accountLines(inventoryCredits, credit)];
  if (removedCostCents > purchase.totalCents) lines.push(debit('5195', removedCostCents - purchase.totalCents));
  if (purchase.totalCents > removedCostCents) lines.push(credit('4205', purchase.totalCents - removedCostCents));
  journal(tx, ctx, { sourceType: 'purchase-void', sourceId: purchaseRef.id, note: `${reason}; devolución y diferencia de valoración`, lines });
  if (purchase.paidCents) {
    payment(tx, ctx, 'purchase-refund', purchaseRef.id, purchase.paidCents, { direction: 'in' });
    journal(tx, ctx, { sourceType: 'purchase-refund', sourceId: purchaseRef.id, note: 'Reintegro registrado del proveedor por devolución', lines: [debit('1105', purchase.paidCents), credit('2205', purchase.paidCents)] });
  }
  tx.update(purchaseRef, { status: 'void', voidReason: reason, refundedCents: purchase.paidCents, reversalCostCents: removedCostCents, reversals, balanceCents: 0, voidedAt: ctx.now, voidedBy: ctx.uid, ...meta(ctx) });
  return { id: purchaseRef.id, refundedCents: purchase.paidCents, removedCostCents };
}

async function saveBom(tx, ctx, payload) {
  const outputVariantId = key(payload.outputVariantId, 'Producto terminado');
  const inputs = lineList(payload.inputs);
  if (inputs.some((line) => line.variantId === outputVariantId)) fail('invalid-argument', 'Un producto no puede ser materia prima de sí mismo.');
  const [output, ...materials] = await Promise.all([loadStockItem(tx, ctx, outputVariantId), ...inputs.map((line) => loadStockItem(tx, ctx, line.variantId))]);
  assertActive(output);
  if (output.data.kind !== 'finished') fail('invalid-argument', 'El resultado de la receta debe ser un producto terminado.');
  materials.forEach((item) => {
    assertActive(item);
    if (item.data.kind !== 'material') fail('invalid-argument', 'Los insumos de una receta deben ser materias primas.');
  });
  const bomRef = ref(ctx, 'productionBoms', outputVariantId);
  const existing = await tx.get(bomRef);
  const normalized = inputs.map((line, index) => ({ ...snapshot(materials[index]), quantity: line.quantity }));
  const record = { outputVariantId, outputName: output.referenceData.name, outputSku: output.data.sku, inputs: normalized, ...meta(ctx) };
  if (!existing.exists) tx.create(bomRef, { ...record, ...created(ctx) });
  else tx.update(bomRef, record);
  return { id: bomRef.id };
}

async function planProduction(tx, ctx, payload) {
  const bomId = key(payload.bomId, 'Receta');
  const bom = assertExists(await tx.get(ref(ctx, 'productionBoms', bomId)), 'La receta');
  const quantity = integer(payload.quantity, 'Cantidad a producir', 1);
  const inputs = lineList(bom.inputs).map((line) => ({ ...line, quantityPerUnit: line.quantity, quantity: integer(line.quantity * quantity, 'Cantidad total de insumo', 1) }));
  const [output, ...materials] = await Promise.all([loadStockItem(tx, ctx, bom.outputVariantId), ...inputs.map((line) => loadStockItem(tx, ctx, line.variantId))]);
  [output, ...materials].forEach(assertActive);
  if (output.data.kind !== 'finished' || materials.some((item) => item.data.kind !== 'material')) fail('failed-precondition', 'La receta ya no coincide con los tipos del catálogo.');
  const orderRef = ref(ctx, 'productionOrders');
  tx.create(orderRef, {
    bomId, outputVariantId: bom.outputVariantId, outputName: output.referenceData.name, outputSku: output.data.sku,
    inputs: inputs.map((line, index) => ({ ...snapshot(materials[index]), quantityPerUnit: line.quantityPerUnit, quantity: line.quantity })),
    quantity, completedQuantity: 0, materialCostCents: 0, status: 'planned', notes: optionalText(payload.notes, 'Notas', 2000), ...created(ctx),
  });
  return { id: orderRef.id };
}

async function startProduction(tx, ctx, payload) {
  const orderRef = ref(ctx, 'productionOrders', key(payload.orderId, 'Orden'));
  const order = assertExists(await tx.get(orderRef), 'La orden');
  ensureState(order, 'planned', 'La orden');
  const [output, ...materials] = await Promise.all([loadStockItem(tx, ctx, order.outputVariantId), ...order.inputs.map((line) => loadStockItem(tx, ctx, line.variantId))]);
  [output, ...materials].forEach(assertActive);
  order.inputs.forEach((line, index) => {
    if (materials[index].data.stock < line.quantity) fail('failed-precondition', `Stock insuficiente del insumo ${materials[index].data.sku}.`);
  });
  const inventoryCredits = new Map();
  const inputs = order.inputs.map((line, index) => {
    const unknownBefore = materials[index].costData.unvaluedQuantity ?? (materials[index].data.stock && !materials[index].costData.stockValueCents ? materials[index].data.stock : 0);
    const result = applyStockChange(tx, ctx, materials[index], -line.quantity, { sourceType: 'production-start', sourceId: orderRef.id, reason: `Insumo para ${order.outputSku}` });
    const account = inventoryAccount(materials[index]);
    addAccount(inventoryCredits, account, result.valueCents);
    return { ...line, costCents: result.valueCents, unvaluedQuantity: unknownBefore - result.unvaluedQuantity, inventoryAccount: account };
  });
  const materialCostCents = sumMoney(inputs.map((line) => line.costCents));
  tx.update(orderRef, { status: 'in_progress', inputs, materialCostCents, hasUnvaluedCost: inputs.some((line) => line.unvaluedQuantity > 0), startedAt: ctx.now, startedBy: ctx.uid, ...meta(ctx) });
  if (materialCostCents) journal(tx, ctx, { sourceType: 'production-start', sourceId: orderRef.id, note: 'Consumo de materiales hacia producción en proceso', lines: [debit('1430', materialCostCents), ...accountLines(inventoryCredits, credit)] });
  return { id: orderRef.id, materialCostCents };
}

async function completeProduction(tx, ctx, payload) {
  const orderRef = ref(ctx, 'productionOrders', key(payload.orderId, 'Orden'));
  const order = assertExists(await tx.get(orderRef), 'La orden');
  ensureState(order, 'in_progress', 'La orden');
  const quantity = integer(payload.quantity ?? order.quantity, 'Cantidad terminada', 1, order.quantity);
  const output = await loadStockItem(tx, ctx, order.outputVariantId);
  assertActive(output);
  applyStockChange(tx, ctx, output, quantity, { sourceType: 'production-complete', sourceId: orderRef.id, reason: 'Ingreso de producto terminado', valueCents: order.materialCostCents, unvaluedQuantity: order.hasUnvaluedCost ? quantity : 0 });
  tx.update(orderRef, { status: 'completed', completedQuantity: quantity, completedAt: ctx.now, completedBy: ctx.uid, ...meta(ctx) });
  if (order.materialCostCents) journal(tx, ctx, { sourceType: 'production-complete', sourceId: orderRef.id, note: 'Transferencia de costo de materiales a producto terminado', lines: [debit('1435', order.materialCostCents), credit('1430', order.materialCostCents)] });
  return { id: orderRef.id, quantity, materialCostCents: order.materialCostCents };
}

async function cancelProduction(tx, ctx, payload) {
  const orderRef = ref(ctx, 'productionOrders', key(payload.orderId, 'Orden'));
  const order = assertExists(await tx.get(orderRef), 'La orden');
  ensureState(order, ['planned', 'in_progress', 'completed'], 'La orden');
  const reason = text(payload.reason, 'Motivo de cancelación', 500);
  let materials = [];
  let output;
  if (order.status !== 'planned') {
    materials = await Promise.all(order.inputs.map((line) => loadStockItem(tx, ctx, line.variantId)));
    if (order.status === 'completed') output = await loadStockItem(tx, ctx, order.outputVariantId);
  }
  const inventoryDebits = new Map();
  let removedCostCents = 0;
  if (output) {
    const result = applyStockChange(tx, ctx, output, -order.completedQuantity, { sourceType: 'production-cancel', sourceId: orderRef.id, reason, reactivate: true });
    removedCostCents = result.valueCents;
  }
  if (order.status !== 'planned') {
    order.inputs.forEach((line, index) => {
      applyStockChange(tx, ctx, materials[index], line.quantity, { sourceType: 'production-cancel', sourceId: orderRef.id, reason, valueCents: line.costCents, unvaluedQuantity: line.unvaluedQuantity ?? 0, reactivate: true });
      addAccount(inventoryDebits, line.inventoryAccount, line.costCents);
    });
    if (order.status === 'in_progress' && order.materialCostCents) journal(tx, ctx, { sourceType: 'production-cancel', sourceId: orderRef.id, note: reason, lines: [...accountLines(inventoryDebits, debit), credit('1430', order.materialCostCents)] });
    if (order.status === 'completed' && (order.materialCostCents || removedCostCents)) {
      const lines = [...accountLines(inventoryDebits, debit)];
      if (removedCostCents) lines.push(credit('1435', removedCostCents));
      if (removedCostCents > order.materialCostCents) lines.push(debit('5195', removedCostCents - order.materialCostCents));
      if (order.materialCostCents > removedCostCents) lines.push(credit('4205', order.materialCostCents - removedCostCents));
      journal(tx, ctx, { sourceType: 'production-cancel', sourceId: orderRef.id, note: `${reason}; reversión al costo histórico de insumos y diferencia de valoración`, lines });
    }
  }
  tx.update(orderRef, { status: 'cancelled', previousStatus: order.status, cancelReason: reason, cancelledAt: ctx.now, cancelledBy: ctx.uid, ...meta(ctx) });
  return { id: orderRef.id };
}

async function saveEmployee(tx, ctx, payload) {
  const employeeRef = payload.employeeId ? ref(ctx, 'employees', key(payload.employeeId, 'Empleado')) : ref(ctx, 'employees');
  const existing = payload.employeeId ? await tx.get(employeeRef) : null;
  if (payload.employeeId && !existing.exists) fail('not-found', 'El empleado no existe.');
  const record = {
    name: text(payload.name, 'Nombre', 150), document: text(payload.document, 'Documento', 60),
    position: optionalText(payload.position, 'Cargo', 100), department: optionalText(payload.department, 'Área', 100),
    email: optionalText(payload.email, 'Correo', 200), phone: optionalText(payload.phone, 'Teléfono', 50),
    baseSalaryCents: money(payload.baseSalaryCents, 'Salario base mensual'), active: strictBoolean(payload.active, 'Activo'),
    startDate: date(payload.startDate, 'Fecha de ingreso'), ...meta(ctx),
  };
  if (record.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email)) fail('invalid-argument', 'El correo del empleado no es válido.');
  // A unique document registry prevents duplicate employees under parallel requests.
  const documentKey = stableId('doc', record.document.normalize('NFKC').trim().toLowerCase());
  const indexRef = ref(ctx, 'employeeDocumentIndex', documentKey);
  const index = await tx.get(indexRef);
  if (index.exists && index.data().employeeId !== employeeRef.id) fail('already-exists', 'Ya existe un empleado con ese documento.');
  let oldIndexRef;
  if (existing?.exists && existing.data().document !== record.document) {
    oldIndexRef = ref(ctx, 'employeeDocumentIndex', stableId('doc', existing.data().document.normalize('NFKC').trim().toLowerCase()));
  }
  if (!index.exists) tx.create(indexRef, { employeeId: employeeRef.id, ...created(ctx) });
  if (oldIndexRef && oldIndexRef.path !== indexRef.path) tx.delete(oldIndexRef);
  if (existing?.exists) tx.update(employeeRef, record);
  else tx.create(employeeRef, { ...record, ...created(ctx) });
  return { id: employeeRef.id };
}

async function recordAttendance(tx, ctx, payload) {
  const employeeId = key(payload.employeeId, 'Empleado');
  const employee = assertExists(await tx.get(ref(ctx, 'employees', employeeId)), 'El empleado');
  if (!employee.active) fail('failed-precondition', 'El empleado está inactivo.');
  const day = date(payload.date);
  const status = text(payload.status, 'Estado', 10);
  if (!['present', 'absent', 'leave'].includes(status)) fail('invalid-argument', 'El estado de asistencia no es válido.');
  const minutes = integer(payload.minutes ?? 0, 'Minutos', 0, 1440);
  if (status === 'absent' && minutes !== 0) fail('invalid-argument', 'Una ausencia debe tener cero minutos.');
  const attendanceRef = ref(ctx, 'attendance', stableId('att', employeeId, day));
  const existing = await tx.get(attendanceRef);
  const record = { employeeId, employeeName: employee.name, date: day, status, minutes, ...meta(ctx) };
  if (!existing.exists) tx.create(attendanceRef, { ...record, ...created(ctx) });
  else tx.update(attendanceRef, record);
  return { id: attendanceRef.id };
}

async function createPayroll(tx, ctx, payload) {
  const employeeId = key(payload.employeeId, 'Empleado');
  const employee = assertExists(await tx.get(ref(ctx, 'employees', employeeId)), 'El empleado');
  if (!employee.active) fail('failed-precondition', 'El empleado está inactivo.');
  const period = text(payload.period, 'Período', 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) fail('invalid-argument', 'El período debe tener formato AAAA-MM.');
  const periodIndexRef = ref(ctx, 'payrollPeriodIndex', stableId('pay', employeeId, period));
  const periodIndex = await tx.get(periodIndexRef);
  if (periodIndex.exists) {
    const current = assertExists(await tx.get(ref(ctx, 'payroll', key(periodIndex.data().payrollId, 'Nómina'))), 'La nómina del período');
    if (current.status !== 'void') fail('already-exists', 'La nómina de ese empleado y período ya está registrada.');
  }
  const payrollRef = ref(ctx, 'payroll');
  const additionsCents = money(payload.additionsCents ?? 0, 'Adiciones');
  const deductionsCents = money(payload.deductionsCents ?? 0, 'Deducciones');
  const grossCents = sumMoney([employee.baseSalaryCents, additionsCents]);
  if (!grossCents || deductionsCents > grossCents) fail('invalid-argument', 'El devengado debe ser positivo y las deducciones no pueden superarlo.');
  const netCents = grossCents - deductionsCents;
  const lines = [debit('5105', grossCents)];
  if (netCents) lines.push(credit('2505', netCents));
  if (deductionsCents) lines.push(credit('2365', deductionsCents));
  tx.set(periodIndexRef, { employeeId, period, payrollId: payrollRef.id, ...meta(ctx) });
  tx.create(payrollRef, {
    employeeId, employeeName: employee.name, period, baseSalaryCents: employee.baseSalaryCents,
    additionsCents, deductionsCents, grossCents, netCents, paidCents: 0, balanceCents: netCents,
    status: 'posted', ...created(ctx),
  });
  journal(tx, ctx, { sourceType: 'payroll', sourceId: payrollRef.id, note: `Nómina interna ${period}: ${employee.name}`, lines });
  return { id: payrollRef.id, grossCents, netCents };
}

async function payPayroll(tx, ctx, payload) {
  const payrollRef = ref(ctx, 'payroll', key(payload.payrollId, 'Nómina'));
  const payroll = assertExists(await tx.get(payrollRef), 'La nómina');
  ensureState(payroll, 'posted', 'La nómina');
  const amountCents = positiveMoney(payload.amountCents, 'Pago');
  const paidCents = sumMoney([payroll.paidCents, amountCents]);
  if (paidCents > payroll.netCents) fail('invalid-argument', 'El pago supera el saldo de la nómina.');
  const paymentId = payment(tx, ctx, 'payroll', payrollRef.id, amountCents, { direction: 'out' });
  tx.update(payrollRef, { paidCents, balanceCents: payroll.netCents - paidCents, ...meta(ctx) });
  journal(tx, ctx, { sourceType: 'payroll-payment', sourceId: payrollRef.id, note: 'Pago de nómina interna', lines: [debit('2505', amountCents), credit('1105', amountCents)] });
  return { id: payrollRef.id, paymentId, paidCents };
}

async function voidPayroll(tx, ctx, payload) {
  const payrollRef = ref(ctx, 'payroll', key(payload.payrollId, 'Nómina'));
  const payroll = assertExists(await tx.get(payrollRef), 'La nómina');
  ensureState(payroll, 'posted', 'La nómina');
  const reason = text(payload.reason, 'Motivo de anulación de nómina', 500);
  if (payroll.paidCents !== 0) fail('failed-precondition', 'Esta nómina tiene pagos registrados. Su devolución debe conciliarse y registrarse antes de corregirla; no se anulan pagos ni se simulan reembolsos automáticamente.');
  const lines = [];
  if (payroll.netCents) lines.push(debit('2505', payroll.netCents));
  if (payroll.deductionsCents) lines.push(debit('2365', payroll.deductionsCents));
  lines.push(credit('5105', payroll.grossCents));
  journal(tx, ctx, { sourceType: 'payroll-void', sourceId: payrollRef.id, note: reason, lines });
  tx.update(payrollRef, { status: 'void', balanceCents: 0, voidReason: reason, voidedAt: ctx.now, voidedBy: ctx.uid, ...meta(ctx) });
  return { id: payrollRef.id };
}

async function recordFinanceEntry(tx, ctx, payload) {
  const direction = text(payload.direction, 'Tipo de movimiento', 10);
  if (!['income', 'expense'].includes(direction)) fail('invalid-argument', 'El movimiento debe ser ingreso o egreso.');
  const amountCents = positiveMoney(payload.amountCents, 'Importe');
  const description = text(payload.description, 'Descripción', 1000);
  const entryDate = date(payload.date);
  const entryRef = ref(ctx, 'financeEntries');
  tx.create(entryRef, { direction, amountCents, description, date: entryDate, ...created(ctx) });
  journal(tx, ctx, {
    sourceType: 'finance-entry', sourceId: entryRef.id, note: description, date: entryDate,
    lines: direction === 'income' ? [debit('1105', amountCents), credit('4205', amountCents)] : [debit('5195', amountCents), credit('1105', amountCents)],
  });
  return { id: entryRef.id };
}

async function saveMember(tx, ctx, payload) {
  const uid = key(payload.uid, 'UID');
  const memberRole = text(payload.role, 'Rol', 20);
  if (!['admin', 'operator', 'viewer'].includes(memberRole)) fail('invalid-argument', 'El rol no es válido.');
  const active = strictBoolean(payload.active, 'Activo');
  if (uid === ctx.uid && (!active || memberRole !== 'admin')) fail('failed-precondition', 'No puedes retirar tu propio acceso de administrador. Otro administrador debe realizar ese cambio.');
  const memberRef = ref(ctx, 'members', uid);
  const existing = await tx.get(memberRef);
  const record = { role: memberRole, active, ...meta(ctx) };
  if (existing.exists) tx.update(memberRef, record);
  else tx.create(memberRef, { ...record, ...created(ctx) });
  return { id: uid, role: memberRole, active };
}

async function saveContact(tx, ctx, payload) {
  const contactRef = payload.contactId ? ref(ctx, 'contacts', key(payload.contactId, 'Contacto')) : ref(ctx, 'contacts');
  const existing = payload.contactId ? await tx.get(contactRef) : null;
  if (payload.contactId && !existing.exists) fail('not-found', 'El contacto no existe.');
  const type = text(payload.type, 'Tipo', 10);
  if (!['customer', 'supplier'].includes(type)) fail('invalid-argument', 'El contacto debe ser cliente o proveedor.');
  const record = {
    type, name: text(payload.name, 'Nombre', 150), document: optionalText(payload.document, 'Documento', 60),
    email: optionalText(payload.email, 'Correo', 200), phone: optionalText(payload.phone, 'Teléfono', 50), ...meta(ctx),
  };
  if (record.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email)) fail('invalid-argument', 'El correo del contacto no es válido.');
  if (existing?.exists) tx.update(contactRef, record);
  else tx.create(contactRef, { ...record, ...created(ctx) });
  return { id: contactRef.id };
}

export const handlers = {
  'sales.create': command(createSale), 'sales.pay': command(paySale), 'sales.void': command(voidSale),
  'purchases.create': command(createPurchase), 'purchases.pay': command(payPurchase), 'purchases.void': command(voidPurchase),
  'production.bom': command(saveBom), 'production.plan': command(planProduction),
  'production.start': command(startProduction), 'production.complete': command(completeProduction), 'production.cancel': command(cancelProduction),
  'people.save': command(saveEmployee), 'people.attendance': command(recordAttendance),
  'payroll.create': command(createPayroll), 'payroll.pay': command(payPayroll), 'payroll.void': command(voidPayroll),
  'finance.entry': command(recordFinanceEntry), 'members.save': command(saveMember), 'contacts.save': command(saveContact),
};
