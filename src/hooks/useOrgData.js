import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { firebaseState } from '../lib/firebase.js'

const privateCollections = ['costs', 'sales', 'purchases', 'productionBoms', 'productionOrders', 'employees', 'attendance', 'payroll', 'journals', 'payments', 'financeEntries', 'members', 'audit', 'contacts']
const allCollections = ['references', 'variants', 'legacyProducts', 'movements', ...privateCollections]
const blank = Object.fromEntries(allCollections.map(name => [name, []]))
const identity = (uid, role) => uid && role ? `${uid}:${role}` : ''
export function useOrgData(user, member) {
  const uid = user?.uid, role = member?.role
  const session = identity(uid, role)
  const [state, setState] = useState({ session: '', records: blank, ready: {}, cache: {}, errors: {} })
  useEffect(() => {
    if (!session || !firebaseState.configured) return undefined
    let live = true
    const names = ['references', 'variants', 'legacyProducts', ...(['admin', 'operator'].includes(role) ? ['movements'] : []), ...(role === 'admin' ? privateCollections : [])]
    const stops = names.map(name => {
      let source = collection(firebaseState.db, 'organizations', firebaseState.companyId, name === 'legacyProducts' ? 'products' : name)
      if (role === 'viewer' && ['references', 'variants'].includes(name)) source = query(source, where('kind', '==', 'finished'))
      const update = changes => {
        if (!live) return
        setState(previous => {
          const base = previous.session === session ? previous : { session, records: blank, ready: {}, cache: {}, errors: {} }
          return { ...base, ...changes(base) }
        })
      }
      return onSnapshot(source, { includeMetadataChanges: true }, snapshot => update(base => ({
        records: { ...base.records, [name]: snapshot.docs.map(item => ({ ...item.data(), id: item.id })) },
        ready: { ...base.ready, [name]: true }, cache: { ...base.cache, [name]: snapshot.metadata.fromCache }, errors: { ...base.errors, [name]: '' },
      })), error => update(base => ({
        records: { ...base.records, [name]: [] }, ready: { ...base.ready, [name]: true },
        errors: { ...base.errors, [name]: error.code === 'permission-denied' ? `No tienes acceso a ${name}. Revisa los permisos y las reglas publicadas.` : `No se pudo sincronizar ${name}. Revisa la conexión.` },
      })))
    })
    return () => { live = false; stops.forEach(stop => stop()) }
  }, [session, role])
  return useMemo(() => {
    const current = state.session === session && session ? state : { records: blank, ready: {}, cache: {}, errors: {} }
    const records = current.records
    const references = new Map(records.references.map(item => [item.id, item]))
    const variants = new Set(records.variants.map(item => item.id))
    const migrated = records.variants.filter(item => item.active !== false && references.has(item.referenceKey)).map(item => {
      const header = references.get(item.referenceKey)
      return { ...item, name: header.name, reference: header.code, category: header.category, description: header.description, imageUrl: header.imageUrl, kind: header.kind, unit: header.unit, price: item.priceCents / 100, currency: 'COP', legacy: false }
    })
    const legacy = records.legacyProducts.filter(item => !variants.has(item.id) && item.kind !== 'material').map(item => ({ ...item, kind: 'finished', unit: 'unidad', legacy: true }))
    const products = [...migrated, ...legacy].sort((a, b) => String(a.name).localeCompare(String(b.name), 'es') || String(a.sku).localeCompare(String(b.sku), 'es'))
    return { ...records, products, legacyProducts: legacy, loading: Boolean(session) && ['references', 'variants', 'legacyProducts'].some(name => !current.ready[name]), privateLoading: role === 'admin' && privateCollections.some(name => !current.ready[name] || current.cache[name] !== false), fromCache: ['references', 'variants', 'legacyProducts'].some(name => current.cache[name] !== false), error: Object.values(current.errors).filter(Boolean).join(' '), pendingWrites: false }
  }, [state, session, role])
}
