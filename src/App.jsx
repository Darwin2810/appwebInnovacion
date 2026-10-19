import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { firebaseState } from './lib/firebase'
import { createProduct, updateProduct, deleteProduct, receiveProduct, getProductBySku } from './lib/products'
import { parseProductQr } from './lib/qr'
import { useAuth } from './hooks/useAuth'
import { useProducts } from './hooks/useProducts'
import Modal from './components/Modal'
import AuthPanel from './components/AuthPanel'
import ProductForm from './components/ProductForm'
import StockForm from './components/StockForm'
import './App.css'

const QrScanner = lazy(() => import('./components/QrScanner'))
const ProductQr = lazy(() => import('./components/ProductQr'))
const money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 })
const number = new Intl.NumberFormat('es-CO')
const normalize = text => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
const message = error => typeof error === 'string' ? error : error?.code === 'permission-denied' ? 'Tu cuenta no tiene permiso para esta operación.' : error?.message || 'No se pudo completar la operación. Revisa la conexión.'

export default function App() {
  const auth = useAuth()
  const { user, member } = auth
  const { products, loading, error, fromCache, pendingWrites } = useProducts(member ? user : null)
  const [search, setSearch] = useState(''), [category, setCategory] = useState('all')
  const [dialog, setDialog] = useState(null), [notice, setNotice] = useState(''), [operationError, setOperationError] = useState('')
  const [direct, setDirect] = useState(false), [busy, setBusy] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const close = useCallback(() => setDialog(null), [])
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update); window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])
  const writable = ['admin', 'operator'].includes(member?.role)
  const canWrite = writable && online && !fromCache && !loading && !error
  const categories = [...new Set(products.map(p => p.category))].sort()
  const query = normalize(search.trim())
  const visible = products.filter(p => (category === 'all' || p.category === category) && normalize([p.name, p.sku, p.reference, p.size, p.color, p.lot, p.category].join(' ')).includes(query))
  async function save(data) {
    if (!canWrite) throw new Error('Espera la conexión con la nube para guardar.')
    if (dialog.product) await updateProduct(user.uid, dialog.product.id, data)
    else await createProduct(user.uid, data)
    setNotice(dialog.product ? 'Producto actualizado.' : 'Producto añadido al inventario.'); close()
  }
  async function receive(quantity) {
    if (!canWrite) throw new Error('Espera la conexión con la nube para registrar el ingreso.')
    await receiveProduct(user.uid, dialog.product.id, quantity)
    setNotice(`Ingreso registrado: ${quantity} unidades.`); close()
  }
  async function remove() {
    if (!canWrite) { setOperationError('Espera la conexión con la nube.'); return }
    setBusy(true); setOperationError('')
    try { await deleteProduct(user.uid, dialog.product.id); setNotice('Producto eliminado.'); close() }
    catch (err) { setOperationError(message(err)) } finally { setBusy(false) }
  }
  async function scan(raw) {
    if (!canWrite) throw new Error('Espera la conexión con la nube para usar el ingreso por QR.')
    const parsed = parseProductQr(raw)
    let product = null
    if (parsed.kind === 'product' && parsed.id) {
      const snapshot = await getDoc(doc(firebaseState.db, 'organizations', firebaseState.companyId, 'products', parsed.id))
      if (snapshot.exists()) product = { ...snapshot.data(), id: snapshot.id }
    }
    if (!product && parsed.sku) product = await getProductBySku(user.uid, parsed.sku)
    if (product) {
      if (direct) { await receiveProduct(user.uid, product.id, 1); setNotice(`Ingreso registrado: 1 unidad de ${product.name}.`); close() }
      else setDialog({ mode: 'receive', product })
      return
    }
    if (parsed.kind === 'sku' || !parsed.fields?.name) throw new Error('Este código no está registrado. Crea primero el producto o usa un QR con sus datos completos.')
    setNotice('Datos leídos del QR. Revisa la información antes de guardar.')
    setDialog({ mode: 'create', initialValues: { ...parsed.fields, sku: parsed.sku || '' } })
  }
  async function logout() {
    close(); setNotice(''); setOperationError('')
    try { await auth.signOut() } catch (err) { setOperationError(message(err)) }
  }
  const header = <header className="app-header"><div className="brand"><span className="brand-icon">E</span><div><span className="brand-title">EXLAIDER</span><span className="brand-subtitle">JEANS SAS · Inventario conectado</span></div></div>{user && <div className="header-account"><span>{user.email}</span><button className="secondary-button" onClick={logout}>Cerrar sesión</button></div>}</header>
  if (!firebaseState.configured) return <div className="app-shell">{header}<main className="main-content"><section className="setup-card"><p className="eyebrow">CONFIGURACIÓN INICIAL</p><h1>Conecta tu inventario a Firebase</h1><p>Configura las variables de .env.local siguiendo LEEME_VSCODE.md. La aplicación necesita un proyecto Firebase con Authentication y Firestore.</p><p className="feedback is-error" role="alert">{firebaseState.error || 'Falta la configuración pública de Firebase.'}</p><p>También puedes probar con emuladores locales siguiendo docs/FIREBASE_Y_QR.md.</p></section></main></div>
  if (auth.loading || auth.membershipLoading) return <div className="app-shell">{header}<main className="main-content"><p role="status">Comprobando acceso…</p></main></div>
  if (!user) return <div className="app-shell">{header}<main className="main-content auth-layout"><AuthPanel {...auth} /></main></div>
  if (!member) return <div className="app-shell">{header}<main className="main-content"><section className="setup-card"><h1>Acceso pendiente de aprobación</h1><p>Un administrador debe autorizar tu cuenta en la empresa.</p><p>UID de tu cuenta: <code>{user.uid}</code></p><p>{auth.error?.message || auth.error}</p><p>Consulta docs/FIREBASE_Y_QR.md para crear el primer administrador.</p></section></main></div>
  const syncText = !online ? 'Sin conexión · operaciones deshabilitadas' : loading ? 'Cargando inventario…' : pendingWrites ? 'Esperando confirmación de la nube…' : fromCache ? 'Mostrando datos en caché · esperando la nube' : 'Conectado · sincronización en tiempo real'
  return <div className="app-shell">{header}<main className="main-content">
    <div className="page-heading"><div className="heading-copy"><p className="eyebrow">DE SAN VICTORINO A CADA PANTALLA</p><h1>Inventario de prendas</h1><p>Referencias, tallas y lotes de EXLAIDER JEANS SAS.</p></div><div className="heading-actions">{writable && <><button className="secondary-button" disabled={!canWrite} onClick={() => setDialog({ mode: 'scan' })}>Escanear QR</button><button className="primary-button" disabled={!canWrite} onClick={() => setDialog({ mode: 'create' })}>Añadir producto</button></>}</div></div>
    <div className="sync-status" role="status"><span>{syncText}</span><span>Rol: {member.role} {firebaseState.useEmulators ? '· Emuladores locales' : ''}</span></div>
    <section className="stats-grid" aria-label="Resumen del inventario">{[['Productos', number.format(products.length), 'Referencias registradas'], ['Unidades', number.format(products.reduce((n,p) => n+p.stock, 0)), 'Disponibles en inventario'], ['Valor del inventario', money.format(products.reduce((n,p) => n+p.stock*p.price, 0)), 'Stock × precio unitario · COP'], ['Stock bajo', products.filter(p => p.stock <= p.minStock).length, 'En el mínimo o por debajo']].map(([label, total, caption]) => <article className="stat-card" key={label}><p className="stat-label">{label}</p><p className="stat-value">{total}</p><p className="stat-caption">{caption}</p></article>)}</section>
    {(error || operationError) && <p className="feedback is-error" role="alert">{message(operationError || error)}</p>}{notice && <p className="feedback is-success" role="status">{notice}</p>}
    <section className="inventory-panel" aria-labelledby="products-title"><div className="panel-toolbar"><div className="panel-title"><h2 id="products-title">Tus productos</h2><span>{visible.length} de {products.length}</span></div><div className="toolbar-actions"><label className="search-field"><span className="sr-only">Buscar productos</span><input type="search" aria-label="Buscar productos" placeholder="Referencia, talla, lote o nombre" value={search} onChange={e => setSearch(e.target.value)} /></label><select className="filter-select" aria-label="Filtrar por categoría" value={category} onChange={e => setCategory(e.target.value)}><option value="all">Todas las categorías</option>{categories.map(c => <option key={c}>{c}</option>)}</select></div></div>
    {visible.length ? <div className="table-wrap"><table className="inventory-table" aria-label="Productos del inventario"><thead><tr><th>Producto</th><th>Referencia y variante</th><th>Stock</th><th>Precio unitario</th><th>Acciones</th></tr></thead><tbody>{visible.map(p => <tr key={p.id}><td><div className="product-cell">{p.imageUrl && <img className="product-image" src={p.imageUrl} alt={p.name} loading="lazy" referrerPolicy="no-referrer" />}<div><span className="product-name">{p.name}</span><span className="product-sku">{p.sku || 'Sin código'} · {p.category}</span>{p.description && <p className="product-description">{p.description}</p>}</div></div></td><td><span>{p.reference || 'Sin referencia'}</span><span className="product-sku">Talla {p.size || '—'} · {p.color || 'Sin color'} · Lote {p.lot || '—'}</span></td><td><span className={`stock-badge ${p.stock <= p.minStock ? 'is-low' : 'is-good'}`}>{number.format(p.stock)} · {p.stock === 0 ? 'Agotado' : p.stock <= p.minStock ? 'Bajo' : 'Disponible'}</span></td><td>{money.format(p.price)}</td><td><div className="row-actions"><button className="secondary-button" aria-label={`Ver QR de ${p.name}`} onClick={() => setDialog({ mode: 'qr', product: p })}>QR</button>{writable && <><button className="secondary-button" disabled={!canWrite} aria-label={`Ingresar stock de ${p.name}`} onClick={() => setDialog({ mode: 'receive', product: p })}>Ingresar stock</button><button className="icon-button" disabled={!canWrite} aria-label={`Editar ${p.name}`} onClick={() => setDialog({ mode: 'edit', product: p })}>Editar</button></>}{member.role === 'admin' && <button className="icon-button danger" disabled={!canWrite} aria-label={`Eliminar ${p.name}`} onClick={() => { setOperationError(''); setDialog({ mode: 'delete', product: p }) }}>Eliminar</button>}</div></td></tr>)}</tbody></table></div> : <div className="empty-state"><h3>{loading ? 'Cargando productos…' : products.length ? 'No hay coincidencias' : 'Tu inventario está listo para empezar'}</h3><p>{products.length ? 'Prueba con otra búsqueda.' : 'Agrega tu primera referencia de jeans, bermudas o camuflados.'}</p></div>}</section>
    <p className="storage-note">Cada talla, color y lote puede registrarse con su propio SKU. Los cambios se comparten entre las cuentas autorizadas de esta empresa.</p>
  </main>
  {dialog && <Modal title={{ create: 'Añadir producto', edit: 'Editar producto', receive: 'Ingresar stock', scan: 'Escanear código QR', qr: 'QR del producto', delete: 'Eliminar producto' }[dialog.mode]} onClose={close}>
    {['create', 'edit'].includes(dialog.mode) && <ProductForm product={dialog.product} initialValues={dialog.initialValues} onSave={save} onCancel={close} />}
    {dialog.mode === 'receive' && <StockForm product={dialog.product} onSave={receive} onCancel={close} />}
    {dialog.mode === 'scan' && <><label className="checkbox-field"><input type="checkbox" checked={direct} onChange={e => setDirect(e.target.checked)} />Ingreso directo: sumar 1 unidad si el producto ya existe</label><Suspense fallback={<p>Cargando lector…</p>}><QrScanner onScan={scan} onClose={close} /></Suspense></>}
    {dialog.mode === 'qr' && <Suspense fallback={<p>Generando QR…</p>}><ProductQr product={dialog.product} /></Suspense>}
    {dialog.mode === 'delete' && <><p>¿Eliminar <strong>{dialog.product.name}</strong> del inventario compartido?</p>{operationError && <p role="alert" className="feedback is-error">{operationError}</p>}<div className="modal-actions"><button className="secondary-button" onClick={close} disabled={busy}>Cancelar</button><button className="danger-button" disabled={busy} onClick={remove}>{busy ? 'Eliminando…' : 'Eliminar producto'}</button></div></>}
  </Modal>}</div>
}
