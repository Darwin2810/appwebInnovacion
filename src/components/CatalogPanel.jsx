import { lazy, Suspense, useCallback, useRef, useState } from 'react'
import Modal from './Modal'
import ProductForm from './ProductForm'
import { normalizeProduct } from '../lib/productModel'
import { parseProductQr } from '../lib/qr'
import { requestId } from '../lib/erpApi.js'
import { colorSwatch, groupCatalog, hydrateCatalog, matchesCatalogGroup, productStatus } from '../lib/catalogView.js'
import CatalogProductDetail from './catalog/CatalogProductDetail.jsx'
import CatalogLifecycleForm from './catalog/CatalogLifecycleForm.jsx'
import './CatalogPanel.css'

const QrScanner = lazy(() => import('./QrScanner'))
const ProductQr = lazy(() => import('./ProductQr'))
const currency = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 })
const number = new Intl.NumberFormat('es-CO')
const displayMoney = value => currency.format(Number(value || 0))
const identity = value => String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
const referenceCode = value => /^[A-Za-z0-9._-]{1,60}$/.test(String(value || '').normalize('NFKC').trim())
const priceCents = value => {
  const amount = Number(value)
  if (String(value).trim() === '' || !Number.isFinite(amount) || amount < 0 || amount > 1e12) throw new Error('Los importes deben estar entre 0 y 1.000.000.000.000 COP.')
  return Math.round((amount + Number.EPSILON) * 100)
}
const failMessage = error => error?.message || 'No se pudo completar la operación. Revisa la conexión.'
let variantSequence = 0
const blankVariant = (price = 0) => ({ rowId: `variant-row-${++variantSequence}`, sku: '', size: '', color: '', lot: '', price: String(price), stock: '0', minStock: '5', unitCost: '' })
const headerFromProduct = product => ({ code: product.reference, name: product.name, category: product.category, description: product.description, imageUrl: product.imageUrl, kind: product.kind || 'finished', unit: product.unit || 'unidad' })
const headerFromReference = item => ({ code: item.code, name: item.name, category: item.category || 'General', description: item.description || '', imageUrl: item.imageUrl || '', kind: item.kind || 'finished', unit: item.unit || 'unidad' })

function VariantReferenceForm({ references, initialReference, role, onSave, onCancel }) {
  const [selected, setSelected] = useState(initialReference?.id || initialReference?.code || '')
  const [header, setHeader] = useState(() => initialReference ? headerFromReference(initialReference) : { code: '', name: '', category: 'Jeans', description: '', imageUrl: '', kind: 'finished', unit: 'unidad' })
  const [rows, setRows] = useState(() => [blankVariant(initialReference?.defaultPrice)])
  const [preview, setPreview] = useState(null), [error, setError] = useState(''), [working, setWorking] = useState(false)
  const locked = Boolean(selected)
  function changeHeader(event) { setHeader(value => ({ ...value, [event.target.name]: event.target.value, ...(event.target.name === 'kind' && event.target.value === 'finished' ? { unit: 'unidad' } : {}) })); setPreview(null); setError('') }
  function chooseReference(event) {
    const value = event.target.value
    setSelected(value); setPreview(null); setError('')
    const found = references.find(item => (item.id || item.code) === value)
    setRows([blankVariant(found?.defaultPrice)])
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
    <button type="button" className="secondary-button" disabled={working || rows.length >= 20} onClick={() => setRows(value => [...value, blankVariant(references.find(item => (item.id || item.code) === selected)?.defaultPrice)])}>Añadir otra talla / color</button>
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
  const [status, setStatus] = useState('active'), [selectedGroup, setSelectedGroup] = useState(null), [dialog, setDialog] = useState(null), [direct, setDirect] = useState(false)
  const [notice, setNotice] = useState(''), [error, setError] = useState('')
  const pendingCommand = useRef(null)
  const close = useCallback(() => setDialog(null), [])
  const admin = role === 'admin', intake = ['admin', 'operator'].includes(role)
  const canWrite = intake && !busy && !data.loading && !data.error && !data.fromCache && navigator.onLine
  const references = data.references || []
  const all = hydrateCatalog(data, role)
  const catalog = admin ? all : all.filter(product => product.active && !product.deleted)
  const groups = groupCatalog(catalog, references)
  const currentGroup = groups.find(group => group.key === selectedGroup)
  const liveGroups = groups.filter(group => group.products.some(product => productStatus(product) === 'active'))
  const legacyProducts = all.filter(product => product.legacy && !product.deleted)
  const active = catalog.filter(product => product.active && !product.deleted)
  const existing = catalog.filter(product => !product.deleted)
  const currentStatus = admin ? status : 'active'
  const statusGroups = groups.filter(group => group.products.some(product => productStatus(product) === currentStatus))
  const categories = [...new Set(statusGroups.map(group => group.category))].sort()
  const visible = statusGroups.filter(group => (category === 'all' || group.category === category) && (kind === 'all' || group.kind === kind) && matchesCatalogGroup(group, search))
  const referenceOptions = references.filter(reference => reference.active !== false && !reference.deleted).map(reference => ({ ...reference, defaultPrice: groups.find(group => group.referenceKey === (reference.id || reference.referenceKey))?.defaultPrice || 0 }))
  const stats = [
    ['Referencias', number.format(liveGroups.length), 'Un producto por referencia'],
    ['Variantes', number.format(active.length), 'Tallas, colores y lotes activos'],
    ['Unidades terminadas', number.format(active.filter(product => product.kind === 'finished').reduce((sum, product) => sum + product.stock, 0)), 'Stock disponible en referencias activas'],
    ['Stock bajo', number.format(active.filter(product => product.stock <= product.minStock).length), 'Variantes en el mínimo o por debajo'],
  ]
  if (admin) {
    stats.push(['Valor del inventario', displayMoney(existing.reduce((sum, product) => sum + product.stock * Number(product.price || 0), 0)), 'A precio de venta · incluye archivados'])
    stats.push(['Valor al costo registrado', displayMoney((data.costs || []).reduce((sum, cost) => sum + Number(cost.stockValueCents || 0), 0) / 100), 'Privado · incluye stock archivado'])
  }
  async function command(action, payload) {
    if (!canWrite) throw new Error('Espera la conexión con la nube para guardar. El QR sin guardar puede prepararse sin conexión.')
    if (!admin && action !== 'stock.receive') throw new Error('Solo el administrador puede modificar el catálogo.')
    if (['catalog.delete', 'catalog.deleteReference'].includes(action) && data.privateLoading) throw new Error('Espera a que se sincronicen los costos antes de confirmar la baja.')
    if (payload.variantId) {
      const current = all.find(product => product.id === payload.variantId)
      if (!current || current.legacy) throw new Error('El producto ya no está disponible o debe migrarse antes de registrar movimientos.')
      if (current.deleted && !['catalog.restore'].includes(action)) throw new Error('La variante o su referencia está en la papelera. Restáurala antes de continuar.')
      if (['stock.receive', 'stock.adjust'].includes(action) && !current.active) throw new Error('La variante o su referencia está archivada. Reactívala antes de registrar movimientos.')
    }
    if (action === 'catalog.create') {
      const known = references.find(reference => identity(reference.code) === identity(payload.reference?.code))
      if (known && (known.active === false || known.deleted)) throw new Error('Reactiva la referencia antes de añadir variantes.')
    }
    const fingerprint = JSON.stringify({ action, payload })
    if (!pendingCommand.current || pendingCommand.current.fingerprint !== fingerprint) pendingCommand.current = { fingerprint, id: requestId() }
    const pending = pendingCommand.current
    const result = await run(action, payload, pending.id)
    if (pendingCommand.current === pending) pendingCommand.current = null
    return result
  }
  async function complete(action, payload, success) {
    const currentDialog = dialog
    await command(action, payload)
    setNotice(success)
    setDialog(current => current === currentDialog ? null : current)
  }
  const dialogProduct = all.find(product => product.id === dialog?.productId)
  const dialogGroup = groups.find(group => group.key === dialog?.groupKey) || groups.find(group => group.referenceKey === dialog?.referenceKey)
  const currentReference = dialogGroup?.header ? { ...dialogGroup.header, defaultPrice: dialogGroup.defaultPrice } : null
  async function saveProduct(product) {
    if (dialog.mode === 'edit') {
      if (!dialogProduct) throw new Error('La variante ya no está disponible. Actualiza el catálogo.')
      await complete('catalog.variant', { variantId: dialogProduct.id, sku: product.sku, size: product.size, color: product.color, lot: product.lot, priceCents: priceCents(product.price), minStock: product.minStock }, 'Variante actualizada. El stock y los datos de la referencia se conservaron.')
    } else {
      const variant = { sku: product.sku, size: product.size, color: product.color, lot: product.lot, priceCents: priceCents(product.price), stock: product.stock, minStock: product.minStock }
      if (product.unitCostCents !== undefined) variant.unitCostCents = product.unitCostCents
      await complete('catalog.create', { reference: headerFromProduct(product), variants: [variant] }, 'Producto añadido y compartido en tiempo real.')
    }
  }
  function open(mode, product, group) {
    setError('')
    const selected = group || groups.find(item => item.products.some(candidate => candidate.id === product?.id)) || currentGroup
    setDialog({ mode, productId: product?.id, groupKey: selected?.key, referenceKey: selected?.referenceKey })
  }
  async function scan(raw) {
    if (!canWrite) throw new Error('Espera la conexión con la nube para comprobar el QR.')
    const parsed = parseProductQr(raw)
    const found = (parsed.id && all.find(product => product.id === parsed.id)) || (parsed.sku && all.find(product => [product.sku, ...(Array.isArray(product.skuAliases) ? product.skuAliases : [])].some(sku => identity(sku) === identity(parsed.sku))))
    if (found) {
      if (found.legacy) throw new Error('Un administrador debe migrar este producto del inventario anterior antes de ingresar stock.')
      if (found.deleted || !found.active) throw new Error('Esta variante o su referencia está archivada o eliminada. El administrador debe restablecerla antes de ingresar stock.')
      if (direct) await complete('stock.receive', { variantId: found.id, quantity: 1, reason: 'Ingreso directo por QR' }, `Ingreso registrado: 1 ${found.unit} de ${found.name}.`)
      else open('receive', found)
      return
    }
    if (!admin) throw new Error('El código no está registrado. Solicita al administrador crear la referencia y sus variantes; el operador solo puede agregar stock existente.')
    if (parsed.kind === 'sku' || !parsed.fields?.name) throw new Error('El código no está registrado. Usa un QR con los datos completos o añade el producto como administrador.')
    setNotice('Datos leídos del QR. Revisa la referencia, el SKU y los campos antes de guardar.')
    setDialog({ mode: 'create', initialValues: { ...parsed.fields, sku: parsed.sku || '' } })
  }
  const lifecycle = ['archive', 'referenceState', 'delete', 'deleteReference', 'restore', 'restoreReference'].includes(dialog?.mode)
  const lifecycleAction = { archive: 'catalog.archive', referenceState: 'catalog.referenceState', delete: 'catalog.delete', deleteReference: 'catalog.deleteReference', restore: 'catalog.restore', restoreReference: 'catalog.restoreReference' }
  const titles = { create: 'Añadir producto', edit: 'Editar variante', variants: 'Referencia, tallas y colores', reference: 'Editar referencia', receive: 'Ingresar stock', adjust: 'Ajustar stock', scan: 'Escanear código QR', qr: 'QR del producto', archive: 'Archivar o reactivar variante', referenceState: 'Archivar o reactivar referencia', delete: 'Eliminar variante', deleteReference: 'Eliminar referencia', restore: 'Restaurar variante', restoreReference: 'Restaurar referencia', value: 'Valorar existencias', migrate: 'Migrar inventario anterior' }
  const staleDialog = dialog?.productId && !dialogProduct
  return <div className="catalog-module">
    <div className="page-heading"><div className="heading-copy"><p className="eyebrow">CATÁLOGO CENTRALIZADO</p><h1>Inventario de EXLAIDER</h1><p>Una referencia, un producto. Explora sus tallas, colores y existencias.</p></div>{intake && <div className="heading-actions"><button className="secondary-button" disabled={!canWrite} onClick={() => open('scan')}>Escanear QR</button>{admin && <><button className="secondary-button" disabled={Boolean(busy)} onClick={() => { setDialog({ mode: 'variants' }); setError('') }}>Varias tallas y colores</button><button className="primary-button" disabled={Boolean(busy)} onClick={() => { setDialog({ mode: 'create' }); setError('') }}>Añadir producto</button></>}</div>}</div>
    <section className="stats-grid catalog-stats" aria-label="Resumen del inventario">{stats.map(([label, value, caption]) => <article className="stat-card" key={label}><p className="stat-label">{label}</p><p className="stat-value">{value}</p><p className="stat-caption">{caption}</p></article>)}</section>
    {notice && <p className="feedback is-success" role="status">{notice}</p>}
    {error && <p className="feedback is-error" role="alert">{error}</p>}
    {legacyProducts.length > 0 && <aside className="catalog-migration-banner"><div><strong>{legacyProducts.length} productos del inventario anterior</strong><p>Sus datos se conservan en consulta hasta revisar las referencias y migrarlos con trazabilidad.</p></div>{admin && <button className="secondary-button" disabled={!canWrite} onClick={() => open('migrate')}>Revisar y migrar inventario</button>}</aside>}
    {selectedGroup ? currentGroup ? <CatalogProductDetail key={currentGroup.key} group={currentGroup} role={role} canWrite={canWrite} costs={admin ? data.costs || [] : []} onOpen={open} onBack={() => setSelectedGroup(null)} status={currentStatus} /> : <section className="inventory-panel empty-state"><h3>La referencia cambió de estado</h3><p>Su disponibilidad se ha actualizado en tiempo real.</p><button className="secondary-button" onClick={() => setSelectedGroup(null)}>Volver a productos</button></section> : <section className="inventory-panel" aria-labelledby="catalog-products-title">
      <div className="panel-toolbar"><div className="panel-title"><h2 id="catalog-products-title">Tus productos</h2><span>{visible.length} de {statusGroups.length} referencias</span></div><div className="toolbar-actions"><label className="search-field"><span className="sr-only">Buscar productos</span><input type="search" aria-label="Buscar productos" placeholder="Referencia, nombre, SKU, talla o color" value={search} onChange={event => setSearch(event.target.value)} /></label><select className="filter-select" aria-label="Filtrar por categoría" value={category} onChange={event => setCategory(event.target.value)}><option value="all">Todas las categorías</option>{categories.map(value => <option key={value}>{value}</option>)}</select>{['admin', 'operator'].includes(role) && <select className="filter-select" aria-label="Filtrar por tipo" value={kind} onChange={event => setKind(event.target.value)}><option value="all">Productos e insumos</option><option value="finished">Productos terminados</option><option value="material">Materias primas</option></select>}{admin && <select className="filter-select" aria-label="Estado del catálogo" value={status} onChange={event => { setStatus(event.target.value); setCategory('all') }}><option value="active">Activos</option><option value="archived">Archivados</option><option value="deleted">Papelera</option></select>}</div></div>
      <div className="catalog-collection-note"><span>{currentStatus === 'deleted' ? 'Papelera · el historial y los SKU se conservan' : currentStatus === 'archived' ? 'Archivados · el stock se conserva y no admite movimientos' : 'Cada producto reúne todas sus tallas, colores y lotes'}</span><span>{number.format(statusGroups.reduce((sum, group) => sum + group.products.filter(product => productStatus(product) === currentStatus).length, 0))} variantes</span></div>
      {visible.length ? <div className="catalog-products-grid">{visible.map(group => { const items = group.products.filter(product => productStatus(product) === currentStatus), quantity = items.reduce((sum, product) => sum + product.stock, 0); return <article className="catalog-product-card" data-reference-key={group.referenceKey || group.key} key={group.key}><button className="catalog-card-open" aria-label={`Ver variantes de ${group.code}`} onClick={() => setSelectedGroup(group.key)}><div className="catalog-card-image">{group.imageUrl ? <img src={group.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <div className="catalog-card-placeholder"><span>{group.category}</span><strong>{group.code}</strong><span>EXLAIDER</span></div>}<span className="catalog-card-kind">{group.kind === 'material' ? 'Insumo' : 'Producto'}</span></div><div className="catalog-card-body"><p className="catalog-card-reference">REF. {group.code}</p><div className="catalog-card-title"><h3>{group.name}</h3><span aria-hidden="true">↗</span></div>{role !== 'operator' && <p className="catalog-card-price">{displayMoney(group.minPrice)}{group.maxPrice !== group.minPrice ? ` – ${displayMoney(group.maxPrice)}` : ''}</p>}<div className="catalog-card-colors" aria-label={`Colores de ${group.name}`}>{group.colors.slice(0, 7).map(color => <span className="catalog-swatch" style={{ background: colorSwatch(color) }} title={color} key={color} />)}<small>{group.colors.length} {group.colors.length === 1 ? 'color' : 'colores'} · {group.sizes.length} {group.sizes.length === 1 ? 'talla' : 'tallas'}</small></div><div className="catalog-card-footer"><strong>{number.format(quantity)} <small>{group.unit}</small></strong><span>{items.length} {items.length === 1 ? 'variante' : 'variantes'} · Ver detalle →</span></div>{group.legacy && <span className="catalog-field-warning">Pendiente de migración</span>}</div></button></article> })}</div> : <div className="empty-state"><h3>{data.loading ? 'Cargando productos…' : statusGroups.length ? 'No hay coincidencias' : currentStatus === 'deleted' ? 'La papelera está vacía' : currentStatus === 'archived' ? 'No hay productos archivados' : 'Tu inventario está listo para empezar'}</h3><p>{statusGroups.length ? 'Prueba con otra referencia, nombre, talla o color.' : admin ? 'Gestiona tus referencias y sus variantes. Los cambios se sincronizan entre dispositivos.' : 'Aquí aparecerán los productos habilitados por el administrador.'}</p></div>}
    </section>}
    <p className="storage-note">{role === 'operator' ? 'Operador: consulta existencias e ingresa stock de variantes registradas. La creación y los cambios del catálogo corresponden al administrador.' : admin ? 'Las referencias archivadas conservan sus unidades y su valoración. Eliminar da de baja existencias con trazabilidad y conserva el historial en la papelera.' : role === 'seller' ? 'Vendedor: consulta productos y registra tus ventas desde el módulo Ventas.' : 'Usuario: consulta productos, tallas, colores y códigos QR en tiempo real.'}</p>
    {dialog && <Modal title={titles[dialog.mode]} onClose={close}>
      {staleDialog ? <p className="feedback is-error">El producto ya no está disponible. Cierra esta ventana y actualiza el catálogo.</p> : <>
        {admin && ['create', 'edit'].includes(dialog.mode) && <ProductForm product={dialog.mode === 'edit' ? dialogProduct : undefined} initialValues={dialog.initialValues} onSave={saveProduct} onCancel={close} role={role} referenceOptions={referenceOptions} lockedReference={dialog.mode === 'edit'} />}
        {admin && dialog.mode === 'variants' && <VariantReferenceForm references={referenceOptions} initialReference={currentReference} role={role} onSave={payload => complete('catalog.create', payload, 'Referencia y variantes guardadas.')} onCancel={close} />}
        {admin && dialog.mode === 'reference' && currentReference && <ReferenceForm reference={currentReference} onSave={payload => complete('catalog.reference', payload, 'Referencia actualizada en todas sus variantes.')} onCancel={close} />}
        {intake && ['receive', 'adjust'].includes(dialog.mode) && dialogProduct && <StockMovementForm product={dialogProduct} adjustment={dialog.mode === 'adjust'} role={role} onSave={payload => complete(dialog.mode === 'adjust' ? 'stock.adjust' : 'stock.receive', payload, dialog.mode === 'adjust' ? 'Ajuste registrado con trazabilidad.' : 'Ingreso de stock registrado.')} onCancel={close} />}
        {admin && dialog.mode === 'value' && dialogProduct && <StockValueForm product={dialogProduct} onSave={payload => complete('stock.value', payload, 'Costo actualizado con su asiento contable.')} onCancel={close} />}
        {dialog.mode === 'qr' && dialogProduct && <Suspense fallback={<p role="status">Generando QR…</p>}><ProductQr product={dialogProduct} /></Suspense>}
        {intake && dialog.mode === 'scan' && <><label className="checkbox-field"><input type="checkbox" checked={direct} onChange={event => setDirect(event.target.checked)} />Ingreso directo: sumar 1 unidad si el producto ya existe</label><Suspense fallback={<p role="status">Cargando lector…</p>}><QrScanner onScan={scan} onClose={close} /></Suspense></>}
        {admin && dialog.mode === 'migrate' && <MigrationForm products={legacyProducts} references={references} onSave={payload => complete('catalog.migrate', payload, 'Lote migrado. Revisa los productos restantes en otro lote.')} onCancel={close} />}
        {admin && lifecycle && dialogGroup && <CatalogLifecycleForm mode={dialog.mode} product={dialogProduct} group={dialogGroup} costs={data.costs || []} costsLoading={Boolean(data.privateLoading)} onSave={payload => complete(lifecycleAction[dialog.mode], payload, ['delete', 'deleteReference'].includes(dialog.mode) ? 'Enviado a la papelera. Se registró la baja de existencias y se conserva el historial.' : ['restore', 'restoreReference'].includes(dialog.mode) ? 'Datos restaurados. Las unidades dadas de baja no se recuperan automáticamente.' : 'Estado actualizado. El stock y el historial se conservan.')} onCancel={close} />}
      </>}
    </Modal>}
  </div>
}
