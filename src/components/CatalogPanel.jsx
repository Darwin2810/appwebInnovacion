import { lazy, Suspense, useCallback, useRef, useState } from 'react'
import Modal from './Modal'
import ProductForm from './ProductForm'
import { normalizeProduct } from '../lib/productModel'
import { parseProductQr } from '../lib/qr'
import { requestId } from '../lib/erpApi.js'
import './CatalogPanel.css'

const QrScanner = lazy(() => import('./QrScanner'))
const ProductQr = lazy(() => import('./ProductQr'))
const currency = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 })
const number = new Intl.NumberFormat('es-CO')
const displayMoney = value => currency.format(Number(value || 0))
const normalize = value => String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
const identity = value => String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
const referenceCode = value => /^[A-Za-z0-9._-]{1,60}$/.test(String(value || '').normalize('NFKC').trim())
const priceCents = value => {
  const amount = Number(value)
  if (String(value).trim() === '' || !Number.isFinite(amount) || amount < 0 || amount > 1e12) throw new Error('Los importes deben estar entre 0 y 1.000.000.000.000 COP.')
  return Math.round((amount + Number.EPSILON) * 100)
}
const failMessage = error => error?.message || 'No se pudo completar la operación. Revisa la conexión.'
let variantSequence = 0
const blankVariant = () => ({ rowId: `variant-row-${++variantSequence}`, sku: '', size: '', color: '', lot: '', price: '0', stock: '0', minStock: '5', unitCost: '' })
const headerFromProduct = product => ({ code: product.reference, name: product.name, category: product.category, description: product.description, imageUrl: product.imageUrl, kind: product.kind || 'finished', unit: product.unit || 'unidad' })
const headerFromReference = item => ({ code: item.code, name: item.name, category: item.category || 'General', description: item.description || '', imageUrl: item.imageUrl || '', kind: item.kind || 'finished', unit: item.unit || 'unidad' })

function VariantReferenceForm({ references, initialReference, role, onSave, onCancel }) {
  const [selected, setSelected] = useState(initialReference?.id || initialReference?.code || '')
  const [header, setHeader] = useState(() => initialReference ? headerFromReference(initialReference) : { code: '', name: '', category: 'Jeans', description: '', imageUrl: '', kind: 'finished', unit: 'unidad' })
  const [rows, setRows] = useState(() => [blankVariant()])
  const [preview, setPreview] = useState(null), [error, setError] = useState(''), [working, setWorking] = useState(false)
  const locked = Boolean(selected)
  function changeHeader(event) { setHeader(value => ({ ...value, [event.target.name]: event.target.value, ...(event.target.name === 'kind' && event.target.value === 'finished' ? { unit: 'unidad' } : {}) })); setPreview(null); setError('') }
  function chooseReference(event) {
    const value = event.target.value
    setSelected(value); setPreview(null); setError('')
    const found = references.find(item => (item.id || item.code) === value)
    setHeader(found ? headerFromReference(found) : { code: '', name: '', category: 'Jeans', description: '', imageUrl: '', kind: 'finished', unit: 'unidad' })
  }
  function changeRow(rowId, event) { setRows(value => value.map(row => row.rowId === rowId ? { ...row, [event.target.name]: event.target.value } : row)); setPreview(null); setError('') }
  function normalizedRow(row) {
    if (!referenceCode(header.code)) throw new Error('La referencia es obligatoria: usa hasta 60 letras, números, puntos o guiones.')
    const result = normalizeProduct({ ...header, ...row, reference: header.code })
    if (!result.sku) throw new Error('Cada variante necesita un SKU único.')
    const found = references.find(item => identity(item.code) === identity(header.code))
    if (found && identity(found.name) !== identity(result.name)) throw new Error(`La referencia ${found.code} ya pertenece a «${found.name}».`)
    return result
  }
  function generateRowQr(row) {
    setError('')
    try { setPreview(normalizedRow(row)) } catch (failure) { setPreview(null); setError(failMessage(failure)) }
  }
  async function submit(event) {
    event.preventDefault(); setError(''); setWorking(true)
    try {
      const skus = new Set()
      const variants = rows.map(row => {
        const value = normalizedRow(row), skuKey = identity(value.sku)
        if (skus.has(skuKey)) throw new Error(`El SKU ${value.sku} está repetido en el formulario.`)
        skus.add(skuKey)
        const variant = { sku: value.sku, size: value.size, color: value.color, lot: value.lot, priceCents: priceCents(value.price), stock: value.stock, minStock: value.minStock }
        if (role === 'admin' && row.unitCost !== '') variant.unitCostCents = priceCents(row.unitCost)
        return variant
      })
      const normalized = normalizedRow(rows[0])
      await onSave({ reference: { ...header, code: normalized.reference.normalize('NFKC'), name: normalized.name, category: normalized.category, description: normalized.description, imageUrl: normalized.imageUrl }, variants })
    } catch (failure) { setError(failMessage(failure)) } finally { setWorking(false) }
  }
  return <form className="catalog-variants-form" onSubmit={submit}>
    <div className="form-field"><label htmlFor="variant-reference-select">Referencia del producto</label><select id="variant-reference-select" value={selected} onChange={chooseReference}><option value="">Crear una referencia nueva</option>{references.map(item => <option value={item.id || item.code} key={item.id || item.code}>{item.code} · {item.name}</option>)}</select></div>
    <div className="form-grid catalog-reference-fields">
      {[['code', 'Referencia', 60], ['name', 'Nombre común del producto', 100], ['category', 'Categoría', 60], ['imageUrl', 'URL de imagen (HTTPS)', 500]].map(([name, label, max]) => <div className="form-field" key={name}><label htmlFor={`ref-${name}`}>{label}</label><input id={`ref-${name}`} name={name} value={header[name]} onChange={changeHeader} maxLength={max} required={['code', 'name', 'category'].includes(name)} readOnly={locked} /></div>)}
      <div className="form-field"><label htmlFor="ref-kind">Tipo de inventario</label><select id="ref-kind" name="kind" value={header.kind} onChange={changeHeader} disabled={locked}><option value="finished">Producto terminado</option><option value="material">Materia prima / insumo</option></select></div>
      <div className="form-field"><label htmlFor="ref-unit">Unidad de stock</label><select id="ref-unit" name="unit" value={header.unit} onChange={changeHeader} disabled={locked}><option value="unidad">Unidad</option>{header.kind === 'material' && <><option value="cm">Centímetro</option><option value="g">Gramo</option></>}</select></div>
      <div className="form-field is-wide"><label htmlFor="ref-description">Descripción común</label><textarea id="ref-description" name="description" value={header.description} onChange={changeHeader} maxLength={2000} rows={3} readOnly={locked} /></div>
    </div>
    <p className="storage-note">Una referencia corresponde a un solo producto. Cada combinación de talla, color y lote tiene su propio SKU y stock. Las unidades de materia prima se registran como enteros (por ejemplo, centímetros).</p>
    <div className="catalog-variant-list">{rows.map((row, index) => <fieldset className="catalog-variant-row" key={row.rowId}>
      <legend>Variante {index + 1}</legend>
      <div className="form-grid">{[['sku', 'SKU único', 'text', 40], ['size', 'Talla', 'text', 20], ['color', 'Color', 'text', 40], ['lot', 'Lote', 'text', 60], ['price', 'Precio de venta (COP)', 'number'], ['stock', 'Stock inicial', 'number'], ['minStock', 'Stock mínimo', 'number'], ...(role === 'admin' ? [['unitCost', 'Costo unitario (COP, privado)', 'number']] : [])].map(([name, label, type, maxLength]) => <div className="form-field" key={name}><label htmlFor={`${row.rowId}-${name}`}>{label}</label><input id={`${row.rowId}-${name}`} name={name} type={type} value={row[name]} onChange={event => changeRow(row.rowId, event)} maxLength={maxLength} required={['sku', 'price', 'stock', 'minStock'].includes(name)} min={type === 'number' ? 0 : undefined} max={type === 'number' ? ['price', 'unitCost'].includes(name) ? 1e12 : 1e9 : undefined} step={type === 'number' ? ['price', 'unitCost'].includes(name) ? '0.01' : '1' : undefined} /></div>)}</div>
      <div className="catalog-inline-actions"><button type="button" className="secondary-button" disabled={working} onClick={() => generateRowQr(row)}>Preparar QR de variante {index + 1}</button>{rows.length > 1 && <button type="button" className="icon-button danger" disabled={working} onClick={() => { setRows(value => value.filter(item => item.rowId !== row.rowId)); setPreview(null) }}>Quitar variante {index + 1}</button>}</div>
    </fieldset>)}</div>
    <button type="button" className="secondary-button" disabled={working || rows.length >= 20} onClick={() => setRows(value => [...value, blankVariant()])}>Añadir otra talla / color</button>
    <p className="storage-note">Máximo 20 variantes por registro. Puedes añadir más después a la misma referencia. Generar un QR no guarda los productos ni incluye los costos privados.</p>
    {preview && <section className="catalog-draft-preview" aria-label="QR de variante sin registrar"><h3>QR sin registrar · {preview.sku}</h3><Suspense fallback={<p role="status">Generando QR…</p>}><ProductQr product={preview} draft /></Suspense></section>}
    {error && <p className="feedback is-error" role="alert">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" disabled={working} onClick={onCancel}>Cancelar</button><button type="submit" className="primary-button" disabled={working}>{working ? 'Guardando…' : 'Guardar referencia y variantes'}</button></div>
  </form>
}

function ReferenceForm({ reference, onSave, onCancel }) {
  const [fields, setFields] = useState(() => headerFromReference(reference)), [error, setError] = useState(''), [working, setWorking] = useState(false)
  async function submit(event) {
    event.preventDefault(); setError(''); setWorking(true)
    try {
      const normalized = normalizeProduct({ ...fields, reference: fields.code, sku: 'HEADER', stock: 0, minStock: 0, price: 0 })
      await onSave({ referenceKey: reference.id || reference.referenceKey, name: normalized.name, category: normalized.category, description: normalized.description, imageUrl: normalized.imageUrl })
    } catch (failure) { setError(failMessage(failure)) } finally { setWorking(false) }
  }
  return <form onSubmit={submit}><p>Referencia <strong>{reference.code}</strong>. Estos cambios se aplican a todas sus tallas, colores y lotes.</p><div className="form-grid">{[['name', 'Nombre común del producto', 100], ['category', 'Categoría', 60], ['imageUrl', 'URL de imagen (HTTPS)', 500]].map(([name, label, max]) => <div className="form-field" key={name}><label htmlFor={`edit-reference-${name}`}>{label}</label><input id={`edit-reference-${name}`} value={fields[name]} maxLength={max} required={name !== 'imageUrl'} onChange={event => setFields(value => ({ ...value, [name]: event.target.value }))} /></div>)}<div className="form-field is-wide"><label htmlFor="edit-reference-description">Descripción común</label><textarea id="edit-reference-description" value={fields.description} maxLength={2000} rows={3} onChange={event => setFields(value => ({ ...value, description: event.target.value }))} /></div></div>{error && <p className="feedback is-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" disabled={working} onClick={onCancel}>Cancelar</button><button type="submit" className="primary-button" disabled={working}>{working ? 'Guardando…' : 'Actualizar toda la referencia'}</button></div></form>
}

function StockMovementForm({ product, adjustment, role, onSave, onCancel }) {
  const [quantity, setQuantity] = useState('1'), [unitCost, setUnitCost] = useState(''), [reason, setReason] = useState('')
  const [error, setError] = useState(''), [working, setWorking] = useState(false)
  async function submit(event) {
    event.preventDefault(); setError('')
    const value = Number(quantity)
    if (!Number.isSafeInteger(value) || value === 0 || Math.abs(value) > 1e9 || (!adjustment && value < 1)) { setError(adjustment ? 'Introduce un ajuste entero distinto de cero.' : 'Introduce una cantidad entera mayor que cero.'); return }
    if (adjustment && !reason.trim()) { setError('El motivo es obligatorio para la trazabilidad del ajuste.'); return }
    setWorking(true)
    try {
      const payload = { variantId: product.id, [adjustment ? 'delta' : 'quantity']: value, reason: reason.trim() || 'Ingreso manual de inventario' }
      if (role === 'admin' && value > 0 && unitCost !== '') payload.unitCostCents = priceCents(unitCost)
      await onSave(payload)
    } catch (failure) { setError(failMessage(failure)) } finally { setWorking(false) }
  }
  return <form onSubmit={submit} noValidate><p><strong>{product.name}</strong> · {product.sku}</p><p>Stock visible: {number.format(product.stock)} {product.unit || 'unidad'}. La operación utiliza el stock actual en la nube.</p><div className="form-grid">
    <div className="form-field"><label htmlFor="quantity">{adjustment ? 'Cantidad del ajuste (+ o −)' : 'Cantidad de ingreso'}</label><input id="quantity" type="number" min={adjustment ? -1e9 : 1} max="1000000000" step="1" required value={quantity} onChange={event => setQuantity(event.target.value)} /></div>
    {role === 'admin' && Number(quantity) > 0 && <div className="form-field"><label htmlFor="stock-unit-cost">Costo unitario de ingreso (COP, privado)</label><input id="stock-unit-cost" type="number" min="0" max="1000000000000" step="0.01" value={unitCost} onChange={event => setUnitCost(event.target.value)} placeholder={adjustment ? 'Conservar costo promedio' : 'Costo pendiente si se deja vacío'} /></div>}
    <div className="form-field is-wide"><label htmlFor="stock-reason">Motivo {adjustment ? '(obligatorio)' : '(opcional)'}</label><textarea id="stock-reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={500} rows={3} required={adjustment} /></div>
  </div>{!adjustment && <p className="storage-note">Si el ingreso no tiene un costo registrado, queda pendiente de valorar. Para una compra a un proveedor, el administrador debe usar el módulo Compras para registrar también la cuenta por pagar y sus abonos.</p>}{adjustment && <p className="storage-note">Usa cantidades negativas para corregir faltantes. El ajuste conserva el historial y registra su efecto contable.</p>}{error && <p className="feedback is-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" disabled={working} onClick={onCancel}>Cancelar</button><button type="submit" className="primary-button" disabled={working}>{working ? 'Registrando…' : adjustment ? 'Registrar ajuste' : 'Registrar ingreso'}</button></div></form>
}

function StockValueForm({ product, onSave, onCancel }) {
  const [unitCost, setUnitCost] = useState(''), [reason, setReason] = useState('')
  const [error, setError] = useState(''), [working, setWorking] = useState(false)
  async function submit(event) {
    event.preventDefault(); setError(''); setWorking(true)
    try {
      if (!reason.trim()) throw new Error('Escribe el motivo de la valoración para conservar su trazabilidad.')
      await onSave({ variantId: product.id, unitCostCents: priceCents(unitCost), reason: reason.trim() })
    } catch (failure) { setError(failMessage(failure)) } finally { setWorking(false) }
  }
  return <form onSubmit={submit}><p><strong>{product.name}</strong> · {product.sku}</p><p>Esta operación establece el costo unitario de todas las existencias actuales, sin cambiar la cantidad. Su diferencia se registra contablemente.</p><div className="form-grid"><div className="form-field"><label htmlFor="valuation-cost">Costo unitario real (COP)</label><input id="valuation-cost" type="number" min="0" max="1000000000000" step="0.01" required value={unitCost} onChange={event => setUnitCost(event.target.value)} /></div><div className="form-field is-wide"><label htmlFor="valuation-reason">Motivo de la valoración</label><textarea id="valuation-reason" value={reason} maxLength={500} rows={3} required onChange={event => setReason(event.target.value)} /></div></div><p className="storage-note">Stock visible: {number.format(product.stock)} {product.unit || 'unidad'}. Usa el costo de adquisición, no el precio de venta.</p>{error && <p className="feedback is-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" disabled={working} onClick={onCancel}>Cancelar</button><button type="submit" className="primary-button" disabled={working}>{working ? 'Valorando…' : 'Registrar valoración'}</button></div></form>
}

function MigrationForm({ products, references, onSave, onCancel }) {
  const [mapping, setMapping] = useState(() => Object.fromEntries(products.map(product => [product.id, referenceCode(product.reference) ? product.reference.trim() : ''])))
  const [selected, setSelected] = useState(() => products.slice(0, 20).map(product => product.id))
  const [error, setError] = useState(''), [working, setWorking] = useState(false)
  const names = new Map()
  function addName(code, name) { const normalized = identity(code); if (!normalized) return; if (!names.has(normalized)) names.set(normalized, new Set()); names.get(normalized).add(identity(name)) }
  references.forEach(reference => addName(reference.code, reference.name))
  products.forEach(product => addName(mapping[product.id], product.name))
  function issue(product) {
    const code = mapping[product.id]
    if (!referenceCode(code)) return 'Escribe una referencia válida para migrar este producto.'
    if (names.get(identity(code))?.size > 1) return 'Esta referencia contiene nombres diferentes. Asigna una referencia distinta a uno de los productos.'
    return ''
  }
  async function submit(event) {
    event.preventDefault(); setError('')
    if (!selected.length || selected.length > 20) { setError('Selecciona entre 1 y 20 productos por lote.'); return }
    const invalid = products.find(product => selected.includes(product.id) && issue(product))
    if (invalid) { setError(`${invalid.name}: ${issue(invalid)}`); return }
    setWorking(true)
    try { await onSave({ items: selected.map(legacyId => ({ legacyId, referenceCode: mapping[legacyId].normalize('NFKC').trim() })) }) }
    catch (failure) { setError(failMessage(failure)) } finally { setWorking(false) }
  }
  return <form onSubmit={submit} className="catalog-migration-form"><p>Revisa la referencia de cada producto anterior. Se conservan sus identificadores, códigos QR y stock. Los documentos originales permanecen como respaldo de solo lectura.</p><p className="storage-note">No se supondrán costos de compra a partir del precio de venta. Los costos iniciales desconocidos quedan sin valorar hasta usar «Valorar existencias» desde la cuenta administradora. Migra hasta 20 productos a la vez.</p><p className="catalog-selection-count" role="status">{selected.length} de {products.length} seleccionados</p><div className="catalog-migration-list">{products.map(product => <article className="catalog-migration-item" key={product.id}><label className="catalog-migration-select"><input type="checkbox" checked={selected.includes(product.id)} onChange={event => { setSelected(value => event.target.checked ? [...value, product.id] : value.filter(id => id !== product.id)); setError('') }} disabled={working || (!selected.includes(product.id) && selected.length >= 20)} /><span><strong>{product.name}</strong><small>{product.sku || 'Se asignará un SKU legado'} · {product.size || 'Sin talla'} · {product.color || 'Sin color'} · {product.stock} unidades</small></span></label><div className="form-field"><label htmlFor={`migration-${product.id}`}>Referencia de {product.name}</label><input id={`migration-${product.id}`} value={mapping[product.id]} onChange={event => { setMapping(value => ({ ...value, [product.id]: event.target.value })); setError('') }} maxLength={60} disabled={working} aria-invalid={Boolean(issue(product))} />{issue(product) && <small className="catalog-field-warning">{issue(product)}</small>}</div></article>)}</div>{error && <p className="feedback is-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" disabled={working} onClick={onCancel}>Cancelar</button><button type="submit" className="primary-button" disabled={working || !selected.length}>{working ? 'Migrando…' : 'Migrar productos seleccionados'}</button></div></form>
}

export default function CatalogPanel({ data, run, role, busy }) {
  const [search, setSearch] = useState(''), [category, setCategory] = useState('all'), [kind, setKind] = useState('all')
  const [showArchived, setShowArchived] = useState(false), [dialog, setDialog] = useState(null), [direct, setDirect] = useState(false)
  const [notice, setNotice] = useState(''), [error, setError] = useState(''), [working, setWorking] = useState(false)
  const pendingCommand = useRef(null)
  const close = useCallback(() => setDialog(null), [])
  const writable = ['admin', 'operator'].includes(role)
  const canWrite = writable && !busy && !data.loading && !data.error && !data.fromCache && navigator.onLine
  const references = data.references || [], variants = data.variants || []
  const referenceMap = new Map(references.map(reference => [reference.id || reference.referenceKey, reference]))
  const variantIds = new Set(variants.map(variant => variant.id))
  const legacyProducts = (data.legacyProducts || []).filter(product => !variantIds.has(product.id)).map(product => ({ ...product, legacy: true, kind: product.kind || 'finished', unit: product.unit || 'unidad' }))
  const allProducts = new Map((data.products || []).map(product => [product.id, product]))
  legacyProducts.forEach(product => { if (!allProducts.has(product.id)) allProducts.set(product.id, product) })
  variants.forEach(variant => {
    if (allProducts.has(variant.id)) return
    const reference = referenceMap.get(variant.referenceKey)
    if (reference) allProducts.set(variant.id, { ...variant, ...headerFromProduct({ ...reference, reference: reference.code }), id: variant.id, reference: reference.code, referenceKey: variant.referenceKey, kind: variant.kind || reference.kind, price: (variant.priceCents || 0) / 100, legacy: false })
  })
  const all = [...allProducts.values()].filter(product => role !== 'viewer' || (product.kind || 'finished') === 'finished')
  const products = all.filter(product => showArchived && role === 'admin' ? true : product.active !== false)
  const active = all.filter(product => product.active !== false)
  const categories = [...new Set(products.map(product => product.category || 'General'))].sort()
  const query = normalize(search.trim())
  const visible = products.filter(product => (category === 'all' || (product.category || 'General') === category) && (kind === 'all' || (product.kind || 'finished') === kind) && normalize([product.name, product.sku, ...(Array.isArray(product.skuAliases) ? product.skuAliases : []), product.reference, product.size, product.color, product.lot, product.category].join(' ')).includes(query))
  const stats = [
    ['Referencias', number.format(new Set(active.map(product => product.referenceKey || identity(product.reference) || product.id)).size), 'Un producto por referencia'],
    ['Variantes', number.format(active.length), 'Tallas, colores y lotes activos'],
    ['Unidades terminadas', number.format(active.filter(product => (product.kind || 'finished') === 'finished').reduce((total, product) => total + (product.stock || 0), 0)), 'Productos terminados disponibles'],
    ['Stock bajo', number.format(active.filter(product => product.stock <= product.minStock).length), 'En el mínimo o por debajo'],
  ]
  if (role !== 'operator') stats.push(['Valor del inventario', displayMoney(active.reduce((total, product) => total + (product.stock || 0) * (product.price || 0), 0)), 'Stock × precio de venta · COP'])
  if (role === 'admin') stats.push(['Valor al costo registrado', displayMoney((data.costs || []).reduce((total, cost) => total + (cost.stockValueCents || 0), 0) / 100), 'Privado · sin estimar costos desconocidos'])
  async function command(action, payload) {
    if (!canWrite) throw new Error('Espera la conexión con la nube para guardar. El QR sin guardar puede prepararse sin conexión.')
    const fingerprint = JSON.stringify({ action, payload })
    if (!pendingCommand.current || pendingCommand.current.fingerprint !== fingerprint) pendingCommand.current = { fingerprint, id: requestId() }
    const pending = pendingCommand.current
    // Preserve the command identity after a failed or lost response. Retrying
    // the same form must confirm the original operation, not duplicate it.
    const result = await run(action, payload, pending.id)
    if (pendingCommand.current === pending) pendingCommand.current = null
    return result
  }
  async function saveProduct(product) {
    if (dialog.mode === 'edit') {
      await command('catalog.variant', { variantId: dialog.product.id, sku: product.sku, size: product.size, color: product.color, lot: product.lot, priceCents: priceCents(product.price), minStock: product.minStock })
      setNotice('Variante actualizada. El stock y los datos de la referencia se conservaron.')
    } else {
      const variant = { sku: product.sku, size: product.size, color: product.color, lot: product.lot, priceCents: priceCents(product.price), stock: product.stock, minStock: product.minStock }
      if (role === 'admin' && product.unitCostCents !== undefined) variant.unitCostCents = product.unitCostCents
      await command('catalog.create', { reference: headerFromProduct(product), variants: [variant] })
      setNotice('Producto añadido al inventario y compartido en tiempo real.')
    }
    setDialog(current => current === dialog ? null : current)
  }
  async function complete(action, payload, success) { const currentDialog = dialog; await command(action, payload); setNotice(success); setDialog(current => current === currentDialog ? null : current) }
  async function archive() {
    setWorking(true); setError('')
    try { await complete('catalog.archive', { variantId: dialog.product.id, active: dialog.product.active === false }, dialog.product.active === false ? 'Variante reactivada.' : 'Variante archivada. Su historial se conserva.') }
    catch (failure) { setError(failMessage(failure)) } finally { setWorking(false) }
  }
  async function scan(raw) {
    if (!canWrite) throw new Error('Espera la conexión con la nube para comprobar el QR.')
    const parsed = parseProductQr(raw)
    const found = (parsed.id && all.find(product => product.id === parsed.id)) || (parsed.sku && all.find(product => [product.sku, ...(Array.isArray(product.skuAliases) ? product.skuAliases : [])].some(sku => identity(sku) === identity(parsed.sku))))
    if (found) {
      if (found.legacy) throw new Error('Este producto pertenece al inventario anterior. Un administrador debe migrarlo antes de registrar movimientos.')
      if (found.active === false) throw new Error('Esta variante está archivada. Un administrador debe reactivarla antes de ingresar stock.')
      if (direct) await complete('stock.receive', { variantId: found.id, quantity: 1, reason: 'Ingreso directo por QR' }, `Ingreso registrado: 1 ${found.unit || 'unidad'} de ${found.name}.`)
      else setDialog({ mode: 'receive', product: found })
      return
    }
    if (parsed.kind === 'sku' || !parsed.fields?.name) throw new Error('El código no está registrado. Usa un QR con los datos completos o añade el producto.')
    setNotice('Datos leídos del QR. Revisa la referencia, el SKU y los campos antes de guardar.')
    setDialog({ mode: 'create', initialValues: { ...parsed.fields, sku: parsed.sku || '' } })
  }
  function open(mode, product) { setError(''); setDialog({ mode, product }) }
  const currentReference = dialog?.product ? referenceMap.get(dialog.product.referenceKey) : null
  const titles = { create: 'Añadir producto', edit: 'Editar variante', variants: 'Referencia, tallas y colores', reference: 'Editar referencia', receive: 'Ingresar stock', adjust: 'Ajustar stock', scan: 'Escanear código QR', qr: 'QR del producto', archive: 'Archivar o reactivar variante', value: 'Valorar existencias', migrate: 'Migrar inventario anterior' }
  return <div className="catalog-module">
    <div className="page-heading"><div className="heading-copy"><p className="eyebrow">CATÁLOGO CENTRALIZADO</p><h1>Inventario de EXLAIDER</h1><p>Una referencia, un producto y todas sus tallas, colores y lotes.</p></div>{writable && <div className="heading-actions"><button className="secondary-button" disabled={!canWrite} onClick={() => open('scan')}>Escanear QR</button><button className="secondary-button" disabled={Boolean(busy)} onClick={() => open('variants')}>Varias tallas y colores</button><button className="primary-button" disabled={Boolean(busy)} onClick={() => open('create')}>Añadir producto</button></div>}</div>
    <section className="stats-grid catalog-stats" aria-label="Resumen del inventario">{stats.map(([label, value, caption]) => <article className="stat-card" key={label}><p className="stat-label">{label}</p><p className="stat-value">{value}</p><p className="stat-caption">{caption}</p></article>)}</section>
    {notice && <p className="feedback is-success" role="status">{notice}</p>}
    {error && !dialog && <p className="feedback is-error" role="alert">{error}</p>}
    {legacyProducts.length > 0 && <aside className="catalog-migration-banner"><div><strong>{legacyProducts.length} productos del inventario anterior</strong><p>Se muestran en modo de solo lectura hasta revisar sus referencias y migrarlos al catálogo con trazabilidad.</p></div>{role === 'admin' && <button className="secondary-button" disabled={!canWrite} onClick={() => open('migrate')}>Revisar y migrar inventario</button>}</aside>}
    <section className="inventory-panel" aria-labelledby="catalog-products-title"><div className="panel-toolbar"><div className="panel-title"><h2 id="catalog-products-title">Tus productos</h2><span>{visible.length} de {products.length} variantes</span></div><div className="toolbar-actions"><label className="search-field"><span className="sr-only">Buscar productos</span><input type="search" aria-label="Buscar productos" placeholder="Referencia, talla, color, lote o nombre" value={search} onChange={event => setSearch(event.target.value)} /></label><select className="filter-select" aria-label="Filtrar por categoría" value={category} onChange={event => setCategory(event.target.value)}><option value="all">Todas las categorías</option>{categories.map(value => <option key={value}>{value}</option>)}</select>{role !== 'viewer' && <select className="filter-select" aria-label="Filtrar por tipo" value={kind} onChange={event => setKind(event.target.value)}><option value="all">Productos e insumos</option><option value="finished">Productos terminados</option><option value="material">Materias primas</option></select>}</div></div>
      {role === 'admin' && <label className="catalog-show-archived"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} />Incluir variantes archivadas</label>}
      {visible.length ? <div className="table-wrap"><table className="inventory-table catalog-table" aria-label="Productos del inventario"><thead><tr><th>Producto</th><th>Referencia y variante</th><th>Stock</th><th>Precio unitario</th>{role === 'admin' && <th>Costo registrado</th>}<th>Acciones</th></tr></thead><tbody>{visible.map(product => {
        const cost = role === 'admin' ? (data.costs || []).find(item => item.id === product.id) : null
        return <tr key={product.id} data-sku={product.sku} data-variant-id={product.id} className={product.active === false ? 'catalog-archived' : ''}><td><div className="product-cell">{product.imageUrl && <img className="product-image" src={product.imageUrl} alt={product.name} loading="lazy" referrerPolicy="no-referrer" />}<div><span className="product-name">{product.name}</span><span className="product-sku">{product.sku || 'Sin SKU'} · {product.category || 'General'}</span>{product.description && <p className="product-description">{product.description}</p>}<span className="catalog-type-label">{product.kind === 'material' ? 'Materia prima' : 'Producto terminado'}{product.legacy ? ' · Pendiente de migración' : product.active === false ? ' · Archivada' : ''}</span></div></div></td><td><strong>{product.reference || 'Sin referencia'}</strong><span className="product-sku">Talla {product.size || '—'} · {product.color || 'Sin color'} · Lote {product.lot || '—'}</span></td><td><span className={`stock-badge ${product.stock <= product.minStock ? 'is-low' : 'is-good'}`}>{number.format(product.stock || 0)} {product.unit || 'unidad'}</span><span className="product-sku">Mínimo: {number.format(product.minStock || 0)}</span></td><td>{displayMoney(product.price)}</td>{role === 'admin' && <td><span>{cost ? displayMoney(cost.stockValueCents / 100) : 'Sin valorar'}</span><span className="product-sku">{cost && product.stock > 0 ? `${displayMoney(cost.stockValueCents / product.stock / 100)} / ${product.unit || 'unidad'}` : 'Costo total en stock'}</span>{cost?.unvaluedQuantity > 0 && <span className="catalog-field-warning">{number.format(cost.unvaluedQuantity)} sin valorar</span>}</td>}<td><div className="row-actions"><button className="secondary-button" aria-label={`Ver QR de ${product.name}`} onClick={() => open('qr', product)}>QR</button>{writable && !product.legacy && product.active !== false && <><button className="secondary-button" disabled={!canWrite} aria-label={`Ingresar stock de ${product.name}`} onClick={() => open('receive', product)}>Ingresar stock</button><button className="icon-button" disabled={!canWrite} aria-label={`Editar variante ${product.sku}`} onClick={() => open('edit', product)}>Editar variante</button><button className="icon-button" disabled={!canWrite} aria-label={`Añadir variante a referencia ${product.reference}`} onClick={() => open('variants', product)}>Añadir talla/color</button><button className="icon-button" disabled={!canWrite} aria-label={`Editar referencia ${product.reference}`} onClick={() => open('reference', product)}>Editar referencia</button></>}{role === 'admin' && !product.legacy && <>{product.active !== false && <><button className="icon-button" disabled={!canWrite} aria-label={`Ajustar stock de ${product.sku}`} onClick={() => open('adjust', product)}>Ajustar stock</button>{product.stock > 0 && <button className="icon-button" disabled={!canWrite} aria-label={`Valorar existencias de ${product.sku}`} onClick={() => open('value', product)}>Valorar existencias</button>}</>}<button className="icon-button danger" disabled={!canWrite || (product.active !== false && product.stock !== 0)} title={product.stock !== 0 ? 'El stock debe ser cero antes de archivar.' : undefined} aria-label={`${product.active === false ? 'Reactivar' : 'Archivar'} variante ${product.sku}`} onClick={() => open('archive', product)}>{product.active === false ? 'Reactivar' : 'Archivar'}</button></>}</div></td></tr>
      })}</tbody></table></div> : <div className="empty-state"><h3>{data.loading ? 'Cargando productos…' : products.length ? 'No hay coincidencias' : 'Tu inventario está listo para empezar'}</h3><p>{products.length ? 'Prueba con otra referencia, nombre o variante.' : 'Agrega una referencia y sus tallas o colores. Los cambios aparecerán en los otros dispositivos.'}</p></div>}
    </section>
    <p className="storage-note">El precio de venta sigue visible en cada producto. Los costos de compra y los módulos financieros se consultan exclusivamente desde una cuenta administradora.</p>
    {dialog && <Modal title={titles[dialog.mode]} onClose={close}>
      {['create', 'edit'].includes(dialog.mode) && <ProductForm product={dialog.product} initialValues={dialog.initialValues} onSave={saveProduct} onCancel={close} role={role} referenceOptions={references} lockedReference={dialog.mode === 'edit'} />}
      {dialog.mode === 'variants' && <VariantReferenceForm references={references} initialReference={currentReference} role={role} onSave={payload => complete('catalog.create', payload, 'Referencia y variantes guardadas.')} onCancel={close} />}
      {dialog.mode === 'reference' && currentReference && <ReferenceForm reference={currentReference} onSave={payload => complete('catalog.reference', payload, 'Referencia actualizada en todas sus variantes.')} onCancel={close} />}
      {['receive', 'adjust'].includes(dialog.mode) && <StockMovementForm product={dialog.product} adjustment={dialog.mode === 'adjust'} role={role} onSave={payload => complete(dialog.mode === 'adjust' ? 'stock.adjust' : 'stock.receive', payload, dialog.mode === 'adjust' ? 'Ajuste de inventario registrado con trazabilidad.' : 'Ingreso de stock registrado.')} onCancel={close} />}
      {dialog.mode === 'value' && <StockValueForm product={dialog.product} onSave={payload => complete('stock.value', payload, 'Costo de las existencias actualizado con su asiento contable.')} onCancel={close} />}
      {dialog.mode === 'qr' && <Suspense fallback={<p role="status">Generando QR…</p>}><ProductQr product={dialog.product} /></Suspense>}
      {dialog.mode === 'scan' && <><label className="checkbox-field"><input type="checkbox" checked={direct} onChange={event => setDirect(event.target.checked)} />Ingreso directo: sumar 1 unidad si el producto ya existe</label><Suspense fallback={<p role="status">Cargando lector…</p>}><QrScanner onScan={scan} onClose={close} /></Suspense></>}
      {dialog.mode === 'migrate' && <MigrationForm products={legacyProducts} references={references} onSave={payload => complete('catalog.migrate', payload, 'Lote migrado. Los productos restantes pueden revisarse en otro lote.')} onCancel={close} />}
      {dialog.mode === 'archive' && <><p>{dialog.product.active === false ? 'Reactivar' : 'Archivar'} la variante <strong>{dialog.product.sku}</strong> de {dialog.product.name}.</p><p>Los movimientos, ventas y documentos relacionados conservarán su historial.</p>{error && <p className="feedback is-error" role="alert">{error}</p>}<div className="modal-actions"><button className="secondary-button" disabled={working} onClick={close}>Cancelar</button><button className="primary-button" disabled={working} onClick={archive}>{working ? 'Guardando…' : dialog.product.active === false ? 'Reactivar variante' : 'Archivar variante'}</button></div></>}
    </Modal>}
  </div>
}
