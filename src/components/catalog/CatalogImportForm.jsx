import { useState } from 'react'
import readExcelFile from 'read-excel-file/browser'
import { parseCatalogSheets, validateImport } from '../../lib/catalogImport.js'

const money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })

export default function CatalogImportForm({ products, onImport, onCancel }) {
  const [groups, setGroups] = useState([]), [errors, setErrors] = useState([]), [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false), [message, setMessage] = useState('')
  const variants = groups.flatMap(group => group.variants)
  async function selectFile(event) {
    const file = event.target.files?.[0]
    setMessage(''); setErrors([]); setConfirmed(false); setFileName(file?.name || '')
    if (!file) { setGroups([]); return }
    try {
      const result = parseCatalogSheets(await readExcelFile(file))
      setGroups(result.groups); setErrors(result.errors)
    } catch (failure) { setGroups([]); setErrors([failure.message || 'No se pudo leer el archivo Excel.']) }
  }
  function change(reference, index, field, value) {
    setGroups(current => current.map(group => group.reference.code === reference ? { ...group, variants: group.variants.map((variant, position) => position === index ? { ...variant, [field]: value } : variant) } : group))
    setMessage('')
  }
  function apply(field, value) {
    setGroups(current => current.map(group => ({ ...group, variants: group.variants.map(variant => ({ ...variant, [field]: value })) })))
  }
  async function submit(event) {
    event.preventDefault(); setMessage('')
    const issues = [...errors, ...validateImport(groups, products)]
    if (issues.length) { setErrors(issues); return }
    if (!confirmed) { setMessage('Confirma que revisaste el conteo y los precios antes de importar.'); return }
    setBusy(true)
    try { await onImport(groups); setMessage('Importación terminada correctamente.') }
    catch (failure) { setMessage(failure.message || 'La importación no pudo completarse.') }
    finally { setBusy(false) }
  }
  return <form className="catalog-import-form" onSubmit={submit}>
    <p>Selecciona la base de campo en formato <strong>.xlsx</strong>. La aplicación usará <strong>Prototipo conteo</strong> como stock inicial y agrupará cada prenda por referencia, talla y color.</p>
    <div className="form-field"><label htmlFor="catalog-import-file">Archivo Excel</label><input id="catalog-import-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={selectFile} disabled={busy} /></div>
    {groups.length > 0 && <>
      <div className="catalog-import-summary"><strong>{groups.length} referencias</strong><strong>{variants.length} variantes</strong><strong>{variants.reduce((sum, item) => sum + item.stock, 0)} unidades</strong></div>
      <p className="storage-note">El archivo no contiene precios de venta. Puedes aplicarlos de forma general y corregirlos por variante antes de confirmar. Los movimientos históricos y la hoja de insumos no se importan como existencias.</p>
      <div className="form-grid"><div className="form-field"><label htmlFor="import-default-price">Aplicar precio a todas</label><input id="import-default-price" type="number" min="1" step="1" onChange={event => apply('price', event.target.value)} placeholder="COP" /></div><div className="form-field"><label htmlFor="import-default-min">Aplicar stock mínimo a todas</label><input id="import-default-min" type="number" min="0" step="1" defaultValue="5" onChange={event => apply('minStock', event.target.value)} /></div></div>
      <div className="table-wrap"><table className="inventory-table"><thead><tr><th>Producto</th><th>Variante</th><th>Stock inicial</th><th>Precio</th><th>Stock mínimo</th></tr></thead><tbody>{groups.flatMap(group => group.variants.map((variant, index) => <tr key={`${group.reference.code}-${variant.sourceRow}`}><td><strong>{group.reference.name}</strong><span className="product-sku">Ref. {group.reference.code}</span></td><td>Talla {variant.size || 'Única'} · {variant.color || 'Sin color'}</td><td>{variant.stock}</td><td><input aria-label={`Precio ${group.reference.code} ${variant.size} ${variant.color}`} type="number" min="1" step="1" value={variant.price} onChange={event => change(group.reference.code, index, 'price', event.target.value)} placeholder={money.format(0)} required /></td><td><input aria-label={`Stock mínimo ${group.reference.code} ${variant.size} ${variant.color}`} type="number" min="0" step="1" value={variant.minStock} onChange={event => change(group.reference.code, index, 'minStock', event.target.value)} required /></td></tr>))}</tbody></table></div>
      <label className="checkbox-field"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />Revisé referencias, nombres, conteos y precios. Confirmo la carga de esta información.</label>
    </>}
    {errors.length > 0 && <div className="feedback is-error" role="alert"><strong>Corrige antes de importar:</strong><ul>{errors.slice(0, 20).map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}</ul>{errors.length > 20 && <p>Hay {errors.length - 20} errores adicionales.</p>}</div>}
    {message && <p className={message.includes('terminada') ? 'feedback' : 'feedback is-error'} role="status">{message}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>Cancelar</button><button type="submit" className="primary-button" disabled={busy || !groups.length}>{busy ? 'Importando…' : `Importar ${variants.length} variantes`}</button></div>
    {fileName && <p className="storage-note">Archivo seleccionado: {fileName}</p>}
  </form>
}
