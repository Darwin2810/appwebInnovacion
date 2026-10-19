import { createHash } from 'node:crypto'
import { FieldPath } from 'firebase-admin/firestore'
import { fail, text, integer, money, key, codeKey, nameKey, ref, meta, created, mulCents, proportion, journal } from './core.js'

const MAX_LINES = 20
const MAX_STOCK = 1_000_000_000
const INVENTORY_ACCOUNT = { material: '1405', finished: '1435' }

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid-argument', `${label} debe ser un objeto.`)
  return value
}

function list(value, label) {
  if (!Array.isArray(value) || !value.length || value.length > MAX_LINES) fail('invalid-argument', `${label} debe contener entre 1 y ${MAX_LINES} elementos.`)
  return value
}

function optional(value, label, max) {
  return text(value ?? '', label, max, false)
}

function bool(value, label) {
  if (typeof value !== 'boolean') fail('invalid-argument', `${label} debe ser verdadero o falso.`)
  return value
}

function skuFields(value) {
  const sku = text(value, 'SKU', 40).normalize('NFKC')
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(sku)) fail('invalid-argument', 'El SKU admite letras, números, puntos, guiones y guiones bajos, hasta 40 caracteres.')
  return { sku, skuKey: sku.toLowerCase() }
}

function referenceId(value) {
  if (typeof value !== 'string' || !/^r_[a-z0-9._-]{1,60}$/.test(value)) fail('invalid-argument', 'La referencia no es válida.')
  return value
}

function imageUrl(value) {
  const image = optional(value, 'Imagen', 500)
  if (!image) return image
  let url
  try { url = new URL(image) } catch { fail('invalid-argument', 'La imagen debe ser una URL HTTPS válida.') }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) fail('invalid-argument', 'La imagen debe ser una URL HTTPS válida.')
  return image
}

function header(input) {
  object(input, 'La referencia')
  const code = text(input.code, 'Referencia', 60).normalize('NFKC')
  const name = text(input.name, 'Nombre del producto', 100)
  const kind = input.kind ?? 'finished'
  const unit = input.unit ?? 'unidad'
  if (!['finished', 'material'].includes(kind)) fail('invalid-argument', 'El tipo debe ser producto terminado o material.')
  if (!['unidad', 'cm', 'g'].includes(unit) || (kind === 'finished' && unit !== 'unidad')) fail('invalid-argument', 'Los productos terminados se registran en unidades; los materiales admiten unidad, cm o g.')
  return {
    id: codeKey(code),
    data: {
      code, name, nameKey: nameKey(name), kind, unit,
      category: text(input.category ?? 'General', 'Categoría', 60),
      description: optional(input.description, 'Descripción', 2000),
      imageUrl: imageUrl(input.imageUrl),
    },
  }
}

function variantFields(input) {
  object(input, 'La variante')
  return {
    ...skuFields(input.sku),
    size: optional(input.size, 'Talla', 20),
    color: optional(input.color, 'Color', 40),
    lot: optional(input.lot, 'Lote', 60),
    priceCents: money(input.priceCents ?? 0, 'Precio de venta'),
    minStock: integer(input.minStock ?? 5, 'Stock mínimo', 0, MAX_STOCK),
  }
}

function combinationKey(referenceKey, variant) {
  const parts = [referenceKey, variant.size, variant.color, variant.lot].map(value => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('es').replace(/\s+/gu, ' '))
  return `c_${createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`
}

function scaled(total, quantity, denominator) {
  // Unlike a consumed fraction, a receipt can be larger than existing stock.
  // BigInt avoids both floating rounding and an overflowing intermediate sum.
  const result = (BigInt(total) * BigInt(quantity) + BigInt(denominator) / 2n) / BigInt(denominator)
  if (result > 100000000000000n) fail('invalid-argument', 'El valor resultante supera el límite permitido.')
  return Number(result)
}

function indexRef(ctx, skuKey) {
  return ref(ctx, 'variantSkuIndex', `s_${skuKey}`)
}

function combinationRef(ctx, referenceKey, variant) {
  return ref(ctx, 'variantCombinationIndex', combinationKey(referenceKey, variant))
}

async function readAll(tx, refs) {
  if (!refs.length) return []
  return tx.getAll(...refs)
}

function validateHeader(existing, incoming) {
  if (nameKey(existing.name) !== incoming.nameKey) fail('already-exists', `La referencia ${existing.code} ya pertenece a «${existing.name}». Usa otra referencia para otro producto o corrige el nombre del encabezado.`)
  if (existing.kind !== incoming.kind || existing.unit !== incoming.unit) fail('failed-precondition', `La referencia ${existing.code} ya tiene tipo y unidad definidos; no pueden cambiar entre variantes.`)
}

function acquisitionCost(ctx, value, quantity) {
  if (value == null) return undefined
  if (ctx.role !== 'admin') fail('permission-denied', 'Solo el administrador puede registrar costos de adquisición.')
  return mulCents(money(value, 'Costo unitario'), quantity)
}

/** Reads only. Call every loader before the first write in a transaction. */
export async function loadStockItem(tx, ctx, variantId) {
  const id = key(variantId, 'Variante')
  const variantRef = ref(ctx, 'variants', id)
  const costRef = ref(ctx, 'costs', id)
  const [variant, cost] = await readAll(tx, [variantRef, costRef])
  if (!variant.exists) fail('not-found', 'No se encontró la variante. Migra los productos anteriores antes de operar con ellos.')
  const data = variant.data()
  const referenceRef = ref(ctx, 'references', referenceId(data.referenceKey))
  const reference = await tx.get(referenceRef)
  if (!reference.exists) fail('failed-precondition', 'La variante no tiene una referencia válida. Solicita revisión al administrador.')
  const referenceData = reference.data()
  if (referenceData.kind !== data.kind) fail('failed-precondition', 'El tipo de la variante no coincide con su referencia.')
  return { ref: variantRef, data, costRef, costData: cost.exists ? cost.data() : { stockValueCents: 0, unvaluedQuantity: data.stock }, referenceRef, referenceData }
}

/** Writes only. Monetary values are private; movements intentionally omit costs. */
export function applyStockChange(tx, ctx, item, delta, options = {}) {
  integer(delta, 'Movimiento de stock', -MAX_STOCK, MAX_STOCK)
  if (!delta) fail('invalid-argument', 'La cantidad del movimiento debe ser distinta de cero.')
  const stockBefore = integer(item.data.stock, 'Stock actual', 0, MAX_STOCK)
  const stockAfter = integer(stockBefore + delta, 'Stock resultante', 0, MAX_STOCK)
  if (item.data.active !== true && !options.reactivate) fail('failed-precondition', 'La variante está archivada. Reactívala antes de registrar movimientos.')
  const currentValue = money(item.costData?.stockValueCents ?? 0, 'Valor registrado')
  const unknownBefore = integer(item.costData?.unvaluedQuantity ?? (stockBefore && !currentValue ? stockBefore : 0), 'Unidades sin valorar', 0, stockBefore)
  if (!stockBefore && currentValue) fail('failed-precondition', 'El costo registrado no coincide con el stock. Solicita una revisión contable.')
  const quantity = Math.abs(delta)
  let valueCents
  let unknownAfter
  if (delta < 0) {
    // The pooled acquisition value follows the current weighted average. The
    // caller can compare it with a historical amount when posting a reversal.
    valueCents = quantity === stockBefore ? currentValue : proportion(currentValue, quantity, stockBefore)
    unknownAfter = unknownBefore - (quantity === stockBefore ? unknownBefore : Math.min(unknownBefore, proportion(unknownBefore, quantity, stockBefore)))
  } else if (options.valueCents != null) {
    valueCents = money(options.valueCents, 'Valor de adquisición')
    unknownAfter = unknownBefore + integer(options.unvaluedQuantity ?? 0, 'Unidades ingresadas sin valorar', 0, quantity)
  } else {
    valueCents = stockBefore ? scaled(currentValue, quantity, stockBefore) : 0
    unknownAfter = unknownBefore + (stockBefore ? Math.min(quantity, scaled(unknownBefore, quantity, stockBefore)) : quantity)
  }
  const stockValueCents = money(currentValue + (delta > 0 ? valueCents : -valueCents), 'Valor resultante')
  const next = { stock: stockAfter, ...(options.reactivate ? { active: true } : {}), ...meta(ctx) }
  tx.set(item.ref, next, { merge: true })
  tx.set(item.costRef, { stockValueCents, unvaluedQuantity: unknownAfter, ...meta(ctx) }, { merge: true })
  const movementRef = ref(ctx, 'movements')
  tx.set(movementRef, {
    variantId: item.ref.id, referenceKey: item.data.referenceKey,
    sku: item.data.sku, name: item.referenceData.name, delta,
    stockBefore, stockAfter,
    sourceType: text(options.sourceType, 'Origen del movimiento', 60),
    sourceId: text(options.sourceId, 'ID del origen', 128),
    reason: text(options.reason ?? 'Movimiento de inventario', 'Motivo', 500),
    createdAt: ctx.now, createdBy: ctx.uid,
  })
  // Keep repeated changes to a previously loaded item coherent without reads
  // after writes; callers should still consolidate duplicate document lines.
  Object.assign(item.data, next)
  item.costData = { ...item.costData, stockValueCents, unvaluedQuantity: unknownAfter }
  return { valueCents, stockAfter, movementId: movementRef.id, unvaluedQuantity: unknownAfter }
}

function recordInitialValue(tx, ctx, variantId, kind, valueCents, note) {
  if (!valueCents) return
  journal(tx, ctx, {
    sourceType: 'catalog_initial', sourceId: variantId, note,
    lines: [
      { account: INVENTORY_ACCOUNT[kind], debitCents: valueCents, creditCents: 0 },
      { account: '3105', debitCents: 0, creditCents: valueCents },
    ],
  })
}

// Protect unmigrated legacy SKUs too, so adopting v2 cannot create two active
// products with the same code before the administrator finishes migration.
async function legacyReservations(tx, ctx, skuKeys) {
  const legacyIndices = await readAll(tx, skuKeys.map(sku => ref(ctx, 'skuIndex', `s_${sku}`)))
  const ids = [...new Set(legacyIndices.filter(snapshot => snapshot.exists).map(snapshot => snapshot.data().productId).filter(value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)))]
  const migrated = await readAll(tx, ids.map(id => ref(ctx, 'variants', id)))
  const migratedIds = new Set(migrated.filter(snapshot => snapshot.exists).map(snapshot => snapshot.id))
  return new Map(legacyIndices.flatMap((snapshot, index) => snapshot.exists && !migratedIds.has(snapshot.data().productId) ? [[skuKeys[index], snapshot.data().productId]] : []))
}

async function assertLegacyReference(tx, ctx, incoming, migratingIds = new Set()) {
  // Legacy documents do not have a normalized-reference index. Read a small
  // projection in bounded pages rather than matching a few letter cases and
  // missing mixed-case/NFKC equivalents. Old copies whose v2 variant exists
  // no longer reserve their old name: a canonical rename must stay possible.
  const targets = Array.isArray(incoming) ? incoming : [incoming]
  if (!targets.length) return
  const byCode = new Map(targets.map(item => [item.code.normalize('NFKC').trim().toLowerCase(), item]))
  const source = ctx.org.collection('products').orderBy(FieldPath.documentId()).select('reference', 'name').limit(200)
  let cursor
  while (true) {
    const page = await tx.get(cursor ? source.startAfter(cursor) : source)
    const candidates = page.docs.flatMap(snapshot => {
      const old = snapshot.data()
      const target = typeof old.reference === 'string' ? byCode.get(old.reference.normalize('NFKC').trim().toLowerCase()) : undefined
      return !migratingIds.has(snapshot.id) && target ? [{ snapshot, target }] : []
    })
    const variants = await readAll(tx, candidates.map(item => ref(ctx, 'variants', item.snapshot.id)))
    for (let index = 0; index < candidates.length; index++) {
      if (variants[index].exists) continue
      const incoming = candidates[index].target
      const legacyName = candidates[index].snapshot.data().name
      if (typeof legacyName !== 'string' || !legacyName.trim()) fail('failed-precondition', 'Una referencia anterior pendiente tiene un nombre inválido. Revisa y migra ese registro antes de continuar.')
      if (nameKey(legacyName) !== incoming.nameKey) fail('already-exists', `La referencia ${incoming.code} pertenece al producto anterior «${legacyName}», pendiente de migración. Migra o reasigna primero su referencia; no se pueden crear dos productos diferentes con la misma referencia.`)
      if (incoming.kind !== 'finished' || incoming.unit !== 'unidad') fail('failed-precondition', `La referencia ${incoming.code} tiene productos anteriores pendientes en unidades. Migra o reasigna esos registros antes de usarla como materia prima.`)
    }
    if (page.size < 200) return
    cursor = page.docs.at(-1)
  }
}

async function createCatalog(tx, ctx, payload) {
  object(payload, 'El producto')
  const incoming = header(payload.reference)
  const inputs = list(payload.variants, 'Las variantes').map(input => {
    const fields = variantFields(input)
    const stock = integer(input.stock ?? 0, 'Stock inicial', 0, MAX_STOCK)
    const valueCents = acquisitionCost(ctx, input.unitCostCents, stock)
    return { ref: ref(ctx, 'variants'), fields, stock, valueCents }
  })
  const skus = inputs.map(item => item.fields.skuKey)
  const combinations = inputs.map(item => combinationKey(incoming.id, item.fields))
  if (new Set(skus).size !== skus.length) fail('already-exists', 'No repitas el SKU entre variantes.')
  if (new Set(combinations).size !== combinations.length) fail('already-exists', 'No repitas la misma combinación de talla, color y lote en una referencia.')
  const referenceRef = ref(ctx, 'references', incoming.id)
  const [reference, ...indices] = await readAll(tx, [referenceRef, ...skus.map(sku => indexRef(ctx, sku)), ...inputs.map(item => combinationRef(ctx, incoming.id, item.fields))])
  const legacy = await legacyReservations(tx, ctx, skus)
  if (reference.exists) validateHeader(reference.data(), incoming.data)
  if (indices.some(snapshot => snapshot.exists)) fail('already-exists', 'El SKU o la combinación de talla, color y lote ya existe en el inventario.')
  if (legacy.size) fail('already-exists', `El SKU ${[...legacy.keys()][0]} pertenece a un producto anterior. Migra ese producto antes de añadir variantes.`)
  await assertLegacyReference(tx, ctx, incoming.data)
  const referenceData = reference.exists ? reference.data() : incoming.data
  if (!reference.exists) tx.set(referenceRef, { ...incoming.data, ...created(ctx) })
  for (const item of inputs) {
    const data = { ...item.fields, skuAliases: [], referenceKey: incoming.id, kind: referenceData.kind, stock: 0, active: true, ...created(ctx) }
    const costRef = ref(ctx, 'costs', item.ref.id)
    tx.set(item.ref, data)
    tx.set(costRef, { stockValueCents: 0, unvaluedQuantity: 0, ...meta(ctx) })
    tx.set(indexRef(ctx, data.skuKey), { variantId: item.ref.id, ...created(ctx) })
    tx.set(combinationRef(ctx, incoming.id, data), { variantId: item.ref.id, referenceKey: incoming.id, ...created(ctx) })
    if (item.stock) {
      const result = applyStockChange(tx, ctx, { ref: item.ref, data, costRef, costData: { stockValueCents: 0, unvaluedQuantity: 0 }, referenceRef, referenceData }, item.stock, { sourceType: 'catalog_initial', sourceId: item.ref.id, reason: 'Existencia inicial', ...(item.valueCents === undefined ? {} : { valueCents: item.valueCents }) })
      recordInitialValue(tx, ctx, item.ref.id, data.kind, result.valueCents, `Existencia inicial de ${referenceData.name} (${data.sku})`)
    }
  }
  return { id: incoming.id, referenceKey: incoming.id, variantIds: inputs.map(item => item.ref.id) }
}

async function editReference(tx, ctx, payload) {
  object(payload, 'La referencia')
  const referenceRef = ref(ctx, 'references', referenceId(payload.referenceKey))
  const snapshot = await tx.get(referenceRef)
  if (!snapshot.exists) fail('not-found', 'La referencia no existe.')
  const name = text(payload.name, 'Nombre del producto', 100)
  await assertLegacyReference(tx, ctx, { ...snapshot.data(), name, nameKey: nameKey(name) })
  tx.update(referenceRef, {
    name, nameKey: nameKey(name),
    category: text(payload.category ?? snapshot.data().category ?? 'General', 'Categoría', 60),
    description: optional(payload.description ?? snapshot.data().description, 'Descripción', 2000),
    imageUrl: imageUrl(payload.imageUrl ?? snapshot.data().imageUrl),
    ...meta(ctx),
  })
  return { id: referenceRef.id }
}

async function editVariant(tx, ctx, payload) {
  object(payload, 'La variante')
  const item = await loadStockItem(tx, ctx, payload.variantId)
  const fields = variantFields(payload)
  const newIndex = indexRef(ctx, fields.skuKey)
  const newCombination = combinationRef(ctx, item.data.referenceKey, fields)
  const [sku, combination] = await readAll(tx, [newIndex, newCombination])
  const legacy = await legacyReservations(tx, ctx, [fields.skuKey])
  if (sku.exists && sku.data().variantId !== item.ref.id) fail('already-exists', 'Ese SKU ya pertenece a otra variante.')
  if (combination.exists && combination.data().variantId !== item.ref.id) fail('already-exists', 'Esa combinación de talla, color y lote ya existe para la referencia.')
  if (legacy.has(fields.skuKey) && legacy.get(fields.skuKey) !== item.ref.id) fail('already-exists', 'Ese SKU pertenece a un producto anterior pendiente de migración.')
  const skuAliases = [...new Set([...(item.data.skuAliases ?? []), ...(item.data.skuKey !== fields.skuKey ? [item.data.skuKey] : [])])].filter(value => value !== fields.skuKey)
  if (skuAliases.length > 50) fail('failed-precondition', 'Esta variante ya conserva 50 SKU anteriores. Mantén su código para no perder la trazabilidad de las etiquetas.')
  // Every previously printed SKU remains reserved to the same variant. Reusing
  // it for another item would make an old label point at the wrong product.
  const oldCombination = combinationRef(ctx, item.data.referenceKey, item.data)
  if (oldCombination.id !== newCombination.id) tx.delete(oldCombination)
  tx.set(newIndex, { variantId: item.ref.id, ...created(ctx) })
  tx.set(newCombination, { variantId: item.ref.id, referenceKey: item.data.referenceKey, ...created(ctx) })
  tx.update(item.ref, { ...fields, skuAliases, ...meta(ctx) })
  return { id: item.ref.id }
}

function adjustmentJournal(tx, ctx, item, delta, valueCents, reason, sourceType) {
  if (!valueCents) return
  const positive = delta > 0
  journal(tx, ctx, {
    sourceType, sourceId: ctx.commandId, note: reason,
    lines: [
      { account: INVENTORY_ACCOUNT[item.data.kind], debitCents: positive ? valueCents : 0, creditCents: positive ? 0 : valueCents },
      { account: positive ? '4205' : '5195', debitCents: positive ? 0 : valueCents, creditCents: positive ? valueCents : 0 },
    ],
  })
}

async function receiveStock(tx, ctx, payload) {
  object(payload, 'El ingreso')
  const quantity = integer(payload.quantity, 'Cantidad de ingreso', 1, MAX_STOCK)
  const valueCents = acquisitionCost(ctx, payload.unitCostCents, quantity)
  const reason = text(payload.reason ?? 'Ingreso de inventario', 'Motivo', 500)
  const item = await loadStockItem(tx, ctx, payload.variantId)
  const result = applyStockChange(tx, ctx, item, quantity, {
    sourceType: 'stock_receive', sourceId: ctx.commandId, reason,
    // An operational receipt does not establish what the incoming goods cost.
    // Keep it explicitly pending instead of inventing cost from older stock.
    valueCents: valueCents ?? 0,
    unvaluedQuantity: valueCents === undefined ? quantity : 0,
  })
  // A direct receipt has no supplier liability. Purchases have their own flow
  // and post payable/cash. Here the balanced counterpart is an inventory gain.
  adjustmentJournal(tx, ctx, item, quantity, result.valueCents, reason, 'stock_receive')
  return { id: item.ref.id, stock: result.stockAfter }
}

async function adjustStock(tx, ctx, payload) {
  object(payload, 'El ajuste')
  const delta = integer(payload.delta, 'Ajuste', -MAX_STOCK, MAX_STOCK)
  if (!delta) fail('invalid-argument', 'El ajuste debe ser distinto de cero.')
  const reason = text(payload.reason, 'Motivo del ajuste', 500)
  if (delta < 0 && payload.unitCostCents != null) fail('invalid-argument', 'Las salidas usan el costo promedio registrado; no se puede indicar otro costo.')
  const valueCents = delta > 0 ? acquisitionCost(ctx, payload.unitCostCents, delta) : undefined
  const item = await loadStockItem(tx, ctx, payload.variantId)
  const result = applyStockChange(tx, ctx, item, delta, { sourceType: 'stock_adjust', sourceId: ctx.commandId, reason, ...(valueCents === undefined ? {} : { valueCents }) })
  adjustmentJournal(tx, ctx, item, delta, result.valueCents, reason, 'stock_adjust')
  return { id: item.ref.id, stock: result.stockAfter, valueCents: result.valueCents }
}

async function archiveVariant(tx, ctx, payload) {
  object(payload, 'La variante')
  const active = bool(payload.active, 'Estado activo')
  const item = await loadStockItem(tx, ctx, payload.variantId)
  if (!active && item.data.stock !== 0) fail('failed-precondition', 'Solo se puede archivar una variante con stock cero. Registra primero el movimiento correspondiente.')
  tx.update(item.ref, { active, ...meta(ctx) })
  return { id: item.ref.id, active }
}

async function valueStock(tx, ctx, payload) {
  object(payload, 'La valoración')
  const unitCostCents = money(payload.unitCostCents, 'Costo unitario')
  const reason = text(payload.reason, 'Motivo de la valoración', 500)
  const item = await loadStockItem(tx, ctx, payload.variantId)
  if (item.data.stock < 1) fail('failed-precondition', 'La variante no tiene existencias para valorar.')
  const stockValueCents = mulCents(unitCostCents, item.data.stock)
  const previousValue = money(item.costData.stockValueCents ?? 0, 'Valor anterior')
  const difference = stockValueCents - previousValue
  tx.set(item.costRef, { stockValueCents, unvaluedQuantity: 0, ...meta(ctx) }, { merge: true })
  adjustmentJournal(tx, ctx, item, difference >= 0 ? 1 : -1, Math.abs(difference), reason, 'stock_value')
  return { id: item.ref.id, stockValueCents, differenceCents: difference }
}

function legacyPrice(value) {
  if (value == null) return 0
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e12) fail('failed-precondition', 'El precio del producto anterior no es válido. Corrígelo antes de migrar.')
  return money(Math.round((value + Number.EPSILON) * 100), 'Precio anterior')
}

function legacyPrepared(snapshot, requested) {
  const old = snapshot.data()
  if (old.currency != null && old.currency !== 'COP') fail('failed-precondition', `El producto anterior ${snapshot.id} no está registrado en COP. Revisa su moneda antes de migrar.`)
  const shortId = createHash('sha256').update(snapshot.id).digest('hex').slice(0, 24)
  const oldReference = optional(old.reference, 'Referencia anterior', 60)
  const oldSku = optional(old.sku, 'SKU anterior', 40)
  const incoming = header({
    code: requested.referenceCode ?? (oldReference || `LEG-${shortId}`),
    name: old.name, category: old.category || 'General',
    description: old.description ?? '', imageUrl: old.imageUrl ?? '',
    kind: 'finished', unit: 'unidad',
  })
  const fields = variantFields({
    sku: oldSku || `LEGACY-${shortId}`,
    size: old.size ?? '', color: old.color ?? '', lot: old.lot ?? '',
    priceCents: legacyPrice(old.price), minStock: old.minStock ?? 5,
  })
  return { legacyId: snapshot.id, incoming, fields, stock: integer(old.stock ?? 0, 'Stock anterior', 0, MAX_STOCK) }
}

async function migrateLegacy(tx, ctx, payload) {
  object(payload, 'La migración')
  const requests = list(payload.items, 'Los productos a migrar').map(value => {
    object(value, 'El producto a migrar')
    return { legacyId: key(value.legacyId, 'Producto anterior'), ...(value.referenceCode == null ? {} : { referenceCode: text(value.referenceCode, 'Nueva referencia', 60) }) }
  })
  if (new Set(requests.map(item => item.legacyId)).size !== requests.length) fail('invalid-argument', 'No repitas productos en una migración.')
  const snapshots = await readAll(tx, requests.flatMap(item => [ref(ctx, 'products', item.legacyId), ref(ctx, 'migrations', item.legacyId), ref(ctx, 'variants', item.legacyId)]))
  const prepared = []
  const skipped = []
  for (let index = 0; index < requests.length; index++) {
    const [legacy, migration, variant] = snapshots.slice(index * 3, index * 3 + 3)
    if (migration.exists) {
      if (!variant.exists) fail('failed-precondition', 'Hay una migración registrada cuya variante falta. Solicita revisión antes de continuar.')
      skipped.push(requests[index].legacyId)
      continue
    }
    if (!legacy.exists) fail('not-found', `El producto anterior ${requests[index].legacyId} ya no existe.`)
    if (variant.exists) fail('already-exists', `El ID ${requests[index].legacyId} ya está en uso; no se sobrescribirá ningún producto.`)
    prepared.push(legacyPrepared(legacy, requests[index]))
  }
  const headers = new Map()
  for (const item of prepared) {
    const prior = headers.get(item.incoming.id)
    if (prior) validateHeader(prior, item.incoming.data)
    else headers.set(item.incoming.id, item.incoming.data)
  }
  const skuKeys = prepared.map(item => item.fields.skuKey)
  const combinationKeys = prepared.map(item => combinationKey(item.incoming.id, item.fields))
  if (new Set(skuKeys).size !== skuKeys.length) fail('already-exists', 'Dos productos anteriores comparten SKU. Corrige el código antes de migrarlos.')
  if (new Set(combinationKeys).size !== combinationKeys.length) fail('already-exists', 'Dos productos anteriores tienen la misma referencia, talla, color y lote. Reasigna la referencia de uno para conservarlos sin duplicar variantes.')
  const headerIds = [...headers.keys()]
  const [headerSnapshots, skuSnapshots, combinationSnapshots] = await Promise.all([
    readAll(tx, headerIds.map(id => ref(ctx, 'references', id))),
    readAll(tx, skuKeys.map(sku => indexRef(ctx, sku))),
    readAll(tx, prepared.map(item => combinationRef(ctx, item.incoming.id, item.fields))),
  ])
  for (let index = 0; index < headerIds.length; index++) {
    const snapshot = headerSnapshots[index]
    if (snapshot.exists) {
      validateHeader(snapshot.data(), headers.get(headerIds[index]))
      headers.set(headerIds[index], snapshot.data())
    }
  }
  if (skuSnapshots.some(snapshot => snapshot.exists) || combinationSnapshots.some(snapshot => snapshot.exists)) fail('already-exists', 'Un SKU o una combinación anterior ya está asignado. Revisa la referencia y los códigos; la migración no sobrescribe datos.')
  const migratingIds = new Set(prepared.map(item => item.legacyId))
  await assertLegacyReference(tx, ctx, [...headers.values()], migratingIds)
  for (let index = 0; index < headerIds.length; index++) {
    if (!headerSnapshots[index].exists) tx.set(ref(ctx, 'references', headerIds[index]), { ...headers.get(headerIds[index]), ...created(ctx) })
  }
  for (const item of prepared) {
    const variantRef = ref(ctx, 'variants', item.legacyId)
    const costRef = ref(ctx, 'costs', item.legacyId)
    const referenceRef = ref(ctx, 'references', item.incoming.id)
    const referenceData = headers.get(item.incoming.id)
    const data = { ...item.fields, skuAliases: [], referenceKey: item.incoming.id, kind: referenceData.kind, stock: 0, active: true, legacyId: item.legacyId, ...created(ctx) }
    tx.set(variantRef, data)
    tx.set(costRef, { stockValueCents: 0, unvaluedQuantity: 0, ...meta(ctx) })
    tx.set(indexRef(ctx, item.fields.skuKey), { variantId: item.legacyId, ...created(ctx) })
    tx.set(combinationRef(ctx, item.incoming.id, item.fields), { variantId: item.legacyId, referenceKey: item.incoming.id, ...created(ctx) })
    if (item.stock) applyStockChange(tx, ctx, { ref: variantRef, data, costRef, costData: { stockValueCents: 0, unvaluedQuantity: 0 }, referenceRef, referenceData }, item.stock, { sourceType: 'legacy_migration', sourceId: item.legacyId, reason: 'Migración de existencia anterior; costo pendiente de registrar' })
    tx.set(ref(ctx, 'migrations', item.legacyId), { legacyId: item.legacyId, variantId: item.legacyId, referenceKey: item.incoming.id, ...created(ctx) })
  }
  return { id: ctx.commandId, migrated: prepared.map(item => item.legacyId), skipped, unvalued: prepared.filter(item => item.stock > 0).map(item => item.legacyId) }
}

export const handlers = {
  'catalog.create': { roles: ['admin', 'operator'], run: createCatalog },
  'catalog.reference': { roles: ['admin', 'operator'], run: editReference },
  'catalog.variant': { roles: ['admin', 'operator'], run: editVariant },
  'stock.receive': { roles: ['admin', 'operator'], run: receiveStock },
  'stock.adjust': { roles: ['admin'], run: adjustStock },
  'stock.value': { roles: ['admin'], run: valueStock },
  'catalog.archive': { roles: ['admin'], run: archiveVariant },
  'catalog.migrate': { roles: ['admin'], run: migrateLegacy },
}
