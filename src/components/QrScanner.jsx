import { useEffect, useId, useRef, useState } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'

function cameraError(error) {
  const message = `${error?.name || ''} ${error?.message || error || ''}`
  if (/NotAllowed|PermissionDenied|permission|denied/i.test(message)) return 'El navegador no tiene permiso para usar la cámara. Permite el acceso desde la barra de direcciones y vuelve a intentarlo.'
  if (/NotFound|DevicesNotFound|device.*found/i.test(message)) return 'No se encontró una cámara. Conecta una cámara o selecciona una imagen del QR.'
  if (/NotReadable|TrackStart|in use|Could not start/i.test(message)) return 'La cámara está ocupada o no se puede abrir. Cierra otras aplicaciones que la estén usando.'
  return 'No se pudo abrir la cámara. Comprueba los permisos, elige otra cámara o utiliza una imagen del QR.'
}

async function listAvailableCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  // Html5Qrcode.getCameras() opens and stops a second capture stream. On iOS
  // that can interrupt the active preview, so enumerate the devices directly.
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((device) => device.kind === 'videoinput' && device.deviceId)
    .map((device) => ({ id: device.deviceId, label: device.label }))
}

export default function QrScanner({ onScan, onClose }) {
  const reactId = useId()
  const readerId = `qr-reader-${reactId.replace(/[^A-Za-z0-9_-]/g, '')}`
  const scannerRef = useRef(null)
  const tracksRef = useRef([])
  const queueRef = useRef(Promise.resolve())
  const mountedRef = useRef(false)
  const processingRef = useRef(false)
  const scanCallbackRef = useRef(onScan)
  const fileRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [working, setWorking] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [cameras, setCameras] = useState([])
  const [cameraId, setCameraId] = useState('')
  const [error, setError] = useState('')
  const [manualText, setManualText] = useState('')
  const [status, setStatus] = useState('Abre la cámara o selecciona una imagen del QR.')
  const secureCamera = window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia)

  useEffect(() => { scanCallbackRef.current = onScan }, [onScan])
  useEffect(() => {
    mountedRef.current = true
    let cancelled = false
    let scanner
    queueRef.current = queueRef.current.then(() => {
      if (cancelled) return
      scanner = new Html5Qrcode(readerId, { formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE], verbose: false })
      scannerRef.current = scanner
      setReady(true)
    }).catch(() => { if (!cancelled) setError('No se pudo iniciar el lector. Cierra esta ventana y vuelve a abrirla.') })
    return () => {
      cancelled = true
      mountedRef.current = false
      queueRef.current = queueRef.current.then(async () => {
        if (!scanner) return
        try { if (scanner.isScanning) await scanner.stop() } finally {
          tracksRef.current.forEach((track) => track.stop())
          tracksRef.current = []
        }
        scanner.clear()
        if (scannerRef.current === scanner) scannerRef.current = null
      }).catch(() => {
        tracksRef.current.forEach((track) => track.stop())
        tracksRef.current = []
      })
    }
  }, [readerId])

  function queue(action) {
    const result = queueRef.current.then(action)
    queueRef.current = result.catch(() => {})
    return result
  }
  async function stopCamera() {
    try { if (scannerRef.current?.isScanning) await scannerRef.current.stop() } finally {
      tracksRef.current.forEach((track) => track.stop())
      tracksRef.current = []
      if (mountedRef.current) setScanning(false)
    }
  }
  async function decoded(text) {
    if (!mountedRef.current || processingRef.current) return
    processingRef.current = true
    setWorking(true)
    setError('')
    setStatus('QR leído. Comprobando el producto…')
    try {
      await queue(stopCamera)
      if (!mountedRef.current) return
      await scanCallbackRef.current(text)
      if (mountedRef.current) setStatus('QR procesado correctamente.')
    } catch (failure) {
      processingRef.current = false
      if (mountedRef.current) {
        setError(failure instanceof Error ? failure.message : 'No se pudo procesar el QR.')
        setStatus('Puedes abrir de nuevo la cámara o seleccionar otra imagen.')
      }
    } finally { if (mountedRef.current) setWorking(false) }
  }
  async function startCamera() {
    if (!secureCamera) return
    setWorking(true)
    setError('')
    processingRef.current = false
    try {
      await queue(async () => {
        const scanner = scannerRef.current
        if (!mountedRef.current || !scanner) return
        await stopCamera()
        await scanner.start(cameraId || { facingMode: 'environment' }, {
          fps: 10,
          qrbox: (width, height) => {
            const side = Math.max(50, Math.min(280, Math.floor(Math.min(width, height) * 0.75)))
            return { width: side, height: side }
          },
        }, decoded, () => {})
        tracksRef.current = document.getElementById(readerId)?.querySelector('video')?.srcObject?.getTracks() || []
        if (!mountedRef.current) { await stopCamera(); return }
        setScanning(true)
        setStatus('Apunta al QR y mantenlo dentro del recuadro.')
        try {
          const available = await listAvailableCameras()
          if (mountedRef.current) setCameras(available)
        } catch { /* Enumeration may be unavailable while scanning remains usable. */ }
      })
    } catch (failure) {
      if (mountedRef.current) setError(cameraError(failure))
      try {
        const available = await listAvailableCameras()
        if (mountedRef.current && available.length) {
          setCameras(available)
          setCameraId(available[0].id)
          setStatus('Elige una cámara y pulsa Abrir cámara para volver a intentarlo.')
        }
      } catch { /* Keep original permission error. */ }
    } finally { if (mountedRef.current) setWorking(false) }
  }
  async function pauseCamera() {
    setWorking(true)
    try {
      await queue(stopCamera)
      if (mountedRef.current) setStatus('Cámara detenida.')
    } catch (failure) { if (mountedRef.current) setError(cameraError(failure)) } finally {
      if (mountedRef.current) setWorking(false)
    }
  }
  async function scanFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/') || file.size > 10 * 1024 * 1024) { setError('Selecciona una imagen del QR de menos de 10 MB.'); return }
    processingRef.current = false
    setWorking(true)
    setError('')
    setStatus('Leyendo la imagen del QR…')
    let text
    try {
      text = await queue(async () => {
        await stopCamera()
        if (!mountedRef.current || !scannerRef.current) return null
        scannerRef.current.clear()
        return scannerRef.current.scanFile(file, true)
      })
    } catch {
      if (mountedRef.current) {
        setError('No se encontró un QR legible. Utiliza una foto clara, sin reflejos y con el código completo.')
        setStatus('Selecciona otra imagen o abre la cámara.')
      }
    } finally { if (mountedRef.current) setWorking(false) }
    if (text && mountedRef.current) await decoded(text)
  }
  return (
    <div className="qr-scanner">
      <p className="qr-guidance">Escanea un QR de producto o un código SKU. El lector no abre enlaces externos.</p>
      {!secureCamera && <p className="qr-error" role="alert">La cámara necesita HTTPS (o localhost en el computador). Una dirección HTTP de la red Wi-Fi no permite usarla en el celular. Puedes leer una imagen del QR mientras preparas un sitio HTTPS.</p>}
      <div id={readerId} className="qr-video" />
      <div className="qr-camera-controls">
        {cameras.length > 0 && <label>Cámara<select value={cameraId} onChange={(event) => setCameraId(event.target.value)} disabled={working || scanning}><option value="">Cámara trasera / automática</option>{cameras.map((camera, index) => <option key={camera.id} value={camera.id}>{camera.label || `Cámara ${index + 1}`}</option>)}</select></label>}
        <button type="button" className="primary-button" onClick={scanning ? pauseCamera : startCamera} disabled={!ready || working || !secureCamera}>{scanning ? 'Detener cámara' : 'Abrir cámara'}</button>
        <button type="button" className="secondary-button" onClick={() => fileRef.current?.click()} disabled={!ready || working}>Leer imagen QR</button>
        <input ref={fileRef} type="file" accept="image/*" onChange={scanFile} className="sr-only" aria-label="Seleccionar imagen del QR" disabled={!ready || working} />
      </div>
      <p className="qr-status" role="status">{status}</p>
      {error && <p className="qr-error" role="alert">{error}</p>}
      <div className="form-field">
        <label htmlFor={`${readerId}-text`}>SKU o contenido del QR</label>
        <textarea id={`${readerId}-text`} value={manualText} onChange={(event) => setManualText(event.target.value)} maxLength={8192} rows={3} />
        <button type="button" className="secondary-button" disabled={!ready || working || !manualText.trim()} onClick={() => { processingRef.current = false; void decoded(manualText) }}>Procesar código</button>
      </div>
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cerrar lector</button></div>
    </div>
  )
}
