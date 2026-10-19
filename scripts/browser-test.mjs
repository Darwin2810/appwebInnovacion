import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'

const root = fileURLToPath(new URL('../', import.meta.url))
const directory = path.resolve(process.env.VERIFICATION_DIR || path.join(root, '.verification'))
const appUrl = process.env.APP_URL || 'http://127.0.0.1:5173'
const project = 'demo-inventario'
const company = 'exlaider-jeans'
const setupSmoke = process.argv.includes('--setup-smoke')
const password = 'BrowserEmulator2026!'
const run = String(Date.now())
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const report = { environment: setupSmoke ? 'Unconfigured production setup and PWA only; no cloud integration exercised' : 'Firebase Auth, Firestore and Functions emulators; isolated admin, operator and viewer Chromium clients', appUrl, project, checks: [], consoleErrors: [], pageExceptions: [] }
const accountsToRemove = []
const contexts = []
const sessions = new Map()
const calls = new Map()
await mkdir(directory, { recursive: true })

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10000) })
  const body = await response.json()
  if (!response.ok) throw new Error(`Emulator HTTP ${response.status}: ${JSON.stringify(body)}`)
  return body
}
async function createAccount(role) {
  const email = `${role}.${run}@browser.exlaider.test`
  const result = await jsonRequest('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-inventario-key', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) })
  const account = { email, uid: result.localId, idToken: result.idToken, role }
  accountsToRemove.push(account)
  await jsonRequest(`http://127.0.0.1:8080/v1/projects/${project}/databases/(default)/documents/organizations/${company}/members/${account.uid}`, { method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: 'Bearer owner' }, body: JSON.stringify({ fields: { role: { stringValue: role }, active: { booleanValue: true } } }) })
  return account
}
async function command(account, action, payload) {
  const response = await jsonRequest(`http://127.0.0.1:5001/${project}/us-east1/erp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${account.idToken}` },
    body: JSON.stringify({ data: { companyId: company, action, requestId: `browser_${crypto.randomUUID()}`, payload } }),
  })
  if (response.error) throw new Error(response.error.message || JSON.stringify(response.error))
  return response.result ?? response.data
}
async function collection(name) {
  const response = await jsonRequest(`http://127.0.0.1:8080/v1/projects/${project}/databases/(default)/documents/organizations/${company}/${name}?pageSize=1000`, { headers: { Authorization: 'Bearer owner' } })
  return response.documents || []
}
function field(document, name) {
  const value = document.fields?.[name]
  if (!value) return undefined
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return value.doubleValue
  if ('booleanValue' in value) return value.booleanValue
  return value.stringValue
}
async function variantBySku(sku) {
  const document = (await collection('variants')).find(item => field(item, 'sku') === sku)
  return document ? { id: document.name.split('/').at(-1), stock: field(document, 'stock'), document } : null
}
async function chromeExecutable() {
  const candidates = [process.env.CHROMIUM_BIN, process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'), process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')].filter(Boolean)
  for (const candidate of candidates) { try { await access(candidate); return candidate } catch { /* Try the next supported browser path. */ } }
  throw new Error('Chrome/Chromium is required. Set CHROMIUM_BIN or CHROME_BIN to its executable.')
}

let browser
let socket
let profile
let callNumber = 0
const request = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++callNumber
  const timeout = setTimeout(() => { calls.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 15000)
  calls.set(id, { resolve, reject, timeout })
  try { socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })) } catch (error) { clearTimeout(timeout); calls.delete(id); reject(error) }
})
const helpers = `
  window.qaControl = label => [...document.querySelectorAll('input,select,textarea')].find(el => el.getAttribute('aria-label') === label || [...(el.labels || [])].some(l => l.textContent.trim().replace(/\\s*\\*$/, '') === label || l.querySelector(':scope > span')?.textContent.trim() === label));
  window.qaButton = text => [...document.querySelectorAll('button')].find(el => el.getClientRects().length && (el.getAttribute('aria-label') === text || el.textContent.replace(/\\s+/g, ' ').trim() === text));
  window.qaSet = (label,value) => {const el=qaControl(label);if(!el)throw new Error('Missing control '+label);const prototype=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(el,value);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));};
  window.qaClick = text => {const el=qaButton(text);if(!el)throw new Error('Missing button '+text);if(el.disabled)throw new Error('Disabled button '+text);el.click();};
  window.qaStock = name => {const row=qaButton('Ver QR de '+name)?.closest('tr');const text=row?.querySelector('.stock-badge')?.textContent;if(!text)return null;return Number(text.trim().match(/^[0-9.]+/)?.[0].replaceAll('.',''));};
  window.qaRow = sku => [...document.querySelectorAll('table tbody tr')].find(row => [...row.querySelectorAll('.product-sku')].some(el => el.textContent.trim().split(/\\s+·\\s+/)[0] === sku) || row.getAttribute('data-sku') === sku);
  window.qaStockSku = sku => {const text=qaRow(sku)?.querySelector('.stock-badge')?.textContent;if(!text)return null;return Number(text.trim().match(/^[0-9.]+/)?.[0].replaceAll('.',''));};
  window.qaRowClick = (sku,label) => {const row=qaRow(sku);if(!row)throw new Error('Missing variant '+sku);const button=[...row.querySelectorAll('button')].find(el=>el.textContent.trim()===label || el.getAttribute('aria-label')===label);if(!button||button.disabled)throw new Error('Missing or disabled row button '+label);button.click();};
  window.qaVariantSet = (index,name,value) => {const row=document.querySelectorAll('.catalog-variant-row')[index];const input=row?.querySelector('input[name="'+name+'"]');if(!input)throw new Error('Missing variant form field '+index+'/'+name);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
  true;
`
class Client {
  constructor(name, sessionId) { this.name = name; this.sessionId = sessionId }
  request(method, params) { return request(method, params, this.sessionId) }
  async evaluate(expression, returnByValue = true) {
    const result = await this.request('Runtime.evaluate', { expression, returnByValue, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(`${this.name}: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`)
    return returnByValue ? result.result.value : result.result
  }
  async wait(expression, description, timeout = 20000) {
    const until = Date.now() + timeout
    while (Date.now() < until) { if (await this.evaluate(`Boolean(${expression})`)) return; await pause(75) }
    throw new Error(`${this.name}: timed out: ${description}`)
  }
  async set(label, value) { await this.evaluate(`qaSet(${JSON.stringify(label)},${JSON.stringify(String(value))})`); await pause(30) }
  async click(text) { await this.evaluate(`qaClick(${JSON.stringify(text)})`); await pause(60) }
  async submit() {
    await this.evaluate(`(()=>{const button=document.querySelector('form button[type="submit"]');if(!button||button.disabled)throw new Error('Missing or disabled form submit');button.click()})()`)
    await pause(60)
  }
  async checkbox(label, checked) {
    await this.evaluate(`(()=>{const el=qaControl(${JSON.stringify(label)});if(!el)throw new Error('Missing checkbox');if(el.checked!==${checked})el.click()})()`)
    await pause(40)
  }
  async screenshot(filename) { const { data } = await this.request('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); await writeFile(path.join(directory, filename), Buffer.from(data, 'base64')) }
  async login(account) {
    await this.wait(`qaControl('Correo electrónico') && qaControl('Contraseña')`, 'login form')
    await this.set('Correo electrónico', account.email)
    await this.set('Contraseña', password)
    await this.submit()
    await this.wait(`!qaControl('Contraseña') && document.body.textContent.includes('Rol: ${account.role}')`, 'approved company membership')
    await this.wait(`document.querySelector('[aria-label="Resumen del inventario"]') && document.querySelector('.sync-status')?.textContent.includes('Conectado')`, 'live role-scoped inventory rendered')
    if (account.role !== 'viewer') await this.wait(`qaButton('Añadir producto') && !qaButton('Añadir producto').disabled && qaButton('Escanear QR') && !qaButton('Escanear QR').disabled`, 'active catalog and callable actions')
  }
  async stock(name, expected) { await this.wait(`qaStock(${JSON.stringify(name)}) === ${expected}`, `${name} stock = ${expected}`) }
  async stockSku(sku, expected) { await this.wait(`qaStockSku(${JSON.stringify(sku)}) === ${expected}`, `${sku} stock = ${expected}`) }
  async rowClick(sku, label) { await this.evaluate(`qaRowClick(${JSON.stringify(sku)},${JSON.stringify(label)})`); await pause(60) }
  async variantFields(index, values) { for (const [name, value] of Object.entries(values)) { await this.evaluate(`qaVariantSet(${index},${JSON.stringify(name)},${JSON.stringify(String(value))})`); await pause(30) } }
  async closed() { await this.wait(`!document.querySelector('[role="dialog"]')`, 'completed operation closes dialog') }
  async hasProduct(name) { return this.evaluate(`!!qaButton(${JSON.stringify(`Ver QR de ${name}`)})`) }
  async openScanner(quickReceive = false) {
    await this.click('Escanear QR')
    await this.wait(`qaControl('Seleccionar imagen del QR') && !qaControl('Seleccionar imagen del QR').disabled`, 'real QR library ready')
    await this.checkbox('Ingreso directo: sumar 1 unidad si el producto ya existe', quickReceive)
  }
  async uploadQr(filename) {
    const input = await this.evaluate(`qaControl('Seleccionar imagen del QR')`, false)
    if (!input.objectId) throw new Error('QR file control is missing')
    await this.request('DOM.setFileInputFiles', { files: [filename], objectId: input.objectId })
  }
}
async function client(name, mobile = false) {
  const { browserContextId } = await request('Target.createBrowserContext')
  contexts.push(browserContextId)
  const { targetId } = await request('Target.createTarget', { url: 'about:blank', browserContextId })
  const { sessionId } = await request('Target.attachToTarget', { targetId, flatten: true })
  sessions.set(sessionId, name)
  const page = new Client(name, sessionId)
  await page.request('Runtime.enable')
  await page.request('Page.enable')
  await page.request('Page.addScriptToEvaluateOnNewDocument', { source: helpers })
  await page.request('Emulation.setDeviceMetricsOverride', { width: mobile ? 390 : 1440, height: mobile ? 844 : 1000, deviceScaleFactor: 1, mobile })
  await page.request('Page.navigate', { url: appUrl })
  await page.wait(`document.querySelector('#root')?.children.length`, 'React render')
  return page
}
async function check(name, operation) {
  try { await operation(); report.checks.push({ name, passed: true }); console.log(`PASS ${name}`) }
  catch (error) { report.checks.push({ name, passed: false, error: error.message }); throw error }
}
async function fill(page, product) {
  for (const [label, key] of [['Nombre del producto', 'name'], ['Código (SKU)', 'sku'], ['Referencia', 'reference'], ['Categoría', 'category'], ['Talla', 'size'], ['Color', 'color'], ['Lote', 'lot'], ['Stock', 'stock'], ['Stock mínimo', 'minStock'], ['Precio unitario (COP)', 'price']]) await page.set(label, product[key] ?? '')
}

let desktop
let mobile
let viewerPage
try {
  const executable = await chromeExecutable()
  const admin = setupSmoke ? null : await createAccount('admin')
  const operator = setupSmoke ? null : await createAccount('operator')
  const viewer = setupSmoke ? null : await createAccount('viewer')
  profile = await mkdtemp(path.join(tmpdir(), 'exlaider-browser-'))
  browser = spawn(executable, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
  let log = ''
  let launchError
  browser.on('error', error => { launchError = error })
  browser.stderr.on('data', chunk => { log += chunk.toString() })
  let port
  for (let attempt = 0; attempt < 100; attempt++) {
    if (launchError) throw launchError
    if (browser.exitCode !== null) throw new Error(`Chromium exited: ${log.slice(-2000)}`)
    try { port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (port) break } catch { /* Chromium is still starting. */ }
    await pause(100)
  }
  if (!port) throw new Error(`Chrome CDP did not start: ${log.slice(-2000)}`)
  const details = await jsonRequest(`http://127.0.0.1:${port}/json/version`)
  socket = new WebSocket(details.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (message.id) {
      const call = calls.get(message.id)
      if (!call) return
      calls.delete(message.id)
      clearTimeout(call.timeout)
      if (message.error) call.reject(new Error(JSON.stringify(message.error)))
      else call.resolve(message.result)
    } else if (message.method === 'Runtime.exceptionThrown') report.pageExceptions.push({ client: sessions.get(message.sessionId), message: message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text })
    else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') report.consoleErrors.push({ client: sessions.get(message.sessionId), message: message.params.args.map(arg => arg.value ?? arg.description ?? '').join(' ') })
  })
  socket.addEventListener('close', () => { for (const call of calls.values()) { clearTimeout(call.timeout); call.reject(new Error('CDP connection closed')) }; calls.clear() })
  desktop = await client('admin desktop')
  mobile = await client('operator mobile', true)
  if (setupSmoke) {
    await check('Unconfigured production app renders a clear Firebase setup screen on desktop and mobile', async () => {
      for (const page of [desktop, mobile]) {
        await page.wait(`document.body.textContent.includes('Conecta EXLAIDER a Firebase')`, 'actual setup screen')
        assert.equal(await page.evaluate(`!!document.querySelector('[role="alert"]') && !qaButton('Añadir producto')`), true)
      }
    })
    await check('Production manifest advertises an installable Spanish standalone app and raster icons', async () => {
      const manifest = await desktop.evaluate(`(async()=>{const link=document.querySelector('link[rel="manifest"]');if(!link)throw new Error('Missing manifest');const response=await fetch(link.href);if(!response.ok)throw new Error('Manifest request failed');return response.json()})()`)
      assert.equal(manifest.display, 'standalone')
      assert.ok(manifest.lang.startsWith('es'))
      for (const size of ['192x192', '512x512']) assert.ok(manifest.icons.some(icon => icon.sizes === size && icon.type === 'image/png'))
    })
    await check('Mobile setup screen has no page-level horizontal overflow', async () => {
      const size = await mobile.evaluate(`({viewport:innerWidth,scroll:document.documentElement.scrollWidth})`)
      assert.ok(size.scroll <= size.viewport + 1, JSON.stringify(size))
    })
    await desktop.screenshot('setup-desktop.png')
    await mobile.screenshot('setup-mobile.png')
    await check('The actual production service worker activates and restores the setup shell offline', async () => {
      await desktop.wait(`navigator.serviceWorker?.controller?.state === 'activated'`, 'production service worker controls page')
      await desktop.request('Network.enable')
      try {
        await desktop.request('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
        await desktop.request('Page.reload')
        await desktop.wait(`document.body.textContent.includes('Conecta EXLAIDER a Firebase')`, 'cached public interface renders offline')
        assert.equal(await desktop.evaluate('navigator.onLine'), false)
      } finally {
        await desktop.request('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
      }
    })
    await check('Setup and offline reload produce no JavaScript exceptions or console errors', async () => { assert.deepEqual(report.pageExceptions, []); assert.deepEqual(report.consoleErrors, []) })
  } else {
  viewerPage = await client('viewer mobile', true)
  await check('Admin, operator and viewer sign in using isolated browser contexts', async () => {
    await desktop.login(admin)
    await mobile.login(operator)
    await viewerPage.login(viewer)
  })
  await check('Operator has stock tools without aggregate inventory values; viewer stays read-only', async () => {
    assert.equal(await mobile.evaluate(`!!qaButton('Añadir producto') && !!qaButton('Escanear QR')`), true)
    assert.equal(await mobile.evaluate(`[...document.querySelectorAll('.stat-label')].some(el=>/valor|costo/i.test(el.textContent))`), false)
    assert.equal(await mobile.evaluate(`['Resumen','Ventas','Compras','Producción','Finanzas','Personal','Usuarios','Auditoría'].some(label=>!!qaButton(label))`), false)
    assert.equal(await viewerPage.evaluate(`!!qaButton('Añadir producto') || !!qaButton('Escanear QR')`), false)
    assert.equal(await viewerPage.evaluate(`[...document.querySelectorAll('.stat-label')].some(el=>/valor/i.test(el.textContent))`), true)
  })
  const product = { name: `Jean QR ${run}`, sku: `QA-QR-${run}`, reference: `QR-${run}`, category: 'Jeans', size: '34', color: 'Negro', lot: 'QR-2026', stock: 3, minStock: 1, price: 125000, description: 'Prenda preparada antes de registrarla.' }
  const qrFile = path.join(directory, 'draft-product-qr.png')
  await mobile.click('Añadir producto')
  await check('Empty product name blocks submission through native form validation', async () => {
    await mobile.submit()
    assert.equal(await mobile.evaluate(`qaControl('Nombre del producto').validity.valueMissing`), true)
    assert.equal(await mobile.evaluate(`!!document.querySelector('[role="dialog"]')`), true)
    assert.equal(await variantBySku(product.sku), null)
  })
  await check('A draft QR includes every entered field and never saves inventory', async () => {
    await fill(mobile, product)
    await mobile.set('Descripción', product.description)
    await mobile.click('Generar QR sin guardar')
    await mobile.wait(`document.querySelector('[aria-label="QR de producto sin registrar"] .qr-image')?.src.startsWith('data:image/png;base64,')`, 'real draft QR raster image')
    const content = await mobile.evaluate(`JSON.parse(document.querySelector('[aria-label="QR de producto sin registrar"] .qr-code pre').textContent)`)
    for (const [key, value] of Object.entries(product)) assert.equal(content[key], value, `QR field ${key}`)
    assert.equal(content.type, 'inventory-product')
    assert.equal(content.currency, 'COP')
    assert.equal('id' in content, false)
    const source = await mobile.evaluate(`document.querySelector('[aria-label="QR de producto sin registrar"] .qr-image').src`)
    await writeFile(qrFile, Buffer.from(source.split(',')[1], 'base64'))
    assert.equal(await variantBySku(product.sku), null)
    assert.equal(await desktop.evaluate(`!!qaRow(${JSON.stringify(product.sku)})`), false)
    await mobile.screenshot('draft-qr-mobile.png')
    await mobile.click('Cancelar')
    await mobile.closed()
  })
  await check('The actual QR image decoder fills the desktop form without registering the draft', async () => {
    await desktop.openScanner(false)
    await desktop.uploadQr(qrFile)
    await desktop.wait(`qaControl('Nombre del producto')?.value === ${JSON.stringify(product.name)}`, 'decoded draft QR form')
    for (const [label, key] of [['Código (SKU)', 'sku'], ['Referencia', 'reference'], ['Talla', 'size'], ['Color', 'color'], ['Lote', 'lot'], ['Stock', 'stock'], ['Precio unitario (COP)', 'price'], ['Descripción', 'description']]) assert.equal(await desktop.evaluate(`qaControl(${JSON.stringify(label)}).value`), String(product[key]))
    assert.equal(await variantBySku(product.sku), null)
    assert.equal(await mobile.evaluate(`!!qaRow(${JSON.stringify(product.sku)})`), false)
  })
  await check('Saving the reviewed draft through Functions updates mobile and viewer without reloading', async () => {
    await desktop.submit()
    await desktop.closed()
    await desktop.stockSku(product.sku, 3)
    await mobile.stockSku(product.sku, 3)
    await viewerPage.stockSku(product.sku, 3)
  })
  await check('Existing QR direct ingress adds exactly one unit to all connected clients', async () => {
    await mobile.openScanner(true)
    await mobile.uploadQr(qrFile)
    await mobile.closed()
    await mobile.stockSku(product.sku, 4)
    await desktop.stockSku(product.sku, 4)
    await viewerPage.stockSku(product.sku, 4)
  })
  await check('Reviewed ingress rejects zero and fractional units, then adds a valid quantity live', async () => {
    await mobile.openScanner(false)
    await mobile.uploadQr(qrFile)
    await mobile.wait(`qaControl('Cantidad de ingreso')`, 'existing QR ingress form')
    for (const quantity of [0, 1.5]) {
      await mobile.set('Cantidad de ingreso', quantity)
      await mobile.submit()
      await mobile.wait(`document.querySelector('[role="dialog"] [role="alert"]')`, 'invalid quantity feedback')
      await desktop.stockSku(product.sku, 4)
    }
    await mobile.set('Cantidad de ingreso', 2)
    await mobile.submit()
    await mobile.closed()
    await desktop.stockSku(product.sku, 6)
    await mobile.stockSku(product.sku, 6)
  })
  const reference = { code: `MULTI-${run}`, name: `Jean variantes ${run}`, category: 'Jeans', description: 'Referencia compartida por varias tallas y colores.', kind: 'finished', unit: 'unidad' }
  const variants = [
    { sku: `QA-AZUL-${run}`, size: '32', color: 'Azul', lot: 'CI-2026', priceCents: 12990000, stock: 6, minStock: 1, unitCostCents: 4000000 },
    { sku: `QA-NEGRO-${run}`, size: '34', color: 'Negro', lot: 'CI-2026', priceCents: 12990000, stock: 4, minStock: 1, unitCostCents: 4200000 },
  ]
  await check('One canonical reference supports distinct color and size stocks in real time', async () => {
    await desktop.click('Varias tallas y colores')
    await desktop.set('Referencia', reference.code)
    await desktop.set('Nombre común del producto', reference.name)
    await desktop.set('Descripción común', reference.description)
    for (const [index, item] of variants.entries()) {
      if (index) await desktop.click('Añadir otra talla / color')
      await desktop.variantFields(index, { sku: item.sku, size: item.size, color: item.color, lot: item.lot, price: item.priceCents / 100, stock: item.stock, minStock: item.minStock, unitCost: item.unitCostCents / 100 })
    }
    await desktop.click('Guardar referencia y variantes')
    await desktop.closed()
    for (const item of variants) {
      await desktop.stockSku(item.sku, item.stock)
      await mobile.stockSku(item.sku, item.stock)
      await viewerPage.stockSku(item.sku, item.stock)
      const row = await mobile.evaluate(`qaRow(${JSON.stringify(item.sku)}).textContent`)
      assert.ok(row.includes(reference.name) && row.includes(item.size) && row.includes(item.color), row)
    }
  })
  await check('Editing a reference updates its common name on every size and color', async () => {
    await desktop.rowClick(variants[0].sku, 'Editar referencia')
    reference.name += ' actualizado'
    await desktop.set('Nombre común del producto', reference.name)
    await desktop.click('Actualizar toda la referencia')
    await desktop.closed()
    for (const item of variants) for (const page of [desktop, mobile, viewerPage]) await page.wait(`qaRow(${JSON.stringify(item.sku)})?.textContent.includes(${JSON.stringify(reference.name)})`, 'shared reference name updated live')
  })
  await check('A reference cannot be reused for a different product name', async () => {
    const conflictingSku = `QA-CONFLICT-${run}`
    await assert.rejects(command(operator, 'catalog.create', { reference: { ...reference, name: `Producto diferente ${run}` }, variants: [{ ...variants[0], sku: conflictingSku, unitCostCents: 0 }] }), /referencia|nombre/i)
    assert.equal(await variantBySku(conflictingSku), null)
    for (const item of variants) await desktop.stockSku(item.sku, item.stock)
  })
  await check('Private acquisition costs are blocked by Firestore rules for operator and viewer', async () => {
    const variant = await variantBySku(variants[0].sku)
    const url = `http://127.0.0.1:8080/v1/projects/${project}/databases/(default)/documents/organizations/${company}/costs/${variant.id}`
    for (const [page, account] of [[mobile, operator], [viewerPage, viewer]]) {
      const status = await page.evaluate(`fetch(${JSON.stringify(url)}, {headers:{Authorization:${JSON.stringify(`Bearer ${account.idToken}`)}}}).then(response=>response.status)`)
      assert.equal(status, 403)
    }
    const document = await jsonRequest(url, { headers: { Authorization: `Bearer ${admin.idToken}` } })
    assert.equal(field(document, 'stockValueCents'), variants[0].stock * variants[0].unitCostCents)
  })
  const materialSku = `QA-TELA-${run}`
  await check('Material inventory is shared with operators and excluded from the viewer catalog', async () => {
    await command(admin, 'catalog.create', { reference: { code: `TELA-${run}`, name: `Tela denim ${run}`, category: 'Insumos', kind: 'material', unit: 'cm' }, variants: [{ sku: materialSku, size: '', color: 'Azul', lot: 'ROLLO-CI', priceCents: 0, stock: 100, minStock: 5, unitCostCents: 1000 }] })
    await desktop.stockSku(materialSku, 100)
    await mobile.stockSku(materialSku, 100)
    assert.equal(await viewerPage.evaluate(`!!qaRow(${JSON.stringify(materialSku)})`), false)
  })
  await check('Admin can open every management area; operators cannot invoke sales commands', async () => {
    for (const [label, heading] of [['Resumen', 'Dirección de la empresa'], ['Ventas', 'Ventas y cartera'], ['Compras', 'Compras y proveedores'], ['Producción', 'Producción y materiales'], ['Finanzas', 'Finanzas y libro de movimientos'], ['Personal', 'Personal y nómina'], ['Usuarios', 'Usuarios y permisos'], ['Auditoría', 'Trazabilidad y auditoría']]) {
      await desktop.click(label)
      await desktop.wait(`document.querySelector('main')?.textContent.includes(${JSON.stringify(heading)})`, `${label} panel renders`)
      assert.equal(await desktop.evaluate(`!!document.querySelector('main [role="alert"]')`), false, label)
    }
    const variant = await variantBySku(variants[0].sku)
    await assert.rejects(command(operator, 'sales.create', { customerName: 'Cliente no autorizado', lines: [{ variantId: variant.id, quantity: 1 }], paidCents: 0 }), /permiso|permission|autorizad/i)
    await desktop.click('Inventario')
    await mobile.stockSku(variants[0].sku, 6)
  })
  await check('An admin sale, partial payment and reversal keep stock synchronized and accounting balanced', async () => {
    const variant = await variantBySku(variants[0].sku)
    await desktop.click('Ventas')
    await desktop.wait(`qaControl('Cliente') && qaControl('Variante 1')`, 'sales form ready')
    await desktop.set('Cliente', `Cliente E2E ${run}`)
    await desktop.set('Variante 1', variant.id)
    await desktop.set('Cantidad 1', 2)
    await desktop.set('Abono inicial (COP)', 50000)
    await desktop.set('Notas de la venta', 'Venta de validación desde el formulario real de la aplicación.')
    await desktop.click('Confirmar venta')
    await desktop.wait(`document.querySelector('main').textContent.includes(${JSON.stringify(`Cliente E2E ${run}`)})`, 'sale visible in live sales panel')
    const sale = (await collection('sales')).find(item => field(item, 'customerName') === `Cliente E2E ${run}`)
    assert.ok(sale, 'The authenticated sales form created a real server record')
    const saleId = sale.name.split('/').at(-1)
    await mobile.stockSku(variants[0].sku, 4)
    await viewerPage.stockSku(variants[0].sku, 4)
    await desktop.evaluate(`(()=>{const summary=[...document.querySelectorAll('summary')].find(el=>el.textContent.trim()===${JSON.stringify(`Venta ${saleId}`)});if(!summary)throw new Error('Missing sale details');summary.click()})()`)
    await desktop.set(`Pago del registro ${saleId} (COP)`, 50000)
    await desktop.click('Confirmar pago')
    await desktop.wait(`qaControl(${JSON.stringify(`Pago del registro ${saleId} (COP)`)}).value === ''`, 'partial payment confirmed')
    const saleDoc = (await collection('sales')).find(item => item.name.endsWith(`/${saleId}`))
    assert.equal(field(saleDoc, 'paidCents'), 10000000)
    await desktop.set(`Motivo de anulación de ${saleId}`, 'Reversión de la venta sintética E2E.')
    await desktop.click('Confirmar anulación')
    await mobile.stockSku(variants[0].sku, 6)
    await viewerPage.stockSku(variants[0].sku, 6)
    const entries = await collection('journals')
    assert.ok(entries.length > 0)
    for (const entry of entries) assert.equal(field(entry, 'debitCents'), field(entry, 'creditCents'), entry.name)
    await desktop.click('Inventario')
    await desktop.stockSku(variants[0].sku, 6)
  })
  await check('Admin migration preserves legacy IDs and printed QR codes without overwriting original records', async () => {
    const legacyId = `browser_legacy_${run}`
    const legacy = { name: `Jean anterior ${run}`, sku: `QA-LEGACY-${run}`, reference: 'Referencia anterior con espacios', category: 'Jeans', description: 'Producto sintético del esquema anterior.', imageUrl: '', size: '30', color: 'Gris', lot: 'LEGACY-CI', price: 50000, stock: 2, minStock: 1, currency: 'COP' }
    const fields = Object.fromEntries(Object.entries(legacy).map(([name, value]) => [name, typeof value === 'number' ? { integerValue: String(value) } : { stringValue: value }]))
    const url = `http://127.0.0.1:8080/v1/projects/${project}/databases/(default)/documents/organizations/${company}/products/${legacyId}`
    await jsonRequest(url, { method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: 'Bearer owner' }, body: JSON.stringify({ fields }) })
    await desktop.wait(`qaButton('Revisar y migrar inventario')`, 'legacy migration review available')
    await mobile.stockSku(legacy.sku, 2)
    await desktop.click('Revisar y migrar inventario')
    await desktop.set(`Referencia de ${legacy.name}`, `LEG-${run}`)
    await desktop.click('Migrar productos seleccionados')
    await desktop.closed()
    await desktop.stockSku(legacy.sku, 2)
    await mobile.stockSku(legacy.sku, 2)
    assert.equal((await variantBySku(legacy.sku)).id, legacyId)
    const legacyQrFile = path.join(directory, 'legacy-printed-qr.png')
    await QRCode.toFile(legacyQrFile, JSON.stringify({ v: 1, type: 'inventory-product', id: legacyId, ...legacy }), { width: 600, margin: 4, errorCorrectionLevel: 'M' })
    await mobile.openScanner(true)
    await mobile.uploadQr(legacyQrFile)
    await mobile.closed()
    await desktop.stockSku(legacy.sku, 3)
    await viewerPage.stockSku(legacy.sku, 3)
    const original = await jsonRequest(url, { headers: { Authorization: 'Bearer owner' } })
    assert.equal(field(original, 'stock'), 2)
    assert.equal(field(original, 'reference'), legacy.reference)
  })
  await desktop.screenshot('erp-inventory-desktop.png')
  await mobile.screenshot('erp-inventory-operator-mobile.png')
  await viewerPage.screenshot('erp-inventory-viewer-mobile.png')
  await check('Desktop and mobile inventories have no page-level horizontal overflow', async () => {
    for (const page of [desktop, mobile, viewerPage]) {
      const size = await page.evaluate(`({viewport:innerWidth,scroll:document.documentElement.scrollWidth})`)
      assert.ok(size.scroll <= size.viewport + 1, `${page.name}: ${JSON.stringify(size)}`)
    }
  })
  await check('Signing up creates pending membership and exposes no inventory or ERP modules', async () => {
    await desktop.click('Cerrar sesión')
    await desktop.wait(`qaControl('Correo electrónico')`, 'signed-out login form')
    await desktop.click('Crear cuenta')
    const email = `pending.${run}@browser.exlaider.test`
    await desktop.set('Correo electrónico', email)
    await desktop.set('Contraseña', password)
    await desktop.submit()
    await desktop.wait(`document.body.textContent.includes('Acceso pendiente de aprobación')`, 'new user awaits admin approval')
    assert.equal(await desktop.evaluate(`!!qaButton('Añadir producto') || !!document.querySelector('table') || !!qaButton('Finanzas')`), false)
    const account = await jsonRequest('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-inventario-key', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) })
    accountsToRemove.push({ uid: account.localId, idToken: account.idToken })
  })
  await check('ERP flows produce no JavaScript exceptions or console errors', async () => {
    assert.deepEqual(report.pageExceptions, [])
    assert.deepEqual(report.consoleErrors, [])
  })
  }
  report.passed = true
} catch (error) {
  report.passed = false
  report.error = error.stack
  console.error(error.stack)
  for (const page of [desktop, mobile, viewerPage].filter(Boolean)) {
    try {
      report[`${page.name} body`] = await page.evaluate('document.body.innerText')
      if (setupSmoke) report[`${page.name} service worker`] = await page.evaluate(`(async()=>({secure:isSecureContext,state:document.readyState,controlled:Boolean(navigator.serviceWorker?.controller),registrations:(await navigator.serviceWorker.getRegistrations()).map(r=>({scope:r.scope,active:r.active?.state,installing:r.installing?.state,waiting:r.waiting?.state})),caches:await caches.keys(),register:await Promise.race([navigator.serviceWorker.register('/sw.js').then(r=>({scope:r.scope,active:r.active?.state,installing:r.installing?.state})).catch(e=>({name:e.name,message:e.message})),new Promise(resolve=>setTimeout(()=>resolve('registration timed out'),3000))])}))()`)
      await page.screenshot(`failure-${page.name.replaceAll(' ', '-')}.png`)
    } catch { /* The original failure may have closed the target. */ }
  }
  process.exitCode = 1
} finally {
  for (const context of contexts) { try { await request('Target.disposeBrowserContext', { browserContextId: context }) } catch { /* Browser teardown must continue if a target already closed. */ } }
  socket?.close()
  if (browser) {
    browser.kill('SIGTERM')
    await Promise.race([new Promise(resolve => browser.once('exit', resolve)), pause(3000)])
    if (browser.exitCode === null && browser.signalCode === null) browser.kill('SIGKILL')
  }
  if (profile) await rm(profile, { recursive: true, force: true })
  // Only synthetic accounts in the fixed demo emulators are removed.
  for (const account of accountsToRemove) {
    try {
      await fetch(`http://127.0.0.1:8080/v1/projects/${project}/databases/(default)/documents/organizations/${company}/members/${account.uid}`, { method: 'DELETE', headers: { Authorization: 'Bearer owner' }, signal: AbortSignal.timeout(5000) })
      await jsonRequest('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:delete?key=demo-inventario-key', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: account.idToken }) })
    } catch (error) { report.cleanupError = error.message }
  }
  await writeFile(path.join(directory, setupSmoke ? 'setup-smoke-report.json' : 'browser-report.json'), `${JSON.stringify(report, null, 2)}\n`)
}
