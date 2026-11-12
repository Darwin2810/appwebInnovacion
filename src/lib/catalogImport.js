const clean = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ')
const key = value => clean(value).toLocaleLowerCase('es').normalize('NFD').replace(/\p{Diacritic}/gu, '')
const integer = value => {
  const number = typeof value === 'number' ? value : Number(clean(value))
  return Number.isSafeInteger(number) && number >= 0 ? number : null
}

function objects(rows = []) {
  const headers = (rows[0] || []).map(key)
  return rows.slice(1).filter(row => row.some(value => clean(value))).map((row, index) => ({
    row: index + 2,
    values: Object.fromEntries(headers.map((header, column) => [header, row[column]])),
  }))
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
  if (!groups.size) throw new Error(errors[0] || 'No se encontraron productos válidos para importar.')
  return { groups: [...groups.values()], errors, ignored: ['Cantidad que ingresó', 'Cantidad que salió a la venta', 'Conteo por papel', 'Diferencia', 'Estado', 'Insumos'] }
}

export function validateImport(groups, existingProducts = []) {
  const errors = []
  for (const group of groups) {
    const existingNames = existingProducts.filter(item => key(item.reference) === key(group.reference.code)).map(item => item.name)
    if (existingNames.some(name => key(name) !== key(group.reference.name))) errors.push(`La referencia ${group.reference.code} ya pertenece a otro producto en la aplicación.`)
    for (const variant of group.variants) {
      const price = Number(variant.price)
      if (!Number.isFinite(price) || price <= 0) errors.push(`${group.reference.code}, talla ${variant.size || 'única'}, color ${variant.color || 'sin color'}: ingresa un precio mayor que cero.`)
      if (!Number.isSafeInteger(Number(variant.minStock)) || Number(variant.minStock) < 0) errors.push(`${group.reference.code}: el stock mínimo debe ser un entero mayor o igual a cero.`)
      if (existingProducts.some(item => key(item.reference) === key(group.reference.code) && key(item.size) === key(variant.size) && key(item.color) === key(variant.color) && key(item.lot) === key(variant.lot))) errors.push(`${group.reference.code}, talla ${variant.size || 'única'}, color ${variant.color || 'sin color'} ya existe.`)
    }
  }
  return [...new Set(errors)]
}
