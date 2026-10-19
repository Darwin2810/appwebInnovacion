import { useEffect, useState } from 'react'
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { firebaseState } from '../lib/firebase.js'

const empty = { uid: null, products: [], loading: false, error: '', fromCache: false, pendingWrites: false }

export function useProducts(user) {
  const uid = user?.uid || null
  const [state, setState] = useState(empty)
  useEffect(() => {
    if (!uid || !firebaseState.configured) return undefined
    let live = true
    const source = query(collection(firebaseState.db, 'organizations', firebaseState.companyId, 'products'), orderBy('name'))
    const stop = onSnapshot(source, { includeMetadataChanges: true }, (snapshot) => {
      if (!live) return
      setState({ uid, products: snapshot.docs.map((item) => ({ id: item.id, ...item.data() })), loading: false, error: '', fromCache: snapshot.metadata.fromCache, pendingWrites: snapshot.metadata.hasPendingWrites })
    }, (error) => {
      if (!live) return
      setState({ ...empty, uid, error: error.code === 'permission-denied' ? 'Tu cuenta no tiene acceso al inventario de esta empresa.' : 'No se pudo conectar con el inventario. Revisa tu conexión y Firebase.' })
    })
    return () => { live = false; stop() }
  }, [uid])
  if (!uid) return empty
  if (state.uid !== uid) return { ...empty, loading: firebaseState.configured, error: firebaseState.error }
  return state
}
