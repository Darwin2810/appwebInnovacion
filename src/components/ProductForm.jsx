import { useState } from 'react'
import { normalizeProduct } from '../lib/productModel'

const controls = [
  ['name', 'Nombre del producto', 100], ['sku', 'Código (SKU)', 40],
  ['category', 'Categoría', 60], ['reference', 'Referencia', 60], ['size', 'Talla', 20],
  ['color', 'Color', 40], ['lot', 'Lote', 60], ['imageUrl', 'URL de imagen (HTTPS)', 500],
  ['price', 'Precio unitario (COP)', null, 'number', '0.01'], ['stock', 'Stock', null, 'number', '1'],
  ['minStock', 'Stock mínimo', null, 'number', '1'],
]
export default function ProductForm({ product, initialValues, onSave, onCancel }) {
  const [fields, setFields] = useState(() => ({ name: '', sku: '', category: 'Jeans', reference: '', size: '', color: '', lot: '', imageUrl: '', description: '', price: 0, stock: 0, minStock: 5, ...initialValues, ...product }))
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  function change(e) { setFields(prev => ({ ...prev, [e.target.name]: e.target.value })); setError('') }
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('')
    try { await onSave(normalizeProduct(fields)) }
    catch (err) { setError(err.message || 'No se pudo guardar. Revisa la conexión y tus permisos.') }
    finally { setBusy(false) }
  }
  return <form onSubmit={submit}>
    <div className="form-grid">{controls.map(([name, label, maxLength, type = 'text', step]) => <div className="form-field" key={name}>
      <label htmlFor={`product-${name}`}>{label}</label>
      <input id={`product-${name}`} name={name} value={fields[name]} onChange={change} type={type} maxLength={maxLength || undefined} min={type === 'number' ? 0 : undefined} max={type === 'number' ? name === 'price' ? 1e12 : 1e9 : undefined} step={step} required={['name', 'category', 'stock', 'minStock', 'price'].includes(name)} readOnly={name === 'stock' && Boolean(product)} />
    </div>)}<div className="form-field is-wide"><label htmlFor="product-description">Descripción</label><textarea id="product-description" name="description" value={fields.description} onChange={change} maxLength={2000} rows={3} /></div></div>
    {product && <p className="storage-note">Registra nuevas unidades con «Ingresar stock». Editar los datos conserva el stock actual de la nube.</p>}
    {error && <p className="feedback is-error" role="alert">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>Cancelar</button><button type="submit" className="primary-button" disabled={busy}>{busy ? 'Guardando…' : product ? 'Guardar cambios' : 'Guardar producto'}</button></div>
  </form>
}
