import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCatalogSheets, validateImport } from '../src/lib/catalogImport.js'

const headers = ['Colección', 'Ref', 'Prenda', 'Color', 'Talla', 'Cantidad que ingresó', 'Cantidad que salió a la venta', 'Conteo por papel', 'Prototipo conteo', 'Diferencia (papel vs. prototipo)', 'Estado']

test('agrupa la base de campo por referencia y usa únicamente el conteo del prototipo', () => {
  const result = parseCatalogSheets([{ sheet: 'Inventario Prendas', data: [headers,
    ['Bermudas', 'A5', 'Bermuda camuflada', 'Verde', '34', 120, 10, 91, 95, -4, 'Revisar'],
    ['Bermudas', 'A5', 'Bermuda camuflada', 'Azul', '36', 80, 5, 70, 72, -2, 'Revisar'],
  ] }])
  assert.equal(result.groups.length, 1)
  assert.equal(result.groups[0].reference.code, 'A5')
  assert.deepEqual(result.groups[0].variants.map(item => item.stock), [95, 72])
  assert.equal(result.groups[0].variants.some(item => Object.hasOwn(item, 'sku')), false)
})

test('rechaza una referencia con nombres diferentes y exige precios antes de importar', () => {
  const result = parseCatalogSheets([{ sheet: 'Inventario Prendas', data: [headers,
    ['Jeans', 'A4', 'Jean recto', 'Azul', '36', 1, 0, 1, 1, 0, 'OK'],
    ['Jeans', 'A4', 'Otro producto', 'Negro', '38', 1, 0, 1, 1, 0, 'OK'],
  ] }])
  assert.match(result.errors[0], /no puede usarse/)
  assert.match(validateImport(result.groups)[0], /precio mayor que cero/)
})

test('carga automáticamente la columna Precio venta COP sin exponer códigos técnicos', () => {
  const data = [headers.concat('Precio venta COP'), ['Jeans', '1005', 'Jean Recto Clásico', 'Azul Índigo', 30, 46, 0, 30, 46, 0, 'Cuadra', 145000]]
  const result = parseCatalogSheets([{ sheet: 'Inventario Prendas', data }])
  assert.equal(result.groups[0].variants[0].price, '145000')
  assert.deepEqual(validateImport(result.groups), [])
})
