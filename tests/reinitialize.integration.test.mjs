import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { withCommand } from '../functions/lib/core.js'
import { handlers } from '../functions/lib/catalog.js'
import { COMPANY, CONFIRMATION, operationalCollections, reinitializeExlaider, correctInitialSupplyDates } from '../functions/lib/reinitialize.js'

const requireFunctions = createRequire(new URL('../functions/package.json', import.meta.url))

test('reinicializa EXLAIDER una vez, conserva cuentas y reemplaza los datos operativos', {
  skip: !process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST,
}, async () => {
  const { initializeApp, deleteApp } = requireFunctions('firebase-admin/app')
  const { getFirestore } = requireFunctions('firebase-admin/firestore')
  const { getAuth } = requireFunctions('firebase-admin/auth')
  const app = initializeApp({ projectId: 'demo-inventario' }, 'reset-test')
  const db = getFirestore(app)
  const auth = getAuth(app)
  const org = db.collection('organizations').doc(COMPANY)
  const input = { companyId: COMPANY, confirmation: CONFIRMATION }
  const reset = (uid = 'reset-admin', data = input) => reinitializeExlaider(db, uid, data)
  const rows = name => org.collection(name).get().then(s => s.docs)
  const company = { name: 'EXLAIDER', settings: { flag: true } }
  const roles = {
    'reset-admin': { role: 'admin', active: true, name: 'Administradora' },
    'reset-operator': { role: 'operator', active: true },
    'reset-seller': { role: 'seller', active: true },
    'reset-viewer': { role: 'viewer', active: true },
    'reset-disabled': { role: 'admin', active: false },
  }
  try {
    await org.set(company)
    for (const [uid, member] of Object.entries(roles)) {
      await auth.createUser({ uid, email: `${uid}@example.com` })
      await org.collection('members').doc(uid).set(member)
    }
    await org.collection('commands').doc('member-save').set({ action: 'members.save' })
    await org.collection('settings').doc('retained').set({ enabled: true })
    const otherOrg = db.collection('organizations').doc('reset-other')
    await otherOrg.collection('variants').doc('retained').set({ stock: 10 })
    await Promise.all(operationalCollections.map(name => org.collection(name).doc('old').set({ old: true })))

    await assert.rejects(reset(null), { code: 'unauthenticated' })
    for (const uid of [...Object.keys(roles).filter(uid => uid !== 'reset-admin'), 'missing']) {
      await assert.rejects(reset(uid), { code: 'permission-denied' })
    }
    await assert.rejects(reset('reset-admin', { ...input, companyId: 'reset-other' }), { code: 'permission-denied' })
    await assert.rejects(reset('reset-admin', { ...input, confirmation: CONFIRMATION + ' ' }), { code: 'invalid-argument' })
    assert.equal((await rows('variants'))[0].id, 'old')

    const results = await Promise.all([reset(), reset()])
    assert.deepEqual(results.map(result => result.replayed).sort(), [false, true])
    for (const result of results) {
      assert.equal(result.validated, true)
      assert.equal(result.entry, 855)
      assert.equal(result.exit, 199)
      assert.equal(result.stock, 656)
      assert.equal(result.historicalMovements, 32)
      assert.equal(result.removed, operationalCollections.length)
    }

    assert.deepEqual((await org.get()).data(), company)
    assert.deepEqual(Object.fromEntries((await rows('members')).map(doc => [doc.id, doc.data()])), roles)
    for (const uid of Object.keys(roles)) assert.equal((await auth.getUser(uid)).email, `${uid}@example.com`)
    assert.equal((await otherOrg.collection('variants').doc('retained').get()).get('stock'), 10)
    assert.equal((await org.collection('settings').doc('retained').get()).get('enabled'), true)
    assert.deepEqual((await rows('commands')).map(doc => doc.id), ['member-save'])

    const variants = await rows('variants')
    const references = await rows('references')
    assert.equal(references.length, 13)
    assert.equal(variants.length, 19)
    const garments = variants.filter(doc => doc.get('kind') === 'finished')
    assert.equal(garments.reduce((sum, doc) => sum + doc.get('stock'), 0), 656)
    const movements = (await rows('movements')).map(doc => doc.data())
    const historical = movements.filter(row => row.sourceType === 'field_entry' || row.sourceType === 'field_exit')
    assert.equal(historical.length, 32)
    assert.equal(movements.length, 35)
    assert.equal(historical.filter(row => row.delta > 0).reduce((sum, row) => sum + row.delta, 0), 855)
    assert.equal(historical.filter(row => row.delta < 0).reduce((sum, row) => sum - row.delta, 0), 199)
    for (const garment of garments) {
      const [entry, exit] = historical.filter(row => row.variantId === garment.id).sort((a, b) => b.delta - a.delta)
      assert.equal(entry.date, exit.date)
      assert.ok(['2026-10-23', '2026-10-24'].includes(entry.date))
      assert.equal(entry.stockBefore, 0)
      assert.equal(exit.stockBefore, entry.stockAfter)
      assert.equal(exit.stockAfter, garment.get('stock'))
      assert.equal(garment.get('fieldReconciliation.date'), entry.date)
    }
    assert.equal(historical.filter(row => row.date === '2026-10-23').length, 14)
    const sample = garments.find(doc => doc.get('referenceKey') === 'r_1005' && doc.get('size') === '32')
    assert.equal(sample.get('stock'), 24)
    assert.equal(sample.get('fieldReconciliation.paperCount'), 14)
    assert.equal(sample.get('fieldReconciliation.prototypeCount'), 24)
    for (const [code, quantity, unit] of [['IN-BOT-01', 1100, 'unidad'], ['IN-CRE-02', 1000, 'unidad'], ['IN-HIL-03', 150, 'm']]) {
      const material = references.find(doc => doc.get('code') === code)
      assert.equal(material.get('unit'), unit)
      assert.equal(variants.find(doc => doc.get('referenceKey') === material.id).get('stock'), quantity)
    }
    assert.equal((await rows('variantSkuIndex')).length, 19)
    assert.equal((await rows('variantCombinationIndex')).length, 19)
    for (const name of operationalCollections) assert.equal((await org.collection(name).doc('old').get()).exists, false)

    const correctDates = uid => withCommand(db, uid, {
      companyId: COMPANY, action: 'maintenance.correctSupplyDates', requestId: randomUUID(),
    }, { 'maintenance.correctSupplyDates': correctInitialSupplyDates })
    await assert.rejects(correctDates('reset-operator'), { code: 'permission-denied' })
    const beforeCorrection = new Map((await rows('movements')).map(doc => [doc.id, doc.data()]))
    const correction = await correctDates('reset-admin')
    assert.equal(correction.updated, 3)
    assert.equal(correction.date, '2026-10-23')
    for (const doc of await rows('movements')) {
      const before = beforeCorrection.get(doc.id)
      assert.deepEqual(doc.data(), before.sourceType === 'catalog_initial' ? { ...before, date: '2026-10-23' } : before)
    }
    assert.equal((await correctDates('reset-admin')).updated, 0)

    await org.collection('sales').doc('post-reset').set({ retained: true })
    assert.equal((await reset()).replayed, true)
    assert.equal((await org.collection('sales').doc('post-reset').get()).get('retained'), true)

    const reference = { code: 'FIELD-IMPORT', name: 'Importación de prueba' }
    const history = { date: '2026-10-24', entry: 10, exit: 3, paperCount: 9, prototypeCount: 6 }
    const importField = stock => withCommand(db, 'reset-admin', {
      companyId: COMPANY, action: 'catalog.create', requestId: randomUUID(),
      payload: { reference, variants: [{ size: '30', stock, history }] },
    }, handlers)
    await assert.rejects(importField(9), { code: 'invalid-argument' })
    const imported = await importField(7)
    const fieldMovements = (await rows('movements')).map(doc => doc.data())
      .filter(row => row.variantId === imported.variantIds[0]).sort((a, b) => b.delta - a.delta)
    assert.deepEqual(fieldMovements.map(row => [row.date, row.delta]), [['2026-10-24', 10], ['2026-10-24', -3]])
  } finally {
    await deleteApp(app)
  }
})
