import test from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import { enqueueOfflineCommand, listOfflineCommands, offlineActionAllowed, offlineActionLabel, syncOfflineCommands } from '../src/lib/offlineQueue.js'

test('solo permite offline operaciones capturables y respeta los roles', () => {
  assert.equal(offlineActionAllowed('stock.receive', 'operator'), true)
  assert.equal(offlineActionAllowed('stock.receive', 'viewer'), false)
  assert.equal(offlineActionAllowed('stock.adjust', 'admin'), true)
  assert.equal(offlineActionAllowed('stock.adjust', 'operator'), false)
  assert.equal(offlineActionAllowed('sales.create', 'seller'), true)
  assert.equal(offlineActionAllowed('sales.create', 'admin'), true)
  for (const sensitive of ['members.save', 'catalog.delete', 'finance.entry', 'sales.pay', 'purchases.create']) assert.equal(offlineActionAllowed(sensitive, 'admin'), false)
  assert.equal(offlineActionLabel('sales.create'), 'Venta')
})

test('cifra el contenido, conserva el requestId y sincroniza exactamente una vez', async () => {
  const scope = { companyId: 'test-company', uid: 'user-1', role: 'operator' }
  const requestId = 'offline-test-request'
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true })
  const queued = await enqueueOfflineCommand(scope, 'stock.receive', { variantId: 'variant-1', quantity: 7, reason: 'Conteo offline' }, requestId)
  assert.deepEqual(queued, { id: requestId, queued: true })
  const [stored] = await listOfflineCommands(scope)
  assert.equal(stored.status, 'pending')
  assert.equal(stored.action, 'stock.receive')
  assert.equal(Object.hasOwn(stored, 'payload'), false, 'El contenido no queda en texto plano')
  assert.ok(stored.ciphertext instanceof ArrayBuffer)

  const received = []
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true })
  assert.deepEqual(await syncOfflineCommands(scope, async (action, payload, id) => received.push({ action, payload, id })), { synced: 1, failed: 0 })
  assert.deepEqual(received, [{ action: 'stock.receive', payload: { variantId: 'variant-1', quantity: 7, reason: 'Conteo offline' }, id: requestId }])
  assert.equal((await listOfflineCommands(scope))[0].status, 'synced')
  assert.deepEqual(await syncOfflineCommands(scope, async () => { throw new Error('No debe repetirse') }), { synced: 0, failed: 0 })
})

test('conserva para revisión una operación rechazada por el servidor', async () => {
  const scope = { companyId: 'conflict-company', uid: 'user-2', role: 'admin' }
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true })
  await enqueueOfflineCommand(scope, 'stock.adjust', { variantId: 'variant-2', quantity: 2, reason: 'Inventario físico' }, 'offline-conflict-request')

  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true })
  const error = new Error('El stock cambió mientras estabas sin conexión.')
  error.code = 'functions/failed-precondition'
  assert.deepEqual(await syncOfflineCommands(scope, async () => { throw error }), { synced: 0, failed: 1 })

  const [stored] = await listOfflineCommands(scope)
  assert.equal(stored.status, 'failed')
  assert.equal(stored.lastError, error.message)
})
