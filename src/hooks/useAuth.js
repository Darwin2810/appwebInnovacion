import { useCallback, useEffect, useState } from 'react'
import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut as firebaseSignOut } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { firebaseState } from '../lib/firebase.js'

function authMessage(error) {
  const messages = {
    'auth/invalid-credential': 'El correo o la contraseña no son correctos.',
    'auth/invalid-email': 'Introduce un correo válido.',
    'auth/email-already-in-use': 'Este correo ya tiene una cuenta. Inicia sesión.',
    'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
    'auth/too-many-requests': 'Hay demasiados intentos. Espera un momento y vuelve a intentarlo.',
    'auth/network-request-failed': 'No se pudo conectar. Comprueba tu conexión.',
    'auth/operation-not-allowed': 'Activa el proveedor correo y contraseña en Firebase Authentication.',
  }
  return messages[error?.code] || 'No se pudo completar la autenticación. Revisa la configuración de Firebase.'
}

export function useAuth() {
  const [state, setState] = useState({ user: null, member: null, loading: firebaseState.configured, membershipLoading: false, error: firebaseState.error })
  useEffect(() => {
    if (!firebaseState.configured) return undefined
    let stopMember = null
    let live = true
    let currentUid = null
    const stopAuth = onAuthStateChanged(firebaseState.auth, (user) => {
      stopMember?.()
      currentUid = user?.uid || null
      if (!live) return
      setState({ user, member: null, loading: false, membershipLoading: Boolean(user), error: '' })
      if (!user) return
      stopMember = onSnapshot(doc(firebaseState.db, 'organizations', firebaseState.companyId, 'members', user.uid), (snapshot) => {
        if (!live || currentUid !== user.uid) return
        const value = snapshot.exists() ? snapshot.data() : null
        const member = value?.active === true && ['admin', 'operator', 'viewer'].includes(value.role) ? value : null
        setState((current) => ({ ...current, member, membershipLoading: false, error: '' }))
      }, () => {
        if (!live || currentUid !== user.uid) return
        setState((current) => ({ ...current, member: null, membershipLoading: false, error: 'No se pudo comprobar el acceso a la empresa. Revisa las reglas de Firestore y tu conexión.' }))
      })
    }, (error) => {
      if (live) setState({ user: null, member: null, loading: false, membershipLoading: false, error: authMessage(error) })
    })
    return () => { live = false; stopMember?.(); stopAuth() }
  }, [])

  const execute = useCallback(async (operation) => {
    if (!firebaseState.configured) throw new Error(firebaseState.error)
    setState((current) => ({ ...current, error: '' }))
    try { return await operation() } catch (error) {
      const message = authMessage(error)
      setState((current) => ({ ...current, error: message }))
      throw new Error(message)
    }
  }, [])
  const signIn = useCallback((email, password) => execute(() => signInWithEmailAndPassword(firebaseState.auth, email.trim(), password)), [execute])
  const signUp = useCallback((email, password) => execute(() => createUserWithEmailAndPassword(firebaseState.auth, email.trim(), password)), [execute])
  const signOut = useCallback(() => execute(() => firebaseSignOut(firebaseState.auth)), [execute])
  return { ...state, signIn, signUp, signOut }
}
