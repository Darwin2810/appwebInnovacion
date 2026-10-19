import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { makeProductQr } from '../lib/qr.js'

export default function ProductQr({ product }) {
  const [generated, setGenerated] = useState({ source: '', payload: '', image: '', error: '', compact: false })
  const [notice, setNotice] = useState('')
  let payload = ''
  let compactPayload = ''
  let payloadError = ''
  try {
    payload = makeProductQr(product)
    if (product.id) compactPayload = makeProductQr({ id: product.id, sku: product.sku })
  } catch (error) { payloadError = error.message }
  const current = generated.source === payload ? generated : null
  const image = current?.image || ''
  const error = current?.error || ''
  const effectivePayload = current?.payload || ''
  useEffect(() => {
    let cancelled = false
    if (!payload) return
    const options = { errorCorrectionLevel: 'M', width: 720, margin: 4 }
    async function generate() {
      try {
        const image = await QRCode.toDataURL(payload, options)
        if (!cancelled) setGenerated({ source: payload, payload, image, error: '', compact: false })
      } catch {
        if (cancelled) return
        try {
          if (!compactPayload || compactPayload === payload) throw new Error('No compact identifier')
          const image = await QRCode.toDataURL(compactPayload, options)
          if (!cancelled) setGenerated({ source: payload, payload: compactPayload, image, error: '', compact: true })
        } catch {
          if (!cancelled) setGenerated({ source: payload, payload: '', image: '', error: 'Hay demasiado texto para una imagen QR. Guarda primero el producto o reduce la descripción.', compact: false })
        }
      }
    }
    generate()
    return () => { cancelled = true }
  }, [payload, compactPayload])
  async function copy() {
    try { await navigator.clipboard.writeText(effectivePayload); setNotice('Contenido del QR copiado.') } catch {
      setNotice('Despliega el contenido del QR para copiarlo manualmente.')
    }
  }
  return (
    <div className="qr-preview">
      <p className="qr-guidance">Escanea este QR en otro dispositivo con una cuenta autorizada de la misma empresa para abrir el producto o registrar su ingreso. Revisa los datos antes de guardar.</p>
      {(payloadError || error) && <p className="qr-error" role="alert">{payloadError || error}</p>}
      {current?.compact && <p className="qr-guidance">Este QR usa el identificador del producto porque sus datos completos son extensos. Al escanearlo con una cuenta autorizada de la misma empresa se consultarán los datos actuales en la nube.</p>}
      {image && !error && !payloadError && <img className="qr-image" src={image} alt={`Código QR del producto ${product.name}`} width="360" height="360" />}
      {!image && !error && !payloadError && <p role="status">Generando QR…</p>}
      <div className="qr-actions">
        {image && !error && <a className="primary-button" href={image} download={`producto-${product.sku || product.id || 'qr'}.png`}>Descargar QR</a>}
        {effectivePayload && <button type="button" className="secondary-button" onClick={copy}>Copiar contenido</button>}
      </div>
      {notice && <p className="qr-status" role="status">{notice}</p>}
      {effectivePayload && <details className="qr-code"><summary>Ver contenido del QR</summary><pre>{effectivePayload}</pre></details>}
    </div>
  )
}
