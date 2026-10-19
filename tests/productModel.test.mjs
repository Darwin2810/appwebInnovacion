import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeProduct,
  normalizeSku,
  skuDocumentKey,
} from '../src/lib/productModel.js'

const valid = (overrides = {}) => ({
  name: 'Jeans Slim Azul',
  sku: 'EX-SLIM-AZ-M',
  reference: 'EX-SLIM',
  size: 'M',
  color: 'Azul',
  lot: 'LOTE-01',
  description: 'Denim elástico',
  category: 'Jeans',
  price: 129900,
  stock: 8,
  minStock: 3,
  imageUrl: 'https://example.com/jeans.jpg',
  ...overrides,
})

test('normaliza el producto y limita los campos a los datos editables', () => {
  const product = normalizeProduct(valid({
    name: '  Jeans Slim Azul  ',
    sku: '  EX-SLIM-AZ-M  ',
    description: '  Denim elástico  ',
    createdBy: 'intruso',
    updatedBy: 'intruso',
    tenantId: 'otra-empresa',
  }))

  assert.equal(product.name, 'Jeans Slim Azul')
  assert.equal(product.sku.trim(), product.sku)
  assert.equal(product.skuKey, normalizeSku('EX-SLIM-AZ-M'))
  assert.equal(product.description, 'Denim elástico')
  assert.equal(product.currency, 'COP')
  for (const field of ['createdBy', 'updatedBy', 'tenantId']) {
    assert.equal(Object.hasOwn(product, field), false)
  }
})

test('normaliza SKU con NFKC y evita claves especiales de documento', () => {
  assert.equal(normalizeSku('  ＡＢＣ-１２３  '), 'abc-123')
  assert.equal(skuDocumentKey(''), '')
  for (const sku of ['.', '..', 'ABC_123-XYZ']) {
    const key = skuDocumentKey(sku)
    assert.equal(key, 's_' + normalizeSku(sku))
    assert.equal(key.includes('/'), false)
    assert.notEqual(key, '.')
    assert.notEqual(key, '..')
  }
})

test('rechaza SKU no compatibles con el índice', () => {
  for (const sku of ['A/B', 'A % B', 'ÁZUL', 'A'.repeat(41)]) {
    assert.throws(() => normalizeProduct(valid({ sku })), Error)
  }
})

test('acepta stock y precio cero', () => {
  const product = normalizeProduct(valid({ price: 0, stock: 0, minStock: 0 }))
  assert.equal(product.stock, 0)
  assert.equal(product.price, 0)
})

test('rechaza nombre vacío, precios inválidos y stock no entero', () => {
  for (const overrides of [
    { name: '' },
    { name: '   ' },
    { price: -1 },
    { price: Number.NaN },
    { price: Number.POSITIVE_INFINITY },
    { stock: -1 },
    { stock: 1.5 },
    { stock: Number.NaN },
    { minStock: -1 },
    { minStock: 1.5 },
  ]) {
    assert.throws(() => normalizeProduct(valid(overrides)), Error)
  }
})

test('rechaza imágenes con protocolos ejecutables o sin HTTPS', () => {
  for (const imageUrl of [
    'javascript:alert(1)',
    'data:image/png;base64,AA==',
    'http://example.com/jeans.jpg',
  ]) {
    assert.throws(() => normalizeProduct(valid({ imageUrl })), Error)
  }
  assert.equal(normalizeProduct(valid({ imageUrl: '' })).imageUrl, '')
})

test('conserva unidades de materiales y mantiene compatibles los productos anteriores', () => {
  const previous = normalizeProduct(valid())
  assert.equal(previous.kind, 'finished')
  assert.equal(previous.unit, 'unidad')
  const material = normalizeProduct(valid({ kind: 'material', unit: 'cm', stock: 2500, unitCostCents: 99 }))
  assert.equal(material.kind, 'material')
  assert.equal(material.unit, 'cm')
  assert.equal(material.stock, 2500)
  assert.equal(Object.hasOwn(material, 'unitCostCents'), false)
  for (const fields of [{ kind: 'finished', unit: 'cm' }, { kind: 'material', unit: 'litro' }, { kind: 'otro' }]) assert.throws(() => normalizeProduct(valid(fields)), Error)
})
