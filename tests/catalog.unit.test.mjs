import test from 'node:test'
import assert from 'node:assert/strict'
import { applyStockChange, handlers } from '../functions/lib/catalog.js'

function fixture({ stock = 10, value = 5_000, unknown = 0, active = true, deleted = false, referenceActive = true, referenceDeleted = false, role = 'operator' } = {}) {
  const writes = []
  const tx = { set: (target, data, options) => writes.push({ path: target.path, data, options }) }
  const document = (collection, id) => ({ id, path: `${collection}/${id}` })
  const ctx = {
    uid: role, role, commandId: 'source_1', now: 'test-timestamp',
    org: { collection: collection => ({ doc: id => document(collection, id ?? 'movement_1') }) },
  }
  const item = {
    ref: document('variants', 'variant_1'), costRef: document('costs', 'variant_1'), referenceRef: document('references', 'r_jean.01'),
    data: { referenceKey: 'r_jean.01', sku: 'J01-A', kind: 'finished', stock, active, deleted },
    costData: { stockValueCents: value, unvaluedQuantity: unknown },
    referenceData: { name: 'Jean clásico', active: referenceActive, deleted: referenceDeleted },
  }
  const change = (delta, extra = {}) => applyStockChange(tx, ctx, item, delta, { sourceType: 'test', sourceId: 'source_1', reason: 'Movimiento de prueba', ...extra })
  return { writes, item, change, tx, ctx }
}

test('receipt without explicit acquisition cost marks every incoming unit pending', async () => {
  const { writes, item, tx, ctx } = fixture({ stock: 10, value: 5_000 })
  const snapshot = data => ({ exists: true, data: () => structuredClone(data) })
  tx.getAll = async () => [snapshot(item.data), snapshot(item.costData)]
  tx.get = async () => snapshot({ name: 'Jean clásico', kind: 'finished' })
  const result = await handlers['stock.receive'].run(tx, ctx, { variantId: 'variant_1', quantity: 25 })
  assert.equal(result.stock, 35)
  const cost = writes.find(write => write.path.startsWith('costs/')).data
  assert.equal(cost.stockValueCents, 5_000)
  assert.equal(cost.unvaluedQuantity, 25)
  assert.equal(writes.some(write => write.path.startsWith('journals/')), false)
  assert.equal(Object.hasOwn(result, 'valueCents'), false)
})

test('positive stock correction larger than current stock preserves average cost and unvalued share', () => {
  const { item, change, writes } = fixture({ stock: 10, value: 5_000, unknown: 4 })
  assert.equal(change(25).valueCents, 12_500)
  assert.equal(item.data.stock, 35)
  assert.equal(item.costData.stockValueCents, 17_500)
  assert.equal(item.costData.unvaluedQuantity, 14)
  const movement = writes.find(write => write.path.startsWith('movements/')).data
  assert.equal(movement.stockBefore, 10)
  assert.equal(movement.stockAfter, 35)
  assert.equal(Object.hasOwn(movement, 'stockValueCents'), false)
  assert.equal(Object.hasOwn(movement, 'valueCents'), false)
  assert.equal(Object.hasOwn(movement, 'unvaluedQuantity'), false)
})

test('large quantities use integer ratios without overflowing an intermediate multiplication', () => {
  const { item, change } = fixture({ stock: 500_000_000, value: 50_000_000_000_000 })
  assert.equal(change(500_000_000).valueCents, 50_000_000_000_000)
  assert.equal(item.data.stock, 1_000_000_000)
  assert.equal(item.costData.stockValueCents, 100_000_000_000_000)
})

test('full withdrawal consumes every remaining cent and unvalued unit', () => {
  const { item, change } = fixture({ stock: 3, value: 100, unknown: 2 })
  assert.equal(change(-1).valueCents, 33)
  assert.equal(change(-2).valueCents, 67)
  assert.equal(item.data.stock, 0)
  assert.deepEqual(item.costData, { stockValueCents: 0, unvaluedQuantity: 0 })
})

test('unknown zero cost and explicitly recorded zero cost remain distinguishable', () => {
  const unknown = fixture({ stock: 0, value: 0 })
  unknown.change(5)
  assert.equal(unknown.item.costData.unvaluedQuantity, 5)
  const recorded = fixture({ stock: 0, value: 0 })
  recorded.change(5, { valueCents: 0 })
  assert.equal(recorded.item.costData.unvaluedQuantity, 0)
})

test('reversal restores historical value and unknown quantities to an archived variant', () => {
  const { item, change } = fixture({ stock: 0, value: 0, active: false, role: 'admin' })
  assert.throws(() => change(2, { valueCents: 300 }), /archivada/)
  assert.equal(change(2, { valueCents: 300, unvaluedQuantity: 1, reactivate: true }).stockAfter, 2)
  assert.equal(item.data.active, true)
  assert.equal(item.costData.stockValueCents, 300)
  assert.equal(item.costData.unvaluedQuantity, 1)
})

test('stock movement enforces reference and variant states, and only admin reversals can recover both', () => {
  for (const input of [{ referenceActive: false }, { referenceDeleted: true }, { deleted: true }, { active: false }]) {
    const { change, writes } = fixture(input)
    assert.throws(() => change(1), /archivada|eliminada/)
    assert.equal(writes.length, 0)
    assert.throws(() => change(1, { reactivate: true }), /Solo el administrador/)
    assert.equal(writes.length, 0)
  }
  const { item, change, writes } = fixture({ stock: 0, value: 0, active: false, deleted: true, referenceActive: false, referenceDeleted: true, role: 'admin' })
  change(2, { reactivate: true, valueCents: 300 })
  assert.equal(item.data.deleted, false)
  assert.equal(item.referenceData.deleted, false)
  assert.equal(item.referenceData.active, true)
  assert.equal(writes.find(write => write.path.startsWith('references/')).data.restoredBy, 'admin')
})

// A transaction double rejects every read attempted after a write. Lifecycle
// tests exercise the handlers, costing, journals and persisted metadata together.
function catalogStore(count = 1) {
  const records = new Map([
    ['references/r_a4', { code: 'A4', name: 'Jean recto', nameKey: 'jean recto', kind: 'finished', unit: 'unidad' }],
  ])
  for (let index = 0; index < count; index++) {
    records.set(`variants/v_${index}`, { referenceKey: 'r_a4', sku: `A4-${index}`, kind: 'finished', stock: 3, active: true, skuAliases: [] })
    records.set(`costs/v_${index}`, { stockValueCents: 101, unvaluedQuantity: 1 })
    records.set(`variantSkuIndex/s_a4-${index}`, { variantId: `v_${index}` })
  }
  let serial = 0
  function document(collection, id) { return { id, path: `${collection}/${id}` } }
  function collection(name, filters = [], cursor = '', limit = Infinity) {
    return {
      collection: name, filters, cursor, maximum: limit,
      doc: id => document(name, id ?? `generated_${++serial}`),
      where: (field, op, value) => { assert.equal(op, '=='); return collection(name, [...filters, [field, value]], cursor, limit) },
      orderBy: () => collection(name, filters, cursor, limit),
      limit: maximum => collection(name, filters, cursor, maximum),
      startAfter: snapshot => collection(name, filters, snapshot.id, limit),
    }
  }
  function transaction() {
    const writes = []
    const ctx = {
      uid: 'admin_1', role: 'admin', commandId: `command_${++serial}`,
      now: { toDate: () => new Date('2026-10-20T12:00:00Z') },
      org: { collection },
    }
    const snapshot = target => ({ id: target.id, ref: target, exists: records.has(target.path), data: () => ({ ...records.get(target.path) }) })
    function assertReading() { assert.equal(writes.length, 0, 'Firestore transactions must finish all reads before any write') }
    const tx = {
      getAll: async (...targets) => { assertReading(); return targets.map(snapshot) },
      get: async target => {
        assertReading()
        if (target.path) return snapshot(target)
        const docs = [...records].filter(([path, data]) => path.startsWith(`${target.collection}/`) && path.split('/').length === 2 && path.split('/')[1] > target.cursor && target.filters.every(([field, value]) => data[field] === value))
          .sort(([left], [right]) => left.localeCompare(right)).slice(0, target.maximum).map(([path]) => snapshot(document(target.collection, path.split('/')[1])))
        return { docs, size: docs.length }
      },
    }
    for (const operation of ['set', 'update', 'create']) {
      tx[operation] = (target, data, options) => {
        if (operation === 'create') assert.equal(records.has(target.path), false)
        writes.push({ operation, path: target.path, data })
        records.set(target.path, operation === 'update' || options?.merge ? { ...records.get(target.path), ...data } : { ...data })
      }
    }
    return { tx, ctx, writes }
  }
  const run = async (action, payload) => {
    const current = transaction()
    const result = await handlers[action].run(current.tx, current.ctx, payload)
    return { result, ...current }
  }
  return { records, run, transaction }
}

test('catalog mutations are admin-only; the operator may only receive positive stock', () => {
  for (const [action, handler] of Object.entries(handlers)) {
    assert.deepEqual(handler.roles, action === 'stock.receive' ? ['admin', 'operator'] : ['admin'], action)
  }
})

test('archiving positive stock preserves valuation and blocks movement through either state', async () => {
  const store = catalogStore()
  await store.run('catalog.archive', { variantId: 'v_0', active: false })
  assert.equal(store.records.get('variants/v_0').stock, 3)
  assert.deepEqual(store.records.get('costs/v_0'), { stockValueCents: 101, unvaluedQuantity: 1 })
  await assert.rejects(store.run('stock.receive', { variantId: 'v_0', quantity: 1 }), /archivada/)
  await store.run('catalog.archive', { variantId: 'v_0', active: true })
  await store.run('catalog.referenceState', { referenceKey: 'r_a4', active: false })
  await assert.rejects(store.run('stock.receive', { variantId: 'v_0', quantity: 1 }), /referencia está archivada/)
  assert.equal(store.records.get('variants/v_0').stock, 3)
  await store.run('catalog.referenceState', { referenceKey: 'r_a4', active: true })
  assert.equal((await store.run('stock.receive', { variantId: 'v_0', quantity: 1 })).result.stock, 4)
})

test('deletion requires exact confirmation, writes off all stock and cost, and restoration only recovers metadata', async () => {
  const store = catalogStore()
  const current = store.transaction()
  await assert.rejects(handlers['catalog.delete'].run(current.tx, current.ctx, { variantId: 'v_0', reason: 'Producto retirado', confirmSku: 'A4-OTRO' }), /exactamente el SKU/)
  assert.equal(current.writes.length, 0)
  const { result, writes } = await store.run('catalog.delete', { variantId: 'v_0', reason: 'Producto retirado', confirmSku: 'A4-0' })
  assert.equal(result.writeOffQuantity, 3)
  const variant = store.records.get('variants/v_0')
  assert.equal(variant.stock, 0)
  assert.equal(variant.deleted, true)
  assert.equal(variant.active, false)
  assert.equal(variant.deletedBy, 'admin_1')
  assert.equal(store.records.get('costs/v_0').stockValueCents, 0)
  assert.equal(store.records.get('costs/v_0').unvaluedQuantity, 0)
  const snapshot = writes.find(write => write.path.startsWith('deletions/')).data
  assert.equal(snapshot.entries[0].stock, 3)
  assert.equal(snapshot.entries[0].stockValueCents, 101)
  assert.equal(snapshot.entries[0].unvaluedQuantity, 1)
  const movement = writes.find(write => write.path.startsWith('movements/')).data
  assert.equal(movement.delta, -3)
  assert.equal(Object.hasOwn(movement, 'stockValueCents'), false)
  const entry = writes.find(write => write.path.startsWith('journals/')).data
  assert.equal(snapshot.entries[0].journalId, writes.find(write => write.path.startsWith('journals/')).path.split('/')[1])
  assert.equal(entry.debitCents, 101)
  assert.deepEqual(entry.lines, [{ account: '1435', debitCents: 0, creditCents: 101 }, { account: '5195', debitCents: 101, creditCents: 0 }])
  assert.equal(store.records.get('variantSkuIndex/s_a4-0').variantId, 'v_0')
  await assert.rejects(store.run('catalog.archive', { variantId: 'v_0', active: true }), /eliminada/)
  const restored = await store.run('catalog.restore', { variantId: 'v_0', reason: 'Referencia vuelve al catálogo' })
  assert.equal(restored.result.stock, 0)
  assert.equal(store.records.get('variants/v_0').deleted, false)
  assert.equal(store.records.get('variants/v_0').deletionReason, 'Producto retirado')
  assert.equal(store.records.get('costs/v_0').stockValueCents, 0)
  assert.equal(restored.writes.some(write => /movements|journals/.test(write.path)), false)
})

test('whole-reference deletion and restoration are atomic for 100 variants and keep immutable SKU reservations', async () => {
  const store = catalogStore(100)
  const deleted = await store.run('catalog.deleteReference', { referenceKey: 'r_a4', confirmReference: 'A4', reason: 'Colección retirada' })
  assert.equal(deleted.result.variantIds.length, 100)
  assert.equal(deleted.result.writeOffQuantity, 300)
  assert.equal(deleted.writes.length + 2 < 500, true, 'Reserve command and audit writes within the transaction limit')
  assert.equal(deleted.writes.filter(write => write.path.startsWith('deletions/')).length, 1)
  assert.equal(store.records.get('references/r_a4').deleted, true)
  assert.equal(store.records.get('variants/v_99').stock, 0)
  assert.equal(store.records.get('variantSkuIndex/s_a4-99').variantId, 'v_99')
  const restored = await store.run('catalog.restoreReference', { referenceKey: 'r_a4', reason: 'Reabrir colección' })
  assert.equal(restored.result.variantIds.length, 100)
  assert.equal(store.records.get('references/r_a4').deleted, false)
  assert.equal(store.records.get('variants/v_99').deleted, false)
  assert.equal(store.records.get('variants/v_99').stock, 0)
  assert.equal(restored.writes.some(write => /movements|journals/.test(write.path)), false)
})

test('restoring one deleted variant also recovers its header, and remaining variants can then be restored together', async () => {
  const store = catalogStore(2)
  await store.run('catalog.deleteReference', { referenceKey: 'r_a4', confirmReference: 'A4', reason: 'Colección retirada' })
  await store.run('catalog.restore', { variantId: 'v_0', reason: 'Reabrir una talla' })
  assert.equal(store.records.get('references/r_a4').deleted, false)
  assert.equal(store.records.get('references/r_a4').active, true)
  assert.equal(store.records.get('variants/v_1').deleted, true)
  const restored = await store.run('catalog.restoreReference', { referenceKey: 'r_a4', reason: 'Reabrir las tallas restantes' })
  assert.deepEqual(restored.result.variantIds, ['v_1'])
  assert.equal(store.records.get('variants/v_0').stock, 0)
  assert.equal(store.records.get('variants/v_1').stock, 0)
})

test('material writeoffs credit the material inventory account and allow archived references', async () => {
  const store = catalogStore()
  store.records.set('references/r_a4', { ...store.records.get('references/r_a4'), kind: 'material', unit: 'cm', active: false })
  store.records.set('variants/v_0', { ...store.records.get('variants/v_0'), kind: 'material', active: false })
  const current = store.transaction()
  await assert.rejects(handlers['catalog.deleteReference'].run(current.tx, current.ctx, { referenceKey: 'r_a4', confirmReference: 'OTRA', reason: 'Material descontinuado' }), /exactamente la referencia/)
  assert.equal(current.writes.length, 0)
  const deleted = await store.run('catalog.deleteReference', { referenceKey: 'r_a4', confirmReference: 'A4', reason: 'Material descontinuado' })
  const entry = deleted.writes.find(write => write.path.startsWith('journals/')).data
  assert.equal(entry.lines.find(line => line.account === '1405').creditCents, 101)
  assert.equal(store.records.get('variants/v_0').stock, 0)
})

test('reference bulk limit fails before writing; deleted variants do not consume the deletion limit', async () => {
  const store = catalogStore(101)
  const current = store.transaction()
  await assert.rejects(handlers['catalog.deleteReference'].run(current.tx, current.ctx, { referenceKey: 'r_a4', confirmReference: 'A4', reason: 'Colección retirada' }), /hasta 100 variantes/)
  assert.equal(current.writes.length, 0)
  store.records.set('variants/v_100', { ...store.records.get('variants/v_100'), stock: 0, deleted: true, active: false })
  store.records.set('costs/v_100', { stockValueCents: 0, unvaluedQuantity: 0 })
  const { result } = await store.run('catalog.deleteReference', { referenceKey: 'r_a4', confirmReference: 'A4', reason: 'Colección retirada' })
  assert.equal(result.variantIds.length, 100)
  const restored = store.transaction()
  await assert.rejects(handlers['catalog.restoreReference'].run(restored.tx, restored.ctx, { referenceKey: 'r_a4', reason: 'Reabrir colección' }), /hasta 100 variantes/)
  assert.equal(restored.writes.length, 0)
})

test('insufficient stock, quantity overflow and monetary overflow fail before stock writes', () => {
  for (const setup of [
    { input: { stock: 1, value: 1 }, delta: -2 },
    { input: { stock: 1_000_000_000, value: 0 }, delta: 1 },
    { input: { stock: 1, value: 100_000_000_000_000 }, delta: 1 },
  ]) {
    const { change, writes } = fixture(setup.input)
    assert.throws(() => change(setup.delta))
    assert.equal(writes.length, 0)
  }
})
