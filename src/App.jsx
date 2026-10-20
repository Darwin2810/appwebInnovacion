import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { firebaseState } from './lib/firebase'
import { erpCommand } from './lib/erpApi'
import { useAuth } from './hooks/useAuth'
import { useOrgData } from './hooks/useOrgData'
import AuthPanel from './components/AuthPanel'
import './App.css'

const CatalogPanel = lazy(() => import('./components/CatalogPanel'))
const panels = {
  summary: lazy(() => import('./components/OperationsPanels').then(m => ({ default: m.DashboardPanel }))),
  sales: lazy(() => import('./components/OperationsPanels').then(m => ({ default: m.SalesPanel }))),
  purchases: lazy(() => import('./components/OperationsPanels').then(m => ({ default: m.PurchasesPanel }))),
  production: lazy(() => import('./components/OperationsPanels').then(m => ({ default: m.ProductionPanel }))),
  finance: lazy(() => import('./components/OperationsPanels').then(m => ({ default: m.FinancePanel }))),
  people: lazy(() => import('./components/OperationsPanels').then(m => ({ default: m.PeoplePanel }))),
  members: lazy(() => import('./components/OperationsPanels').then(m => ({ default: m.MembersPanel }))),
  audit: lazy(() => import('./components/OperationsPanels').then(m => ({ default: m.AuditPanel }))),
}
const adminTabs = [['summary', 'Resumen'], ['sales', 'Ventas'], ['purchases', 'Compras'], ['production', 'Producción'], ['finance', 'Finanzas'], ['people', 'Personal'], ['members', 'Usuarios'], ['audit', 'Auditoría']]
const roleNames = { admin: 'Administrador', operator: 'Operador', seller: 'Vendedor', viewer: 'Usuario' }
function date(value) { return value?.toDate ? value.toDate().toLocaleString('es-CO') : '—' }

export default function App() {
  const auth = useAuth()
  const { user, member } = auth
  const data = useOrgData(user, member)
  const [tab, setTab] = useState('inventory')
  const [busyCount, setBusyCount] = useState(0)
  const [notice, setNotice] = useState('')
  const [operationError, setOperationError] = useState('')
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update); window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])
  const run = useCallback(async (action, payload, requestId) => {
    if (!navigator.onLine) throw new Error('Conéctate a internet antes de registrar una operación.')
    setBusyCount(count => count + 1); setOperationError(''); setNotice('')
    try {
      const result = await erpCommand(action, payload, requestId)
      setNotice('Operación confirmada por el servidor. Los cambios se sincronizan entre los dispositivos.')
      return result
    } catch (error) { setOperationError(error.message || 'No se pudo completar la operación.'); throw error }
    finally { setBusyCount(count => count - 1) }
  }, [])
  async function logout() {
    setNotice(''); setOperationError(''); setTab('inventory')
    try { await auth.signOut() } catch (error) { setOperationError(error.message) }
  }
  const header = <header className="app-header"><div className="brand"><span className="brand-icon">E</span><div><span className="brand-title">EXLAIDER</span><span className="brand-subtitle">JEANS SAS · Gestión conectada</span></div></div>{user && <div className="header-account"><span>{user.email}</span><button className="secondary-button" onClick={logout}>Cerrar sesión</button></div>}</header>
  const shell = content => <div className="app-shell">{header}<main className="main-content">{content}</main></div>
  if (!firebaseState.configured) return shell(<section className="setup-card"><p className="eyebrow">CONFIGURACIÓN INICIAL</p><h1>Conecta EXLAIDER a Firebase</h1><p>Configura .env.local según LEEME_VSCODE.md. El sistema utiliza Authentication, Firestore y Functions para validar las operaciones.</p><p className="feedback is-error" role="alert">{firebaseState.error}</p><p>Consulta docs/ERP.md para la instalación y migración.</p></section>)
  if (auth.loading || auth.membershipLoading) return shell(<p role="status">Comprobando acceso…</p>)
  if (!user) return shell(<div className="auth-layout"><AuthPanel {...auth} /></div>)
  if (!member) return shell(<section className="setup-card"><h1>Acceso pendiente de aprobación</h1><p>Un administrador debe autorizar tu cuenta en la empresa.</p><p>UID de tu cuenta: <code>{user.uid}</code></p><p>{auth.error?.message || auth.error}</p><p>El primer administrador se crea en Firebase Console siguiendo docs/FIREBASE_Y_QR.md. Después puede autorizar otras cuentas desde Usuarios.</p></section>)
  const tabs = [['inventory', 'Inventario'], ...(['admin', 'operator'].includes(member.role) ? [['movements', 'Movimientos']] : []), ...(member.role === 'seller' ? [['sales', 'Ventas']] : []), ...(member.role === 'admin' ? adminTabs : [])]
  const activeTab = tabs.some(([id]) => id === tab) ? tab : 'inventory'
  const Panel = panels[activeTab]
  const syncText = !online ? 'Sin conexión · operaciones deshabilitadas' : data.loading ? 'Cargando inventario…' : data.fromCache ? 'Mostrando datos en caché · esperando la nube' : 'Conectado · sincronización en tiempo real'
  return shell(<>
    <div className="page-heading"><div className="heading-copy"><p className="eyebrow">EXLAIDER JEANS SAS</p><h1>Centro de gestión</h1><p>Productos, operación y decisiones conectados en tiempo real.</p></div></div>
    <div className="sync-status" role="status"><span>{syncText}</span><span data-role={member.role}>Rol: {roleNames[member.role]}{firebaseState.useEmulators ? ' · Emuladores locales' : ''}</span></div>
    <nav className="erp-navigation" aria-label="Módulos de gestión">{tabs.map(([id, label]) => <button key={id} className={activeTab === id ? 'primary-button' : 'secondary-button'} aria-current={activeTab === id ? 'page' : undefined} onClick={() => { setTab(id); setNotice(''); setOperationError('') }}>{label}</button>)}</nav>
    {(data.error || operationError) && <p className="feedback is-error" role="alert">{operationError || data.error}</p>}
    {notice && <p className="feedback is-success" role="status">{notice}</p>}
    <Suspense fallback={<p role="status">Cargando módulo…</p>}><div key={`${user.uid}:${member.role}`}>
      {activeTab === 'inventory' && <CatalogPanel data={data} run={run} role={member.role} busy={busyCount > 0} />}
      {activeTab === 'movements' && <section className="inventory-panel"><div className="panel-toolbar"><div><h2>{member.role === 'operator' ? 'Tus movimientos de stock' : 'Movimientos de inventario'}</h2><p>{member.role === 'operator' ? 'Ingresos y movimientos realizados por tu cuenta, con fecha y documento de origen.' : 'Ingresos, ventas, ajustes y producción con su documento de origen.'}</p></div></div><div className="table-wrap"><table className="inventory-table"><thead><tr><th>Fecha</th><th>Producto / SKU</th><th>Cambio</th><th>Antes → después</th><th>Origen y responsable</th><th>Motivo</th></tr></thead><tbody>{[...data.movements].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).map(m => <tr key={m.id}><td>{date(m.createdAt)}</td><td>{m.name}<span className="product-sku">{m.sku}</span></td><td>{m.delta > 0 ? '+' : ''}{m.delta}</td><td>{m.stockBefore} → {m.stockAfter}</td><td>{m.sourceType}<span className="product-sku">{m.sourceId} · {m.createdBy}</span></td><td>{m.reason || '—'}</td></tr>)}</tbody></table>{!data.movements.length && <p className="empty-state">Aún no hay movimientos registrados en el sistema de gestión.</p>}</div></section>}
      {Panel && (data.privateLoading ? <p role="status">Sincronizando información del módulo con el servidor…</p> : <Panel data={data} run={run} role={member.role} busy={busyCount > 0 || !online || data.loading || data.fromCache || Boolean(data.error)} />)}
    </div></Suspense>
    <p className="storage-note">Empresa: {firebaseState.companyId}. Las operaciones se confirman en el servidor y conservan su historial. Los datos en caché son de consulta.</p>
  </>)
}
