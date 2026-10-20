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
    if (role === 'admin' && unitCostCents !== null) variant.unitCostCents = unitCostCents
    await command('catalog.create', {
      reference: { code, name, category: kind === 'material' ? 'Insumos' : 'Jeans', description: '', imageUrl: '', kind, unit },
      variants: [variant],
    }, role)
    const found = (await rows('variants')).find((item) => item.sku === sku)
    assert.ok(found, 'La variante debe persistirse con su SKU')
    return found
  }

  function assertSalePresentation(value) {
    const allowed = new Set(['id', 'totalCents', 'paidCents', 'replayed'])
    assert.ok(Object.keys(value).every((key) => allowed.has(key)), 'La respuesta del vendedor sólo incluye identificador e importes de venta')
    assert.equal(typeof value.id, 'string')
    assert.ok(Number.isSafeInteger(value.totalCents))
    assert.ok(Number.isSafeInteger(value.paidCents))
  }

  function assertSalesDesk(value) {
    const allowed = new Set(['sellerUid', 'customerName', 'lines', 'totalCents', 'paidCents', 'balanceCents', 'status', 'notes', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'])
    const lineFields = new Set(['variantId', 'referenceKey', 'sku', 'name', 'size', 'color', 'lot', 'quantity', 'unitPriceCents', 'totalCents'])
    assert.ok(value, 'Toda venta tiene una proyección pública persistida')
    assert.ok(Object.keys(value).every((key) => allowed.has(key)), 'salesDesk usa una lista explícita de campos sin costos privados')
    assert.ok(value.lines.length > 0)
    for (const line of value.lines) {
      assert.ok(Object.keys(line).every((key) => lineFields.has(key)), 'Las líneas no revelan adquisición, cuenta de inventario ni estado de valoración')
      assert.equal(line.totalCents, line.quantity * line.unitPriceCents)
    }
    assert.equal(value.balanceCents, value.status === 'void' ? 0 : value.totalCents - value.paidCents)
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
    for (const role of ['admin', 'operator', 'seller', 'viewer']) batch.set(org.collection('members').doc(role), { role, active: true })
    batch.set(org.collection('members').doc('seller-other'), { role: 'seller', active: true })
    batch.set(org.collection('members').doc('admin-other'), { role: 'admin', active: true })
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
    await command('catalog.reference', { referenceKey: first.referenceKey, name: 'Jeans Slim Premium', category: 'Jeans', description: 'Nombre canónico', imageUrl: '', kind: 'material', unit: 'g' })
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
      assert.ok(handler.roles.includes('admin'), `Administrador dispone de ${action}`)
      assert.equal(handler.roles.includes('operator'), action === 'stock.receive', `Operador sólo puede ejecutar stock.receive: ${action}`)
      assert.equal(handler.roles.includes('seller'), ['sales.create', 'sales.pay'].includes(action), `Vendedor sólo crea ventas y abonos: ${action}`)
      for (const role of ['viewer', ...(['operator', 'seller'].filter((candidate) => !handler.roles.includes(candidate)))]) {
        await assert.rejects(command(action, {}, role), (error) => error.code === 'permission-denied', `Rol ${role} no puede ejecutar ${action}`)
      }
    }
  })

  test('operador sólo ingresa cantidades positivas de variantes existentes; no crea ni edita catálogo ni sus precios', async () => {
    const item = await catalog()
    await reject('catalog.create', {
      reference: { code: 'OP-CREATE', name: 'No crear', category: 'Jeans', kind: 'finished', unit: 'unidad' },
      variants: [{ sku: 'OP-CREATE-32', stock: 1, priceCents: 999, minStock: 0, size: '32', color: 'Azul', lot: '' }],
    }, 'operator')
    await reject('catalog.reference', { referenceKey: item.referenceKey, name: 'Nombre no autorizado', category: 'Jeans', description: '', imageUrl: '' }, 'operator')
    await reject('catalog.variant', { variantId: item.id, sku: 'OP-CHANGED', size: '40', color: 'Rojo', lot: 'X', priceCents: 1, minStock: 0 }, 'operator')
    await reject('stock.receive', { variantId: 'does-not-exist', quantity: 1 }, 'operator')
    await command('stock.receive', { variantId: item.id, quantity: 2, reason: 'Operador recibe' }, 'operator')
    const current = await read('variants', item.id)
    assert.equal(current.stock, 12)
    assert.equal(current.sku, item.sku)
    assert.equal(current.priceCents, 2500)
    assert.equal((await read('references', item.referenceKey)).name, 'Jeans Slim')
    assert.equal((await rows('variants')).length, 1)
    assert.equal((await read('costs', item.id)).stockValueCents, 10000)
    const movement = (await rows('movements')).find((row) => row.createdBy === 'operator')
    assert.equal(movement.delta, 2)
    assert.equal(movement.variantId, item.id)
  })

  test('vendedor usa precio oficial, sólo cobra sus ventas y recibe proyecciones sin información de costos', async () => {
    const item = await catalog()
    const payload = { customerName: 'Cliente vendedor', lines: [{ variantId: item.id, quantity: 2 }], paidCents: 0, notes: 'Venta propia' }
    for (const unitPriceCents of [2400, 2501]) await reject('sales.create', { ...payload, lines: [{ variantId: item.id, quantity: 2, unitPriceCents }] }, 'seller')
    await org.collection('contacts').doc('private-customer').set({ type: 'customer', name: 'Cliente reservado' })
    await reject('sales.create', { ...payload, contactId: 'private-customer' }, 'seller')
    assert.equal((await rows('sales')).length, 0)
    await reject('sales.create', { ...payload, sellerUid: 'seller-other' }, 'seller')
    const result = await command('sales.create', payload, 'seller')
    assertSalePresentation(result)
    assert.equal(result.totalCents, 5000)
    const sale = await read('sales', result.id)
    assert.equal(sale.sellerUid, 'seller', 'El vendedor no puede atribuir la venta a otra cuenta')
    assert.equal(sale.costCents, 2000, 'La valoración se conserva únicamente en la factura privada')
    let desk = await read('salesDesk', result.id)
    assertSalesDesk(desk)
    assert.equal(desk.sellerUid, 'seller')
    assert.equal(desk.lines[0].unitPriceCents, 2500)
    await assert.rejects(withCommand(db, 'seller', { companyId: `${companyId}-foreign`, action: 'sales.pay', requestId: randomUUID(), payload: { saleId: result.id, amountCents: 1000 } }, handlers), (error) => error.code === 'permission-denied')
    await reject('sales.pay', { saleId: result.id, amountCents: 1000 }, 'seller-other')
    await command('sales.pay', { saleId: result.id, amountCents: 1000 }, 'seller')
    desk = await read('salesDesk', result.id)
    assertSalesDesk(desk)
    assert.equal(desk.paidCents, 1000)
    for (const sellerUid of ['viewer', 'operator', 'inactive', 'outsider']) await reject('sales.assign', { saleId: result.id, sellerUid })
    await reject('sales.assign', { saleId: result.id, sellerUid: 'seller-other' }, 'seller')
    await command('sales.assign', { saleId: result.id, sellerUid: 'seller-other' })
    assert.equal((await read('sales', result.id)).sellerUid, 'seller-other')
    assertSalesDesk(await read('salesDesk', result.id))
    assert.equal((await read('salesDesk', result.id)).sellerUid, 'seller-other')
    await reject('sales.pay', { saleId: result.id, amountCents: 1000 }, 'seller')
    await command('sales.pay', { saleId: result.id, amountCents: 1000 }, 'seller-other')
    await reject('sales.void', { saleId: result.id, reason: 'Vendedor sin facultad de anulación' }, 'seller-other')
    assert.equal((await read('sales', result.id)).paidCents, 2000)
    await command('sales.void', { saleId: result.id, reason: 'Administrador autoriza devolución' })
    assert.equal((await read('salesDesk', result.id)).status, 'void')
    assertSalesDesk(await read('salesDesk', result.id))
    assert.equal((await read('variants', item.id)).stock, 10)
    await balancedLedger()
  })

  test('reintento de venta después de degradar administrador filtra el resultado guardado y no duplica stock', async () => {
    const item = await catalog()
    const requestId = randomUUID()
    const payload = { customerName: 'Venta antes de degradación', lines: [{ variantId: item.id, quantity: 2 }], paidCents: 0, notes: '' }
    const initial = await command('sales.create', payload, 'admin', requestId)
    assert.equal(initial.costCents, 2000)
    await command('members.save', { uid: 'admin', role: 'seller', active: true }, 'admin-other')
    const replay = await command('sales.create', payload, 'admin', requestId)
    assert.equal(replay.replayed, true)
    assertSalePresentation(replay)
    assert.equal(replay.id, initial.id)
    assert.equal((await read('variants', item.id)).stock, 8)
    assert.equal((await rows('sales')).length, 1)
    assert.equal((await read('sales', initial.id)).costCents, 2000)
    assertSalesDesk(await read('salesDesk', initial.id))
    await reject('stock.receive', { variantId: item.id, quantity: 1 }, 'admin')
    await reject('sales.pay', { saleId: initial.id, amountCents: 1 }, 'seller')
    await command('sales.pay', { saleId: initial.id, amountCents: 100 }, 'admin')
    await balancedLedger()
  })

  test('administrador asigna una venta histórica sin proyección sin publicar costos ni permitir cobros ajenos', async () => {
    const item = await catalog()
    const result = await command('sales.create', { customerName: 'Venta anterior', lines: [{ variantId: item.id, quantity: 1 }], paidCents: 0 })
    await org.collection('salesDesk').doc(result.id).delete()
    await org.collection('sales').doc(result.id).update({ sellerUid: requireFunctions('firebase-admin/firestore').FieldValue.delete() })
    await reject('sales.pay', { saleId: result.id, amountCents: 100 }, 'seller')
    await command('sales.assign', { saleId: result.id, sellerUid: 'seller' })
    assertSalesDesk(await read('salesDesk', result.id))
    await command('sales.pay', { saleId: result.id, amountCents: 100 }, 'seller')
    assert.equal((await read('salesDesk', result.id)).paidCents, 100)
    assert.equal((await read('sales', result.id)).costCents, 1000)
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

  test('cambiar SKU conserva alias e índices: etiquetas anteriores nunca apuntan a otro producto y se puede deshacer', async () => {
    const item = await catalog()
    const original = item.sku
    const second = 'JEAN-100-AZ-32-V2'
    const third = 'JEAN-100-AZ-32-V3'
    const edit = (sku) => command('catalog.variant', {
      variantId: item.id, sku, size: item.size, color: item.color, lot: item.lot,
      priceCents: item.priceCents, minStock: item.minStock,
    })
    await edit(second)
    assert.deepEqual((await read('variants', item.id)).skuAliases, [original.toLowerCase()])
    assert.equal((await read('variantSkuIndex', `s_${original.toLowerCase()}`)).variantId, item.id)
    await reject('catalog.create', {
      reference: { code: 'ANOTHER-REFERENCE', name: 'Bermuda distinta', kind: 'finished', unit: 'unidad', category: 'Bermudas' },
      variants: [{ sku: original, size: '', color: '', lot: '', stock: 0, priceCents: 1000, minStock: 0 }],
    })
    assert.equal((await rows('references')).length, 1, 'Un SKU anterior reservado no deja una referencia nueva parcial')
    await edit(third)
    assert.deepEqual(new Set((await read('variants', item.id)).skuAliases), new Set([original.toLowerCase(), second.toLowerCase()]))
    await edit(second)
    assert.equal((await read('variants', item.id)).sku, second)
    assert.deepEqual(new Set((await read('variants', item.id)).skuAliases), new Set([original.toLowerCase(), third.toLowerCase()]))
    await edit(original)
    const restored = await read('variants', item.id)
    assert.equal(restored.sku, original)
    assert.deepEqual(new Set(restored.skuAliases), new Set([second.toLowerCase(), third.toLowerCase()]))
    assert.equal(restored.stock, 10)
    assert.equal((await read('costs', item.id)).stockValueCents, 10000)
    for (const sku of [original, second, third]) {
      assert.equal((await read('variantSkuIndex', `s_${sku.toLowerCase()}`)).variantId, item.id)
    }
    assert.equal((await rows('variants')).length, 1)
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
      command('catalog.variant', { variantId: item.id, sku: item.sku, size: item.size, color: item.color, lot: item.lot, priceCents: 2600, minStock: 3, stock: 999 }),
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
    const material = await catalog({ code: 'PENDIENTE', name: 'Tela sin costo', kind: 'material', unit: 'cm', sku: 'TELA-PENDIENTE', stock: 10, priceCents: 0, unitCostCents: null })
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
    await command('catalog.archive', { variantId: item.id, active: false })
    assert.equal((await read('variants', item.id)).stock, 2, 'Archivar preserva las existencias')
    assert.equal((await read('costs', item.id)).stockValueCents, 2000, 'Archivar no da de baja el activo contable')
    await reject('stock.receive', { variantId: item.id, quantity: 1 }, 'operator')
    await reject('sales.create', { customerName: 'No vender archivado', lines: [{ variantId: item.id, quantity: 1 }], paidCents: 0 }, 'seller')
    await command('catalog.archive', { variantId: item.id, active: true })
    await command('stock.adjust', { variantId: item.id, delta: -2, reason: 'Merma inventariada' })
    await command('catalog.archive', { variantId: item.id, active: false })
    assert.equal((await read('variants', item.id)).active, false)
    await reject('stock.receive', { variantId: item.id, quantity: 1 }, 'operator')
    await command('catalog.archive', { variantId: item.id, active: true })
    assert.equal((await read('variants', item.id)).active, true)
    assert.ok((await rows('movements')).length >= 2)
    await balancedLedger()
  })

  test('archivar referencia conserva existencias y valoración de todas sus tallas y bloquea ingresos/ventas/compras', async () => {
    const first = await catalog({ stock: 5 })
    const second = await catalog({ sku: 'JEAN-100-NE-34', size: '34', color: 'Negro', stock: 3, unitCostCents: 1500 })
    const journalsBefore = (await rows('journals')).map((row) => row.id)
    await command('catalog.referenceState', { referenceKey: first.referenceKey, active: false, reason: 'Retirada temporal de referencia' })
    for (const item of [first, second]) {
      assert.equal((await read('variants', item.id)).stock, item.stock)
      await reject('stock.receive', { variantId: item.id, quantity: 1 }, 'operator')
      await reject('stock.receive', { variantId: item.id, quantity: 1 })
      await reject('sales.create', { customerName: 'Referencia archivada', lines: [{ variantId: item.id, quantity: 1 }], paidCents: 0 }, 'seller')
      await reject('purchases.create', { supplierName: 'Proveedor', lines: [{ variantId: item.id, quantity: 1, unitCostCents: 1000 }], paidCents: 0 })
    }
    assert.equal((await read('costs', first.id)).stockValueCents, 5000)
    assert.equal((await read('costs', second.id)).stockValueCents, 4500)
    assert.deepEqual((await rows('journals')).map((row) => row.id), journalsBefore, 'Archivar y rechazar operaciones no modifica el libro contable')
    assert.equal((await rows('sales')).length, 0)
    assert.equal((await rows('purchases')).length, 0)
    await command('catalog.referenceState', { referenceKey: first.referenceKey, active: true })
    await command('stock.receive', { variantId: second.id, quantity: 1 }, 'operator')
    assert.equal((await read('variants', second.id)).stock, 4)
    assert.equal((await balancedLedger()).balances['1435'], 9500)
  })

  test('producción respeta archivo del padre tanto al consumir materiales como al entregar la prenda', async () => {
    const material = await catalog({ code: 'PARENT-MATERIAL', name: 'Tela', kind: 'material', sku: 'PARENT-TELA', stock: 10, unitCostCents: 100, priceCents: 0 })
    const finished = await catalog({ stock: 0, unitCostCents: 0 })
    await command('production.bom', { outputVariantId: finished.id, inputs: [{ variantId: material.id, quantity: 2 }] })
    const bom = (await rows('productionBoms'))[0]
    await command('production.plan', { bomId: bom.id, quantity: 2, notes: '' })
    const order = (await rows('productionOrders'))[0]
    await command('catalog.referenceState', { referenceKey: material.referenceKey, active: false })
    await reject('production.start', { orderId: order.id })
    assert.equal((await read('variants', material.id)).stock, 10)
    assert.equal((await read('productionOrders', order.id)).status, 'planned')
    await command('catalog.referenceState', { referenceKey: material.referenceKey, active: true })
    await command('production.start', { orderId: order.id })
    await command('catalog.referenceState', { referenceKey: finished.referenceKey, active: false })
    await reject('production.complete', { orderId: order.id, quantity: 2 })
    assert.equal((await read('variants', finished.id)).stock, 0)
    assert.equal((await read('productionOrders', order.id)).status, 'in_progress')
    await command('catalog.referenceState', { referenceKey: finished.referenceKey, active: true })
    await command('production.complete', { orderId: order.id, quantity: 2 })
    assert.equal((await read('variants', finished.id)).stock, 2)
    assert.equal((await balancedLedger()).balances['1430'] || 0, 0)
  })

  test('eliminar variante da de baja exactamente las unidades/costo, conserva documentos e índices y recuperar no inventa stock', async () => {
    const item = await catalog()
    const saleResult = await command('sales.create', { customerName: 'Venta conservada', lines: [{ variantId: item.id, quantity: 2 }], paidCents: 0 })
    const oldSale = await read('sales', saleResult.id)
    await command('stock.receive', { variantId: item.id, quantity: 1 }, 'operator')
    const oldJournals = await rows('journals')
    const oldMovements = await rows('movements')
    const requestId = randomUUID()
    const payload = { variantId: item.id, reason: 'Producto discontinuado: baja física autorizada', confirmSku: item.sku }
    await reject('catalog.delete', { ...payload, reason: '' })
    await reject('catalog.delete', { ...payload, confirmSku: 'INCORRECTO' })
    assert.equal((await read('variants', item.id)).stock, 9, 'Una confirmación inválida no modifica existencias')
    const result = await command('catalog.delete', payload, 'admin', requestId)
    const replay = await command('catalog.delete', payload, 'admin', requestId)
    assert.equal(replay.deletionId, result.deletionId)
    assert.equal(replay.replayed, true)
    const deleted = await read('variants', item.id)
    assert.equal(deleted.deleted, true)
    assert.equal(deleted.active, false)
    assert.equal(deleted.stock, 0)
    assert.equal(deleted.deletedBy, 'admin')
    assert.equal(deleted.deletionReason, payload.reason)
    assert.ok(deleted.deletedAt)
    assert.equal((await read('costs', item.id)).stockValueCents, 0)
    assert.equal((await read('costs', item.id)).unvaluedQuantity, 0)
    const snapshot = await read('deletions', result.deletionId)
    assert.equal(snapshot.scope, 'variant')
    assert.equal(snapshot.createdBy, 'admin')
    assert.equal(snapshot.reason, payload.reason)
    assert.equal(snapshot.entries.length, 1)
    assert.equal(snapshot.entries[0].stock, 9)
    assert.equal(snapshot.entries[0].stockValueCents, 8000)
    assert.equal(snapshot.entries[0].unvaluedQuantity, 1)
    assert.equal(snapshot.entries[0].variantId, item.id)
    const movement = await read('movements', snapshot.entries[0].movementId)
    assert.equal(movement.delta, -9)
    assert.equal(movement.sourceType, 'catalog_delete')
    assert.equal((await rows('deletions')).length, 1, 'Reintentar una baja no duplica su historial')
    assert.deepEqual(await read('sales', saleResult.id), oldSale)
    for (const prior of oldJournals) assert.deepEqual(await read('journals', prior.id), Object.fromEntries(Object.entries(prior).filter(([key]) => key !== 'id')))
    for (const prior of oldMovements) assert.deepEqual(await read('movements', prior.id), Object.fromEntries(Object.entries(prior).filter(([key]) => key !== 'id')))
    const ledger = await balancedLedger()
    assert.equal(ledger.balances['1435'] || 0, 0)
    assert.equal(ledger.balances['5195'], 8000)
    assert.equal(ledger.balances['6135'], 2000, 'La venta anterior conserva su costo histórico')
    await reject('stock.receive', { variantId: item.id, quantity: 1 }, 'operator')
    await reject('catalog.archive', { variantId: item.id, active: true })
    await reject('catalog.create', {
      reference: { code: 'NEW-REF', name: 'Otro producto', category: 'Jeans', kind: 'finished', unit: 'unidad' },
      variants: [{ sku: item.sku, stock: 0, size: '', color: '', lot: '', priceCents: 1, minStock: 0 }],
    })
    assert.equal((await read('variantSkuIndex', `s_${item.sku.toLowerCase()}`)).variantId, item.id)
    await command('catalog.restore', { variantId: item.id, reason: 'Recuperar ficha para ingreso futuro' })
    const restored = await read('variants', item.id)
    assert.equal(restored.deleted, false)
    assert.equal(restored.active, true)
    assert.equal(restored.stock, 0)
    assert.equal((await read('costs', item.id)).stockValueCents, 0)
    assert.equal((await rows('journals')).length, ledger.journals.length, 'Recuperar metadatos no revierte la baja física ni su asiento')
    await command('stock.receive', { variantId: item.id, quantity: 2 }, 'operator')
    assert.equal((await read('variants', item.id)).stock, 2)
    assert.equal((await read('costs', item.id)).unvaluedQuantity, 2)
    await balancedLedger()
  })

  test('eliminar y recuperar referencia trata todas sus tallas atómicamente y conserva sus SKU reservados', async () => {
    const first = await catalog({ stock: 5 })
    const second = await catalog({ sku: 'JEAN-100-NE-34', color: 'Negro', size: '34', stock: 3, unitCostCents: 2000 })
    const payload = { referenceKey: first.referenceKey, confirmReference: 'JEAN-100', reason: 'Baja total de referencia' }
    await reject('catalog.deleteReference', { ...payload, confirmReference: 'jean-100' })
    assert.equal((await read('variants', first.id)).stock, 5)
    assert.equal((await read('variants', second.id)).stock, 3)
    await command('catalog.referenceState', { referenceKey: first.referenceKey, active: false })
    const result = await command('catalog.deleteReference', payload)
    const header = await read('references', first.referenceKey)
    assert.equal(header.deleted, true)
    assert.equal(header.active, false)
    assert.equal(result.writeOffQuantity, 8)
    const deletion = await read('deletions', result.deletionId)
    assert.equal(deletion.scope, 'reference')
    assert.equal(deletion.entries.length, 2)
    assert.equal(deletion.entries.reduce((sum, entry) => sum + entry.stockValueCents, 0), 11000)
    for (const item of [first, second]) {
      const value = await read('variants', item.id)
      assert.equal(value.stock, 0)
      assert.equal(value.deleted, true)
      assert.equal((await read('costs', item.id)).stockValueCents, 0)
      assert.equal((await read('variantSkuIndex', `s_${item.sku.toLowerCase()}`)).variantId, item.id)
    }
    assert.equal((await balancedLedger()).balances['5195'], 11000)
    await reject('catalog.referenceState', { referenceKey: first.referenceKey, active: true })
    await command('catalog.restoreReference', { referenceKey: first.referenceKey, reason: 'Recuperar catálogo sin reconstruir la existencia dada de baja' })
    assert.equal((await read('references', first.referenceKey)).deleted, false)
    assert.equal((await read('references', first.referenceKey)).active, true)
    for (const item of [first, second]) {
      assert.equal((await read('variants', item.id)).deleted, false)
      assert.equal((await read('variants', item.id)).active, true)
      assert.equal((await read('variants', item.id)).stock, 0)
    }
    assert.equal((await balancedLedger()).balances['1435'] || 0, 0)
    assert.equal((await rows('deletions')).length, 1)
  })

  test('baja masiva rechaza 101 variantes sin cambios y confirma 100 con sus asientos dentro de una transacción real', async () => {
    const first = await catalog({ stock: 1, unitCostCents: 100 })
    // An administrative historical import is a realistic reference with more
    // variants than a single form allows. Seed its existing opening balance.
    const batch = db.batch()
    const { id: firstId, ...firstData } = first
    assert.equal(firstId, first.id)
    for (let index = 0; index < 100; index++) {
      const id = `bulk-${String(index).padStart(3, '0')}`
      const sku = `BULK-${String(index).padStart(3, '0')}`
      batch.set(org.collection('variants').doc(id), { ...firstData, sku, size: String(index), color: 'Bulk', stock: 1 })
      batch.set(org.collection('costs').doc(id), { stockValueCents: 100, unvaluedQuantity: 0 })
      batch.set(org.collection('variantSkuIndex').doc(`s_${sku.toLowerCase()}`), { variantId: id })
    }
    const opening = (await rows('journals'))[0]
    const { id: openingId, ...openingData } = opening
    assert.ok(openingId)
    batch.set(org.collection('journals').doc('bulk-opening'), {
      ...openingData, sourceId: 'bulk-fixture', debitCents: 10000, creditCents: 10000,
      lines: [{ account: '1435', debitCents: 10000, creditCents: 0 }, { account: '3105', debitCents: 0, creditCents: 10000 }],
    })
    await batch.commit()
    const payload = { referenceKey: first.referenceKey, confirmReference: 'JEAN-100', reason: 'Baja masiva autorizada' }
    await assert.rejects(command('catalog.deleteReference', payload), (error) => error.code === 'failed-precondition' && error.message.includes('100'))
    assert.equal((await rows('variants')).reduce((sum, value) => sum + value.stock, 0), 101)
    assert.equal((await rows('deletions')).length, 0)
    assert.equal((await rows('commands')).length, 1)
    assert.equal((await read('references', first.referenceKey)).deleted, false)
    await command('catalog.delete', { variantId: first.id, confirmSku: first.sku, reason: 'Primera variante individual' })
    const result = await command('catalog.deleteReference', payload)
    assert.equal(result.variantIds.length, 100)
    assert.equal(result.writeOffQuantity, 100)
    assert.equal((await rows('variants')).every((value) => value.deleted && value.stock === 0), true)
    assert.equal((await rows('costs')).every((value) => value.stockValueCents === 0 && value.unvaluedQuantity === 0), true)
    const snapshot = await read('deletions', result.deletionId)
    assert.equal(snapshot.entries.length, 100)
    assert.equal(new Set(snapshot.entries.map((entry) => entry.movementId)).size, 100)
    assert.equal(new Set(snapshot.entries.map((entry) => entry.journalId)).size, 100)
    const ledger = await balancedLedger()
    assert.equal(ledger.balances['1435'] || 0, 0)
    assert.equal(ledger.balances['5195'], 10100)
    assert.equal(ledger.journals.length, 103)
  })

  test('anulación administrativa devuelve la venta a una ficha eliminada y reactiva su referencia sin borrar la baja', async () => {
    const item = await catalog({ stock: 4 })
    const sale = await command('sales.create', { customerName: 'Devolución posterior', lines: [{ variantId: item.id, quantity: 1 }], paidCents: 0 }, 'seller')
    await command('catalog.deleteReference', { referenceKey: item.referenceKey, confirmReference: 'JEAN-100', reason: 'Baja de restantes' })
    assert.equal((await read('variants', item.id)).stock, 0)
    await command('sales.void', { saleId: sale.id, reason: 'La devolución física reingresa una unidad' })
    assert.equal((await read('references', item.referenceKey)).active, true)
    assert.equal((await read('references', item.referenceKey)).deleted, false)
    const restored = await read('variants', item.id)
    assert.equal(restored.active, true)
    assert.equal(restored.deleted, false)
    assert.equal(restored.stock, 1)
    assert.equal((await read('costs', item.id)).stockValueCents, 1000)
    assert.equal((await rows('deletions')).length, 1)
    assert.equal((await balancedLedger()).balances['5195'], 3000)
    assert.equal((await read('salesDesk', sale.id)).status, 'void')
  })

  test('migración conserva IDs/QR y originales, rechaza referencias ambiguas y permite remapear', async () => {
    const legacy = (name, sku) => ({ name, sku, reference: 'OLD-REF', category: 'Jeans', description: '', size: '32', color: 'Azul', lot: 'LOTE', imageUrl: '', price: 129900, stock: 3, minStock: 1, currency: 'COP' })
    await org.collection('products').doc('legacy-one').set(legacy('Jeans Clásico', 'OLD-ONE'))
    await org.collection('products').doc('legacy-two').set(legacy('Bermuda Clásica', 'OLD-TWO'))
    await reject('catalog.migrate', { items: [{ legacyId: 'legacy-one' }] })
    await reject('catalog.migrate', { items: [{ legacyId: 'legacy-one' }, { legacyId: 'legacy-two' }] })
    for (const collection of ['references', 'variants', 'migrations', 'commands', 'audit']) {
      assert.equal((await rows(collection)).length, 0, `Una referencia ambigua no deja una migración parcial en ${collection}`)
    }
    await command('catalog.migrate', { items: [{ legacyId: 'legacy-one' }, { legacyId: 'legacy-two', referenceCode: 'BERMUDA-OLD' }] })
    assert.equal((await read('variants', 'legacy-one')).priceCents, 12990000)
    assert.equal((await read('variants', 'legacy-one')).stock, 3)
    assert.equal((await read('variants', 'legacy-one')).referenceKey, 'r_old-ref')
    assert.equal((await read('variants', 'legacy-two')).referenceKey, 'r_bermuda-old')
    assert.equal((await read('costs', 'legacy-one')).stockValueCents, 0, 'No inventa costos usando el precio de venta')
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

  test('una referencia anterior sin migrar bloquea otro nombre; remapear libera el código sin colisiones con copias históricas', async () => {
    const legacy = (reference, name, sku) => ({ reference, name, sku, category: 'Jeans', description: '', size: '32', color: 'Azul', lot: 'LOTE', imageUrl: '', price: 129900, stock: 3, minStock: 1, currency: 'COP' })
    // Deliberately omit skuIndex: checking an old reference must not depend on
    // whether that previous application version maintained its SKU registry.
    const originalReference = '  ＬＥＧ－ＲＥＦ  '
    await org.collection('products').doc('legacy-reserved').set(legacy(originalReference, 'Jeans Anterior', 'LEGACY-RESERVED'))
    const incoming = {
      reference: { code: 'leg-ref', name: 'Bermuda Nueva', category: 'Bermudas', kind: 'finished', unit: 'unidad' },
      variants: [{ sku: 'NEW-DIFFERENT-SKU', size: 'M', color: 'Negro', lot: '', stock: 0, priceCents: 1000, minStock: 0 }],
    }
    await reject('catalog.create', incoming)
    for (const collection of ['references', 'variants', 'commands', 'audit', 'journals']) {
      assert.equal((await rows(collection)).length, 0, `El rechazo no deja datos parciales en ${collection}`)
    }
    await command('catalog.migrate', { items: [{ legacyId: 'legacy-reserved', referenceCode: 'LEG-OLD' }] })
    await command('catalog.create', incoming)
    assert.equal((await read('references', 'r_leg-ref')).name, 'Bermuda Nueva')
    assert.equal((await read('variants', 'legacy-reserved')).referenceKey, 'r_leg-old')
    assert.equal((await read('products', 'legacy-reserved')).reference, originalReference, 'Conserva la copia anterior original')

    await org.collection('products').doc('legacy-renamed').set(legacy('LEG-SAME', 'Jeans Original', 'LEGACY-RENAMED'))
    await command('catalog.create', {
      reference: { code: 'LEG-SAME', name: 'Jeans Original', category: 'Jeans', kind: 'finished', unit: 'unidad' },
      variants: [{ sku: 'PRE-MIGRATION-VARIANT', size: '36', color: 'Verde', lot: 'LOTE', stock: 0, priceCents: 1000, minStock: 0 }],
    })
    await reject('catalog.reference', { referenceKey: 'r_leg-same', name: 'Jeans Renombrado', category: 'Jeans', description: '', imageUrl: '' })
    assert.equal((await read('references', 'r_leg-same')).name, 'Jeans Original', 'Un cambio de nombre no evade la referencia reservada por un producto pendiente de migrar')
    await command('catalog.migrate', { items: [{ legacyId: 'legacy-renamed' }] })
    await command('catalog.reference', { referenceKey: 'r_leg-same', name: 'Jeans Renombrado', category: 'Jeans', description: '', imageUrl: '' })
    await command('catalog.create', {
      reference: { code: 'leg-same', name: 'Jeans Renombrado', category: 'Jeans', kind: 'finished', unit: 'unidad' },
      variants: [{ sku: 'RENAMED-SECOND', size: '34', color: 'Negro', lot: 'LOTE', stock: 0, priceCents: 1000, minStock: 0 }],
    })
    assert.equal((await read('products', 'legacy-renamed')).name, 'Jeans Original')
    assert.equal((await rows('variants')).filter((item) => item.referenceKey === 'r_leg-same').length, 3)
    assert.equal((await read('references', 'r_leg-same')).name, 'Jeans Renombrado')
    await balancedLedger()
  })

  test('administrador gestiona roles y desactivación sin poder bloquear su propio acceso', async () => {
    await command('members.save', { uid: 'operator', role: 'viewer', active: true })
    assert.equal((await read('members', 'operator')).role, 'viewer')
    await reject('catalog.create', { reference: {}, variants: [] }, 'operator')
    await command('members.save', { uid: 'operator', role: 'seller', active: true })
    assert.equal((await read('members', 'operator')).role, 'seller')
    await reject('stock.receive', { variantId: 'missing', quantity: 1 }, 'operator')
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
