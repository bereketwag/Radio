import { Palette, Save } from 'lucide-react'
import { FormEvent, useEffect, useState } from 'react'
import { api, StationSettings } from '../../lib/api'
import { refreshStation } from '../../lib/useStation'
import { AdminSection, ErrorState, Spinner } from './useAdminApi'

const emptyForm = {
  name: '',
  tagline: '',
  contact_email: '',
  contact_address: '',
  accent_color: '#169154',
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

export function AdminSettings() {
  const [data, setData] = useState<StationSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  const [form, setForm] = useState({ ...emptyForm })
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    api
      .get<StationSettings>('/admin-panel/station-settings/')
      .then((res) => {
        if (alive) {
          setData(res)
          setForm({
            name: res.name ?? '',
            tagline: res.tagline ?? '',
            contact_email: res.contact_email ?? '',
            contact_address: res.contact_address ?? '',
            accent_color: res.accent_color || '#169154',
          })
          setError(null)
        }
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : 'Failed to load settings')
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [nonce])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setFlash(null)
    setError(null)
    try {
      const saved = await api.patch<StationSettings>('/admin-panel/station-settings/', form)
      setData(saved)
      // Push the new theme colour + branding across the live site immediately.
      await refreshStation()
      setFlash('Saved. The theme colour is live across the site.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Spinner />
  if (!data && error) return <ErrorState message={error} onRetry={() => setNonce((n) => n + 1)} />

  const [r, g, b] = hexToRgb(form.accent_color)

  return (
    <AdminSection
      title="Station settings"
      description="Branding and theme colour used across the public site and the player."
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <form onSubmit={submit} className="card grid gap-4 p-5">
          {flash && (
            <p className="rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent" role="status">
              {flash}
            </p>
          )}

          <div>
            <label className="label">Station name</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Aurora Radio"
            />
            <p className="mt-1 text-xs text-muted">Leave blank to use the server default.</p>
          </div>

          <div>
            <label className="label">Tagline</label>
            <input
              className="input"
              value={form.tagline}
              onChange={(e) => setForm({ ...form, tagline: e.target.value })}
              placeholder="The sound of the city"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Contact email</label>
              <input
                className="input"
                type="email"
                value={form.contact_email}
                onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                placeholder="hello@example.com"
              />
            </div>
            <div>
              <label className="label">Contact address</label>
              <input
                className="input"
                value={form.contact_address}
                onChange={(e) => setForm({ ...form, contact_address: e.target.value })}
                placeholder="City, Country"
              />
            </div>
          </div>

          <div>
            <label className="label">Theme colour</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                className="h-10 w-14 cursor-pointer rounded-lg border border-line bg-surface-2 p-1"
                value={form.accent_color}
                onChange={(e) => setForm({ ...form, accent_color: e.target.value })}
                aria-label="Pick theme colour"
              />
              <input
                className="input w-32 uppercase"
                value={form.accent_color}
                onChange={(e) => {
                  const v = e.target.value
                  setForm({ ...form, accent_color: v.startsWith('#') ? v : `#${v}` })
                }}
                pattern="#[0-9a-fA-F]{6}"
                title="Hex colour like #169154"
              />
            </div>
            <p className="mt-1 text-xs text-muted">
              Applied to buttons, highlights, and the live indicator. Saved as a hex colour.
            </p>
          </div>

          <div>
            <button className="btn-primary" type="submit" disabled={busy}>
              <Save size={15} /> {busy ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </form>

        <div className="card h-fit p-5">
          <p className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Palette size={15} className="text-accent" /> Preview
          </p>
          <div
            className="rounded-xl p-4"
            style={{ background: `rgb(${r} ${g} ${b} / 0.1)` }}
          >
            <p className="mb-1 text-lg font-semibold" style={{ color: `rgb(${r} ${g} ${b})` }}>
              {form.name || 'Station name'}
            </p>
            <p className="mb-4 text-sm text-muted">{form.tagline || 'Tagline'}</p>
            <span
              className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium"
              style={{
                background: `rgb(${r} ${g} ${b})`,
                color: (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#121412' : '#ffffff',
              }}
            >
              Listen live
            </span>
          </div>
          <p className="mt-3 text-xs text-muted">
            Uses the current form values. Save to apply site-wide.
          </p>
        </div>
      </div>
    </AdminSection>
  )
}
