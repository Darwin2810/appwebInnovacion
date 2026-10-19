import test from 'node:test'
import assert from 'node:assert/strict'
import { makeProductQr, parseProductQr } from '../src/lib/qr.js'

const product = { id: '9pFNxhRu0AivDBcaa8Ts', name: 'Camiseta EXLAIDER', sku: 'EX-001', description: 'Algodón\nEdición 2026', category: 'Ropa', reference: 'REF-01', size: 'M', color: 'Negro', lot: 'L01', imageUrl: 'https://example.com/shirt.png', stock: 10, minStock: 5, price: 59000, uid: 'not-a-qr-field', createdAt: 123 }
const json = (fields) => JSON.stringify({ v: 1, type: 'inventory-product', ...fields })

test('QR roundtrip conserva metadata y elimina campos internos', () => {
  const text = makeProductQr(product)
  assert.equal(text.includes('uid'), false)
  assert.equal(text.includes('createdAt'), false)
  const result = parseProductQr(text)
  assert.equal(result.kind, 'product')
  assert.equal(result.id, product.id)
  assert.equal(result.sku, product.sku)
  for (const key of ['name', 'description', 'reference', 'size', 'color', 'lot', 'imageUrl', 'stock', 'minStock', 'price']) assert.equal(result.fields[key], product[key])
  assert.equal(result.fields.currency, 'COP')
})
test('SKU simple y producto nuevo mínimo', () => {
  assert.deepEqual(parseProductQr(' EX-001 '), { kind: 'sku', sku: 'EX-001' })
  assert.deepEqual(parseProductQr(json({ name: 'Producto', stock: 0, price: 10.5 })), { kind: 'product', fields: { name: 'Producto', stock: 0, price: 10.5 } })
  assert.deepEqual(parseProductQr(json({ id: 'validId' })), { kind: 'product', id: 'validId', fields: {} })
})
test('rechaza enlaces, versiones, rutas y propietarios ajenos', () => {
  for (const text of ['', 'https://evil.example/qr', 'javascript:alert(1)', '[]', '"not-object"', json({ name: 'Sin precio' }), json({ id: '../user/product' }), json({ sku: 'A B' }), json({ id: 'valid', uid: 'other' }), json({ id: 'valid', companyId: 'other' }), '{"v":1,"type":"inventory-product","id":"ok","__proto__":{}}', '{"v":2,"type":"inventory-product","id":"ok"}']) assert.throws(() => parseProductQr(text), Error, text)
})
test('rechaza números inválidos, fracciones de stock y cadenas numéricas', () => {
  for (const [key, value] of [['price', '10'], ['price', -1], ['price', 1e12 + 1], ['stock', 1.5], ['stock', -1], ['stock', 1e9 + 1], ['minStock', null], ['minStock', '2']]) assert.throws(() => parseProductQr(json({ id: 'ok', [key]: value })), Error)
  assert.throws(() => parseProductQr('{"v":1,"type":"inventory-product","id":"ok","price":1e309}'), Error)
})
test('rechaza límites de campo, control y URL de imagen insegura', () => {
  for (const [key, limit] of Object.entries({ name: 100, description: 2000, category: 60, reference: 60, size: 20, color: 40, lot: 60, imageUrl: 500 })) assert.throws(() => parseProductQr(json({ id: 'ok', [key]: 'A'.repeat(limit + 1) })), Error)
  assert.throws(() => parseProductQr('A'.repeat(8193)), Error)
  assert.throws(() => parseProductQr(json({ id: 'ok', name: 'bad\u0000name' })), Error)
  for (const imageUrl of ['javascript:alert(1)', 'http://example.com/img.png', 'https://user:password@example.com/img.png']) assert.throws(() => parseProductQr(json({ id: 'ok', imageUrl })), Error)
})
test('generador también valida datos', () => {
  assert.throws(() => makeProductQr({ ...product, stock: -1 }), Error)
  assert.throws(() => makeProductQr({ ...product, sku: '../unsafe' }), Error)
})
