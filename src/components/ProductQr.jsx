import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { makeProductQr } from '../lib/qr.js'

export default function ProductQr({ product }) {
  const [generated, setGenerated] = useState({ payload: '', image: '', error: '' })
  const [notice, setNotice] = useState('')
  let payload = ''
  let payloadError = ''
  try { payload = makeProductQr(product) } catch (error) { payloadError = error.message }
  const image = generated.payload === payload ? generated.image : ''
  const error = generated.payload === payload ? generated.error : ''
  useEffect(() => {
    let cancelled = false
    if (!payload) return
    QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', width: 360, margin: 3 }).then((image) => {
      if (!cancelled) setGenerated({ payload, image, error: '' })
    }).catch(() => {
      if (!cancelled) setGenerated({ payload, image: '', error: 'Hay demasiado texto para una imagen QR. Reduce la descripción o utiliza el SKU como identificador.' })
    })
    return () => { cancelled = true }
  }, [payload])
  async function copy() {
    try { await navigator.clipboard.writeText(payload); setNotice('Contenido del QR copiado.') } catch {
      setNotice('Despliega el contenido del QR para copiarlo manualmente.')
    }
  }
  return (
    <div className="qr-preview">
      <p className="qr-guidance">Escanea este QR en otro dispositivo con la misma cuenta para abrir el producto o registrar su ingreso. Revisa los datos antes de guardar.</p>
      {(payloadError || error) && <p className="qr-error" role="alert">{payloadError || error}</p>}
      {image && !error && !payloadError && <img className="qr-image" src={image} alt={`Código QR del producto ${product.name}`} width="360" height="360" />}
      {!image && !error && !payloadError && <p role="status">Generando QR…</p>}
      <div className="qr-actions">
        {image && !error && <a className="primary-button" href={image} download={`producto-${product.sku || product.id || 'qr'}.png`}>Descargar QR</a>}
        {payload && <button type="button" className="secondary-button" onClick={copy}>Copiar contenido</button>}
      </div>
      {notice && <p className="qr-status" role="status">{notice}</p>}
      {payload && <details className="qr-code"><summary>Ver contenido del QR</summary><pre>{payload}</pre></details>}
    </div>
  )
}
