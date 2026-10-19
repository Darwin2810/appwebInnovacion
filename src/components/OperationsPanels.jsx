import { cloneElement, isValidElement, useRef, useState } from 'react'
import { requestId as newRequestId } from '../lib/erpApi.js'
import './OperationsPanels.css'

const currency = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const count = new Intl.NumberFormat('es-CO')
const asBigInt = value => typeof value === 'bigint' ? value : BigInt(Number.isSafeInteger(Number(value)) ? Number(value) : 0)
const formatMoney = value => {
  const amount = asBigInt(value), negative = amount < 0n, absolute = negative ? -amount : amount
  const whole = absolute / 100n
  return currency.formatToParts(negative ? whole === 0n ? -0 : -whole : whole).map(part => part.type === 'fraction' ? String(absolute % 100n).padStart(2, '0') : part.value).join('')
}
const today = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` }
const month = () => today().slice(0, 7)
const states = { posted: 'Registrada', void: 'Anulada', planned: 'Planeada', in_progress: 'En producción', completed: 'Terminada', cancelled: 'Cancelada', present: 'Presente', absent: 'Ausente', leave: 'Permiso', paid: 'Pagada', pending: 'Pendiente', admin: 'Administrador', operator: 'Operador', viewer: 'Consulta' }
const accounts = { 1105: 'Caja / bancos', 1305: 'Clientes por cobrar', 1405: 'Materias primas', 1430: 'Producción en proceso', 1435: 'Productos terminados', 2205: 'Proveedores por pagar', 2505: 'Nómina por pagar', 2365: 'Deducciones por pagar', 3105: 'Saldo inicial / patrimonio', 4135: 'Ingresos por ventas', 6135: 'Costo de ventas', 5105: 'Gastos de personal', 5195: 'Otros gastos', 4205: 'Otros ingresos' }

function cents(value, label = 'Importe') {
  const raw = String(value ?? '').trim()
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) throw new Error(`${label}: escribe un valor positivo con máximo dos decimales.`)
  const [whole, fraction = ''] = raw.split('.')
  const result = Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')))
  if (!Number.isSafeInteger(result) || result > 1e14) throw new Error(`${label}: el valor es demasiado alto.`)
  return result
}
function units(value, label = 'Cantidad', minimum = 1) {
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < minimum || n > 1e9) throw new Error(`${label}: usa un número entero desde ${minimum}.`)
  return n
}
function dateText(value) {
  if (!value) return '—'
  if (typeof value === 'string') return value
  const date = value.toDate?.() || new Date((value.seconds ?? value._seconds ?? 0) * 1000)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('es-CO')
}
function labelProduct(p) {
  return [p?.name || 'Variante no disponible', p?.reference || p?.sku, p?.size && `Talla ${p.size}`, p?.color, p?.lot && `Lote ${p.lot}`].filter(Boolean).join(' · ')
}
function productOptions(data, kind) {
  return (data.products || []).filter(p => !p.legacy && p.active !== false && (!kind || p.kind === kind))
}
function resolveProduct(data, id) {
  const product = (data.products || []).find(p => p.id === id)
  if (product) return product
  const variant = (data.variants || []).find(p => p.id === id)
  if (!variant) return undefined
  const header = (data.references || []).find(item => item.id === variant.referenceKey)
  return { ...variant, name: header?.name, reference: header?.code, unit: header?.unit }

}
function balance(journals, account) {
  return (journals || []).reduce((total, record) => total + (record.lines || []).filter(line => String(line.account) === String(account)).reduce((sum, line) => sum + asBigInt(line.debitCents) - asBigInt(line.creditCents), 0n), 0n)
}
function sum(items, field) { return (items || []).reduce((total, item) => total + asBigInt(item[field]), 0n) }
function outstanding(items, totalField = 'totalCents') {
  return (items || []).filter(item => item.status !== 'void' && item.status !== 'cancelled').reduce((total, item) => total + asBigInt(Math.max(0, (item[totalField] || 0) - (item.paidCents || 0))), 0n)
}

function Panel({ title, description, children, className = '' }) {
  return <section className={`erp-panel ${className}`}><header className="erp-panel-heading"><h2>{title}</h2>{description && <p>{description}</p>}</header>{children}</section>
}
function Field({ label, children, className = '', ...input }) {
  const control = isValidElement(children) ? cloneElement(children, { 'aria-label': children.props['aria-label'] || label }) : <input aria-label={label} {...input} />
  return <label className={`erp-field ${className}`}><span>{label}</span>{control}</label>
}
function MoneyField({ label, ...input }) {
  return <Field label={`${label} (COP)`} type="number" min="0" max="1000000000000" step="0.01" inputMode="decimal" required {...input} />
}
function ProductSelect({ label, products, value, onChange, required = true }) {
  return <Field label={label}><select value={value} onChange={e => onChange(e.target.value)} required={required}><option value="">Selecciona una variante</option>{products.map(product => <option value={product.id} key={product.id}>{labelProduct(product)} · Stock {count.format(product.stock || 0)} {product.unit || 'unidad'}</option>)}</select></Field>
}
function ActionForm({ title, description, run, busy, action, getPayload, onDone, children, submitLabel = 'Guardar', className = '' }) {
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const request = useRef(null)
  async function submit(event) {
    event.preventDefault()
    if (pending || busy) return
    setError(''); setNotice(''); setPending(true)
    try {
      const payload = getPayload()
      const fingerprint = JSON.stringify({ action, payload })
      if (!request.current || request.current.fingerprint !== fingerprint) request.current = { fingerprint, id: newRequestId() }
      const result = await run(action, payload, request.current.id)
      request.current = null
      setNotice(`Operación confirmada en la nube.${result?.id ? ` Registro: ${result.id}` : ''}`)
      onDone?.(result)
    } catch (err) { setError(err?.message || 'No se pudo guardar. Revisa los datos y la conexión.') }
    finally { setPending(false) }
  }
  return <form className={`erp-form ${className}`} aria-label={title} onSubmit={submit}>{title && <h3>{title}</h3>}{description && <p className="erp-help">{description}</p>}<fieldset disabled={busy || pending}>{children}<div className="erp-form-actions"><button className="primary-button" type="submit">{pending ? 'Confirmando…' : submitLabel}</button></div></fieldset>{error && <p className="feedback is-error" role="alert">{error}</p>}{notice && <p className="feedback is-success" role="status">{notice}</p>}</form>
}
function Records({ title, columns, rows, empty = 'Todavía no hay registros.', renderDetails }) {
  return <section className="erp-records"><h3>{title} <span className="erp-muted">({rows.length})</span></h3>{!rows.length ? <p className="erp-empty">{empty}</p> : <div className="erp-table-scroll"><table className="erp-table" aria-label={title}><thead><tr>{columns.map(column => <th key={column.label} scope="col">{column.label}</th>)}{renderDetails && <th scope="col">Detalle / acciones</th>}</tr></thead><tbody>{rows.map(row => <tr key={row.id}>{columns.map(column => <td key={column.label}>{column.render(row)}</td>)}{renderDetails && <td>{renderDetails(row)}</td>}</tr>)}</tbody></table></div>}</section>
}
function StatCards({ values }) {
  return <div className="erp-stats">{values.map(([label, value, note]) => <article className="erp-stat" key={label}><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</article>)}</div>
}
function Status({ value }) { return <span className={`erp-status erp-status-${value}`}>{states[value] || value || '—'}</span> }
function LineEditor({ lines, setLines, products, purchase = false, material = false, unitLabel = 'Cantidad' }) {
  function update(index, patch) { setLines(current => current.map((line, i) => i === index ? { ...line, ...patch } : line)) }
  function choose(index, id) {
    const product = products.find(p => p.id === id)
    update(index, { variantId: id, ...(purchase || material ? {} : { amount: String((product?.priceCents ?? Math.round((product?.price || 0) * 100)) / 100) }) })
  }
  return <div className="erp-lines" aria-label={material ? 'Materiales de la receta' : 'Líneas de productos'}>{lines.map((line, index) => <div className={`erp-line ${material ? 'erp-material-line' : ''}`} key={line.key}><ProductSelect label={`${material ? 'Material' : 'Variante'} ${index + 1}`} products={products} value={line.variantId} onChange={id => choose(index, id)} /><Field label={`${unitLabel} ${index + 1}`} type="number" min="1" max="1000000000" step="1" value={line.quantity} onChange={e => update(index, { quantity: e.target.value })} required />{!material && <MoneyField label={`${purchase ? 'Costo' : 'Precio'} unitario ${index + 1}`} value={line.amount} onChange={e => update(index, { amount: e.target.value })} />}<button type="button" className="secondary-button erp-remove" disabled={lines.length === 1} aria-label={`Quitar línea ${index + 1}`} onClick={() => setLines(current => current.filter((_, i) => i !== index))}>Quitar</button></div>)}<button className="secondary-button" type="button" disabled={lines.length >= 20} onClick={() => setLines(current => [...current, freshLine()])}>Añadir {material ? 'material' : 'línea'}</button><p className="erp-help">Máximo 20 líneas. Cada combinación de talla, color y lote tiene su propio stock.</p></div>
}
function freshLine() { return { key: newRequestId(), variantId: '', quantity: '1', amount: '0' } }
function estimateLines(lines) {
  return lines.reduce((total, line) => {
    try { return total + BigInt(units(line.quantity)) * BigInt(cents(line.amount)) }
    catch { return total }
  }, 0n)
}
function PaymentForm({ run, busy, type, record, totalField = 'totalCents' }) {
  const due = Math.max(0, (record[totalField] || 0) - (record.paidCents || 0))
  const [amount, setAmount] = useState('')
  if (!due || record.status === 'void' || record.status === 'cancelled') return null
  const idField = { sales: 'saleId', purchases: 'purchaseId', payroll: 'payrollId' }[type]
  return <ActionForm title="Registrar pago" run={run} busy={busy} action={`${type}.pay`} submitLabel="Confirmar pago" getPayload={() => ({ [idField]: record.id, amountCents: cents(amount, 'Pago') })} onDone={() => setAmount('')}><p className="erp-help">Saldo pendiente: {formatMoney(due)}. El pago se registra en caja y en el historial.</p><MoneyField label={`Pago del registro ${record.id}`} value={amount} max={due / 100} onChange={e => setAmount(e.target.value)} /></ActionForm>
}
function LinesDetail({ record, data, cost = false }) {
  return <ul className="erp-detail-lines">{(record.lines || []).map((line, i) => <li key={`${line.variantId}-${i}`}><strong>{line.name || labelProduct(resolveProduct(data, line.variantId))}</strong><span>{line.sku || line.variantId} · {count.format(line.quantity || 0)} × {formatMoney(cost ? line.unitCostCents : line.unitPriceCents)}{(line.totalCents ?? line.lineTotalCents) !== undefined ? ` = ${formatMoney(line.totalCents ?? line.lineTotalCents)}` : ''}</span></li>)}</ul>
}

function ContactsDirectory({ data, run, busy, type }) {
  const [edit, setEdit] = useState(null)
  const contacts = (data.contacts || []).filter(contact => contact.type === type)
  return <details className="erp-directory"><summary>Directorio de {type === 'customer' ? 'clientes' : 'proveedores'} ({contacts.length})</summary><ContactEditor key={edit?.id || 'new'} contact={edit} type={type} run={run} busy={busy} onDone={() => setEdit(null)} />{edit && <button className="secondary-button" type="button" onClick={() => setEdit(null)}>Cancelar edición del contacto</button>}<Records title={type === 'customer' ? 'Clientes registrados' : 'Proveedores registrados'} rows={contacts} columns={[{ label: 'Contacto', render: contact => <>{contact.name}<small>{contact.document}</small></> }, { label: 'Correo / teléfono', render: contact => <>{contact.email || '—'}<small>{contact.phone}</small></> }, { label: 'Acciones', render: contact => <button className="secondary-button" type="button" disabled={busy} onClick={() => setEdit(contact)}>Editar contacto {contact.name}</button> }]} /></details>
}
function ContactEditor({ contact, type, run, busy, onDone }) {
  const [form, setForm] = useState(() => ({ name: '', document: '', email: '', phone: '', ...contact }))
  const update = (field, value) => setForm(current => ({ ...current, [field]: value }))
  const noun = type === 'customer' ? 'cliente' : 'proveedor'
  return <ActionForm title={`${contact ? 'Editar' : 'Registrar'} ${noun}`} run={run} busy={busy} action="contacts.save" getPayload={() => ({ ...(contact ? { contactId: contact.id } : {}), type, name: form.name.trim(), document: form.document.trim(), email: form.email.trim(), phone: form.phone.trim() })} submitLabel="Guardar contacto" onDone={() => { if (!contact) setForm({ name: '', document: '', email: '', phone: '' }); onDone() }}><div className="erp-field-grid"><Field label={`Nombre del ${noun}`} value={form.name} onChange={e => update('name', e.target.value)} maxLength={150} required /><Field label={`Documento del ${noun}`} value={form.document} onChange={e => update('document', e.target.value)} maxLength={60} /><Field label={`Correo del ${noun}`} type="email" value={form.email} onChange={e => update('email', e.target.value)} maxLength={200} /><Field label={`Teléfono del ${noun}`} type="tel" value={form.phone} onChange={e => update('phone', e.target.value)} maxLength={50} /></div></ActionForm>
}
function ContactSelect({ data, type, value, onChange }) {
  const contacts = (data.contacts || []).filter(contact => contact.type === type)
  return <Field label={type === 'customer' ? 'Cliente del directorio' : 'Proveedor del directorio'}><select value={value} onChange={e => onChange(contacts.find(contact => contact.id === e.target.value))}><option value="">Escribir un nombre sin vincular contacto</option>{contacts.map(contact => <option value={contact.id} key={contact.id}>{contact.name} {contact.document && `· ${contact.document}`}</option>)}</select></Field>
}

export function DashboardPanel({ data }) {
  const journals = data.journals || []
  const low = (data.products || []).filter(p => p.active !== false && p.stock <= p.minStock)
  const unknownSales = (data.sales || []).filter(sale => sale.status !== 'void' && sale.hasUnvaluedCost)
  const revenue = -balance(journals, '4135')
  const costs = balance(journals, '6135')
  const production = (data.productionOrders || []).filter(order => ['planned', 'in_progress'].includes(order.status))
  const unvalued = (data.products || []).filter(p => p.stock > 0 && !(data.costs || []).some(item => item.id === p.id && item.stockValueCents > 0 && !(item.unvaluedQuantity > 0)))
  return <Panel title="Dirección de la empresa" description="Inventario, dinero y operaciones comparten los mismos registros en tiempo real."><StatCards values={[
    ['Inventario a costo', formatMoney(sum(data.costs, 'stockValueCents')), 'Costo registrado de materiales y prendas'],
    ['Ventas netas', formatMoney(revenue), 'Incluye anulaciones mediante asientos inversos'],
    ['Margen bruto registrado', formatMoney(revenue - costs), unknownSales.length ? 'Parcial: hay ventas con costo desconocido' : 'Ventas menos costo de las unidades vendidas'],
    ['Caja / bancos', formatMoney(balance(journals, '1105')), 'Saldo contable de movimientos registrados'],
    ['Clientes por cobrar', formatMoney(outstanding(data.sales)), 'Ventas registradas con saldo pendiente'],
    ['Proveedores por pagar', formatMoney(outstanding(data.purchases)), 'Compras registradas con saldo pendiente'],
    ['Nómina por pagar', formatMoney(outstanding(data.payroll, 'netCents')), 'Neto de periodos registrados menos pagos'],
    ['Producción abierta', count.format(production.length), 'Órdenes planeadas o en proceso'],
  ]} />{unvalued.length > 0 && <p className="feedback erp-warning" role="status">Hay {unvalued.length} variantes con existencias sin costo registrado. La valoración y el margen dependen de los costos ingresados; el precio de venta no se usa como costo.</p>}{unknownSales.length > 0 && <p className="feedback erp-warning" role="status">{unknownSales.length} ventas vigentes incluyen unidades con costo desconocido. El margen registrado es parcial; valorar el stock actual no modifica el costo histórico de esas ventas.</p>}<div className="erp-two-columns"><Records title="Atención de inventario" rows={low} columns={[{ label: 'Variante', render: labelProduct }, { label: 'Disponible / mínimo', render: p => `${count.format(p.stock)} / ${count.format(p.minStock)}` }]} empty="Todas las variantes están por encima de su mínimo." /><Records title="Producción pendiente" rows={production} columns={[{ label: 'Orden', render: order => order.id }, { label: 'Producto', render: order => labelProduct(resolveProduct(data, order.outputVariantId)) }, { label: 'Estado', render: order => <Status value={order.status} /> }]} /></div></Panel>
}

function SalesCreator({ data, run, busy }) {
  const [contactId, setContactId] = useState('')
  const [customerName, setCustomerName] = useState(''), [notes, setNotes] = useState(''), [paid, setPaid] = useState('0')
  const [lines, setLines] = useState(() => [freshLine()])
  const products = productOptions(data, 'finished')
  const estimate = estimateLines(lines)
  function payload() {
    return { ...(contactId ? { contactId } : {}), customerName: customerName.trim(), notes: notes.trim(), paidCents: cents(paid, 'Abono inicial'), lines: lines.map((line, index) => ({ variantId: line.variantId, quantity: units(line.quantity, `Cantidad ${index + 1}`), unitPriceCents: cents(line.amount, `Precio ${index + 1}`) })) }
  }
  return <ActionForm title="Nueva venta" description="Al confirmar se descuentan las unidades, se registra el ingreso y su costo, y se crea la cuenta por cobrar." run={run} busy={busy} action="sales.create" getPayload={payload} submitLabel="Confirmar venta" onDone={() => { setContactId(''); setCustomerName(''); setNotes(''); setPaid('0'); setLines([freshLine()]) }}><ContactSelect data={data} type="customer" value={contactId} onChange={contact => { setContactId(contact?.id || ''); if (contact) setCustomerName(contact.name) }} /><Field label="Cliente" value={customerName} readOnly={Boolean(contactId)} onChange={e => setCustomerName(e.target.value)} maxLength={150} required /><LineEditor lines={lines} setLines={setLines} products={products} /><div className="erp-field-grid"><MoneyField label="Abono inicial" value={paid} onChange={e => setPaid(e.target.value)} /><Field label="Notas de la venta"><textarea value={notes} onChange={e => setNotes(e.target.value)} maxLength={1000} rows="2" /></Field></div><p className="erp-total">Total a confirmar: {formatMoney(estimate)}</p>{!products.length && <p className="erp-help">Registra primero una variante de producto terminado en Inventario.</p>}</ActionForm>
}
function VoidSale({ record, run, busy }) {
  const [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false)
  if (record.status === 'void') return null
  return <ActionForm title="Anular venta" description="Devuelve las unidades y compensa los asientos y pagos. El historial original se conserva." run={run} busy={busy} action="sales.void" submitLabel="Confirmar anulación" getPayload={() => ({ saleId: record.id, reason: reason.trim() })} onDone={() => setReason('')}><Field label={`Motivo de anulación de ${record.id}`} value={reason} onChange={e => setReason(e.target.value)} required minLength={3} maxLength={500} />{record.paidCents > 0 && <label className="erp-check"><input type="checkbox" required checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Confirmo la devolución al cliente de {formatMoney(record.paidCents)}. Se registrará una salida de caja; el sistema no transfiere dinero por una pasarela.</label>}</ActionForm>
}

function VoidPurchase({ record, run, busy }) {
  const [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false)
  if (record.status === 'void') return null
  return <ActionForm title="Anular compra" description="Descuenta las unidades devueltas al proveedor, compensa el costo y conserva el historial. Debe haber existencias suficientes para la devolución." run={run} busy={busy} action="purchases.void" submitLabel="Confirmar devolución de compra" getPayload={() => ({ purchaseId: record.id, reason: reason.trim() })}><Field label={`Motivo de devolución de ${record.id}`} value={reason} onChange={e => setReason(e.target.value)} required minLength={3} maxLength={500} />{record.paidCents > 0 && <label className="erp-check"><input type="checkbox" required checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Confirmo que el proveedor devuelve {formatMoney(record.paidCents)}. Se registra una entrada de caja; el sistema no ejecuta un reembolso bancario.</label>}</ActionForm>
}

function VoidPayroll({ record, run, busy }) {
  const [reason, setReason] = useState('')
  if (record.status !== 'posted') return null
  if (record.paidCents > 0) return <p className="erp-help">Esta nómina tiene pagos registrados y no puede anularse automáticamente.</p>
  return <ActionForm title="Anular nómina sin pagos" description="Compensa el gasto y las obligaciones del periodo; conserva el historial. Solo admite nóminas sin pagos." run={run} busy={busy} action="payroll.void" submitLabel="Confirmar anulación de nómina" getPayload={() => ({ payrollId: record.id, reason: reason.trim() })}><Field label={`Motivo de anulación de nómina ${record.id}`} value={reason} onChange={e => setReason(e.target.value)} required minLength={3} maxLength={500} /></ActionForm>
}
export function SalesPanel({ data, run, busy }) {
  return <Panel title="Ventas y cartera" description="Cada venta conecta las prendas entregadas, su costo y el dinero recibido."><StatCards values={[["Ventas vigentes", count.format((data.sales || []).filter(item => item.status !== 'void').length)], ['Saldo de clientes', formatMoney(outstanding(data.sales))]]} /><SalesCreator data={data} run={run} busy={busy} /><ContactsDirectory data={data} run={run} busy={busy} type="customer" /><Records title="Ventas registradas" rows={data.sales || []} columns={[{ label: 'Cliente / fecha', render: row => <>{row.customerName}<small>{dateText(row.createdAt)}</small>{row.hasUnvaluedCost && row.status !== 'void' && <small className="erp-cost-warning">Costo histórico incompleto</small>}</> }, { label: 'Total', render: row => formatMoney(row.totalCents) }, { label: 'Pagado', render: row => formatMoney(row.paidCents) }, { label: 'Estado', render: row => <Status value={row.status} /> }]} renderDetails={row => <details className="erp-details"><summary>Venta {row.id}</summary><LinesDetail record={row} data={data} />{row.notes && <p>{row.notes}</p>}<PaymentForm run={run} busy={busy} type="sales" record={row} /><VoidSale record={row} run={run} busy={busy} /></details>} /></Panel>
}

function PurchasesCreator({ data, run, busy }) {
  const [contactId, setContactId] = useState('')
  const [supplierName, setSupplierName] = useState(''), [notes, setNotes] = useState(''), [paid, setPaid] = useState('0')
  const [lines, setLines] = useState(() => [freshLine()])
  function payload() { return { ...(contactId ? { contactId } : {}), supplierName: supplierName.trim(), notes: notes.trim(), paidCents: cents(paid, 'Pago inicial'), lines: lines.map((line, index) => ({ variantId: line.variantId, quantity: units(line.quantity, `Cantidad ${index + 1}`), unitCostCents: cents(line.amount, `Costo ${index + 1}`) })) } }
  const estimate = estimateLines(lines)
  return <ActionForm title="Nueva compra" description="El ingreso aumenta las existencias y su costo; el saldo pendiente queda registrado por pagar al proveedor." run={run} busy={busy} action="purchases.create" getPayload={payload} submitLabel="Confirmar compra" onDone={() => { setContactId(''); setSupplierName(''); setNotes(''); setPaid('0'); setLines([freshLine()]) }}><ContactSelect data={data} type="supplier" value={contactId} onChange={contact => { setContactId(contact?.id || ''); if (contact) setSupplierName(contact.name) }} /><Field label="Proveedor" value={supplierName} readOnly={Boolean(contactId)} onChange={e => setSupplierName(e.target.value)} maxLength={150} required /><LineEditor lines={lines} setLines={setLines} products={productOptions(data)} purchase /><div className="erp-field-grid"><MoneyField label="Pago inicial al proveedor" value={paid} onChange={e => setPaid(e.target.value)} /><Field label="Notas de la compra"><textarea value={notes} onChange={e => setNotes(e.target.value)} maxLength={1000} rows="2" /></Field></div><p className="erp-total">Total a confirmar: {formatMoney(estimate)}</p></ActionForm>
}
export function PurchasesPanel({ data, run, busy }) {
  return <Panel title="Compras y proveedores" description="El costo de adquisición se comparte con inventario, producción y finanzas."><StatCards values={[["Compras registradas", count.format((data.purchases || []).length)], ['Saldo de proveedores', formatMoney(outstanding(data.purchases))]]} /><PurchasesCreator data={data} run={run} busy={busy} /><ContactsDirectory data={data} run={run} busy={busy} type="supplier" /><Records title="Compras registradas" rows={data.purchases || []} columns={[{ label: 'Proveedor / fecha', render: row => <>{row.supplierName}<small>{dateText(row.createdAt)}</small></> }, { label: 'Total', render: row => formatMoney(row.totalCents) }, { label: 'Pagado', render: row => formatMoney(row.paidCents) }, { label: 'Estado', render: row => <Status value={row.status} /> }]} renderDetails={row => <details className="erp-details"><summary>Compra {row.id}</summary><LinesDetail record={row} data={data} cost />{row.notes && <p>{row.notes}</p>}<PaymentForm run={run} busy={busy} type="purchases" record={row} /><VoidPurchase record={row} run={run} busy={busy} /></details>} /></Panel>
}

function BomCreator({ data, run, busy }) {
  const [output, setOutput] = useState(''), [inputs, setInputs] = useState(() => [freshLine()])
  return <ActionForm title="Receta de producción" description="Define las unidades enteras de cada material necesarias para una unidad terminada. Registra telas en cm y pesos en g para evitar fracciones." run={run} busy={busy} action="production.bom" submitLabel="Guardar receta" getPayload={() => ({ outputVariantId: output, inputs: inputs.map((input, i) => ({ variantId: input.variantId, quantity: units(input.quantity, `Material ${i + 1}`) })) })} onDone={() => { setOutput(''); setInputs([freshLine()]) }}><ProductSelect label="Producto terminado de la receta" products={productOptions(data, 'finished')} value={output} onChange={setOutput} /><LineEditor lines={inputs} setLines={setInputs} products={productOptions(data, 'material')} material unitLabel="Unidades por prenda" /></ActionForm>
}
function ProductionPlanner({ data, run, busy }) {
  const [bomId, setBomId] = useState(''), [quantity, setQuantity] = useState('1'), [notes, setNotes] = useState('')
  const selected = (data.productionBoms || []).find(bom => bom.id === bomId)
  return <ActionForm title="Planear orden" description="La orden conserva una copia de la receta. Los materiales se descuentan cuando comienza la producción." run={run} busy={busy} action="production.plan" submitLabel="Crear orden de producción" getPayload={() => ({ bomId, quantity: units(quantity, 'Unidades a producir'), notes: notes.trim() })} onDone={() => { setNotes(''); setQuantity('1') }}><div className="erp-field-grid"><Field label="Receta para la orden"><select value={bomId} onChange={e => setBomId(e.target.value)} required><option value="">Selecciona una receta</option>{(data.productionBoms || []).map(bom => <option key={bom.id} value={bom.id}>{labelProduct(resolveProduct(data, bom.outputVariantId))} · {bom.id}</option>)}</select></Field><Field label="Unidades a producir" type="number" min="1" step="1" max="1000000000" value={quantity} onChange={e => setQuantity(e.target.value)} required /></div><Field label="Notas de la orden"><textarea value={notes} onChange={e => setNotes(e.target.value)} rows="2" maxLength={1000} /></Field>{selected && <ul className="erp-detail-lines">{(selected.inputs || []).map(input => <li key={input.variantId}>{labelProduct(resolveProduct(data, input.variantId))}: {count.format((Number(quantity) || 0) * input.quantity)} unidades requeridas</li>)}</ul>}</ActionForm>
}
function ProductionActions({ order, run, busy }) {
  const [actual, setActual] = useState(String(order.quantity || 1)), [reason, setReason] = useState('')
  return <>{order.status === 'planned' && <ActionForm run={run} busy={busy} action="production.start" title="Comenzar producción" getPayload={() => ({ orderId: order.id })} submitLabel="Consumir materiales e iniciar"><p className="erp-help">La nube comprueba la disponibilidad y traslada el costo de materiales a producción en proceso.</p></ActionForm>}{order.status === 'in_progress' && <ActionForm run={run} busy={busy} action="production.complete" title="Terminar producción" getPayload={() => ({ orderId: order.id, quantity: units(actual, 'Cantidad terminada') })} submitLabel="Ingresar prendas terminadas"><Field label={`Unidades terminadas de ${order.id}`} type="number" min="1" max={order.quantity} step="1" value={actual} onChange={e => setActual(e.target.value)} required /><p className="erp-help">Todo el costo consumido se asigna a las unidades terminadas de esta orden.</p></ActionForm>}{['planned', 'in_progress', 'completed'].includes(order.status) && <ActionForm run={run} busy={busy} action="production.cancel" title={order.status === 'completed' ? 'Revertir producción terminada' : 'Cancelar orden'} description={order.status === 'completed' ? 'Se comprueba el stock terminado para revertir la transformación y restaurar los materiales al costo histórico.' : 'Los materiales consumidos se restauran mediante movimientos inversos.'} getPayload={() => ({ orderId: order.id, reason: reason.trim() })} submitLabel="Confirmar cancelación"><Field label={`Motivo de cancelación de ${order.id}`} value={reason} onChange={e => setReason(e.target.value)} minLength={3} maxLength={500} required /></ActionForm>}</>
}
export function ProductionPanel({ data, run, busy }) {
  return <Panel title="Producción y materiales" description="Recetas, consumo de materiales y entrada de prendas quedan unidos a una orden trazable."><div className="erp-two-columns"><BomCreator data={data} run={run} busy={busy} /><ProductionPlanner data={data} run={run} busy={busy} /></div><Records title="Recetas registradas" rows={data.productionBoms || []} columns={[{ label: 'Receta', render: bom => bom.id }, { label: 'Producto terminado', render: bom => labelProduct(resolveProduct(data, bom.outputVariantId)) }, { label: 'Materiales por unidad', render: bom => <ul className="erp-compact-list">{(bom.inputs || []).map(input => <li key={input.variantId}>{input.quantity} × {labelProduct(resolveProduct(data, input.variantId))}</li>)}</ul> }]} /><Records title="Órdenes de producción" rows={data.productionOrders || []} columns={[{ label: 'Orden / fecha', render: order => <>{order.id}<small>{dateText(order.createdAt)}</small></> }, { label: 'Producto / unidades', render: order => <>{labelProduct(resolveProduct(data, order.outputVariantId))}<small>Planeadas: {order.quantity} · Terminadas: {order.completedQuantity || 0}</small></> }, { label: 'Estado', render: order => <Status value={order.status} /> }, { label: 'Costo material', render: order => formatMoney(order.materialCostCents) }]} renderDetails={order => <details className="erp-details"><summary>Gestionar {order.id}</summary><ul className="erp-detail-lines">{(order.inputs || []).map(input => <li key={input.variantId}>{labelProduct(resolveProduct(data, input.variantId))} · {input.quantity} unidades</li>)}</ul>{order.notes && <p>{order.notes}</p>}<ProductionActions order={order} run={run} busy={busy} /></details>} /></Panel>
}

function FinanceEntry({ run, busy }) {
  const [direction, setDirection] = useState('expense'), [amount, setAmount] = useState(''), [description, setDescription] = useState(''), [date, setDate] = useState(today)
  return <ActionForm title="Movimiento de caja" description="Registra ingresos y gastos internos adicionales. Las compras, ventas y nómina crean sus propios asientos automáticamente." run={run} busy={busy} action="finance.entry" submitLabel="Confirmar movimiento" getPayload={() => ({ direction, amountCents: cents(amount), description: description.trim(), date })} onDone={() => { setAmount(''); setDescription('') }}><div className="erp-field-grid"><Field label="Tipo de movimiento"><select value={direction} onChange={e => setDirection(e.target.value)}><option value="expense">Gasto / salida de caja</option><option value="income">Ingreso / entrada de caja</option></select></Field><MoneyField label="Valor del movimiento" value={amount} onChange={e => setAmount(e.target.value)} /><Field label="Fecha del movimiento" type="date" value={date} onChange={e => setDate(e.target.value)} required /></div><Field label="Descripción del movimiento" value={description} onChange={e => setDescription(e.target.value)} required maxLength={500} minLength={3} /></ActionForm>
}
export function FinancePanel({ data, run, busy }) {
  const journals = data.journals || []
  const debit = journals.reduce((total, entry) => total + (entry.lines || []).reduce((sum, line) => sum + asBigInt(line.debitCents), 0n), 0n)
  const credit = journals.reduce((total, entry) => total + (entry.lines || []).reduce((sum, line) => sum + asBigInt(line.creditCents), 0n), 0n)
  const accountRows = Object.entries(accounts).map(([id, name]) => ({ id, name, balance: balance(journals, id) })).filter(row => row.balance !== 0n)
  return <Panel title="Finanzas y libro de movimientos" description="Contabilidad interna de doble partida con documentos y pagos vinculados."><StatCards values={[["Caja / bancos", formatMoney(balance(journals, '1105'))], ['Débitos registrados', formatMoney(debit)], ['Créditos registrados', formatMoney(credit)], ['Diferencia de comprobación', formatMoney(debit - credit), debit === credit ? 'Asientos balanceados' : 'Revisa los registros cargados']]} /><p className="erp-help">Este módulo registra operaciones internas. La facturación electrónica DIAN, las declaraciones y la liquidación legal de nómina requieren integración y revisión contable específicas.</p><FinanceEntry run={run} busy={busy} /><Records title="Saldos por cuenta" rows={accountRows} columns={[{ label: 'Cuenta', render: row => `${row.id} · ${row.name}` }, { label: 'Saldo deudor', render: row => formatMoney(row.balance > 0n ? row.balance : 0n) }, { label: 'Saldo acreedor', render: row => formatMoney(row.balance < 0n ? -row.balance : 0n) }]} /><Records title="Asientos contables" rows={journals} columns={[{ label: 'Fecha', render: row => row.date || dateText(row.createdAt) }, { label: 'Origen', render: row => <>{row.sourceType}<small>{row.sourceId}</small></> }, { label: 'Descripción', render: row => row.note }, { label: 'Débito / crédito', render: row => formatMoney(row.debitCents ?? (row.lines || []).reduce((total, line) => total + (line.debitCents || 0), 0)) }]} renderDetails={row => <details className="erp-details"><summary>Ver asiento {row.id}</summary><ul className="erp-detail-lines">{(row.lines || []).map((line, index) => <li key={index}><strong>{line.account} · {accounts[line.account] || 'Cuenta'}</strong><span>Débito {formatMoney(line.debitCents)} · Crédito {formatMoney(line.creditCents)}</span></li>)}</ul><small>Registrado por {row.createdBy}</small></details>} /><Records title="Pagos registrados" rows={data.payments || []} columns={[{ label: 'Fecha', render: row => dateText(row.createdAt) }, { label: 'Documento', render: row => `${row.sourceType} · ${row.sourceId}` }, { label: 'Valor', render: row => formatMoney(row.amountCents) }]} /></Panel>
}

const emptyEmployee = () => ({ name: '', document: '', position: '', department: '', email: '', phone: '', salary: '0', active: true, startDate: today() })
function EmployeeEditor({ employee, run, busy, onDone }) {
  const [form, setForm] = useState(() => employee ? { ...emptyEmployee(), ...employee, salary: String((employee.baseSalaryCents || 0) / 100) } : emptyEmployee())
  const update = (field, value) => setForm(current => ({ ...current, [field]: value }))
  return <ActionForm title={employee ? `Editar a ${employee.name}` : 'Registrar empleado'} run={run} busy={busy} action="people.save" getPayload={() => ({ ...(employee ? { employeeId: employee.id } : {}), name: form.name.trim(), document: form.document.trim(), position: form.position.trim(), department: form.department.trim(), email: form.email.trim(), phone: form.phone.trim(), baseSalaryCents: cents(form.salary, 'Salario base'), active: form.active, startDate: form.startDate })} submitLabel="Guardar empleado" onDone={() => { if (!employee) setForm(emptyEmployee()); onDone?.() }}><div className="erp-field-grid"><Field label="Nombre del empleado" value={form.name} onChange={e => update('name', e.target.value)} required maxLength={100} /><Field label="Documento del empleado" value={form.document} onChange={e => update('document', e.target.value)} required maxLength={40} /><Field label="Cargo" value={form.position} onChange={e => update('position', e.target.value)} maxLength={100} /><Field label="Área / departamento" value={form.department} onChange={e => update('department', e.target.value)} maxLength={100} /><Field label="Correo del empleado" type="email" value={form.email} onChange={e => update('email', e.target.value)} maxLength={254} /><Field label="Teléfono del empleado" type="tel" value={form.phone} onChange={e => update('phone', e.target.value)} maxLength={40} /><MoneyField label="Salario base del periodo" value={form.salary} onChange={e => update('salary', e.target.value)} /><Field label="Fecha de ingreso" type="date" value={form.startDate} onChange={e => update('startDate', e.target.value)} required /></div><label className="erp-check"><input type="checkbox" checked={form.active} onChange={e => update('active', e.target.checked)} />Empleado activo</label></ActionForm>
}
function EmployeeSelect({ data, label = 'Empleado', value, onChange }) {
  return <Field label={label}><select value={value} onChange={e => onChange(e.target.value)} required><option value="">Selecciona un empleado</option>{(data.employees || []).filter(employee => employee.active !== false).map(employee => <option value={employee.id} key={employee.id}>{employee.name} · {employee.document}</option>)}</select></Field>
}
function AttendanceForm({ data, run, busy }) {
  const [employeeId, setEmployeeId] = useState(''), [date, setDate] = useState(today), [status, setStatus] = useState('present'), [minutes, setMinutes] = useState('480')
  return <ActionForm title="Asistencia del personal" description="La combinación empleado y fecha identifica el registro diario." run={run} busy={busy} action="people.attendance" submitLabel="Guardar asistencia" getPayload={() => ({ employeeId, date, status, minutes: units(minutes, 'Minutos trabajados', 0) })}><EmployeeSelect data={data} label="Empleado de asistencia" value={employeeId} onChange={setEmployeeId} /><div className="erp-field-grid"><Field label="Fecha de asistencia" type="date" value={date} onChange={e => setDate(e.target.value)} required /><Field label="Estado de asistencia"><select value={status} onChange={e => { setStatus(e.target.value); if (e.target.value !== 'present') setMinutes('0') }}><option value="present">Presente</option><option value="absent">Ausente</option><option value="leave">Permiso</option></select></Field><Field label="Minutos trabajados" type="number" min="0" max="1440" step="1" value={minutes} onChange={e => setMinutes(e.target.value)} required /></div></ActionForm>
}
function PayrollCreator({ data, run, busy }) {
  const [employeeId, setEmployeeId] = useState(''), [period, setPeriod] = useState(month), [additions, setAdditions] = useState('0'), [deductions, setDeductions] = useState('0')
  const employee = (data.employees || []).find(item => item.id === employeeId)
  const netEstimate = (employee?.baseSalaryCents || 0) + Math.round((Number(additions) || 0) * 100) - Math.round((Number(deductions) || 0) * 100)
  return <ActionForm title="Registrar periodo de nómina" description="Usa el salario base y los ajustes que indique la empresa. El sistema evita duplicar un empleado en el mismo periodo; no calcula aportes o retenciones legales automáticamente." run={run} busy={busy} action="payroll.create" submitLabel="Confirmar nómina del periodo" getPayload={() => ({ employeeId, period, additionsCents: cents(additions, 'Adiciones'), deductionsCents: cents(deductions, 'Deducciones') })} onDone={() => { setAdditions('0'); setDeductions('0') }}><EmployeeSelect data={data} label="Empleado de nómina" value={employeeId} onChange={setEmployeeId} /><div className="erp-field-grid"><Field label="Periodo de nómina" type="month" value={period} onChange={e => setPeriod(e.target.value)} required /><MoneyField label="Adiciones del periodo" value={additions} onChange={e => setAdditions(e.target.value)} /><MoneyField label="Deducciones del periodo" value={deductions} onChange={e => setDeductions(e.target.value)} /></div><p className="erp-help">Base: {formatMoney(employee?.baseSalaryCents)} · Neto estimado: {formatMoney(netEstimate)}</p></ActionForm>
}
export function PeoplePanel({ data, run, busy }) {
  const [edit, setEdit] = useState(null)
  const employeeName = id => (data.employees || []).find(employee => employee.id === id)?.name || id
  return <Panel title="Personal y nómina" description="Empleados, asistencia y pagos internos en el mismo sistema. El acceso a estos datos corresponde al administrador."><StatCards values={[["Personal activo", count.format((data.employees || []).filter(employee => employee.active !== false).length)], ['Nómina pendiente', formatMoney(outstanding(data.payroll, 'netCents'))]]} /><EmployeeEditor key={edit?.id || 'new'} employee={edit} run={run} busy={busy} onDone={() => setEdit(null)} />{edit && <button className="secondary-button" onClick={() => setEdit(null)}>Cancelar edición del empleado</button>}<Records title="Empleados registrados" rows={data.employees || []} columns={[{ label: 'Empleado', render: employee => <>{employee.name}<small>{employee.document}</small></> }, { label: 'Cargo / área', render: employee => `${employee.position || '—'} · ${employee.department || '—'}` }, { label: 'Salario base', render: employee => formatMoney(employee.baseSalaryCents) }, { label: 'Estado', render: employee => employee.active === false ? 'Inactivo' : 'Activo' }, { label: 'Acciones', render: employee => <button className="secondary-button" onClick={() => setEdit(employee)} disabled={busy}>Editar empleado {employee.name}</button> }]} /><div className="erp-two-columns"><AttendanceForm data={data} run={run} busy={busy} /><PayrollCreator data={data} run={run} busy={busy} /></div><Records title="Asistencia registrada" rows={data.attendance || []} columns={[{ label: 'Empleado', render: row => row.employeeName || employeeName(row.employeeId) }, { label: 'Fecha', render: row => row.date }, { label: 'Estado', render: row => <Status value={row.status} /> }, { label: 'Minutos', render: row => count.format(row.minutes || 0) }]} /><Records title="Nómina registrada" rows={data.payroll || []} columns={[{ label: 'Empleado / periodo', render: row => <>{row.employeeName || employeeName(row.employeeId)}<small>{row.period}</small></> }, { label: 'Devengado', render: row => formatMoney(row.grossCents) }, { label: 'Deducciones', render: row => formatMoney(row.deductionsCents) }, { label: 'Neto / pagado', render: row => <>{formatMoney(row.netCents)}<small>Pagado: {formatMoney(row.paidCents)}</small></> }, { label: 'Estado', render: row => <Status value={row.status} /> }]} renderDetails={row => <details className="erp-details"><summary>Pagos de nómina {row.id}</summary><PaymentForm run={run} busy={busy} type="payroll" record={row} totalField="netCents" /><VoidPayroll record={row} run={run} busy={busy} /></details>} /></Panel>
}

function MemberForm({ record, run, busy }) {
  const [uid, setUid] = useState(record?.id || record?.uid || ''), [role, setRole] = useState(record?.role || 'operator'), [active, setActive] = useState(record?.active !== false)
  return <ActionForm title={record ? 'Actualizar acceso' : 'Autorizar cuenta'} description={record ? undefined : 'La persona debe crear su cuenta o existir en Firebase Authentication. Copia el UID que aparece en su pantalla de acceso pendiente.'} run={run} busy={busy} action="members.save" submitLabel={record ? 'Guardar permisos' : 'Autorizar usuario'} getPayload={() => ({ uid: uid.trim(), role, active })} onDone={() => { if (!record) setUid('') }}><Field label={record ? `UID del miembro ${record.id}` : 'UID del usuario a autorizar'} value={uid} onChange={e => setUid(e.target.value)} required readOnly={Boolean(record)} maxLength={128} /><Field label={record ? `Rol de ${record.id}` : 'Rol del usuario'}><select value={role} onChange={e => setRole(e.target.value)}><option value="admin">Administrador</option><option value="operator">Operador</option><option value="viewer">Consulta</option></select></Field><label className="erp-check"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />Acceso activo</label></ActionForm>
}
export function MembersPanel({ data, run, busy }) {
  return <Panel title="Usuarios y permisos" description="El administrador autoriza y revoca el acceso de las cuentas de la empresa."><div className="erp-permissions"><p><strong>Administrador:</strong> administra catálogo, stock, ventas, compras, producción, finanzas, personal, usuarios y auditoría.</p><p><strong>Operador:</strong> gestiona catálogo y entradas de inventario; consulta movimientos. No recibe costos ni datos financieros y no muestra el valor agregado del inventario.</p><p><strong>Consulta:</strong> conserva la consulta de prendas, precios de venta, existencias y QR. No puede modificar registros.</p></div><MemberForm run={run} busy={busy} /><Records title="Cuentas autorizadas" rows={data.members || []} columns={[{ label: 'Cuenta / UID', render: member => <>{member.name || member.email || 'Cuenta de la empresa'}<small className="erp-identifier">{member.id || member.uid}</small></> }, { label: 'Rol', render: member => states[member.role] || member.role }, { label: 'Acceso', render: member => member.active === true ? 'Activo' : 'Revocado' }]} renderDetails={member => <details className="erp-details"><summary>Permisos de {member.id || member.uid}</summary><MemberForm key={`${member.id}-${member.role}-${member.active}`} record={member} run={run} busy={busy} /></details>} /><p className="erp-help">Para evitar perder el control de la empresa, un administrador no puede revocar ni degradar su propia sesión. Contraseñas y recuperación de cuenta se administran con Firebase Authentication.</p></Panel>
}

export function AuditPanel({ data }) {
  return <Panel title="Trazabilidad y auditoría" description="Cada operación confirmada conserva su actor y documento de origen. Las correcciones generan operaciones compensatorias; el historial no se borra."><Records title="Operaciones de la empresa" rows={data.audit || []} columns={[{ label: 'Fecha', render: row => dateText(row.createdAt) }, { label: 'Acción', render: row => row.action || row.type }, { label: 'Usuario', render: row => <span className="erp-identifier">{row.actorUid || row.uid || row.createdBy || row.actor}</span> }, { label: 'Documento', render: row => row.entityId || row.sourceId || row.result?.id || row.commandId || row.id }]} renderDetails={row => <details className="erp-details"><summary>Detalle de operación</summary><pre className="erp-json">{JSON.stringify({ action: row.action, actorUid: row.actorUid || row.uid || row.createdBy || row.actor, commandId: row.commandId, summary: row.summary, result: row.result, entityId: row.entityId, sourceId: row.sourceId }, null, 2)}</pre></details>} /><Records title="Movimientos de materiales y prendas" rows={data.movements || []} columns={[{ label: 'Fecha', render: row => dateText(row.createdAt) }, { label: 'Variante', render: row => <>{row.name || labelProduct(resolveProduct(data, row.variantId))}<small>{row.sku || row.variantId}</small></> }, { label: 'Cambio', render: row => `${row.delta > 0 ? '+' : ''}${count.format(row.delta || 0)}` }, { label: 'Stock antes / después', render: row => `${count.format(row.stockBefore || 0)} → ${count.format(row.stockAfter || 0)}` }, { label: 'Origen', render: row => <>{row.sourceType}<small>{row.sourceId}</small></> }, { label: 'Motivo / actor', render: row => <>{row.reason}<small className="erp-identifier">{row.createdBy}</small></> }]} /></Panel>
}
