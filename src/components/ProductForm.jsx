import { lazy, Suspense, useState } from 'react'
import { normalizeProduct } from '../lib/productModel'

const ProductQr = lazy(() => import('./ProductQr'))
const controls = [
  ['name', 'Nombre del producto', 100], ['sku', 'Código (SKU)', 40],
  ['category', 'Categoría', 60], ['reference', 'Referencia', 60], ['size', 'Talla', 20],
  ['color', 'Color', 40], ['lot', 'Lote', 60], ['imageUrl', 'URL de imagen (HTTPS)', 500],
  ['price', 'Precio unitario (COP)', null, 'number', '0.01'], ['stock', 'Stock', null, 'number', '1'],
  ['minStock', 'Stock mínimo', null, 'number', '1'],
]
const commonFields = new Set(['name', 'category', 'reference', 'imageUrl', 'description', 'kind', 'unit'])

export default function ProductForm({ product, initialValues, onSave, onCancel, role = 'operator', referenceOptions = [], lockedReference = false }) {
  const [fields, setFields] = useState(() => ({ name: '', sku: '', category: 'Jeans', reference: '', size: '', color: '', lot: '', imageUrl: '', description: '', price: 0, stock: 0, minStock: 5, unitCost: '', kind: 'finished', unit: 'unidad', ...initialValues, ...product }))
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [qrDraft, setQrDraft] = useState(null)
  const knownReference = referenceOptions.find(item => item.code?.normalize('NFKC').trim().toLowerCase() === fields.reference.normalize('NFKC').trim().toLowerCase())
  function change(event) {
    setFields(previous => ({ ...previous, [event.target.name]: event.target.value, ...(event.target.name === 'kind' && event.target.value === 'finished' ? { unit: 'unidad' } : {}) }))
    setError(''); setQrDraft(null)
  }
  function validatedProduct() {
    const result = normalizeProduct(fields)
    if (!result.sku) throw new Error('Escribe un SKU único para esta talla, color y lote.')
    if (!/^[A-Za-z0-9._-]{1,60}$/.test(result.reference.normalize('NFKC'))) throw new Error('La referencia es obligatoria y admite letras, números, puntos y guiones (máximo 60).')
    if (!product && knownReference && knownReference.name.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ') !== result.name.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')) throw new Error(`La referencia ${knownReference.code} pertenece a «${knownReference.name}». Usa ese nombre o una referencia diferente.`)
    if (!product && knownReference && ((knownReference.kind || 'finished') !== result.kind || (knownReference.unit || 'unidad') !== result.unit)) throw new Error(`Usa el tipo y la unidad de la referencia ${knownReference.code}: ${knownReference.kind === 'material' ? 'materia prima' : 'producto terminado'} / ${knownReference.unit || 'unidad'}.`)
    return result
  }
  function generateQr() {
    setError('')
    try { setQrDraft(validatedProduct()) }
    catch (failure) { setQrDraft(null); setError(failure.message || 'Revisa los datos para generar el QR.') }
  }
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const value = validatedProduct()
      if (role === 'admin' && !product && fields.unitCost !== '') {
        const cost = Number(fields.unitCost)
        if (!Number.isFinite(cost) || cost < 0 || cost > 1e12) throw new Error('El costo unitario debe ser un importe válido mayor o igual a cero.')
        value.unitCostCents = Math.round((cost + Number.EPSILON) * 100)
      }
      await onSave(value)
    } catch (failure) { setError(failure.message || 'No se pudo guardar. Revisa la conexión y tus permisos.') }
    finally { setBusy(false) }
  }
  return <form onSubmit={submit}>
    <div className="form-grid">{controls.map(([name, label, maxLength, type = 'text', step]) => <div className="form-field" key={name}>
      <label htmlFor={`product-${name}`}>{label}</label>
      <input id={`product-${name}`} name={name} value={fields[name]} onChange={change} type={type} maxLength={maxLength || undefined} min={type === 'number' ? 0 : undefined} max={type === 'number' ? name === 'price' ? 1e12 : 1e9 : undefined} step={step} required={['name', 'sku', 'reference', 'category', 'stock', 'minStock', 'price'].includes(name)} readOnly={(name === 'stock' && Boolean(product)) || (lockedReference && commonFields.has(name))} list={name === 'reference' && !lockedReference ? 'catalog-reference-options' : undefined} />
    </div>)}<div className="form-field"><label htmlFor="product-kind">Tipo de inventario</label><select id="product-kind" name="kind" value={fields.kind} onChange={change} disabled={lockedReference}><option value="finished">Producto terminado</option><option value="material">Materia prima / insumo</option></select></div><div className="form-field"><label htmlFor="product-unit">Unidad de stock</label><select id="product-unit" name="unit" value={fields.unit} onChange={change} disabled={lockedReference}><option value="unidad">Unidad</option>{fields.kind === 'material' && <><option value="cm">Centímetro</option><option value="g">Gramo</option></>}</select></div><div className="form-field is-wide"><label htmlFor="product-description">Descripción</label><textarea id="product-description" name="description" value={fields.description} onChange={change} maxLength={2000} rows={3} readOnly={lockedReference} /></div>
      {role === 'admin' && !product && <div className="form-field is-wide"><label htmlFor="product-unitCost">Costo unitario de ingreso (COP, solo administrador)</label><input id="product-unitCost" name="unitCost" type="number" min="0" max="1000000000000" step="0.01" value={fields.unitCost} onChange={change} placeholder="Sin costo registrado" /><small>Este costo es privado y no se incluye en el QR. Déjalo vacío si todavía no lo conoces.</small></div>}
    </div>
    <datalist id="catalog-reference-options">{referenceOptions.map(item => <option key={item.id || item.code} value={item.code}>{item.name}</option>)}</datalist>
    {knownReference && !product && <p className="storage-note">Esta referencia ya pertenece a <strong>{knownReference.name}</strong>. El nombre debe coincidir; la nueva talla o color se añadirá a esa referencia.</p>}
    {product && <p className="storage-note">Registra nuevas unidades con «Ingresar stock». Los datos comunes pertenecen a la referencia; puedes cambiarlos para todas sus variantes desde «Editar referencia».</p>}
    {!product && <p className="storage-note">Puedes preparar el QR sin guardar el producto. Usa una referencia y un SKU únicos para identificar la variante; si el SKU ya existe, al escanearlo se abrirá el ingreso del producto registrado.</p>}
    {error && <p className="feedback is-error" role="alert">{error}</p>}
    {!product && qrDraft && <section className="catalog-draft-preview" aria-label="QR de producto sin registrar">
      <h3>QR de producto sin registrar</h3>
      <Suspense fallback={<p role="status">Generando QR…</p>}><ProductQr product={qrDraft} draft /></Suspense>
    </section>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>Cancelar</button>{!product && <button type="button" className="secondary-button" onClick={generateQr} disabled={busy}>Generar QR sin guardar</button>}<button type="submit" className="primary-button" disabled={busy}>{busy ? 'Guardando…' : product ? 'Guardar cambios' : 'Guardar producto'}</button></div>
  </form>
}
