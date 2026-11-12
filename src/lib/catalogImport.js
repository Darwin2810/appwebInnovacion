const clean = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ')
const key = value => clean(value).toLocaleLowerCase('es').normalize('NFD').replace(/\p{Diacritic}/gu, '')
const integer = value => {
  const number = typeof value === 'number' ? value : Number(clean(value))
  return Number.isSafeInteger(number) && number >= 0 ? number : null
}

function objects(rows = [], headerIndex = 0) {
  const headers = (rows[headerIndex] || []).map(key)
  return rows.slice(headerIndex + 1).filter(row => row.some(value => clean(value))).map((row, index) => ({
    row: index + headerIndex + 2,
    values: Object.fromEntries(headers.map((header, column) => [header, row[column]])),
  }))
}

function amount(value) {
  if (value == null || clean(value) === '') return ''
  const result = Number(value)
  return Number.isFinite(result) && result >= 0 && result <= 1e12 ? result : null
}

function supplyGroups(sheet, errors) {
  if (!sheet) return []
  const headerIndex = sheet.data.findIndex(row => row.some(value => key(value) === 'insumo') && row.some(value => key(value) === 'ref'))
  if (headerIndex < 0) { errors.push('La hoja «Insumos» no contiene los encabezados Ref e Insumo.'); return [] }
  const groups = new Map()
  for (const item of objects(sheet.data, headerIndex)) {
    const row = item.values, reference = clean(row.ref), name = clean(row.insumo)
    if (!reference && !name) continue
    if (!reference || !name) { errors.push(`Insumos, fila ${item.row}: faltan referencia o nombre.`); continue }
    const quantity = integer(row['cantidades ingresadas'])
    if (quantity === null) { errors.push(`Insumos, fila ${item.row}: la cantidad debe ser un entero mayor o igual a cero.`); continue }
    const rawUnit = key(row['unidad de medida'])
    const meters = rawUnit.includes('metro')
    if (!meters && !rawUnit.includes('unidad') && !rawUnit.includes('und')) { errors.push(`Insumos, fila ${item.row}: la unidad «${clean(row['unidad de medida'])}» no es compatible.`); continue }
    const price = amount(row['precio venta cop']), unitCost = amount(row['costo unitario cop'])
    if (price === null || unitCost === null) { errors.push(`Insumos, fila ${item.row}: revisa el precio o costo unitario.`); continue }
    const id = key(reference), unit = meters ? 'cm' : 'unidad', factor = meters ? 100 : 1
    if (!groups.has(id)) groups.set(id, { reference: { code: reference, name, category: 'Insumos', description: 'Insumo agregado desde las mediciones de campo EXLAIDER.', imageUrl: '', kind: 'material', unit }, variants: [{ size: '', color: '', lot: 'Carga inicial de campo', stock: 0, price: price === '' ? '0' : String(price), unitCost: unitCost === '' ? '' : String(unitCost), minStock: meters ? '1000' : '20', sourceRow: item.row }], sourceRows: [] })
    const group = groups.get(id)
    if (key(group.reference.name) !== key(name) || group.reference.unit !== unit) { errors.push(`Insumos, fila ${item.row}: la referencia ${reference} tiene nombres o unidades incompatibles.`); continue }
    const variant = group.variants[0]
    if (price !== '' && variant.price !== String(price)) errors.push(`Insumos, fila ${item.row}: la referencia ${reference} tiene precios diferentes.`)
    if (unitCost !== '' && variant.unitCost !== String(unitCost)) errors.push(`Insumos, fila ${item.row}: la referencia ${reference} tiene costos diferentes.`)
    variant.stock += quantity * factor
    group.sourceRows.push(item.row)
  }
  return [...groups.values()]
}

export function parseCatalogSheets(sheets = []) {
  const source = sheets.find(item => key(item.sheet) === 'inventario prendas')
  if (!source) throw new Error('El archivo debe incluir la hoja «Inventario Prendas» de la base de campo de EXLAIDER.')
  const groups = new Map(), errors = []
  for (const item of objects(source.data)) {
    const row = item.values
    const reference = clean(row.ref), name = clean(row.prenda), color = clean(row.color), size = clean(row.talla)
    const stock = integer(row['prototipo conteo'])
    const importedPrice = row['precio venta cop'] == null || clean(row['precio venta cop']) === '' ? '' : Number(row['precio venta cop'])
    if (!reference && !name) continue
    if (!reference || !name) { errors.push(`Fila ${item.row}: faltan referencia o prenda.`); continue }
    if (stock === null) { errors.push(`Fila ${item.row}: «Prototipo conteo» debe ser un entero mayor o igual a cero.`); continue }
    const id = key(reference)
    if (!groups.has(id)) groups.set(id, { reference: { code: reference, name, category: clean(row.coleccion) || 'General', description: 'Importado desde la base de datos de campo EXLAIDER.', imageUrl: '', kind: 'finished', unit: 'unidad' }, variants: [], sourceRows: [] })
    const group = groups.get(id)
    if (key(group.reference.name) !== key(name)) { errors.push(`Fila ${item.row}: la referencia ${reference} ya está asociada a «${group.reference.name}» y no puede usarse para «${name}».`); continue }
    const duplicate = group.variants.some(variant => key(variant.size) === key(size) && key(variant.color) === key(color) && !variant.lot)
    if (duplicate) { errors.push(`Fila ${item.row}: se repite ${reference}, talla ${size || 'única'}, color ${color || 'sin color'}.`); continue }
    if (importedPrice !== '' && (!Number.isFinite(importedPrice) || importedPrice <= 0 || importedPrice > 1e12)) { errors.push(`Fila ${item.row}: «Precio venta COP» debe ser mayor que cero.`); continue }
    group.variants.push({ size, color, lot: '', stock, price: importedPrice === '' ? '' : String(importedPrice), minStock: '5', sourceRow: item.row })
    group.sourceRows.push(item.row)
  }
  const supplies = supplyGroups(sheets.find(item => key(item.sheet) === 'insumos'), errors)
  if (!groups.size && !supplies.length) throw new Error(errors[0] || 'No se encontraron productos válidos para importar.')
  return { groups: [...groups.values(), ...supplies], errors, ignored: ['Cantidad que ingresó', 'Cantidad que salió a la venta', 'Conteo por papel', 'Diferencia', 'Estado', 'Tiempos de búsqueda'] }
}

export function validateImport(groups, existingProducts = []) {
  const errors = []
  for (const group of groups) {
    const existingNames = existingProducts.filter(item => key(item.reference) === key(group.reference.code)).map(item => item.name)
    if (existingNames.some(name => key(name) !== key(group.reference.name))) errors.push(`La referencia ${group.reference.code} ya pertenece a otro producto en la aplicación.`)
    for (const variant of group.variants) {
      const price = Number(variant.price)
      if (!Number.isFinite(price) || price < 0 || (group.reference.kind !== 'material' && price === 0)) errors.push(`${group.reference.code}, talla ${variant.size || 'única'}, color ${variant.color || 'sin color'}: ingresa un precio válido${group.reference.kind === 'material' ? '' : ' mayor que cero'}.`)
      if (variant.unitCost != null && variant.unitCost !== '' && (!Number.isFinite(Number(variant.unitCost)) || Number(variant.unitCost) < 0)) errors.push(`${group.reference.code}: el costo unitario debe ser mayor o igual a cero.`)
      if (!Number.isSafeInteger(Number(variant.minStock)) || Number(variant.minStock) < 0) errors.push(`${group.reference.code}: el stock mínimo debe ser un entero mayor o igual a cero.`)
      if (existingProducts.some(item => key(item.reference) === key(group.reference.code) && key(item.size) === key(variant.size) && key(item.color) === key(variant.color) && key(item.lot) === key(variant.lot))) errors.push(`${group.reference.code}, talla ${variant.size || 'única'}, color ${variant.color || 'sin color'} ya existe.`)
    }
  }
  return [...new Set(errors)]
}
