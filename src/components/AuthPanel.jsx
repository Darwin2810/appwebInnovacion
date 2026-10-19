import { useState } from 'react'

export default function AuthPanel({ signIn, signUp, error }) {
  const [signup, setSignup] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function submit(event) {
    event.preventDefault(); setMessage(''); setBusy(true)
    const data = new FormData(event.currentTarget)
    try { await (signup ? signUp : signIn)(data.get('email').trim(), data.get('password')) }
    catch (err) { setMessage(err.message || 'No se pudo completar el acceso.') }
    finally { setBusy(false) }
  }
  return <section className="auth-card">
    <p className="eyebrow">EXLAIDER JEANS SAS</p><h1>Tu inventario, conectado</h1><p>Consulta y registra prendas desde el computador o el celular.</p>
    <div className="auth-tabs"><button className={!signup ? 'primary-button' : 'secondary-button'} onClick={() => setSignup(false)}>Iniciar sesión</button><button className={signup ? 'primary-button' : 'secondary-button'} onClick={() => setSignup(true)}>Crear cuenta</button></div>
    <form onSubmit={submit}>
      <div className="form-field"><label htmlFor="email">Correo electrónico</label><input id="email" name="email" type="email" autoComplete="email" required /></div>
      <div className="form-field"><label htmlFor="password">Contraseña</label><input id="password" name="password" type="password" autoComplete={signup ? 'new-password' : 'current-password'} minLength={8} required /></div>
      {signup && <p className="storage-note">Después del registro, un administrador debe autorizar tu acceso a la empresa.</p>}
      {(message || error) && <p className="feedback is-error" role="alert">{message || error?.message || error}</p>}
      <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Procesando…' : signup ? 'Crear cuenta' : 'Iniciar sesión'}</button>
    </form>
  </section>
}
