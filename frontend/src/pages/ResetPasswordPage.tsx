import { CheckCircle2 } from 'lucide-react'
import { FormEvent, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api'

/**
 * Landing page for the emailed reset link (/reset-password?token=…).
 * Confirms the new password against /auth/password-reset/confirm/ and then
 * sends the user to sign in. Without this route the emailed link was a dead end.
 */
export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password !== confirm) {
      setError('Both passwords must match.')
      return
    }
    setBusy(true)
    try {
      await api.post('/auth/password-reset/confirm/', { token, password })
      setDone(true)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not reset the password. The link may have expired — request a new one.',
      )
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="shell py-16">
        <div className="mx-auto max-w-sm">
          <div className="card p-6 text-center" role="status">
            <CheckCircle2 size={22} className="mx-auto text-accent" />
            <h1 className="mt-3 text-xl font-semibold tracking-tight">Password updated</h1>
            <p className="mt-2 text-sm text-muted">
              Your password has been changed. Sign in with the new one — any other
              sessions have been signed out.
            </p>
            <button className="btn-primary mt-5 w-full" onClick={() => navigate('/account')}>
              Go to sign in
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="shell py-16">
      <div className="mx-auto max-w-sm">
        <h1 className="text-center text-2xl font-semibold tracking-tight">Set a new password</h1>
        <p className="mt-2 text-center text-sm text-muted">
          Choose a new password for your account.
        </p>

        <form onSubmit={submit} className="card mt-6 space-y-4 p-6">
          {error && (
            <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{error}</p>
          )}
          {!token && (
            <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning" role="alert">
              This page needs a reset token. Open the link from your email, or{' '}
              <Link to="/account" className="font-medium underline-offset-2 hover:underline">
                request a new one
              </Link>
              .
            </p>
          )}

          <div>
            <label className="label" htmlFor="new-password">New password</label>
            <input
              id="new-password"
              className="input"
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="hint">At least 10 characters.</p>
          </div>

          <div>
            <label className="label" htmlFor="confirm-password">Confirm new password</label>
            <input
              id="confirm-password"
              className="input"
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>

          <button type="submit" className="btn-primary w-full" disabled={busy || !token}>
            {busy ? 'Saving…' : 'Set new password'}
          </button>

          <p className="text-center text-sm text-muted">
            <Link to="/account" className="underline-offset-4 hover:underline">
              Back to sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}
