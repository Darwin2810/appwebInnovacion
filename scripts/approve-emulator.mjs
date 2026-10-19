// Development helper. The host and demo project are fixed deliberately.
// This request targets only the local Firestore emulator, never Firebase cloud.
const [uid, role = 'admin', ...extra] = process.argv.slice(2)
const roles = new Set(['admin', 'operator', 'viewer'])

if (!uid || !/^[A-Za-z0-9_-]{1,128}$/.test(uid) || !roles.has(role) || extra.length) {
  console.error('Uso: node scripts/approve-emulator.mjs UID [admin|operator|viewer]')
  process.exitCode = 1
} else {
  const endpoint = `http://127.0.0.1:8080/v1/projects/demo-inventario/databases/(default)/documents/organizations/exlaider-jeans/members/${uid}`
  try {
    const response = await fetch(endpoint, {
      method: 'PATCH',
      // Firestore Emulator Suite recognizes this local-only administrator marker.
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({ fields: { role: { stringValue: role }, active: { booleanValue: true } } }),
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    console.log(`Miembro de prueba aprobado como ${role} en demo-inventario (solo emulador local).`)
  } catch (error) {
    console.error(`No se pudo aprobar el miembro local: ${error.message}. Inicia npm run emulators y revisa el UID.`)
    process.exitCode = 1
  }
}
