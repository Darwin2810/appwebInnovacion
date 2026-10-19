import { useEffect, useRef } from 'react'

export default function Modal({ title, onClose, children }) {
  const ref = useRef(null)
  useEffect(() => {
    const previous = document.activeElement
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const controls = () => [...ref.current.querySelectorAll('button,input,select,textarea,a[href]')].filter(el => !el.disabled && el.offsetParent !== null)
    controls()[0]?.focus()
    function key(event) {
      if (event.key === 'Escape') onClose()
      if (event.key !== 'Tab') return
      const all = controls(), first = all[0], last = all.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', key)
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus() }
  }, [onClose])
  return <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <section ref={ref} className="modal-card" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <div className="modal-heading"><h2 id="dialog-title">{title}</h2><button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar">×</button></div>{children}
    </section>
  </div>
}
