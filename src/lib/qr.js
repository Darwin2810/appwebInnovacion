const SKU = /^[A-Za-z0-9._-]{1,40}$/
const ID = /^[A-Za-z0-9_-]{1,128}$/
const TEXT = { name: 100, description: 2000, category: 60, reference: 60, size: 20, color: 40, lot: 60, imageUrl: 500 }
const NUMBERS = { price: 1e12, stock: 1e9, minStock: 1e9 }
const ALLOWED = new Set(['v', 'type', 'id', 'sku', 'currency', ...Object.keys(TEXT), ...Object.keys(NUMBERS)])
const fail = (message) => { throw new Error(message) }
const unsafeControl = (text) => Array.from(text).some((character) => character.charCodeAt(0) < 32 && ![9, 10, 13].includes(character.charCodeAt(0)))

/** QR input is untrusted: never navigate to it or accept an ownership field. */
export function parseProductQr(text) {
  if (typeof text !== 'string' || !text.trim()) fail('El QR está vacío.')
  if (text.length > 8192) fail('El QR supera el tamaño permitido.')
  const trimmed = text.trim()
  if (SKU.test(trimmed)) return { kind: 'sku', sku: trimmed }
  let data
  try { data = JSON.parse(trimmed) } catch {
    fail('Usa un QR de producto de esta aplicación o un código SKU. No se abren enlaces externos.')
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('El QR no contiene un producto válido.')
  if (Object.keys(data).some((key) => !ALLOWED.has(key))) fail('El QR contiene campos no admitidos.')
  if (data.v !== 1 || data.type !== 'inventory-product') fail('El tipo o la versión del QR no es compatible.')
  const result = { kind: 'product', fields: {} }
  if (Object.hasOwn(data, 'id')) {
    if (typeof data.id !== 'string' || !ID.test(data.id)) fail('El identificador del producto no es válido.')
    result.id = data.id
  }
  if (Object.hasOwn(data, 'sku')) {
    if (typeof data.sku !== 'string' || !SKU.test(data.sku)) fail('El SKU admite letras, números, puntos y guiones (máximo 40).')
    result.sku = data.sku
  }
  for (const [field, limit] of Object.entries(TEXT)) {
    if (!Object.hasOwn(data, field)) continue
    if (typeof data[field] !== 'string' || data[field].length > limit || unsafeControl(data[field])) fail(`El campo ${field} no es válido (máximo ${limit} caracteres).`)
    const value = data[field].trim()
    if (['name', 'category'].includes(field) && !value) fail(`El campo ${field} no puede estar vacío.`)
    if (field === 'imageUrl' && value) {
      try {
        const url = new URL(value)
        if (url.protocol !== 'https:' || url.username || url.password) throw new Error('invalid')
      } catch { fail('La imagen del producto debe usar una dirección HTTPS válida.') }
    }
    result.fields[field] = value
  }
  for (const [field, limit] of Object.entries(NUMBERS)) {
    if (!Object.hasOwn(data, field)) continue
    const value = data[field]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > limit || (field !== 'price' && !Number.isSafeInteger(value))) fail(`El campo ${field} debe ser un número válido entre 0 y ${limit}.`)
    result.fields[field] = value
  }
  if (Object.hasOwn(data, 'currency')) {
    if (data.currency !== 'COP') fail('La moneda del QR debe ser COP.')
    result.fields.currency = 'COP'
  }
  if (!result.id && !result.sku && (!result.fields.name || result.fields.price === undefined || result.fields.stock === undefined)) fail('Un producto nuevo necesita nombre, precio y stock; un producto existente necesita ID o SKU.')
  return result
}

export function makeProductQr(product) {
  const data = { v: 1, type: 'inventory-product' }
  if (product.id) data.id = product.id
  if (product.sku) data.sku = product.sku
  for (const field of [...Object.keys(TEXT), ...Object.keys(NUMBERS)]) {
    if (product[field] !== undefined && product[field] !== null) data[field] = product[field]
  }
  data.currency = 'COP'
  const text = JSON.stringify(data)
  parseProductQr(text)
  return text
}
