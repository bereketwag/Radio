import { FormEvent, useState } from 'react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { AdminSection, ErrorState, Spinner, useAdminFetch } from './useAdminApi'

interface AdminUser {
  id: string
  email: string
  username: string
  display_name: string
  role: string
  organization: string
  date_joined: string
}

const ADMIN_ROLES = new Set(['super_admin', 'station_admin', 'ad_manager'])

const roles = [
  { value: 'listener', label: 'Normal user' },
  { value: 'advertiser', label: 'Advertiser' },
  { value: 'ad_manager', label: 'Advertising manager' },
  { value: 'station_admin', label: 'Admin' },
  { value: 'super_admin', label: 'Super administrator' },
]

function roleLabel(role: string) {
  return roles.find((r) => r.value === role)?.label ?? role
}

export function AdminUsers() {
  const { user: me } = useAuth()
  const [roleFilter, setRoleFilter] = useState('')
  const { data, error, loading, reload } = useAdminFetch<AdminUser[]>(
    `/admin-panel/users/${roleFilter ? `?role=${roleFilter}` : ''}`,
    [roleFilter],
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [formOk, setFormOk] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({
    email: '',
    display_name: '',
    password: '',
    role: 'listener',
  })

  const canManage = me?.role === 'super_admin'

  const changeRole = async (u: AdminUser, role: string) => {
    setBusy(u.id)
    setFormError(null)
    try {
      await api.post(`/admin-panel/users/${u.id}/change-role/`, { role })
      reload()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not update role')
    } finally {
      setBusy(null)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    setFormOk(null)
    setCreating(true)
    try {
      await api.post('/admin-panel/users/', form)
      setForm({ email: '', display_name: '', password: '', role: 'listener' })
      setFormOk('User created.')
      reload()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not create user')
    } finally {
      setCreating(false)
    }
  }

  return (
    <AdminSection
      title="Users"
      description="Add accounts, promote someone to admin, or keep them as a normal user."
      actions={
        <select className="input !w-auto" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Filter by role">
          <option value="">All users</option>
          {roles.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      }
    >
      {canManage && (
        <form onSubmit={submit} className="card mb-6 grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label" htmlFor="new-user-email">Email</label>
            <input
              id="new-user-email"
              className="input"
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="new-user-name">Name</label>
            <input
              id="new-user-name"
              className="input"
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="new-user-password">Password</label>
            <input
              id="new-user-password"
              className="input"
              type="password"
              required
              minLength={8}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="new-user-role">Account type</label>
            <div className="flex gap-2">
              <select
                id="new-user-role"
                className="input"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                <option value="listener">Normal user</option>
                <option value="station_admin">Admin</option>
              </select>
              <button type="submit" className="btn-primary shrink-0" disabled={creating}>
                {creating ? 'Adding…' : 'Add'}
              </button>
            </div>
          </div>
        </form>
      )}

      {formError && <p className="mb-4 text-sm text-danger">{formError}</p>}
      {formOk && <p className="mb-4 text-sm text-accent">{formOk}</p>}

      {loading && <Spinner />}
      {error && <ErrorState message={error} onRetry={reload} />}

      {data && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5">User</th>
                <th className="px-4 py-2.5">Joined</th>
                <th className="px-4 py-2.5">Type</th>
                {canManage && <th className="px-4 py-2.5">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.map((u) => {
                const isAdmin = ADMIN_ROLES.has(u.role)
                const isMe = me?.id === u.id
                return (
                  <tr key={u.id}>
                    <td className="px-4 py-3">
                      <span className="font-medium">
                        {u.display_name || u.email}
                        {isMe && <span className="ml-2 text-xs font-normal text-muted">(you)</span>}
                      </span>
                      {u.display_name && <span className="mt-0.5 block text-xs text-muted">{u.email}</span>}
                    </td>
                    <td className="px-4 py-3 text-muted">{new Date(u.date_joined).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      {canManage && !isMe ? (
                        <select
                          className="input !w-auto !py-1.5 text-xs"
                          value={u.role}
                          disabled={busy === u.id}
                          onChange={(e) => changeRole(u, e.target.value)}
                          aria-label={`Role for ${u.email}`}
                        >
                          {roles.map((r) => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-muted">{roleLabel(u.role)}</span>
                      )}
                    </td>
                    {canManage && (
                      <td className="px-4 py-3">
                        {isMe ? (
                          <span className="text-xs text-muted">—</span>
                        ) : isAdmin ? (
                          <button
                            className="btn-ghost !py-1.5 text-xs"
                            disabled={busy === u.id}
                            onClick={() => changeRole(u, 'listener')}
                          >
                            Make normal user
                          </button>
                        ) : (
                          <button
                            className="btn-primary !py-1.5 text-xs"
                            disabled={busy === u.id}
                            onClick={() => changeRole(u, 'station_admin')}
                          >
                            Promote to admin
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!canManage && (
            <p className="border-t border-line px-4 py-3 text-xs text-muted">
              Only super administrators can add users or change roles.
            </p>
          )}
        </div>
      )}
    </AdminSection>
  )
}
