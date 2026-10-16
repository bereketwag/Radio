import { Briefcase, Pencil, Plus, Trash2 } from 'lucide-react'
import { FormEvent, useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { AdminSection, EmptyState, ErrorState, Spinner, useAdminFetch } from './useAdminApi'

interface Advertiser {
  id: string
  name: string
  contact_name: string
  email: string
  phone: string
  website: string
  notes: string
  created_at: string
  visual_campaigns_count: number
  audio_campaigns_count: number
}

const emptyForm = { name: '', contact_name: '', email: '', phone: '', website: '', notes: '' }

export function AdminAdvertisers() {
  // Served from /partners/ (same viewset registered under an ad-blocker-safe path).
  const { data, error, loading, reload } = useAdminFetch<Advertiser[]>('/admin-panel/partners/')
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const advertisers = data ?? []
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return advertisers
    return advertisers.filter((a) =>
      [a.name, a.contact_name, a.email].some((v) => v.toLowerCase().includes(q)),
    )
  }, [advertisers, search])

  const openCreate = () => {
    setForm(emptyForm)
    setEditingId(null)
    setFormOpen(true)
    setActionError(null)
  }

  const openEdit = (a: Advertiser) => {
    setForm({
      name: a.name,
      contact_name: a.contact_name ?? '',
      email: a.email ?? '',
      phone: a.phone ?? '',
      website: a.website ?? '',
      notes: a.notes ?? '',
    })
    setEditingId(a.id)
    setFormOpen(true)
    setActionError(null)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setActionError(null)
    try {
      if (editingId) {
        await api.patch(`/admin-panel/partners/${editingId}/`, form)
      } else {
        await api.post('/admin-panel/partners/', form)
      }
      setFormOpen(false)
      setEditingId(null)
      setForm(emptyForm)
      reload()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not save advertiser')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (a: Advertiser) => {
    const campaigns = a.visual_campaigns_count + a.audio_campaigns_count
    const warning =
      campaigns > 0
        ? `Delete “${a.name}”? This also deletes their ${campaigns} campaign${campaigns === 1 ? '' : 's'}.`
        : `Delete “${a.name}”?`
    if (!window.confirm(warning)) return
    setBusy(true)
    setActionError(null)
    try {
      await api.del(`/admin-panel/partners/${a.id}/`)
      reload()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AdminSection
      title="Advertisers"
      description="Every business that buys banner or audio ads. Campaigns are created against an advertiser here."
      actions={
        <button className="btn-primary" onClick={openCreate} disabled={busy}>
          <Plus size={15} /> New advertiser
        </button>
      }
    >
      {loading && <Spinner />}
      {error && <ErrorState message={error} onRetry={reload} />}

      {actionError && (
        <p className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
          {actionError}
        </p>
      )}

      {formOpen && (
        <form onSubmit={submit} className="card mb-4 grid gap-4 p-5 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="adv-name">Business name *</label>
            <input
              id="adv-name"
              className="input"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="adv-contact">Contact person</label>
            <input
              id="adv-contact"
              className="input"
              value={form.contact_name}
              onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="adv-email">Email</label>
            <input
              id="adv-email"
              className="input"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="adv-phone">Phone</label>
            <input
              id="adv-phone"
              className="input"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="adv-website">Website</label>
            <input
              id="adv-website"
              className="input"
              value={form.website}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="adv-notes">Notes</label>
            <input
              id="adv-notes"
              className="input"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
          <div className="col-span-full flex gap-2">
            <button className="btn-primary" type="submit" disabled={busy || !form.name.trim()}>
              <Briefcase size={15} /> {editingId ? 'Save changes' : 'Create advertiser'}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => { setFormOpen(false); setEditingId(null); setActionError(null) }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {!loading && !error && advertisers.length === 0 && (
        <EmptyState>
          No advertisers yet — create one here, or approve an ad request and its advertiser is created automatically.
        </EmptyState>
      )}

      {advertisers.length > 0 && (
        <>
          <input
            className="input mb-4"
            placeholder="Search advertisers…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search advertisers"
          />
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5">Business</th>
                  <th className="px-4 py-2.5">Contact</th>
                  <th className="px-4 py-2.5">Email</th>
                  <th className="px-4 py-2.5">Campaigns</th>
                  <th className="px-4 py-2.5">Since</th>
                  <th className="px-4 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((a) => (
                  <tr key={a.id}>
                    <td className="px-4 py-3 font-medium">{a.name}</td>
                    <td className="px-4 py-3 text-muted">{a.contact_name || '—'}</td>
                    <td className="px-4 py-3 text-muted">{a.email || '—'}</td>
                    <td className="px-4 py-3 tabular-nums text-muted">
                      {a.visual_campaigns_count} banner · {a.audio_campaigns_count} audio
                    </td>
                    <td className="px-4 py-3 text-muted">{new Date(a.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button
                          className="btn-ghost !py-1.5 text-xs"
                          onClick={() => openEdit(a)}
                          disabled={busy}
                        >
                          <Pencil size={13} /> Edit
                        </button>
                        <button
                          className="btn-ghost !py-1.5 text-xs text-danger"
                          onClick={() => remove(a)}
                          disabled={busy}
                        >
                          <Trash2 size={13} /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-4 text-center text-sm text-muted">
                      No advertisers match “{search}”.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AdminSection>
  )
}
