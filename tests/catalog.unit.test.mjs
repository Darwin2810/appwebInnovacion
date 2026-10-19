import test from 'node:test'
import assert from 'node:assert/strict'
import { applyStockChange, handlers } from '../functions/lib/catalog.js'

function fixture({ stock = 10, value = 5_000, unknown = 0, active = true } = {}) {
  const writes = []
  const tx = { set: (target, data, options) => writes.push({ path: target.path, data, options }) }
  const document = (collection, id) => ({ id, path: `${collection}/${id}` })
  const ctx = {
    uid: 'operator', role: 'operator', commandId: 'source_1', now: 'test-timestamp',
    org: { collection: collection => ({ doc: id => document(collection, id ?? 'movement_1') }) },
  }
  const item = {
    ref: document('variants', 'variant_1'), costRef: document('costs', 'variant_1'),
    data: { referenceKey: 'r_jean.01', sku: 'J01-A', kind: 'finished', stock, active },
    costData: { stockValueCents: value, unvaluedQuantity: unknown },
    referenceData: { name: 'Jean clásico' },
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
  const { item, change } = fixture({ stock: 0, value: 0, active: false })
  assert.throws(() => change(2, { valueCents: 300 }), /archivada/)
  assert.equal(change(2, { valueCents: 300, unvaluedQuantity: 1, reactivate: true }).stockAfter, 2)
  assert.equal(item.data.active, true)
  assert.equal(item.costData.stockValueCents, 300)
  assert.equal(item.costData.unvaluedQuantity, 1)
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
