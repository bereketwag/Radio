import { LogOut, Package, ShieldCheck } from 'lucide-react'
import { FormEvent, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'

interface AdRequestRow {
  id: string
  business_name: string
  ad_format: string
  status: string
  status_note: string
  created_at: string
}

const statusStyles: Record<string, string> = {
  pending: 'bg-warning/10 text-warning',
  approved: 'bg-accent/10 text-accent',
  rejected: 'bg-danger/10 text-danger',
}

type Mode = 'signin' | 'register' | 'reset'

export function AccountPage() {
  const { user, loading, login, register, logout, isStaff } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [requests, setRequests] = useState<AdRequestRow[]>([])
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('')
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwOk, setPwOk] = useState<string | null>(null)
  const [pwBusy, setPwBusy] = useState(false)

  const changePassword = async (e: FormEvent) => {
    e.preventDefault()
    setPwError(null)
    setPwOk(null)
    if (newPassword !== newPasswordConfirm) {
      setPwError('New passwords do not match.')
      return
    }
    setPwBusy(true)
    try {
      await api.post('/auth/change-password/', {
        current_password: currentPassword,
        new_password: newPassword,
      })
      setPwOk('Password updated. Use the new password the next time you sign in.')
      setCurrentPassword('')
      setNewPassword('')
      setNewPasswordConfirm('')
    } catch (err) {
      setPwError(err instanceof ApiError ? err.message : 'Could not change password.')
    } finally {
      setPwBusy(false)
    }
  }

  useEffect(() => {
    if (!user) return
    api
      .get<{ results?: AdRequestRow[] } | AdRequestRow[]>('/ads/requests/mine/')
      .then((res) => setRequests(Array.isArray(res) ? res : res.results ?? []))
      .catch(() => setRequests([]))
  }, [user])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setBusy(true)
    try {
      if (mode === 'signin') {
        await login(email, password)
        const from = (location.state as { from?: string } | null)?.from
        navigate(from && !from.startsWith('/admin') ? from : isStaff ? '/admin' : '/', { replace: true })
      } else if (mode === 'register') {
        await register({ email, password, password_confirm: passwordConfirm })
        navigate('/', { replace: true })
      } else {
        await api.post('/auth/password-reset/', { email })
        setInfo('If that email has an account, a reset link has been sent. Check your inbox.')
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="shell flex min-h-[40vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent" aria-label="Loading" />
      </div>
    )
  }

  if (user) {
    return (
      <div className="shell py-10">
        <div className="mx-auto max-w-2xl">
          <div className="card p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-xl font-semibold tracking-tight">Your account</h1>
                <p className="mt-1 text-sm text-muted">{user.email}</p>
                <p className="mt-0.5 text-xs uppercase tracking-wide text-muted">
                  Role: {user.role.replace('_', ' ')}
                </p>
              </div>
              <div className="flex gap-2">
                {isStaff && (
                  <Link to="/admin" className="btn-ghost">Open dashboard</Link>
                )}
                <button className="btn-ghost" onClick={() => void logout()}>
                  <LogOut size={15} />
                  Sign out
                </button>
              </div>
            </div>
          </div>

          <form onSubmit={changePassword} className="card mt-4 p-6">
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} className="text-accent" />
              <h2 className="text-sm font-semibold">Change password</h2>
            </div>
            {pwError && (
              <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{pwError}</p>
            )}
            {pwOk && (
              <p className="mt-3 rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent" role="status">{pwOk}</p>
            )}
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div>
                <label className="label" htmlFor="current-password">Current password</label>
                <input
                  id="current-password"
                  className="input"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="new-password">New password</label>
                <input
                  id="new-password"
                  className="input"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="new-password2">Confirm new password</label>
                <input
                  id="new-password2"
                  className="input"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={newPasswordConfirm}
                  onChange={(e) => setNewPasswordConfirm(e.target.value)}
                />
              </div>
            </div>
            <button type="submit" className="btn-ghost mt-3" disabled={pwBusy}>
              {pwBusy ? 'Saving…' : 'Update password'}
            </button>
          </form>

          <div className="card mt-4 p-6">
            <div className="flex items-center gap-2">
              <Package size={16} className="text-accent" />
              <h2 className="text-sm font-semibold">Your advertising requests</h2>
            </div>
            {requests.length === 0 ? (
              <p className="mt-3 text-sm text-muted">
                You haven’t submitted any advertising requests yet.{' '}
                <Link to="/advertise" className="font-medium text-accent underline-offset-4 hover:underline">
                  Request one
                </Link>
                .
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {requests.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.business_name}</p>
                      <p className="text-xs text-muted">
                        {r.ad_format} · submitted {new Date(r.created_at).toLocaleDateString()}
                      </p>
                      {r.status_note && <p className="mt-0.5 text-xs text-muted">{r.status_note}</p>}
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusStyles[r.status] ?? 'bg-surface-2 text-muted'}`}>
                      {r.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="shell py-16">
      <div className="mx-auto max-w-sm">
        <h1 className="text-center text-2xl font-semibold tracking-tight">
          {mode === 'signin' ? 'Sign in' : mode === 'register' ? 'Create an account' : 'Reset your password'}
        </h1>
        <p className="mt-2 text-center text-sm text-muted">
          {mode === 'reset'
            ? 'Enter your email and we’ll send a reset link.'
            : 'Listening never requires an account — this is for advertiser and station features.'}
        </p>

        <form onSubmit={submit} className="card mt-6 space-y-4 p-6">
          {error && (
            <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{error}</p>
          )}
          {info && (
            <p className="rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent" role="status">{info}</p>
          )}

          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" className="input" type="email" required autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>

          {mode !== 'reset' && (
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input id="password" className="input" type="password" required
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          )}

          {mode === 'register' && (
            <div>
              <label className="label" htmlFor="password2">Confirm password</label>
              <input id="password2" className="input" type="password" required autoComplete="new-password"
                value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} />
              <p className="hint">At least 10 characters.</p>
            </div>
          )}

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Send reset link'}
          </button>

          <div className="flex flex-col gap-1 text-center text-sm">
            {mode !== 'signin' && (
              <button type="button" className="text-muted hover:text-ink" onClick={() => { setMode('signin'); setError(null) }}>
                Have an account? Sign in
              </button>
            )}
            {mode !== 'register' && (
              <button type="button" className="text-muted hover:text-ink" onClick={() => { setMode('register'); setError(null) }}>
                New here? Create an account
              </button>
            )}
            {mode !== 'reset' && (
              <button type="button" className="text-muted hover:text-ink" onClick={() => { setMode('reset'); setError(null) }}>
                Forgot your password?
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
