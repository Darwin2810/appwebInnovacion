import { createHash } from 'node:crypto'
import { Timestamp } from 'firebase-admin/firestore'
import { authorize, canonical, fail, key } from './core.js'
import { seedCatalog } from './catalog.js'
import { parseCatalogSheets } from './catalogImport.js'
import { fieldSheets } from './exlaiderFieldData.js'

export const COMPANY = 'exlaider-jeans'
export const CONFIRMATION = 'REINICIALIZAR EXLAIDER-JEANS'
const RESET_ID = 'field-2026-10'
const seedCollections = ['references', 'variants', 'variantSkuIndex', 'variantCombinationIndex', 'costs', 'movements']
export const operationalCollections = [
  ...seedCollections, 'products', 'skuIndex', 'migrations', 'deletions', 'audit',
  'sales', 'salesDesk', 'purchases', 'payments', 'productionBoms', 'productionOrders',
  'journals', 'financeEntries', 'contacts', 'employees', 'employeeDocumentIndex',
  'attendance', 'payroll', 'payrollPeriodIndex', 'commands',
]

const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
const byPath = values => [...values].sort(([a], [b]) => a.localeCompare(b))
const version = snapshot => [snapshot.ref.path, snapshot.updateTime]
const preserveCommand = snapshot => snapshot.get('action') === 'members.save'

function makeSeed(ctx) {
  const { groups, errors } = parseCatalogSheets(fieldSheets)
  if (errors.length) fail('internal', 'Los datos base de EXLAIDER son inválidos.')
  const writes = new Map()
  // Consolidate the stock chain into a single final write per document.
  const plan = {
    set(doc, data, options) {
      const previous = options?.merge ? writes.get(doc.path)?.data : undefined
      writes.set(doc.path, { doc, data: { ...previous, ...data } })
    },
  }
  const summary = { references: 0, variants: 0, entry: 0, exit: 0, stock: 0, historicalMovements: 0, supplies: {} }
  for (const group of groups) {
    const { reference, variants } = group
    seedCatalog(plan, ctx, { reference, variants: variants.map(item => ({ ...item, minStock: Number(item.minStock) })) })
    if (reference.kind === 'material') {
      summary.supplies[reference.code] = { quantity: variants[0].stock, unit: reference.unit }
      continue
    }
    summary.references++
    for (const item of variants) {
      summary.variants++
      summary.entry += item.history.entry
      summary.exit += item.history.exit
      summary.stock += item.stock
      summary.historicalMovements += Number(item.history.entry > 0) + Number(item.history.exit > 0)
    }
  }
  const expected = {
    references: 10, variants: 16, entry: 855, exit: 199, stock: 656, historicalMovements: 32,
    supplies: {
      'IN-BOT-01': { quantity: 1100, unit: 'unidad' },
      'IN-CRE-02': { quantity: 1000, unit: 'unidad' },
      'IN-HIL-03': { quantity: 150, unit: 'm' },
    },
  }
  if (digest(summary) !== digest(expected)) fail('internal', 'Los totales de la base de EXLAIDER no coinciden.')
  return { writes, summary }
}

async function verify(db, org, marker) {
  const receipt = marker.data()
  // Read the state at commit time, even if normal ERP writes have since resumed.
  const readTime = marker.createTime
  const options = Date.now() - readTime.toMillis() < 45_000 ? { readOnly: true, readTime } : { readOnly: true }
  await db.runTransaction(async tx => {
    const [organization, members, ...snapshots] = await Promise.all([
      tx.get(org), tx.get(org.collection('members')),
      ...operationalCollections.map(name => tx.get(org.collection(name))),
    ])
    const seeded = []
    const retained = [version(organization), ...members.docs.map(version)]
    for (let i = 0; i < snapshots.length; i++) {
      const name = operationalCollections[i]
      for (const doc of snapshots[i].docs) {
        if (seedCollections.includes(name)) seeded.push([doc.ref.path, doc.data()])
        else if (name === 'commands' && preserveCommand(doc)) retained.push(version(doc))
        else fail('data-loss', 'La validación encontró datos operativos anteriores.')
      }
    }
    if (digest(byPath(seeded)) !== receipt.seedDigest || digest(byPath(retained)) !== receipt.retainedDigest) {
      fail('data-loss', 'La validación no pudo confirmar la carga y la preservación de la organización y sus miembros.')
    }
  }, options)
  await marker.ref.update({ validated: true })
}

export async function reinitializeExlaider(db, uid, input) {
  if (!uid) fail('unauthenticated', 'Inicia sesión para continuar.')
  key(uid, 'Usuario')
  if (input?.companyId !== COMPANY) fail('permission-denied', 'La reinicialización solo está habilitada para EXLAIDER.')
  const org = db.collection('organizations').doc(COMPANY)
  const memberRef = org.collection('members').doc(uid)
  const markerRef = org.collection('_maintenance').doc(RESET_ID)
  const replayed = await db.runTransaction(async tx => {
    const [member, marker, organization] = await tx.getAll(memberRef, markerRef, org)
    authorize(member, ['admin'])
    if (input.confirmation !== CONFIRMATION) fail('invalid-argument', 'La frase de confirmación debe coincidir exactamente.')
    if (!organization.exists) fail('failed-precondition', 'La organización de EXLAIDER debe existir.')
    if (marker.exists) return true

    const { writes, summary } = makeSeed({ org, uid, role: 'admin', now: Timestamp.now() })
    const [members, ...snapshots] = await Promise.all([
      tx.get(org.collection('members').select()),
      ...operationalCollections.map(name => tx.get(org.collection(name).select(...(name === 'commands' ? ['action'] : [])))),
    ])
    const retained = [version(organization), ...members.docs.map(version)]
    let removed = 0
    for (const [index, snapshot] of snapshots.entries()) {
      for (const doc of snapshot.docs) {
        if (operationalCollections[index] === 'commands' && preserveCommand(doc)) {
          retained.push(version(doc))
          continue
        }
        if (!writes.has(doc.ref.path)) tx.delete(doc.ref)
        removed++
      }
    }
    for (const { doc, data } of writes.values()) tx.set(doc, data)
    tx.create(markerRef, {
      summary: { ...summary, removed, members: members.size },
      seedDigest: digest(byPath([...writes].map(([path, item]) => [path, item.data]))),
      retainedDigest: digest(byPath(retained)),
      actor: uid, validated: false,
    })
    return false
  })
  const marker = await markerRef.get()
  const receipt = marker.data()
  if (!receipt.validated) await verify(db, org, marker)
  return { ...receipt.summary, validated: true, replayed }
}
