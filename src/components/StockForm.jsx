import { useState } from 'react'
export default function StockForm({ product, onSave, onCancel }) {
  const [quantity, setQuantity] = useState('1'), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  async function submit(event) {
    event.preventDefault(); setError('')
    const value = Number(quantity)
    if (!Number.isSafeInteger(value) || value < 1 || value > 1e9) { setError('Introduce una cantidad entera mayor que cero.'); return }
    setBusy(true)
    try { await onSave(value) } catch (err) { setError(err.message || 'No se pudo registrar el ingreso.') } finally { setBusy(false) }
  }
  return <form onSubmit={submit} noValidate><p><strong>{product.name}</strong> · {product.sku || 'Sin SKU'}</p><p>Stock visible: {product.stock}. El ingreso se suma al stock actual en la nube.</p>
    <div className="form-field"><label htmlFor="quantity">Cantidad de ingreso</label><input id="quantity" type="number" min="1" step="1" max="1000000000" required value={quantity} onChange={e => setQuantity(e.target.value)} /></div>
    {error && <p role="alert" className="feedback is-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>Cancelar</button><button className="primary-button" disabled={busy} type="submit">{busy ? 'Registrando…' : 'Registrar ingreso'}</button></div>
  </form>
}
