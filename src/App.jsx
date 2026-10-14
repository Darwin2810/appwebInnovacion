import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'

const STORAGE_KEY = 'appwebInnovacion.inventory.v1'
const money = new Intl.NumberFormat('es-CO', {
  style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 2,
})
const number = new Intl.NumberFormat('es-CO')
const normalize = (text) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

function loadInventory() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === null) return { products: [], storageError: '', writable: true }
    const products = JSON.parse(saved)
    const valid = Array.isArray(products) && products.every((item) => (
      item && typeof item.id === 'string' && typeof item.name === 'string' && item.name.trim()
      && typeof item.sku === 'string' && typeof item.category === 'string' && item.category.trim()
      && Number.isSafeInteger(item.stock) && item.stock >= 0
      && Number.isSafeInteger(item.minStock) && item.minStock >= 0
      && Number.isFinite(item.price) && item.price >= 0
    ))
    if (!valid || new Set(products.map((item) => item.id)).size !== products.length) {
      throw new Error('Invalid saved inventory')
    }
    return { products, storageError: '', writable: true }
  } catch {
    return {
      products: [], writable: false,
      storageError: 'No se pudieron leer los datos guardados. Los cambios se conservarán solo durante esta sesión.',
    }
  }
}

function Icon({ name, ...props }) {
  const paths = {
    box: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="M3 8v9l9 5 9-5V8M12 13v9M7.5 5.5l9 5" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
    edit: <><path d="m15 5 4 4M4 20l4.5-1L20 7.5 16.5 4 5 15.5 4 20Z" /></>,
    trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>
}

function Modal({ title, onClose, children }) {
  const dialogRef = useRef(null)
  useEffect(() => {
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const dialog = dialogRef.current
    const firstInput = dialog.querySelector('input') || dialog.querySelector('button')
    firstInput?.focus()
    function handleKey(event) {
      if (event.key === 'Escape') onClose()
      if (event.key !== 'Tab') return
      const controls = [...dialog.querySelectorAll('button, input, select, textarea, [tabindex="0"]')]
        .filter((control) => !control.disabled && control.offsetParent !== null)
      const first = controls[0]
      const last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKey)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [onClose])
  return (
    <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="inventory-dialog-title" ref={dialogRef}>
        <div className="modal-heading">
          <h2 id="inventory-dialog-title">{title}</h2>
          <button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose}><Icon name="close" /></button>
        </div>
        {children}
      </section>
    </div>
  )
}

function ProductForm({ product, products, onSave, onCancel }) {
  const [fields, setFields] = useState(() => ({
    name: product?.name || '', sku: product?.sku || '', category: product?.category || 'General',
    stock: String(product?.stock ?? 0), minStock: String(product?.minStock ?? 5), price: String(product?.price ?? 0),
  }))
  const [errors, setErrors] = useState({})
  const formRef = useRef(null)
  function update(event) {
    const { name, value } = event.target
    setFields((current) => ({ ...current, [name]: value }))
    setErrors((current) => ({ ...current, [name]: '' }))
  }
  function submit(event) {
    event.preventDefault()
    const nextErrors = {}
    if (!fields.name.trim()) nextErrors.name = 'Escribe el nombre del producto.'
    if (!fields.category.trim()) nextErrors.category = 'Escribe una categoría.'
    if (fields.sku.trim() && products.some((item) => item.id !== product?.id && item.sku.toLowerCase() === fields.sku.trim().toLowerCase())) {
      nextErrors.sku = 'Ya existe un producto con este código.'
    }
    for (const key of ['stock', 'minStock']) {
      const value = Number(fields[key])
      if (!fields[key].trim() || !Number.isSafeInteger(value) || value < 0 || value > 1e9) {
        nextErrors[key] = 'Introduce un número entero entre 0 y 1.000.000.000.'
      }
    }
    const price = Number(fields.price)
    if (!fields.price.trim() || !Number.isFinite(price) || price < 0 || price > 1e12) {
      nextErrors.price = 'Introduce un precio entre 0 y 1.000.000.000.000.'
    }
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors)
      formRef.current.elements.namedItem(Object.keys(nextErrors)[0])?.focus()
      return
    }
    onSave({
      id: product?.id || crypto.randomUUID(), name: fields.name.trim(), sku: fields.sku.trim(),
      category: fields.category.trim(), stock: Number(fields.stock), minStock: Number(fields.minStock),
      price: Math.round(price * 100) / 100,
    })
  }
  const controls = [
    { name: 'name', label: 'Nombre del producto', maxLength: 100, placeholder: 'Ej. Cuaderno universitario' },
    { name: 'sku', label: 'Código (SKU)', maxLength: 40, placeholder: 'Ej. PAP-001' },
    { name: 'category', label: 'Categoría', maxLength: 60, list: 'category-suggestions' },
    { name: 'stock', label: 'Stock', type: 'number', min: 0, max: 1e9, step: 1 },
    { name: 'minStock', label: 'Stock mínimo', type: 'number', min: 0, max: 1e9, step: 1 },
    { name: 'price', label: 'Precio unitario (COP)', type: 'number', min: 0, max: 1e12, step: '0.01' },
  ]
  return (
    <form onSubmit={submit} noValidate ref={formRef}>
      <div className="form-grid">
        {controls.map(({ name, label, ...attributes }) => (
          <div className="form-field" key={name}>
            <label htmlFor={`product-${name}`}>{label}</label>
            <input id={`product-${name}`} name={name} value={fields[name]} onChange={update} type="text" {...attributes}
              aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `error-${name}` : undefined} />
            {errors[name] && <p className="form-error" id={`error-${name}`} role="alert">{errors[name]}</p>}
          </div>
        ))}
      </div>
      <datalist id="category-suggestions">{['General', 'Tecnología', 'Papelería', 'Hogar', 'Otros'].map((category) => <option key={category} value={category} />)}</datalist>
      <p className="storage-note">El stock mínimo te ayudará a detectar productos que necesitan reposición.</p>
      <div className="modal-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>Cancelar</button>
        <button type="submit" className="primary-button">{product ? 'Guardar cambios' : 'Guardar producto'}</button>
      </div>
    </form>
  )
}

export default function App() {
  const [inventory, setInventory] = useState(loadInventory)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [dialog, setDialog] = useState(null)
  const [notice, setNotice] = useState('')
  const closeDialog = useCallback(() => setDialog(null), [])
  const { products, storageError } = inventory
  const categories = [...new Set(products.map((item) => item.category))].sort((a, b) => a.localeCompare(b, 'es'))
  const query = normalize(search.trim())
  const visibleProducts = products.filter((item) => (
    (categoryFilter === 'all' || item.category === categoryFilter)
    && normalize(`${item.name} ${item.sku} ${item.category}`).includes(query)
  )).sort((a, b) => a.name.localeCompare(b.name, 'es'))
  const units = products.reduce((sum, item) => sum + item.stock, 0)
  const value = products.reduce((sum, item) => sum + item.stock * item.price, 0)
  const lowStock = products.filter((item) => item.stock <= item.minStock).length

  function saveProducts(next, message) {
    let nextError = inventory.storageError
    if (inventory.writable) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
        nextError = ''
      } catch {
        nextError = 'No se pudieron guardar los cambios en el navegador. Se conservarán solo durante esta sesión.'
      }
    }
    setInventory((current) => ({ ...current, products: next, storageError: nextError }))
    if (categoryFilter !== 'all' && !next.some((item) => item.category === categoryFilter)) setCategoryFilter('all')
    setNotice(message)
    closeDialog()
  }
  function saveProduct(product) {
    const editing = products.some((item) => item.id === product.id)
    const next = editing ? products.map((item) => item.id === product.id ? product : item) : [...products, product]
    saveProducts(next, editing ? 'Producto actualizado.' : 'Producto añadido al inventario.')
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon"><Icon name="box" /></span>
          <div><span className="brand-title">Innovación</span><span className="brand-subtitle">Control de inventario</span></div>
        </div>
        <span className="header-note">Datos guardados en este navegador</span>
      </header>
      <main className="main-content">
        <div className="page-heading">
          <div className="heading-copy"><p className="eyebrow">TU NEGOCIO, EN ORDEN</p><h1>Inventario</h1><p>Organiza tus productos y mantén el stock bajo control.</p></div>
          <button type="button" className="primary-button" onClick={() => setDialog({ mode: 'create' })}><Icon name="plus" />Añadir producto</button>
        </div>
        <section className="stats-grid" aria-label="Resumen del inventario">
          {[['Productos', number.format(products.length), 'Referencias registradas'], ['Unidades', number.format(units), 'Disponibles en inventario'], ['Valor del inventario', money.format(value), 'Stock × precio unitario · COP'], ['Stock bajo', number.format(lowStock), 'En el mínimo o por debajo']].map(([label, total, caption]) => (
            <article className="stat-card" key={label}><p className="stat-label">{label}</p><p className="stat-value">{total}</p><p className="stat-caption">{caption}</p></article>
          ))}
        </section>
        {storageError && <p className="feedback is-error" role="alert">{storageError}</p>}
        {notice && <p className="feedback is-success" role="status">{notice}</p>}
        <section className="inventory-panel" aria-labelledby="products-title">
          <div className="panel-toolbar">
            <div className="panel-title"><h2 id="products-title">Tus productos</h2><span>{number.format(visibleProducts.length)} de {number.format(products.length)}</span></div>
            <div className="toolbar-actions">
              <label className="search-field" htmlFor="product-search"><Icon name="search" /><span className="sr-only">Buscar productos</span><input id="product-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre o código" /></label>
              <select className="filter-select" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="Filtrar por categoría">
                <option value="all">Todas las categorías</option>
                {categories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </div>
          </div>
          {visibleProducts.length ? (
            <div className="table-wrap"><table className="inventory-table" aria-label="Productos del inventario">
              <thead><tr><th scope="col">Producto</th><th scope="col">Categoría</th><th scope="col">Stock</th><th scope="col">Precio unitario</th><th scope="col">Valor total</th><th scope="col">Acciones</th></tr></thead>
              <tbody>{visibleProducts.map((item) => (
                <tr key={item.id}>
                  <td><span className="product-name">{item.name}</span><span className="product-sku">{item.sku || 'Sin código'}</span></td>
                  <td><span className="category-tag">{item.category}</span></td>
                  <td><span className={`stock-badge ${item.stock === 0 ? 'is-empty' : item.stock <= item.minStock ? 'is-low' : 'is-good'}`}>{number.format(item.stock)} · {item.stock === 0 ? 'Agotado' : item.stock <= item.minStock ? 'Bajo' : 'Disponible'}</span></td>
                  <td>{money.format(item.price)}</td><td>{money.format(item.price * item.stock)}</td>
                  <td><div className="row-actions"><button type="button" className="icon-button" aria-label={`Editar ${item.name}`} onClick={() => setDialog({ mode: 'edit', product: item })}><Icon name="edit" /></button><button type="button" className="icon-button" aria-label={`Eliminar ${item.name}`} onClick={() => setDialog({ mode: 'delete', product: item })}><Icon name="trash" /></button></div></td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : (
            <div className="empty-state"><div className="empty-icon"><Icon name={products.length ? 'search' : 'box'} /></div>
              <h3>{products.length ? 'No encontramos productos' : 'Tu inventario empieza aquí'}</h3>
              <p>{products.length ? 'Prueba otro nombre, código o categoría.' : 'Añade tu primer producto para empezar a controlar tus existencias.'}</p>
              {products.length ? <button className="secondary-button" onClick={() => { setSearch(''); setCategoryFilter('all') }}>Limpiar filtros</button> : <button className="secondary-button" onClick={() => setDialog({ mode: 'create' })}>Añadir mi primer producto</button>}
            </div>
          )}
        </section>
        <footer className="app-footer"><p>Inventario · Innovación</p><p>Los datos se guardan en este navegador y no se sincronizan entre dispositivos.</p></footer>
      </main>
      {dialog && <Modal title={dialog.mode === 'delete' ? 'Eliminar producto' : dialog.mode === 'edit' ? 'Editar producto' : 'Añadir producto'} onClose={closeDialog}>
        {dialog.mode === 'delete' ? <><p className="delete-copy">¿Quieres eliminar <strong>{dialog.product.name}</strong> del inventario? Esta acción no se puede deshacer.</p><div className="modal-actions"><button className="secondary-button" onClick={closeDialog}>Cancelar</button><button className="primary-button danger-button" onClick={() => saveProducts(products.filter((item) => item.id !== dialog.product.id), 'Producto eliminado.')}>Eliminar producto</button></div></> : <ProductForm key={dialog.product?.id || 'new'} product={dialog.product} products={products} onSave={saveProduct} onCancel={closeDialog} />}
      </Modal>}
    </div>
  )
}
