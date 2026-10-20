import { useState } from 'react'
import { catalogWriteOffPreview } from '../../lib/catalogView.js'

export default function CatalogLifecycleForm({ mode, product, group, costs, costsLoading, onSave, onCancel }) {
  const [reason, setReason] = useState(''), [confirmation, setConfirmation] = useState(''), [error, setError] = useState(''), [working, setWorking] = useState(false)
  const reference = ['referenceState', 'deleteReference', 'restoreReference'].includes(mode)
  const deleting = mode === 'delete' || mode === 'deleteReference', restoring = mode === 'restore' || mode === 'restoreReference'
  const liveActive = reference ? group.header?.active !== false : product?.active !== false
  const stateSignature = JSON.stringify(reference ? { active: liveActive, deleted: group.header?.deleted === true, code: group.code } : { active: liveActive, deleted: product?.deleted === true, parentActive: product?.parentActive, parentDeleted: product?.parentDeleted, sku: product?.sku })
  const [initialState] = useState(() => ({ signature: stateSignature, active: liveActive }))
  const active = initialState.active, stateChanged = initialState.signature !== stateSignature
  const label = reference ? 'referencia' : 'variante', code = reference ? group.code : product.sku
  const affected = reference ? group.products.filter(item => !item.deleted) : [product]
  const { quantity, valueCents, unvaluedQuantity } = catalogWriteOffPreview(affected, costs)
  const verb = deleting ? 'Eliminar' : restoring ? 'Restaurar' : active ? 'Archivar' : 'Reactivar'
  async function submit(event) {
    event.preventDefault(); setError('')
    if (stateChanged) { setError('El estado cambió desde otro dispositivo. Cierra esta ventana y vuelve a abrir la acción que quieres realizar.'); return }
    if (deleting && costsLoading) { setError('Espera a que se sincronicen los costos antes de confirmar la baja.'); return }
    if (!reason.trim()) { setError('Escribe el motivo para conservar la trazabilidad.'); return }
    if (deleting && confirmation !== code) { setError(`Escribe exactamente ${code} para confirmar.`); return }
    setWorking(true)
    try {
      const payload = { [reference ? 'referenceKey' : 'variantId']: reference ? group.referenceKey : product.id, reason: reason.trim() }
      if (deleting) payload[reference ? 'confirmReference' : 'confirmSku'] = confirmation
      else if (!restoring) payload.active = !active
      await onSave(payload)
    } catch (failure) { setError(failure?.message || 'No se pudo guardar el cambio.'); } finally { setWorking(false) }
  }
  return <form className="catalog-lifecycle-form" onSubmit={submit}>
    <p>{verb} {label} <strong>{code}</strong> · {reference ? group.name : product.name}.</p>
    {stateChanged && <p className="feedback is-error" role="alert">El estado cambió desde otro dispositivo. Cierra esta ventana y vuelve a abrir la acción que quieres realizar.</p>}
    {deleting ? <div className="catalog-delete-warning"><strong>Se darán de baja {new Intl.NumberFormat('es-CO').format(quantity)} {group.unit || 'unidad'}.</strong>{costsLoading ? <p role="status">Sincronizando costos con la nube antes de confirmar la baja…</p> : <dl className="catalog-writeoff-summary"><div><dt>Costo registrado que se retira</dt><dd>{new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 }).format(valueCents / 100)}</dd></div><div><dt>Unidades pendientes de valorar</dt><dd>{new Intl.NumberFormat('es-CO').format(unvaluedQuantity)} {group.unit || 'unidad'}</dd></div></dl>}<p>Las existencias se llevan a cero y su costo registrado genera una pérdida contable. {unvaluedQuantity > 0 && 'El costo desconocido no se estima ni se reemplaza con el precio de venta. '}{reference ? 'La referencia y todas sus variantes pasan' : 'La variante pasa'} a la papelera; se conservan ventas, movimientos, auditoría y códigos SKU.</p><p>Restaurar después recupera los datos del producto, pero no devuelve las unidades dadas de baja.</p></div> : restoring ? <p className="catalog-state-message">Se recuperan los datos y se habilita la variante o referencia. Las unidades eliminadas no vuelven al stock: registra un nuevo ingreso si corresponde.</p> : <p className="catalog-state-message">{active ? `Se conservan ${new Intl.NumberFormat('es-CO').format(quantity)} ${group.unit || 'unidad'} y su valor registrado. Mientras esté archivada no admite ventas, ingresos ni producción.` : 'Se habilitan nuevamente las operaciones de inventario. El stock y el historial se conservan.'}</p>}
    <div className="form-field"><label htmlFor="catalog-lifecycle-reason">Motivo</label><textarea id="catalog-lifecycle-reason" value={reason} onChange={event => setReason(event.target.value)} required maxLength={500} rows={3} /></div>
    {deleting && <div className="form-field"><label htmlFor="catalog-lifecycle-confirmation">{reference ? 'Confirmar referencia' : 'Confirmar SKU'}</label><input id="catalog-lifecycle-confirmation" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" required /><small>Escribe exactamente: <strong>{code}</strong></small></div>}
    {error && <p className="feedback is-error" role="alert">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" disabled={working} onClick={onCancel}>Cancelar</button><button type="submit" className={deleting ? 'danger-button' : 'primary-button'} disabled={working || stateChanged || (deleting && costsLoading)}>{working ? 'Guardando…' : `${verb} ${label}`}</button></div>
  </form>
}
