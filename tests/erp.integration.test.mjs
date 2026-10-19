import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { after, before, beforeEach, describe, test } from 'node:test'

// Import Admin SDK from the deployable Functions package, not from incidental CLI dependencies.
const requireFunctions = createRequire(new URL('../functions/package.json', import.meta.url))

describe('ERP transaccional: catálogo, permisos, dinero y trazabilidad', {
  skip: !process.env.FIRESTORE_EMULATOR_HOST,
}, () => {
  let adminApp
  let db
  let withCommand
  let handlers
  let companyId
  let org
  let removeApp
  let sequence = 0

  const rows = async (collection) => (await org.collection(collection).get()).docs.map((item) => ({ id: item.id, ...item.data() }))
  const read = async (collection, id) => (await org.collection(collection).doc(id).get()).data()
  const command = (action, payload, role = 'admin', requestId = randomUUID()) => withCommand(db, role, { companyId, action, requestId, payload }, handlers)
  const reject = (action, payload, role = 'admin', requestId) => assert.rejects(command(action, payload, role, requestId))

  async function catalog({ code = 'JEAN-100', name = 'Jeans Slim', kind = 'finished', unit = 'unidad', sku = 'JEAN-100-AZ-32', stock = 10, unitCostCents = 1000, priceCents = 2500, color = 'Azul', size = '32', lot = 'L-01' } = {}, role = 'admin') {
    const variant = { sku, stock, priceCents, minStock: 2, size, color, lot }
    if (role === 'admin') variant.unitCostCents = unitCostCents
    await command('catalog.create', {
      reference: { code, name, category: kind === 'material' ? 'Insumos' : 'Jeans', description: '', imageUrl: '', kind, unit },
      variants: [variant],
    }, role)
    const found = (await rows('variants')).find((item) => item.sku === sku)
    assert.ok(found, 'La variante debe persistirse con su SKU')
    return found
  }

  async function balancedLedger() {
    const journalRows = await rows('journals')
    const balances = {}
    for (const item of journalRows) {
      assert.ok(Array.isArray(item.lines) && item.lines.length >= 2, 'Un asiento requiere contrapartida')
      let debit = 0
      let credit = 0
      for (const line of item.lines) {
        assert.ok(Number.isSafeInteger(line.debitCents) && line.debitCents >= 0)
        assert.ok(Number.isSafeInteger(line.creditCents) && line.creditCents >= 0)
        assert.equal(Boolean(line.debitCents) && Boolean(line.creditCents), false, 'Una línea no debita y acredita a la vez')
        debit += line.debitCents
        credit += line.creditCents
        balances[line.account] = (balances[line.account] || 0) + line.debitCents - line.creditCents
      }
      assert.equal(debit, credit, `Asiento ${item.id} desbalanceado`)
      assert.ok(debit > 0)
    }
    assert.equal(Object.values(balances).reduce((sum, value) => sum + value, 0), 0)
    return { journals: journalRows, balances }
  }

  before(async () => {
    const { initializeApp, deleteApp } = requireFunctions('firebase-admin/app')
    const { getFirestore } = requireFunctions('firebase-admin/firestore')
    removeApp = deleteApp
    adminApp = initializeApp({ projectId: 'demo-inventario' }, `erp-tests-${process.pid}`)
    db = getFirestore(adminApp)
    const core = await import('../functions/lib/core.js')
    const catalogModule = await import('../functions/lib/catalog.js')
    const operationsModule = await import('../functions/lib/operations.js')
    withCommand = core.withCommand
    handlers = { ...catalogModule.handlers, ...operationsModule.handlers }
  })

  beforeEach(async () => {
    companyId = `erp-${process.pid}-${Date.now()}-${++sequence}`
    org = db.collection('organizations').doc(companyId)
    const batch = db.batch()
    batch.set(org, { name: 'EXLAIDER JEANS SAS' })
    for (const role of ['admin', 'operator', 'viewer']) batch.set(org.collection('members').doc(role), { role, active: true })
    batch.set(org.collection('members').doc('inactive'), { role: 'admin', active: false })
    batch.set(org.collection('members').doc('legacy-role'), { role: 'employee', active: true })
    await batch.commit()
  })

  after(async () => { if (adminApp) await removeApp(adminApp) })

  test('referencia única con muchas tallas/colores; rechaza nombres distintos y SKU duplicado sin escrituras parciales', async () => {
    const first = await catalog()
    const second = await catalog({ code: 'jean-100', name: '  JEANS   SLIM  ', sku: 'JEAN-100-NE-34', color: 'Negro', size: '34' })
    assert.equal(first.referenceKey, second.referenceKey)
    assert.equal((await rows('references')).length, 1)
    await reject('catalog.create', {
      reference: { code: 'JEAN-100', name: 'Camisa de algodón', category: 'Camisas', kind: 'finished', unit: 'unidad' },
      variants: [{ sku: 'CAMISA-01', stock: 1, priceCents: 1000, minStock: 0, color: 'Blanco', size: 'M', lot: '' }],
    })
    await reject('catalog.create', {
      reference: { code: 'OTHER', name: 'Otro producto', category: 'Jeans', kind: 'finished', unit: 'unidad' },
      variants: [{ sku: 'jean-100-az-32', stock: 0, priceCents: 1000, minStock: 0, color: '', size: '', lot: '' }],
    })
    assert.equal((await rows('variants')).length, 2)
    assert.equal((await rows('references')).length, 1, 'El rechazo no debe dejar una referencia huérfana')
    await command('catalog.reference', { referenceKey: first.referenceKey, name: 'Jeans Slim Premium', category: 'Jeans', description: 'Nombre canónico', imageUrl: '', kind: 'material', unit: 'g' }, 'operator')
    const renamed = await read('references', first.referenceKey)
    assert.equal(renamed.name, 'Jeans Slim Premium')
    assert.equal(renamed.kind, 'finished', 'Editar el nombre no puede convertir la referencia en materia prima')
    assert.equal(renamed.unit, 'unidad', 'La unidad original permanece fija para todas las variantes')
    for (const variant of await rows('variants')) {
      assert.equal(variant.referenceKey, first.referenceKey)
      assert.equal((await read('references', variant.referenceKey)).name, 'Jeans Slim Premium')
      assert.equal(variant.kind, 'finished')
    }
    await balancedLedger()
  })

  test('permisos del servidor: sin sesión/membresía, viewer, inactivos y otra empresa no mutan', async () => {
    const item = await catalog()
    await assert.rejects(withCommand(db, null, { companyId, action: 'stock.receive', requestId: randomUUID(), payload: { variantId: item.id, quantity: 1 } }, handlers))
    for (const uid of ['viewer', 'outsider', 'inactive', 'legacy-role']) await reject('stock.receive', { variantId: item.id, quantity: 1 }, uid)
    await reject('finance.entry', { direction: 'income', amountCents: 1000, description: 'No permitido', date: '2026-10-19' }, 'operator')
    await reject('stock.adjust', { variantId: item.id, delta: -1, reason: 'No permitido' }, 'operator')
    const otherCompany = `${companyId}-other`
    await db.doc(`organizations/${otherCompany}/members/operator`).set({ role: 'operator', active: true })
    await assert.rejects(withCommand(db, 'operator', {
      companyId: otherCompany,
      action: 'stock.receive',
      requestId: randomUUID(),
      payload: { variantId: item.id, quantity: 5 },
    }, handlers))
    assert.equal((await read('variants', item.id)).stock, 10)
    for (const [action, handler] of Object.entries(handlers)) {
      for (const role of ['viewer', ...(handler.roles.includes('operator') ? [] : ['operator'])]) {
        await assert.rejects(command(action, {}, role), (error) => error.code === 'permission-denied', `Rol ${role} no puede ejecutar ${action}`)
      }
    }
  })

  test('una operación crea varias variantes, normaliza combinaciones y protege referencia/SKU en concurrencia', async () => {
    const reference = { code: 'REF.MULTI', name: 'Jeans Multi', category: 'Jeans', kind: 'finished', unit: 'unidad' }
    await command('catalog.create', { reference, variants: [
      { sku: 'MULTI-AZ-30', size: '30', color: 'Azul', lot: 'L-1', stock: 1, priceCents: 9000, minStock: 0, unitCostCents: 1000 },
      { sku: 'MULTI-NE-32', size: '32', color: 'Negro', lot: 'L-1', stock: 2, priceCents: 9000, minStock: 0, unitCostCents: 1000 },
    ] })
    assert.equal((await rows('references')).length, 1)
    assert.equal((await rows('variants')).length, 2)
    await reject('catalog.create', { reference, variants: [{ sku: 'DUPLICATE-COMBINATION', size: ' 30 ', color: ' AZUL ', lot: 'l-1', stock: 0, priceCents: 1, minStock: 0 }] })
    const outcomes = await Promise.allSettled(['Modelo A', 'Modelo B'].map((name, index) => command('catalog.create', {
      reference: { ...reference, code: 'CONCURRENT', name },
      variants: [{ sku: `CONCURRENT-${index}`, size: 'M', color: 'Azul', lot: '', stock: 0, priceCents: 1, minStock: 0 }],
    })))
    assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 1)
    assert.equal(outcomes.filter((item) => item.status === 'rejected').length, 1)
    const sameSku = await Promise.allSettled(['SKU-REF-A', 'SKU-REF-B'].map((code) => command('catalog.create', {
      reference: { ...reference, code },
      variants: [{ sku: 'ONE-SHARED-SKU', size: '', color: '', lot: '', stock: 0, priceCents: 1, minStock: 0 }],
    })))
    assert.equal(sameSku.filter((item) => item.status === 'fulfilled').length, 1)
    assert.equal((await rows('variants')).filter((item) => item.sku === 'ONE-SHARED-SKU').length, 1)
    await balancedLedger()
  })

  test('comandos idempotentes: reintentar no suma dos veces y cambiar payload/actor con el mismo ID falla', async () => {
    const item = await catalog()
    const requestId = randomUUID()
    const payload = { variantId: item.id, quantity: 3, reason: 'Recepción QR' }
    const [first, retry] = await Promise.all([
      command('stock.receive', payload, 'operator', requestId),
      command('stock.receive', payload, 'operator', requestId),
    ])
    const withoutReplayFlag = (value) => { const result = { ...value }; delete result.replayed; return result }
    assert.deepEqual(withoutReplayFlag(first), withoutReplayFlag(retry))
    assert.equal((await read('variants', item.id)).stock, 13)
    assert.equal((await read('costs', item.id)).stockValueCents, 10000, 'Una recepción sin costo no inventa adquisición al costo promedio anterior')
    assert.equal((await read('costs', item.id)).unvaluedQuantity, 3)
    await reject('stock.receive', { ...payload, quantity: 4 }, 'operator', requestId)
    await reject('stock.receive', payload, 'admin', requestId)
    assert.equal((await rows('commands')).length, 2, 'Crear + recibir una vez')
    assert.equal((await rows('audit')).length, 2)
    assert.equal((await rows('movements')).length, 2)
    await balancedLedger()
  })

  test('ingresos simultáneos conservan unidades; cantidades/costos inválidos se rechazan', async () => {
    const item = await catalog()
    await Promise.all([
      ...[1, 2, 3, 4].map((quantity) => command('stock.receive', { variantId: item.id, quantity, reason: 'Conteo concurrente' }, 'operator')),
      command('catalog.variant', { variantId: item.id, sku: item.sku, size: item.size, color: item.color, lot: item.lot, priceCents: 2600, minStock: 3, stock: 999 }, 'operator'),
    ])
    assert.equal((await read('variants', item.id)).stock, 20)
    assert.equal((await read('variants', item.id)).priceCents, 2600)
    assert.equal((await read('costs', item.id)).stockValueCents, 10000, 'Diez unidades sin costo no inflan el valor de adquisición')
    assert.equal((await read('costs', item.id)).unvaluedQuantity, 10)
    for (const quantity of [0, -1, 1.5, 1e12]) await reject('stock.receive', { variantId: item.id, quantity }, 'operator')
    await reject('stock.receive', { variantId: item.id, quantity: 1, unitCostCents: 100 }, 'operator')
    await reject('stock.receive', { variantId: item.id, quantity: 1, unitCostCents: -1 })
    assert.equal((await read('variants', item.id)).stock, 20)
    const movements = await rows('movements')
    assert.equal(movements.reduce((sum, row) => sum + row.delta, 0), 20)
    assert.ok(movements.every((row) => !('costCents' in row) && !('stockValueCents' in row) && !('unitCostCents' in row)))
    const ledger = await balancedLedger()
    assert.equal(ledger.balances['1435'], 10000)
    assert.equal(ledger.balances['4205'] || 0, 0, 'Una recepción sin costo no genera ingresos contables estimados')
  })

  test('admin también deja sin valorar recepciones sin costo; únicamente un costo explícito aumenta la valoración', async () => {
    const item = await catalog({ stock: 5 })
    await command('stock.receive', { variantId: item.id, quantity: 2, reason: 'Recepción pendiente de factura' })
    assert.equal((await read('costs', item.id)).stockValueCents, 5000)
    assert.equal((await read('costs', item.id)).unvaluedQuantity, 2)
    await command('stock.receive', { variantId: item.id, quantity: 3, unitCostCents: 2000, reason: 'Costo documentado' })
    assert.equal((await read('variants', item.id)).stock, 10)
    assert.equal((await read('costs', item.id)).stockValueCents, 11000)
    assert.equal((await read('costs', item.id)).unvaluedQuantity, 2)
    const ledger = await balancedLedger()
    assert.equal(ledger.balances['1435'], 11000)
    assert.equal(ledger.balances['4205'], -6000)
  })

  test('venta, abonos y anulación mantienen stock, costo y partida doble; conserva el historial', async () => {
    const item = await catalog()
    await command('sales.create', { customerName: 'Cliente Bogotá', lines: [{ variantId: item.id, quantity: 2 }], paidCents: 1000, notes: 'Venta de prueba' })
    const sale = (await rows('sales'))[0]
    assert.equal(sale.totalCents, 5000)
    assert.equal(sale.paidCents, 1000)
    assert.equal((await read('variants', item.id)).stock, 8)
    assert.equal((await read('costs', item.id)).stockValueCents, 8000)
    await command('sales.pay', { saleId: sale.id, amountCents: 2000 })
    await reject('sales.pay', { saleId: sale.id, amountCents: 2001 })
    const beforeVoid = await balancedLedger()
    assert.equal(beforeVoid.balances['4135'], -5000)
    assert.equal(beforeVoid.balances['6135'], 2000)
    assert.equal(beforeVoid.balances['1305'], 2000)
    assert.equal(beforeVoid.balances['1105'], 3000)
    const originalIds = beforeVoid.journals.map((row) => row.id)
    await command('sales.void', { saleId: sale.id, reason: 'Devolución completa autorizada' })
    assert.equal((await read('sales', sale.id)).status, 'void')
    assert.equal((await read('variants', item.id)).stock, 10)
    assert.equal((await read('costs', item.id)).stockValueCents, 10000)
    const afterVoid = await balancedLedger()
    for (const code of ['4135', '6135', '1305', '1105']) assert.equal(afterVoid.balances[code] || 0, 0)
    assert.ok(originalIds.every((id) => afterVoid.journals.some((row) => row.id === id)), 'No se borran asientos originales')
    await reject('sales.void', { saleId: sale.id, reason: 'Duplicado' })
    await reject('sales.pay', { saleId: sale.id, amountCents: 1 })
    assert.ok((await rows('audit')).length >= 4)
  })

  test('ventas concurrentes no sobre-venden; una venta rechazada no deja factura ni asiento parcial', async () => {
    const item = await catalog()
    const outcomes = await Promise.allSettled([1, 2].map((number) => command('sales.create', {
      customerName: `Cliente ${number}`, lines: [{ variantId: item.id, quantity: 7 }], paidCents: 0, notes: '',
    })))
    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1)
    assert.equal(outcomes.filter((outcome) => outcome.status === 'rejected').length, 1)
    assert.equal((await read('variants', item.id)).stock, 3)
    assert.equal((await rows('sales')).length, 1)
    assert.equal((await read('costs', item.id)).stockValueCents, 3000)
    await balancedLedger()
  })

  test('compra suma costo real y unidades; pagos parciales sólo saldan lo pendiente', async () => {
    const item = await catalog()
    await command('purchases.create', { supplierName: 'Proveedor Denim', lines: [{ variantId: item.id, quantity: 5, unitCostCents: 1600 }], paidCents: 2000, notes: '' })
    const purchase = (await rows('purchases'))[0]
    assert.equal(purchase.totalCents, 8000)
    assert.equal((await read('variants', item.id)).stock, 15)
    assert.equal((await read('costs', item.id)).stockValueCents, 18000)
    await command('purchases.pay', { purchaseId: purchase.id, amountCents: 6000 })
    assert.equal((await read('purchases', purchase.id)).paidCents, 8000)
    await reject('purchases.pay', { purchaseId: purchase.id, amountCents: 1 })
    const ledger = await balancedLedger()
    assert.equal(ledger.balances['2205'] || 0, 0)
    assert.equal(ledger.balances['1105'], -8000)
  })

  test('anular compra compensa proveedores/caja y conserva la diferencia del costo promedio', async () => {
    const item = await catalog()
    await command('purchases.create', { supplierName: 'Proveedor Denim', lines: [{ variantId: item.id, quantity: 5, unitCostCents: 1600 }], paidCents: 2000, notes: '' })
    const purchase = (await rows('purchases'))[0]
    const oldJournals = (await rows('journals')).map((row) => row.id)
    await command('purchases.void', { purchaseId: purchase.id, reason: 'Devolución al proveedor' })
    assert.equal((await read('purchases', purchase.id)).status, 'void')
    assert.equal((await read('variants', item.id)).stock, 10)
    const ledger = await balancedLedger()
    assert.equal(ledger.balances['2205'] || 0, 0)
    assert.equal(ledger.balances['1105'] || 0, 0)
    assert.equal(ledger.balances['1435'], (await read('costs', item.id)).stockValueCents)
    assert.ok(oldJournals.every((id) => ledger.journals.some((row) => row.id === id)))
    await reject('purchases.void', { purchaseId: purchase.id, reason: 'Duplicado' })
    await reject('purchases.pay', { purchaseId: purchase.id, amountCents: 1 })
  })

  test('producción consume materia prima, pasa su costo por proceso y entrega producto terminado', async () => {
    const material = await catalog({ code: 'TELA-01', name: 'Tela índigo', kind: 'material', unit: 'cm', sku: 'TELA-01-AZ', stock: 1000, unitCostCents: 2, priceCents: 0, size: '', color: 'Azul', lot: 'TELA-LOTE' })
    const finished = await catalog({ stock: 0, unitCostCents: 0 })
    await command('production.bom', { outputVariantId: finished.id, inputs: [{ variantId: material.id, quantity: 200 }] })
    const bom = (await rows('productionBoms'))[0]
    await command('production.plan', { bomId: bom.id, quantity: 3, notes: 'Tres jeans' })
    const order = (await rows('productionOrders'))[0]
    await command('production.start', { orderId: order.id })
    assert.equal((await read('variants', material.id)).stock, 400)
    assert.equal((await read('productionOrders', order.id)).status, 'in_progress')
    let ledger = await balancedLedger()
    assert.equal(ledger.balances['1430'], 1200)
    await command('production.complete', { orderId: order.id, quantity: 3 })
    assert.equal((await read('variants', finished.id)).stock, 3)
    assert.equal((await read('costs', finished.id)).stockValueCents, 1200)
    assert.equal((await read('productionOrders', order.id)).status, 'completed')
    await reject('production.complete', { orderId: order.id, quantity: 3 })
    ledger = await balancedLedger()
    assert.equal(ledger.balances['1430'] || 0, 0)
    assert.equal(ledger.balances['1405'], 800)
    assert.equal(ledger.balances['1435'], 1200)
  })

  test('cancelar producción en proceso devuelve materiales y su costo histórico', async () => {
    const material = await catalog({ code: 'INSUMO', name: 'Botones', kind: 'material', sku: 'BTN-01', stock: 100, unitCostCents: 5, priceCents: 0 })
    const finished = await catalog({ stock: 0, unitCostCents: 0 })
    await command('production.bom', { outputVariantId: finished.id, inputs: [{ variantId: material.id, quantity: 2 }] })
    const bom = (await rows('productionBoms'))[0]
    await command('production.plan', { bomId: bom.id, quantity: 5, notes: '' })
    const order = (await rows('productionOrders'))[0]
    await command('production.start', { orderId: order.id })
    await command('production.cancel', { orderId: order.id, reason: 'Orden detenida' })
    assert.equal((await read('variants', material.id)).stock, 100)
    assert.equal((await read('costs', material.id)).stockValueCents, 500)
    assert.equal((await read('variants', finished.id)).stock, 0)
    assert.equal((await read('productionOrders', order.id)).status, 'cancelled')
    assert.equal((await balancedLedger()).balances['1430'] || 0, 0)
    await reject('production.start', { orderId: order.id })
  })

  test('producción sin materiales suficientes revierte todas las líneas y no deja proceso contable', async () => {
    const first = await catalog({ code: 'SUFICIENTE', name: 'Cierres', kind: 'material', sku: 'CIERRES', stock: 100, unitCostCents: 3, priceCents: 0 })
    const missing = await catalog({ code: 'INSUFICIENTE', name: 'Botones', kind: 'material', sku: 'BOTONES', stock: 1, unitCostCents: 4, priceCents: 0 })
    const finished = await catalog({ stock: 0, unitCostCents: 0 })
    await command('production.bom', { outputVariantId: finished.id, inputs: [{ variantId: first.id, quantity: 1 }, { variantId: missing.id, quantity: 1 }] })
    const bom = (await rows('productionBoms'))[0]
    await command('production.plan', { bomId: bom.id, quantity: 3, notes: '' })
    const order = (await rows('productionOrders'))[0]
    const movementsBefore = (await rows('movements')).length
    const journalsBefore = (await rows('journals')).length
    await reject('production.start', { orderId: order.id })
    assert.equal((await read('variants', first.id)).stock, 100)
    assert.equal((await read('variants', missing.id)).stock, 1)
    assert.equal((await read('productionOrders', order.id)).status, 'planned')
    assert.equal((await rows('movements')).length, movementsBefore)
    assert.equal((await rows('journals')).length, journalsBefore)
    await balancedLedger()
  })

  test('materia prima sin valorar mantiene la advertencia al producir y recupera su estado al cancelar', async () => {
    const material = await catalog({ code: 'PENDIENTE', name: 'Tela sin costo', kind: 'material', unit: 'cm', sku: 'TELA-PENDIENTE', stock: 10, priceCents: 0 }, 'operator')
    const finished = await catalog({ stock: 0, unitCostCents: 0 })
    assert.equal((await read('costs', material.id)).unvaluedQuantity, 10)
    await command('production.bom', { outputVariantId: finished.id, inputs: [{ variantId: material.id, quantity: 2 }] })
    const bom = (await rows('productionBoms'))[0]
    await command('production.plan', { bomId: bom.id, quantity: 3, notes: '' })
    const order = (await rows('productionOrders'))[0]
    await command('production.start', { orderId: order.id })
    assert.equal((await read('productionOrders', order.id)).hasUnvaluedCost, true)
    await command('production.complete', { orderId: order.id, quantity: 3 })
    assert.equal((await read('costs', finished.id)).unvaluedQuantity, 3)
    await command('production.cancel', { orderId: order.id, reason: 'Reversión completa de prueba' })
    assert.equal((await read('variants', finished.id)).stock, 0)
    assert.equal((await read('costs', finished.id)).unvaluedQuantity, 0)
    assert.equal((await read('variants', material.id)).stock, 10)
    assert.equal((await read('costs', material.id)).unvaluedQuantity, 10)
    await balancedLedger()
  })

  test('nómina interna guarda empleados/asistencia, evita duplicar periodo y registra pago parcial', async () => {
    await command('people.save', { name: 'Empleado Prueba', document: 'TEST-123', position: 'Corte', department: 'Producción', email: '', phone: '', baseSalaryCents: 20000000, active: true, startDate: '2026-10-01' })
    const employee = (await rows('employees'))[0]
    await command('people.attendance', { employeeId: employee.id, date: '2026-10-19', status: 'present', minutes: 480 })
    await command('people.attendance', { employeeId: employee.id, date: '2026-10-19', status: 'leave', minutes: 0 })
    assert.equal((await rows('attendance')).length, 1)
    assert.equal((await rows('attendance'))[0].status, 'leave')
    await command('payroll.create', { employeeId: employee.id, period: '2026-10', additionsCents: 200000, deductionsCents: 100000 })
    const payroll = (await rows('payroll'))[0]
    assert.equal(payroll.grossCents, 20200000)
    assert.equal(payroll.netCents, 20100000)
    await reject('payroll.create', { employeeId: employee.id, period: '2026-10', additionsCents: 0, deductionsCents: 0 })
    await command('payroll.pay', { payrollId: payroll.id, amountCents: 10000000 })
    await command('payroll.pay', { payrollId: payroll.id, amountCents: 10100000 })
    await reject('payroll.pay', { payrollId: payroll.id, amountCents: 1 })
    const ledger = await balancedLedger()
    assert.equal(ledger.balances['2505'] || 0, 0)
    assert.equal(ledger.balances['2365'], -100000)
    assert.equal(ledger.balances['5105'], 20200000)
    await reject('payroll.void', { payrollId: payroll.id, reason: 'No debe anular pagos ya efectuados' })
  })

  test('nómina sin pagos puede anularse y corregirse conservando el historial del mismo período', async () => {
    await command('people.save', { name: 'Empleado Corrección', document: 'CORR-123', position: 'Costura', department: 'Producción', email: '', phone: '', baseSalaryCents: 10000000, active: true, startDate: '2026-10-01' })
    const employee = (await rows('employees'))[0]
    await command('payroll.create', { employeeId: employee.id, period: '2026-10', additionsCents: 100000, deductionsCents: 0 })
    const payroll = (await rows('payroll'))[0]
    await command('payroll.void', { payrollId: payroll.id, reason: 'Corrección del devengado' })
    assert.equal((await read('payroll', payroll.id)).status, 'void')
    assert.equal((await balancedLedger()).balances['5105'] || 0, 0)
    await command('payroll.create', { employeeId: employee.id, period: '2026-10', additionsCents: 200000, deductionsCents: 0 })
    const payrollRows = await rows('payroll')
    assert.equal(payrollRows.length, 2)
    assert.equal(payrollRows.filter((row) => row.status === 'posted').length, 1)
    assert.equal((await balancedLedger()).balances['5105'], 10200000)
  })

  test('ajuste admin exige motivo, no permite stock negativo; archivado conserva historial e índice', async () => {
    const item = await catalog({ stock: 2 })
    await reject('stock.adjust', { variantId: item.id, delta: -1, reason: '' })
    await reject('stock.adjust', { variantId: item.id, delta: -3, reason: 'Conteo' })
    await reject('catalog.archive', { variantId: item.id, active: false })
    await command('stock.adjust', { variantId: item.id, delta: -2, reason: 'Merma inventariada' })
    await command('catalog.archive', { variantId: item.id, active: false })
    assert.equal((await read('variants', item.id)).active, false)
    await reject('stock.receive', { variantId: item.id, quantity: 1 }, 'operator')
    await command('catalog.archive', { variantId: item.id, active: true })
    assert.equal((await read('variants', item.id)).active, true)
    assert.ok((await rows('movements')).length >= 2)
    await balancedLedger()
  })

  test('migración conserva IDs/QR y originales, rechaza referencias ambiguas y permite remapear', async () => {
    const legacy = (name, sku) => ({ name, sku, reference: 'OLD-REF', category: 'Jeans', description: '', size: '32', color: 'Azul', lot: 'LOTE', imageUrl: '', price: 129900, stock: 3, minStock: 1, currency: 'COP' })
    await org.collection('products').doc('legacy-one').set(legacy('Jeans Clásico', 'OLD-ONE'))
    await org.collection('products').doc('legacy-two').set(legacy('Bermuda Clásica', 'OLD-TWO'))
    await command('catalog.migrate', { items: [{ legacyId: 'legacy-one' }] })
    assert.equal((await read('variants', 'legacy-one')).priceCents, 12990000)
    assert.equal((await read('variants', 'legacy-one')).stock, 3)
    assert.equal((await read('costs', 'legacy-one')).stockValueCents, 0, 'No inventa costos usando el precio de venta')
    await reject('catalog.migrate', { items: [{ legacyId: 'legacy-two' }] })
    await command('catalog.migrate', { items: [{ legacyId: 'legacy-two', referenceCode: 'BERMUDA-OLD' }] })
    assert.ok(await read('products', 'legacy-one'))
    assert.ok(await read('products', 'legacy-two'))
    assert.ok(await read('variants', 'legacy-two'))
    await command('catalog.migrate', { items: [{ legacyId: 'legacy-one' }] })
    assert.equal((await rows('variants')).length, 2, 'Repetir la migración no duplica inventario')
    await reject('stock.value', { variantId: 'legacy-one', unitCostCents: 5000, reason: 'Costo inicial' }, 'operator')
    await command('stock.value', { variantId: 'legacy-one', unitCostCents: 5000, reason: 'Valor de adquisición documentado' })
    assert.equal((await read('variants', 'legacy-one')).stock, 3)
    assert.equal((await read('costs', 'legacy-one')).stockValueCents, 15000)
    assert.equal((await read('costs', 'legacy-one')).unvaluedQuantity, 0)
    await balancedLedger()
  })

  test('administrador gestiona roles y desactivación sin poder bloquear su propio acceso', async () => {
    await command('members.save', { uid: 'operator', role: 'viewer', active: true })
    assert.equal((await read('members', 'operator')).role, 'viewer')
    await reject('catalog.create', { reference: {}, variants: [] }, 'operator')
    await command('members.save', { uid: 'operator', role: 'admin', active: true })
    await command('members.save', { uid: 'viewer', role: 'viewer', active: false })
    assert.equal((await read('members', 'viewer')).active, false)
    await reject('members.save', { uid: 'admin', role: 'operator', active: true })
    await reject('members.save', { uid: 'admin', role: 'admin', active: false })
    await reject('members.save', { uid: 'viewer', role: 'employee', active: true })
    assert.equal((await read('members', 'admin')).role, 'admin')
    assert.equal((await read('members', 'admin')).active, true)
  })

  test('revocaciones cruzadas concurrentes preservan al menos un administrador activo', async () => {
    await command('members.save', { uid: 'operator', role: 'admin', active: true })
    await Promise.allSettled([
      command('members.save', { uid: 'operator', role: 'viewer', active: false }, 'admin'),
      command('members.save', { uid: 'admin', role: 'viewer', active: false }, 'operator'),
    ])
    const activeAdmins = (await rows('members')).filter((member) => member.role === 'admin' && member.active === true)
    assert.ok(activeAdmins.length >= 1, 'Las operaciones no pueden retirar el último administrador')
  })

  test('egresos/ingresos internos se contabilizan y no aceptan importes ni fechas inválidas', async () => {
    await command('finance.entry', { direction: 'income', amountCents: 500000, description: 'Otros ingresos', date: '2026-10-19' })
    await command('finance.entry', { direction: 'expense', amountCents: 150000, description: 'Transporte', date: '2026-10-19' })
    for (const amountCents of [-1, 0, 1.5, Number.MAX_SAFE_INTEGER]) await reject('finance.entry', { direction: 'income', amountCents, description: 'Inválido', date: '2026-10-19' })
    await reject('finance.entry', { direction: 'expense', amountCents: 100, description: 'Fecha inválida', date: '2026-02-30' })
    assert.equal((await rows('financeEntries')).length, 2)
    const ledger = await balancedLedger()
    assert.equal(ledger.balances['1105'], 350000)
    assert.equal(ledger.balances['4205'], -500000)
    assert.equal(ledger.balances['5195'], 150000)
  })
})
