export const catalogIdentity = value => String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
export const catalogSearchText = value => catalogIdentity(value).normalize('NFD').replace(/\p{Diacritic}/gu, '')
export const catalogOptionLabel = (value, fallback) => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ') || fallback
export function catalogAttributeOptions(products, field, fallback) {
  const options = new Map()
  for (const product of products) {
    const label = catalogOptionLabel(product[field], fallback), key = catalogIdentity(label)
    if (!options.has(key)) options.set(key, label)
  }
  return [...options.values()]
}

// Raw variants are authoritative even for tombstones. Never resurrect an old
// flat document when its migrated variant has subsequently been deleted.
export function hydrateCatalog(data = {}, role = 'viewer') {
  const headers = new Map((data.references || []).map(item => [item.id || item.referenceKey, item]))
  const raw = new Map((data.variants || []).map(item => [item.id, item]))
  const rows = new Map((data.products || []).map(item => [item.id, item]))
  for (const item of data.legacyProducts || []) if (!raw.has(item.id) && !rows.has(item.id)) rows.set(item.id, { ...item, legacy: true })
  for (const item of raw.values()) {
    const previous = rows.get(item.id) || {}, header = headers.get(item.referenceKey)
    if (!header) continue
    rows.set(item.id, { ...previous, ...item, name: header.name, reference: header.code, category: header.category || 'General', description: header.description || '', imageUrl: header.imageUrl || '', kind: header.kind || item.kind || 'finished', unit: header.unit || item.unit || 'unidad', price: Number(item.priceCents || 0) / 100, legacy: false })
  }
  return [...rows.values()].map(item => {
    const header = headers.get(item.referenceKey)
    return { ...item, kind: item.kind || 'finished', unit: item.unit || 'unidad', stock: Number(item.stock || 0), minStock: Number(item.minStock || 0), parentActive: header?.active !== false, parentDeleted: header?.deleted === true, deleted: item.deleted === true || header?.deleted === true, ownDeleted: item.deleted === true, active: item.active !== false && header?.active !== false && header?.deleted !== true && item.deleted !== true }
  }).filter(item => !['viewer', 'seller'].includes(role) || item.kind === 'finished')
}

export function productStatus(product) { return product.deleted ? 'deleted' : product.active === false ? 'archived' : 'active' }

export function groupCatalog(products, references = []) {
  const headers = new Map(references.map(item => [item.id || item.referenceKey, item]))
  const groups = new Map()
  for (const product of products) {
    const key = product.legacy ? `legacy:${catalogIdentity(product.reference)}:${catalogIdentity(product.name)}` : product.referenceKey || `ref:${catalogIdentity(product.reference)}:${catalogIdentity(product.name)}`
    if (!groups.has(key)) {
      const header = headers.get(product.referenceKey)
      groups.set(key, { key, referenceKey: product.referenceKey, code: product.reference || 'Sin referencia', name: product.name, category: product.category || 'General', description: product.description || '', imageUrl: product.imageUrl || '', kind: product.kind, unit: product.unit, legacy: Boolean(product.legacy), header, products: [] })
    }
    groups.get(key).products.push(product)
  }
  return [...groups.values()].map(group => {
    const existing = group.products.filter(item => !item.deleted), active = existing.filter(item => item.active !== false)
    const prices = existing.map(item => Number(item.price || 0))
    return { ...group, colors: catalogAttributeOptions(existing, 'color', 'Sin color'), sizes: catalogAttributeOptions(existing, 'size', 'Única'), stock: existing.reduce((sum, item) => sum + item.stock, 0), availableStock: active.reduce((sum, item) => sum + item.stock, 0), activeCount: active.length, minPrice: prices.length ? Math.min(...prices) : 0, maxPrice: prices.length ? Math.max(...prices) : 0, defaultPrice: existing.find(item => Number(item.price) > 0)?.price || 0 }
  }).sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }) || a.code.localeCompare(b.code, 'es', { numeric: true }))
}

export function matchesCatalogGroup(group, query = '') {
  const search = catalogSearchText(query)
  return !search || group.products.some(item => catalogSearchText([item.name, item.reference, item.category, item.sku, ...(Array.isArray(item.skuAliases) ? item.skuAliases : []), item.size, item.color, item.lot].join(' ')).includes(search))
}

// An unavailable size/color is never substituted for a different physical SKU.
export function findCatalogCombination(products, { color, size, lot } = {}) {
  return products.find(item => (color === undefined || catalogIdentity(catalogOptionLabel(item.color, 'Sin color')) === catalogIdentity(color)) && (size === undefined || catalogIdentity(catalogOptionLabel(item.size, 'Única')) === catalogIdentity(size)) && (lot === undefined || catalogIdentity(catalogOptionLabel(item.lot, 'Sin lote')) === catalogIdentity(lot))) || null
}

export function catalogWriteOffPreview(products, costs = []) {
  const costById = new Map(costs.map(item => [item.id, item]))
  return products.reduce((summary, product) => {
    const quantity = Number(product.stock || 0), cost = costById.get(product.id)
    const valueCents = Number(cost?.stockValueCents || 0)
    const unvaluedQuantity = Number(cost?.unvaluedQuantity ?? (quantity && !valueCents ? quantity : 0))
    return { quantity: summary.quantity + quantity, valueCents: summary.valueCents + valueCents, unvaluedQuantity: summary.unvaluedQuantity + unvaluedQuantity }
  }, { quantity: 0, valueCents: 0, unvaluedQuantity: 0 })
}

const colors = { negro: '#242728', blanco: '#fbfbf7', azul: '#32678a', 'azul oscuro': '#223e5e', 'azul claro': '#9cbacf', verde: '#667b50', rojo: '#a94d49', gris: '#8a8f91', beige: '#d7c6a7', cafe: '#795b46', marron: '#795b46', rosa: '#d9a0ac', amarillo: '#d4ba61', camuflado: 'linear-gradient(135deg,#627152 30%,#a89b72 30% 60%,#454f3a 60%)', 'verde militar': '#616d46' }
export function colorSwatch(name) { return colors[catalogSearchText(name)] || 'linear-gradient(135deg,#bcc6be,#e8e9e1)' }
