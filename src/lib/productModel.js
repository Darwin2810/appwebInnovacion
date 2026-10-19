const TEXT_LIMITS = {
  name: 100, sku: 40, description: 2000, category: 60,
  reference: 60, size: 20, color: 40, lot: 60, imageUrl: 500,
}
const LABELS = {
  name: 'nombre', sku: 'código', description: 'descripción', category: 'categoría',
  reference: 'referencia', size: 'talla', color: 'color', lot: 'lote', imageUrl: 'imagen',
}

function text(input, key, fallback = '') {
  const value = input[key] ?? fallback
  if (typeof value !== 'string') throw new Error(`El campo ${LABELS[key]} debe ser texto.`)
  const result = value.trim()
  if (result.length > TEXT_LIMITS[key]) throw new Error(`El campo ${LABELS[key]} admite hasta ${TEXT_LIMITS[key]} caracteres.`)
  return result
}

export function normalizeSku(sku = '') {
  if (typeof sku !== 'string') throw new Error('El código debe ser texto.')
  return sku.normalize('NFKC').trim().toLowerCase()
}

export function skuDocumentKey(sku = '') {
  const key = normalizeSku(sku)
  if (!key) return ''
  if (!/^[a-z0-9._-]{1,40}$/.test(key)) throw new Error('El código admite letras, números, puntos, guiones y guiones bajos; máximo 40 caracteres.')
  return `s_${key}`
}

export function normalizeProduct(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Introduce los datos del producto.')
  const product = {}
  for (const key of Object.keys(TEXT_LIMITS)) product[key] = text(input, key, key === 'category' ? 'General' : '')
  if (!product.name) throw new Error('Escribe el nombre del producto.')
  if (!product.category) throw new Error('Escribe una categoría.')
  product.sku = product.sku.normalize('NFKC')
  product.skuKey = normalizeSku(product.sku)
  skuDocumentKey(product.sku)
  if (product.imageUrl) {
    let image
    try { image = new URL(product.imageUrl) } catch { throw new Error('La imagen debe tener una URL HTTPS válida.') }
    if (image.protocol !== 'https:' || !image.hostname || image.username || image.password) throw new Error('La imagen debe tener una URL HTTPS válida.')
  }
  for (const key of ['stock', 'minStock']) {
    const original = input[key] ?? (key === 'minStock' ? 5 : 0)
    const value = typeof original === 'string' && original.trim() ? Number(original) : original
    if (!Number.isSafeInteger(value) || value < 0 || value > 1e9) throw new Error('El stock y el stock mínimo deben ser enteros entre 0 y 1.000.000.000.')
    product[key] = value
  }
  const originalPrice = input.price ?? 0
  const price = typeof originalPrice === 'string' && originalPrice.trim() ? Number(originalPrice) : originalPrice
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > 1e12) throw new Error('El precio debe ser un número entre 0 y 1.000.000.000.000.')
  product.price = Math.round((price + Number.EPSILON) * 100) / 100
  if (input.currency != null && input.currency !== 'COP') throw new Error('La moneda admitida es COP.')
  product.currency = 'COP'
  return product
}
