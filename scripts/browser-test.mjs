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
const report = { environment: setupSmoke ? 'Unconfigured production setup and PWA only; no cloud integration exercised' : 'Firebase emulators; two isolated Chromium clients, admin and operator', appUrl, project, checks: [], consoleErrors: [], pageExceptions: [] }
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
  const account = { email, uid: result.localId, idToken: result.idToken }
  accountsToRemove.push(account)
  await jsonRequest(`http://127.0.0.1:8080/v1/projects/${project}/databases/(default)/documents/organizations/${company}/members/${account.uid}`, { method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: 'Bearer owner' }, body: JSON.stringify({ fields: { role: { stringValue: role }, active: { booleanValue: true } } }) })
  return account
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
  window.qaControl = label => [...document.querySelectorAll('input,select,textarea')].find(el => el.getAttribute('aria-label') === label || [...(el.labels || [])].some(l => l.textContent.trim().replace(/\\s*\\*$/, '') === label));
  window.qaButton = text => [...document.querySelectorAll('button')].find(el => el.getAttribute('aria-label') === text || el.textContent.replace(/\\s+/g, ' ').trim() === text);
  window.qaSet = (label,value) => {const el=qaControl(label);if(!el)throw new Error('Missing control '+label);const prototype=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(el,value);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));};
  window.qaClick = text => {const el=qaButton(text);if(!el)throw new Error('Missing button '+text);if(el.disabled)throw new Error('Disabled button '+text);el.click();};
  window.qaStock = name => {const row=qaButton('Ver QR de '+name)?.closest('tr');const text=row?.querySelector('.stock-badge')?.textContent;if(!text)return null;return Number(text.split('·')[0].trim().replaceAll('.',''));};
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
    await this.wait(`qaButton('Añadir producto') && !qaButton('Añadir producto').disabled && qaButton('Escanear QR') && !qaButton('Escanear QR').disabled`, 'approved company inventory and active Firestore listener')
  }
  async stock(name, expected) { await this.wait(`qaStock(${JSON.stringify(name)}) === ${expected}`, `${name} stock = ${expected}`) }
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
try {
  const executable = await chromeExecutable()
  const admin = setupSmoke ? null : await createAccount('admin')
  const operator = setupSmoke ? null : await createAccount('operator')
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
        await page.wait(`document.body.textContent.includes('Conecta tu inventario a Firebase')`, 'actual setup screen')
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
        await desktop.wait(`document.body.textContent.includes('Conecta tu inventario a Firebase')`, 'cached public interface renders offline')
        assert.equal(await desktop.evaluate('navigator.onLine'), false)
      } finally {
        await desktop.request('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
      }
    })
    await check('Setup and offline reload produce no JavaScript exceptions or console errors', async () => { assert.deepEqual(report.pageExceptions, []); assert.deepEqual(report.consoleErrors, []) })
  } else {
  await check('Two different approved users sign in with email and password', async () => { await desktop.login(admin); await mobile.login(operator) })
  await check('Operator can register products and stock but has no delete controls', async () => {
    assert.equal(await mobile.evaluate(`!!qaButton('Añadir producto') && !!qaButton('Escanear QR')`), true)
    assert.equal(await mobile.evaluate(`[...document.querySelectorAll('button')].some(el=>el.getAttribute('aria-label')?.startsWith('Eliminar '))`), false)
  })
  const product = { name: `Jean sincronizado ${run}`, sku: `QA-SYNC-${run}`, reference: 'Cargo urbano', category: 'Jeans', size: '32', color: 'Azul', lot: 'CI-2026', stock: 5, minStock: 2, price: 99000 }
  await mobile.click('Añadir producto')
  await check('Empty product name blocks submission through native required-field validation', async () => {
    await mobile.submit()
    assert.equal(await mobile.evaluate(`qaControl('Nombre del producto').validity.valueMissing`), true)
    assert.equal(await mobile.evaluate(`Boolean(qaControl('Nombre del producto').validationMessage)`), true)
    assert.equal(await mobile.evaluate(`!!document.querySelector('[role="dialog"]')`), true)
    assert.equal(await mobile.hasProduct(product.name), false)
  })
  await check('A mobile product appears live on desktop without reload', async () => {
    await fill(mobile, product)
    await mobile.submit()
    await mobile.closed()
    await mobile.stock(product.name, 5)
    await desktop.stock(product.name, 5)
  })
  await check('Desktop editing preserves read-only stock and updates mobile live', async () => {
    await desktop.click(`Editar ${product.name}`)
    assert.equal(await desktop.evaluate(`qaControl('Stock').readOnly`), true)
    product.name += ' editado'
    await desktop.set('Nombre del producto', product.name)
    await desktop.submit()
    await desktop.closed()
    await desktop.stock(product.name, 5)
    await mobile.stock(product.name, 5)
  })
  await check('Invalid stock ingress rejects zero and fractional units', async () => {
    await mobile.click(`Ingresar stock de ${product.name}`)
    for (const quantity of [0, 1.5]) {
      await mobile.set('Cantidad de ingreso', quantity)
      await mobile.submit()
      await mobile.wait(`document.querySelector('[role="dialog"] [role="alert"]')`, 'invalid ingress error')
      await desktop.stock(product.name, 5)
    }
  })
  await check('Operator stock ingress synchronizes the positive quantity on both clients', async () => {
    await mobile.set('Cantidad de ingreso', 3)
    await mobile.submit()
    await mobile.closed()
    await mobile.stock(product.name, 8)
    await desktop.stock(product.name, 8)
  })
  await check('Duplicate SKU differing only by case is rejected without another row', async () => {
    await desktop.click('Añadir producto')
    const duplicate = { ...product, name: `Duplicado ${run}`, sku: product.sku.toLowerCase() }
    await fill(desktop, duplicate)
    await desktop.submit()
    await desktop.wait(`document.querySelector('[role="dialog"] [role="alert"]')?.textContent.includes('Ya existe')`, 'server-backed SKU uniqueness error')
    assert.equal(await mobile.hasProduct(duplicate.name), false)
    await desktop.click('Cancelar')
  })
  const qrProduct = { v: 1, type: 'inventory-product', name: `Jean QR ${run}`, sku: `QA-QR-${run}`, reference: 'Recto clásico', category: 'Jeans', size: '34', color: 'Negro', lot: 'QR-2026', stock: 3, minStock: 1, price: 125000, currency: 'COP' }
  const qrFile = path.join(directory, 'product-qr.png')
  await QRCode.toFile(qrFile, JSON.stringify(qrProduct), { width: 600, margin: 4, errorCorrectionLevel: 'M' })
  await check('The real image decoder prefills a new product and does not save automatically', async () => {
    await mobile.openScanner()
    await mobile.uploadQr(qrFile)
    await mobile.wait(`qaControl('Nombre del producto')?.value === ${JSON.stringify(qrProduct.name)}`, 'decoded QR product form')
    for (const [label, key] of [['Código (SKU)', 'sku'], ['Referencia', 'reference'], ['Talla', 'size'], ['Color', 'color'], ['Lote', 'lot'], ['Stock', 'stock'], ['Precio unitario (COP)', 'price']]) assert.equal(await mobile.evaluate(`qaControl(${JSON.stringify(label)}).value`), String(qrProduct[key]))
    assert.equal(await desktop.hasProduct(qrProduct.name), false)
  })
  await check('Saving the reviewed QR product updates the other user live', async () => {
    await mobile.submit()
    await mobile.closed()
    await mobile.stock(qrProduct.name, 3)
    await desktop.stock(qrProduct.name, 3)
  })
  await check('An existing QR with automatic ingress adds exactly one unit without a creation form', async () => {
    await mobile.openScanner(true)
    await mobile.uploadQr(qrFile)
    await mobile.stock(qrProduct.name, 4)
    await desktop.stock(qrProduct.name, 4)
    assert.equal(await mobile.evaluate(`!!qaControl('Nombre del producto')`), false)
    await mobile.closed()
  })
  await check('An existing QR without automatic ingress requires a reviewed quantity', async () => {
    await mobile.openScanner(false)
    await mobile.uploadQr(qrFile)
    await mobile.wait(`qaControl('Cantidad de ingreso')`, 'decoded existing QR opens ingress form')
    await desktop.stock(qrProduct.name, 4)
    await mobile.set('Cantidad de ingreso', 2)
    await mobile.submit()
    await mobile.closed()
    await desktop.stock(qrProduct.name, 6)
    await mobile.stock(qrProduct.name, 6)
  })
  await desktop.screenshot('inventory-desktop.png')
  await mobile.screenshot('inventory-mobile.png')
  await check('Mobile page has no horizontal overflow outside the table', async () => {
    const size = await mobile.evaluate(`({viewport:innerWidth,scroll:document.documentElement.scrollWidth})`)
    assert.ok(size.scroll <= size.viewport + 1, JSON.stringify(size))
  })
  await check('Admin deletion cancellation preserves data; confirmation removes it from both clients live', async () => {
    await desktop.click(`Eliminar ${product.name}`)
    await desktop.click('Cancelar')
    await mobile.stock(product.name, 8)
    for (const item of [product, qrProduct]) {
      await desktop.click(`Eliminar ${item.name}`)
      await desktop.click('Eliminar producto')
      await desktop.closed()
      await desktop.wait(`!qaButton(${JSON.stringify(`Ver QR de ${item.name}`)})`, 'admin deletion')
      await mobile.wait(`!qaButton(${JSON.stringify(`Ver QR de ${item.name}`)})`, 'operator listener receives deletion')
    }
  })
  await check('Signing up creates an account with pending access and no inventory permissions', async () => {
    await desktop.click('Cerrar sesión')
    await desktop.wait(`qaControl('Correo electrónico')`, 'signed-out login form')
    await desktop.click('Crear cuenta')
    const email = `pending.${run}@browser.exlaider.test`
    await desktop.set('Correo electrónico', email)
    await desktop.set('Contraseña', password)
    await desktop.submit()
    await desktop.wait(`document.body.textContent.includes('Acceso pendiente de aprobación')`, 'new user awaits admin approval')
    assert.equal(await desktop.evaluate(`!!qaButton('Añadir producto') || !!document.querySelector('table')`), false)
    const account = await jsonRequest('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-inventario-key', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) })
    accountsToRemove.push({ uid: account.localId, idToken: account.idToken })
  })
  await check('No browser JavaScript exceptions or console errors', async () => { assert.deepEqual(report.pageExceptions, []); assert.deepEqual(report.consoleErrors, []) })
  }
  report.passed = true
} catch (error) {
  report.passed = false
  report.error = error.stack
  console.error(error.stack)
  for (const page of [desktop, mobile].filter(Boolean)) {
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
