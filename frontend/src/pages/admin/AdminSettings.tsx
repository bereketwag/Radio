import { Palette, Power, Save, Trash2, Upload } from 'lucide-react'
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
  const [busyBroadcast, setBusyBroadcast] = useState(false)
  const [offairFile, setOffairFile] = useState<File | null>(null)
  const [busyOffair, setBusyOffair] = useState(false)

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

  const toggleBroadcast = async () => {
    if (!data) return
    setBusyBroadcast(true)
    setFlash(null)
    setError(null)
    try {
      const saved = await api.patch<StationSettings>('/admin-panel/station-settings/', {
        broadcast_enabled: !data.broadcast_enabled,
      })
      setData(saved)
      setFlash(
        saved.broadcast_enabled
          ? 'Broadcast is ON — the engine returns to the music rotation within ~15 seconds.'
          : 'Broadcast is OFF — the off-air track is now looping on the stream.',
      )
      await refreshStation()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the broadcast state')
    } finally {
      setBusyBroadcast(false)
    }
  }

  const uploadOffair = async (e: FormEvent) => {
    e.preventDefault()
    if (!offairFile) return
    setBusyOffair(true)
    setFlash(null)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('fallback_audio', offairFile)
      const saved = await api.patchForm<StationSettings>('/admin-panel/station-settings/', fd)
      setData(saved)
      setOffairFile(null)
      setFlash('Off-air track updated. The engine picks it up within ~15 seconds.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusyOffair(false)
    }
  }

  const removeOffair = async () => {
    setBusyOffair(true)
    setFlash(null)
    setError(null)
    try {
      const saved = await api.patch<StationSettings>('/admin-panel/station-settings/', { fallback_audio: null })
      setData(saved)
      setFlash('Off-air track removed — the stream plays silence while the broadcast is off.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the off-air track')
    } finally {
      setBusyOffair(false)
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
      {data && (
        <div className="card mb-6 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Broadcast</p>
              <p className="mt-1 flex items-center gap-2 text-sm font-semibold">
                <Power size={15} className={data.broadcast_enabled ? 'text-accent' : 'text-warning'} />
                {data.broadcast_enabled ? 'On air — music rotation is playing' : 'Off air — off-air track is looping'}
              </p>
              <p className="mt-1 text-xs text-muted">
                Turning it off never stops the stream: listeners keep hearing the off-air track
                (all day) until you switch back on. Ads never air while off air.
              </p>
            </div>
            <button
              className={data.broadcast_enabled ? 'btn-ghost' : 'btn-primary'}
              disabled={busyBroadcast}
              onClick={toggleBroadcast}
            >
              <Power size={15} />
              {busyBroadcast ? 'Switching…' : data.broadcast_enabled ? 'Turn broadcast off' : 'Turn broadcast on'}
            </button>
          </div>

          <form onSubmit={uploadOffair} className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Off-air track</p>
              {data.fallback_audio_url ? (
                <audio controls preload="none" src={data.fallback_audio_url} className="mt-2 h-8" aria-label="Off-air track preview" />
              ) : (
                <p className="mt-1 text-xs text-muted">
                  None uploaded — the stream plays silence while off air. Upload a track (e.g. classical)
                  to have it play all day instead.
                </p>
              )}
            </div>
            <input
              className="input !w-auto"
              type="file"
              accept=".mp3,.ogg,.opus,.flac,.m4a,.aac,.wav"
              onChange={(e) => setOffairFile(e.target.files?.[0] ?? null)}
              aria-label="Choose off-air audio file"
            />
            <button className="btn-primary" type="submit" disabled={busyOffair || !offairFile}>
              <Upload size={15} /> {busyOffair ? 'Uploading…' : 'Set off-air track'}
            </button>
            {data.fallback_audio_url && (
              <button className="btn-ghost text-danger" type="button" disabled={busyOffair} onClick={removeOffair}>
                <Trash2 size={15} /> Remove
              </button>
            )}
          </form>
        </div>
      )}

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
