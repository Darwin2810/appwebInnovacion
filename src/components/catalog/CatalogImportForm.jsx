import { useState } from 'react'
import readExcelFile from 'read-excel-file/browser'
import { parseCatalogSheets, pendingImportGroups, validateImport } from '../../lib/catalogImport.js'

const money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })

export default function CatalogImportForm({ products, onImport, onCancel }) {
  const [groups, setGroups] = useState([]), [errors, setErrors] = useState([]), [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false), [message, setMessage] = useState('')
  const parsedVariants = groups.flatMap(group => group.variants)
  const pendingGroups = pendingImportGroups(groups, products)
  const variants = pendingGroups.flatMap(group => group.variants)
  const skipped = parsedVariants.length - variants.length
  const finishedStock = pendingGroups.filter(group => group.reference.kind !== 'material').flatMap(group => group.variants).reduce((sum, item) => sum + item.stock, 0)
  const supplyCount = pendingGroups.filter(group => group.reference.kind === 'material').length
  async function selectFile(event) {
    const file = event.target.files?.[0]
    setMessage(''); setErrors([]); setConfirmed(false); setFileName(file?.name || '')
    if (!file) { setGroups([]); return }
    try {
      const result = parseCatalogSheets(await readExcelFile(file))
      setGroups(result.groups); setErrors(result.errors)
    } catch (failure) { setGroups([]); setErrors([failure.message || 'No se pudo leer el archivo Excel.']) }
  }
  function change(reference, sourceRow, field, value) {
    setGroups(current => current.map(group => group.reference.code === reference ? { ...group, variants: group.variants.map(variant => variant.sourceRow === sourceRow ? { ...variant, [field]: value } : variant) } : group))
    setMessage('')
  }
  function apply(field, value) {
    setGroups(current => current.map(group => ({ ...group, variants: group.variants.map(variant => ({ ...variant, [field]: value })) })))
  }
  async function submit(event) {
    event.preventDefault(); setMessage('')
    const issues = [...errors, ...validateImport(pendingGroups, products)]
    if (issues.length) { setErrors(issues); return }
    if (!confirmed) { setMessage('Confirma que revisaste el conteo y los precios antes de importar.'); return }
    setBusy(true)
    try { await onImport(pendingGroups); setMessage('Importación terminada correctamente.') }
    catch (failure) { setMessage(failure.message || 'La importación no pudo completarse.') }
    finally { setBusy(false) }
  }
  return <form className="catalog-import-form" onSubmit={submit}>
    <p>Selecciona la base de campo en formato <strong>.xlsx</strong>. La aplicación usará <strong>Prototipo conteo</strong> para las prendas y agrupará las cantidades ingresadas de los insumos por referencia.</p>
    <div className="form-field"><label htmlFor="catalog-import-file">Archivo Excel</label><input id="catalog-import-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={selectFile} disabled={busy} /></div>
    {groups.length > 0 && <>
      <div className="catalog-import-summary"><strong>{pendingGroups.length} referencias nuevas</strong><strong>{variants.length} variantes por importar</strong><strong>{finishedStock} prendas · {supplyCount} insumos</strong></div>
      {skipped > 0 && <p className="feedback is-success">Se omitirán automáticamente {skipped} variantes que ya existen en el inventario.</p>}
      <p className="storage-note">Los precios y costos del archivo se cargan automáticamente. Los metros de hilo se convierten a centímetros, unidad admitida por el inventario. Los tiempos de medición no se importan como movimientos.</p>
      <div className="form-grid"><div className="form-field"><label htmlFor="import-default-price">Aplicar precio a todas</label><input id="import-default-price" type="number" min="1" step="1" onChange={event => apply('price', event.target.value)} placeholder="COP" /></div><div className="form-field"><label htmlFor="import-default-min">Aplicar stock mínimo a todas</label><input id="import-default-min" type="number" min="0" step="1" defaultValue="5" onChange={event => apply('minStock', event.target.value)} /></div></div>
      {variants.length > 0 ? <div className="table-wrap"><table className="inventory-table"><thead><tr><th>Producto o insumo</th><th>Variante</th><th>Stock inicial</th><th>Precio</th><th>Costo unitario</th><th>Stock mínimo</th></tr></thead><tbody>{pendingGroups.flatMap(group => group.variants.map(variant => <tr key={`${group.reference.code}-${variant.sourceRow}`}><td><strong>{group.reference.name}</strong><span className="product-sku">Ref. {group.reference.code} · {group.reference.kind === 'material' ? `Insumo en ${group.reference.unit}` : 'Producto'}</span></td><td>{group.reference.kind === 'material' ? variant.lot : `Talla ${variant.size || 'Única'} · ${variant.color || 'Sin color'}`}</td><td>{variant.stock}</td><td><input aria-label={`Precio ${group.reference.code} ${variant.size} ${variant.color}`} type="number" min="0" step="1" value={variant.price} onChange={event => change(group.reference.code, variant.sourceRow, 'price', event.target.value)} placeholder={money.format(0)} required /></td><td><input aria-label={`Costo ${group.reference.code}`} type="number" min="0" step="1" value={variant.unitCost || ''} onChange={event => change(group.reference.code, variant.sourceRow, 'unitCost', event.target.value)} placeholder="Sin costo" /></td><td><input aria-label={`Stock mínimo ${group.reference.code} ${variant.size} ${variant.color}`} type="number" min="0" step="1" value={variant.minStock} onChange={event => change(group.reference.code, variant.sourceRow, 'minStock', event.target.value)} required /></td></tr>))}</tbody></table></div> : <p className="feedback">Todo el contenido de este archivo ya existe en el inventario.</p>}
      <label className="checkbox-field"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />Revisé referencias, nombres, conteos y precios. Confirmo la carga de esta información.</label>
    </>}
    {errors.length > 0 && <div className="feedback is-error" role="alert"><strong>Corrige antes de importar:</strong><ul>{errors.slice(0, 20).map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}</ul>{errors.length > 20 && <p>Hay {errors.length - 20} errores adicionales.</p>}</div>}
    {message && <p className={message.includes('terminada') ? 'feedback' : 'feedback is-error'} role="status">{message}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>Cancelar</button><button type="submit" className="primary-button" disabled={busy || !variants.length}>{busy ? 'Importando…' : `Importar ${variants.length} variantes`}</button></div>
    {fileName && <p className="storage-note">Archivo seleccionado: {fileName}</p>}
  </form>
}
