import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import QRCode from 'qrcode'
import { normalizeProduct } from '../src/lib/productModel.js'
import { makeProductQr } from '../src/lib/qr.js'
import { decodeQrPixels } from '../src/lib/qrImage.js'

// Read the genuine PNG encoder output, through qrcode's own PNG dependency.
const encoderRequire = createRequire(import.meta.resolve('qrcode'))
const { PNG } = encoderRequire('pngjs')
test('independent image decoder reads dense product PNG matrices missed by ZXing', async () => {
  const cases = ['1792461414692', '1792463883826', '1792468822094', '1792473760362', '1792474994929', '1792476229496', '1792477464063', '1792489809733']
  for (const time of cases) {
    const product = normalizeProduct({ name: `Jean QR ${time}`, sku: `QA-QR-${time}`, reference: `QR-${time}`, category: 'Jeans', size: '34', color: 'Negro', lot: 'QR-2026', stock: 3, minStock: 1, price: 125000, description: 'Prenda preparada antes de registrarla.' })
    const payload = makeProductQr(product)
    const bytes = await QRCode.toBuffer(payload, { width: 720, margin: 4, errorCorrectionLevel: 'M' })
    const png = PNG.sync.read(bytes)
    assert.equal(decodeQrPixels(new Uint8ClampedArray(png.data), png.width, png.height), payload, time)
  }
})
test('an image without a QR does not invent decoded product data', () => {
  assert.equal(decodeQrPixels(new Uint8ClampedArray(100 * 100 * 4).fill(255), 100, 100), null)
})
