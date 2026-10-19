import jsQR from 'jsqr'

// ZXing in html5-qrcode occasionally misses a valid, dense QR matrix. Keep an
// independent pixel decoder for those images; neither decoder opens QR URLs.
export function decodeQrPixels(pixels, width, height) {
  return jsQR(pixels, width, height, { inversionAttempts: 'attemptBoth' })?.data || null
}

export async function readQrImage(file) {
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('No se pudo abrir la imagen.'))
      image.src = url
    })
    const ratio = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio))
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('El navegador no permite leer imágenes.')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const data = context.getImageData(0, 0, canvas.width, canvas.height)
    const text = decodeQrPixels(data.data, data.width, data.height)
    if (!text) throw new Error('No se encontró un QR legible.')
    return text
  } finally { URL.revokeObjectURL(url) }
}
