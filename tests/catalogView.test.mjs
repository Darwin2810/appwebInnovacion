import test from 'node:test'
import assert from 'node:assert/strict'
import { catalogAttributeOptions, catalogWriteOffPreview, findCatalogCombination, groupCatalog, hydrateCatalog, matchesCatalogGroup, productStatus } from '../src/lib/catalogView.js'

const reference = { id: 'r_a4', code: 'A4', name: 'Jean recto', category: 'Jeans', kind: 'finished', unit: 'unidad' }
const variant = (id, values = {}) => ({ id, referenceKey: reference.id, sku: id.toUpperCase(), size: '36', color: 'Azul', lot: '1', priceCents: 14_000_000, stock: 8, minStock: 5, active: true, ...values })

test('one canonical reference groups sizes and colors, preserving physical lots and family price', () => {
  const products = hydrateCatalog({ references: [reference], variants: [variant('sku1'), variant('sku2', { size: '38', color: 'Verde', lot: '2', stock: 12 })] }, 'admin')
  const groups = groupCatalog(products, [reference])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].stock, 20)
  assert.equal(groups[0].defaultPrice, 140_000)
  assert.deepEqual(groups[0].colors, ['Azul', 'Verde'])
  assert.equal(findCatalogCombination(products, { color: 'Azul', size: '38' }), null)
  assert.equal(findCatalogCombination(products, { color: 'Verde', size: '38', lot: '2' }).sku, 'SKU2')
})

test('legacy reference collisions with different names remain separate before migration', () => {
  const data = { legacyProducts: [{ id: 'old1', reference: ' A4 ', name: 'Jean recto', stock: 8 }, { id: 'old2', reference: 'a4', name: 'Bermuda', stock: 9 }, { id: 'old3', reference: 'A4', name: 'JEAN RECTO', stock: 2 }] }
  const groups = groupCatalog(hydrateCatalog(data, 'admin'))
  assert.equal(groups.length, 2)
  assert.equal(groups.find(group => group.name === 'Jean recto').stock, 10)
})

test('tombstones suppress legacy copies and parent state applies immediately to every child', () => {
  const first = variant('legacy1', { deleted: true, active: false, stock: 0 })
  const data = { references: [{ ...reference, active: false }], variants: [first, variant('sku2')], legacyProducts: [{ id: 'legacy1', name: 'Old name', stock: 99 }] }
  const products = hydrateCatalog(data, 'admin')
  assert.equal(products.length, 2)
  assert.ok(products.every(product => !product.active && !product.legacy))
  assert.equal(productStatus(products[0]), 'deleted')
  assert.equal(productStatus(products[1]), 'archived')
  const group = groupCatalog(products, data.references)[0]
  assert.equal(group.stock, 8, 'archived physical stock is preserved')
  assert.equal(group.availableStock, 0)
})

test('header changes replace stale hydrated names and deletion cannot be bypassed by an active child', () => {
  const data = { references: [{ ...reference, name: 'Nuevo nombre', deleted: true }], products: [{ id: 'sku1', name: 'Anterior', referenceKey: 'r_a4', active: true }], variants: [variant('sku1')] }
  const [product] = hydrateCatalog(data, 'admin')
  assert.equal(product.name, 'Nuevo nombre')
  assert.equal(product.deleted, true)
  assert.equal(product.active, false)
  assert.equal(productStatus(product), 'deleted')
})

test('viewer and seller catalogs exclude raw material rows', () => {
  const data = { references: [reference, { ...reference, id: 'r_cotton', code: 'COTTON', kind: 'material', unit: 'g' }], variants: [variant('sku1'), variant('cotton', { referenceKey: 'r_cotton' })] }
  assert.equal(hydrateCatalog(data, 'operator').length, 2)
  assert.equal(hydrateCatalog(data, 'viewer').length, 1)
  assert.equal(hydrateCatalog(data, 'seller').length, 1)
})

test('search discovers a reference through accented color, size, lot or a historical SKU', () => {
  const products = hydrateCatalog({ references: [reference], variants: [variant('sku1', { color: 'Índigo', lot: 'L-2026', skuAliases: ['ANTERIOR-01'] })] }, 'viewer')
  const [group] = groupCatalog(products, [reference])
  for (const text of ['indigo', '36', 'L-2026', 'anterior-01', 'jean recto', 'A4']) assert.equal(matchesCatalogGroup(group, text), true, text)
  assert.equal(matchesCatalogGroup(group, 'inexistente'), false)
})

test('zero stock remains a valid physical combination and lot matching never substitutes another batch', () => {
  const products = hydrateCatalog({ references: [reference], variants: [variant('zero', { stock: 0, lot: '2' }), variant('other', { lot: '1' })] }, 'admin')
  assert.equal(findCatalogCombination(products, { color: 'Azul', size: '36', lot: '2' }).stock, 0)
  assert.equal(findCatalogCombination(products, { color: 'Azul', size: '36', lot: '3' }), null)
})


test('write-off preview includes archived quantities and separates unknown costs without estimating selling value', () => {
  const products = [{ id: 'known', stock: 8, active: false, price: 900_000 }, { id: 'unknown', stock: 5, price: 100_000 }, { id: 'partial', stock: 3 }, { id: 'free', stock: 2 }]
  const costs = [{ id: 'known', stockValueCents: 8_000, unvaluedQuantity: 0 }, { id: 'partial', stockValueCents: 200, unvaluedQuantity: 1 }, { id: 'free', stockValueCents: 0, unvaluedQuantity: 0 }]
  assert.deepEqual(catalogWriteOffPreview(products, costs), { quantity: 18, valueCents: 8_200, unvaluedQuantity: 6 })
  assert.deepEqual(catalogWriteOffPreview(products), { quantity: 18, valueCents: 0, unvaluedQuantity: 18 })
})


test('colors, sizes and lots share backend identity while retaining the first human label', () => {
  const products = hydrateCatalog({ references: [reference], variants: [variant('first', { color: 'Azul', size: ' ３２ ', lot: ' lote  1 ' }), variant('second', { color: ' AZUL ', size: '34', lot: '2' }), variant('third', { color: 'Azul  marino', size: '32', lot: '1' }), variant('fourth', { color: 'AZUL MARINO', size: '34', lot: '2' })] }, 'admin')
  const [group] = groupCatalog(products, [reference])
  assert.deepEqual(group.colors, ['Azul', 'Azul marino'])
  assert.deepEqual(catalogAttributeOptions(products, 'size', 'Única'), ['32', '34'])
  assert.equal(findCatalogCombination(products, { color: 'azul', size: '３４' }).id, 'second')
  assert.equal(findCatalogCombination(products, { color: ' AZUL ', size: '32', lot: 'LOTE 1' }).id, 'first')
  assert.equal(findCatalogCombination(products, { color: 'Azul marino', size: ' 34 ' }).id, 'fourth')
  assert.equal(findCatalogCombination(products, { color: 'Azul', size: '36' }), null)
})
