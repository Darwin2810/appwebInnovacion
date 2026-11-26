import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCatalogSheets, pendingImportGroups, validateImport } from '../src/lib/catalogImport.js'

import { fieldSheets } from '../functions/lib/exlaiderFieldData.js'
import { movementDateText, newestMovementFirst } from '../src/lib/movementView.js'

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
  assert.match(validateImport(result.groups)[0], /precio válido mayor que cero/)
})

test('carga automáticamente la columna Precio venta COP sin exponer códigos técnicos', () => {
  const data = [headers.concat('Precio venta COP'), ['Jeans', '1005', 'Jean Recto Clásico', 'Azul Índigo', 30, 46, 0, 30, 46, 0, 'Cuadra', 145000]]
  const result = parseCatalogSheets([{ sheet: 'Inventario Prendas', data }])
  assert.equal(result.groups[0].variants[0].price, '145000')
  assert.deepEqual(validateImport(result.groups), [])
})

test('agrupa insumos repetidos y convierte metros de hilo a centímetros', () => {
  const garment = [{ sheet: 'Inventario Prendas', data: [headers.concat('Precio venta COP'), ['Jeans', '1005', 'Jean', 'Azul', 30, 1, 0, 1, 1, 0, 'Cuadra', 100000]] }]
  const supplies = { sheet: 'Insumos', data: [[], [], ['N° medición', 'Ref', 'Insumo', 'Cantidades ingresadas', 'Unidad de medida', 'Tiempo', 'Precio venta COP', 'Costo unitario COP'],
    [1, 'IN-BOT-01', 'Botón', 200, 'Unidades (und)', 2, 1000, 500],
    [2, 'IN-BOT-01', 'Botón', 300, 'Unidades (und)', 2, 1000, 500],
    [3, 'IN-HIL-03', 'Hilo', 50, 'Metros (m)', 2, 20, 10],
  ] }
  const result = parseCatalogSheets([...garment, supplies])
  const button = result.groups.find(group => group.reference.code === 'IN-BOT-01')
  const thread = result.groups.find(group => group.reference.code === 'IN-HIL-03')
  assert.equal(button.variants[0].stock, 500)
  assert.equal(thread.reference.unit, 'cm')
  assert.equal(thread.variants[0].stock, 5000)
  assert.equal(thread.variants[0].unitCost, '10')
  assert.deepEqual(validateImport(result.groups), [])
})

test('omite variantes existentes y conserva únicamente los insumos pendientes', () => {
  const groups = [
    { reference: { code: '1005', name: 'Jean', kind: 'finished' }, variants: [{ size: '30', color: 'Azul', lot: '', sourceRow: 2 }] },
    { reference: { code: 'IN-BOT-01', name: 'Botón', kind: 'material' }, variants: [{ size: '', color: '', lot: 'Carga inicial de campo', sourceRow: 4 }] },
  ]
  const existing = [{ reference: '1005', name: 'Jean', size: '30', color: 'Azul', lot: '' }]
  const pending = pendingImportGroups(groups, existing)
  assert.deepEqual(pending.map(group => group.reference.code), ['IN-BOT-01'])
})

test('lee las fechas de Excel y los movimientos de la base EXLAIDER sin sumar los conteos', () => {
  const [garments, supplies] = fieldSheets
  const data = garments.data.map((row, index) => index === 0 ? row : [new Date(row[0]), ...row.slice(1)])
  const { groups, errors } = parseCatalogSheets([{ ...garments, data }, supplies])
  assert.deepEqual(errors, [])
  assert.deepEqual(validateImport(groups), [])
  const finished = groups.filter(group => group.reference.kind === 'finished')
  const variants = finished.flatMap(group => group.variants)
  assert.equal(finished.length, 10)
  assert.equal(variants.length, 16)
  assert.equal(variants.reduce((sum, item) => sum + item.history.entry, 0), 855)
  assert.equal(variants.reduce((sum, item) => sum + item.history.exit, 0), 199)
  assert.equal(variants.reduce((sum, item) => sum + item.stock, 0), 656)
  assert.deepEqual(variants[0].history, { date: '2026-10-23', entry: 60, exit: 14, paperCount: 30, prototypeCount: 46 })
  assert.deepEqual(groups.filter(group => group.reference.kind === 'material').map(group => [group.reference.code, group.variants[0].stock, group.reference.unit]), [
    ['IN-BOT-01', 1100, 'unidad'], ['IN-CRE-02', 1000, 'unidad'], ['IN-HIL-03', 150, 'm'],
  ])
})

test('admite los encabezados abreviados y detecta fechas imposibles y salidas superiores a las entradas', () => {
  const data = [
    ['Fecha', 'Colección', 'Ref', 'Prenda', 'Color', 'Talla', 'Entrada', 'Salida', 'ConteoPapel', 'ConteoPrototipo'],
    ['23/10/2026', 'Jeans', '1005', 'Jean recto', 'Azul', 30, 60, 14, 30, 45],
    ['31/02/2026', 'Jeans', '1005', 'Jean recto', 'Azul', 32, 1, 0, 1, 1],
    ['24/10/2026', 'Jeans', '1005', 'Jean recto', 'Azul', 34, 2, 3, 0, 0],
  ]
  const { groups, errors } = parseCatalogSheets([{ sheet: 'Inventario Prendas', data }])
  assert.equal(errors.length, 2)
  assert.equal(groups[0].variants.length, 1)
  assert.equal(groups[0].variants[0].stock, 46)
})

test('muestra y ordena los movimientos por fecha operativa', () => {
  const importedAt = { seconds: 1795672800, toDate: () => new Date('2026-11-26T06:00:00Z') }
  const entry = { date: '2026-10-23', createdAt: importedAt, stockBefore: 0 }
  const exit = { date: '2026-10-23', createdAt: importedAt, stockBefore: 60 }
  const newer = { date: '2026-10-24', createdAt: importedAt, stockBefore: 0 }
  assert.equal(movementDateText(entry), '23/10/2026')
  assert.deepEqual([exit, entry, newer].sort(newestMovementFirst), [newer, entry, exit])
})
