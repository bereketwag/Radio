import { Plus, X } from 'lucide-react'
import { KeyboardEvent, useEffect, useState } from 'react'
import { api } from '../../lib/api'

interface Advertiser {
  id: string
  name: string
}

/**
 * Advertiser select used by both campaign forms, with inline creation.
 *
 * Campaigns require an advertiser, so without this the very first campaign on
 * a fresh install is impossible. Pick from the list, or create one on the spot
 * and it is selected automatically.
 */
export function AdvertiserPicker({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (id: string) => void
  disabled?: boolean
}) {
  const [advertisers, setAdvertisers] = useState<Advertiser[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')

  useEffect(() => {
    let alive = true
    api
      // "/partners/" not "/advertisers/": ad-blocker extensions block "advertis*"
      // URLs in the browser before they ever leave (Failed to fetch).
      .get<Advertiser[]>('/admin-panel/partners/')
      .then((res) => {
        if (!alive) return
        // Router-paginated endpoints wrap in {results}; this one is a bare list.
        setAdvertisers(Array.isArray(res) ? res : (res as { results?: Advertiser[] }).results ?? [])
      })
      .catch(() => alive && setAdvertisers([]))
    return () => {
      alive = false
    }
  }, [])

  /**
   * Deliberately NOT a <form>: this picker renders inside the campaign
   * <form>, and a nested form is invalid HTML — the browser then performs a
   * real page navigation on submit (full reload, data lost). Plain button +
   * Enter-key handling keeps the UX without ever nesting forms.
   */
  const submit = async () => {
    setError(null)
    setBusy(true)
    try {
      const created = await api.post<Advertiser>('/admin-panel/partners/', { name: name.trim(), email: email.trim() })
      setAdvertisers((prev) => [...(prev ?? []), created].sort((a, b) => a.name.localeCompare(b.name)))
      onChange(created.id)
      setCreating(false)
      setName('')
      setEmail('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create advertiser')
    } finally {
      setBusy(false)
    }
  }

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (!busy && name.trim() && email.trim()) void submit()
    }
  }

  if (advertisers === null) return <div className="input animate-pulse !bg-surface-2" aria-hidden />

  return (
    <div>
      {creating ? (
        <div className="grid gap-2 rounded-xl bg-surface-2 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium">New advertiser</p>
            <button type="button" className="btn-ghost h-7 w-7 !rounded-full !px-0" onClick={() => setCreating(false)} aria-label="Cancel new advertiser">
              <X size={13} />
            </button>
          </div>
          <input
            className="input"
            required
            placeholder="Business name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onInputKeyDown}
            disabled={busy}
          />
          <input
            className="input"
            required
            type="email"
            placeholder="Billing contact email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={onInputKeyDown}
            disabled={busy}
          />
          {error && <p className="text-xs text-danger">{error}</p>}
          <button
            className="btn-primary"
            type="button"
            onClick={() => void submit()}
            disabled={busy || !name.trim() || !email.trim()}
          >
            {busy ? 'Saving…' : 'Create & select'}
          </button>
        </div>
      ) : (
        <>
          <select
            className="input"
            required
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">Select advertiser…</option>
            {advertisers.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-ghost mt-2 !px-2 text-xs"
            onClick={() => setCreating(true)}
            disabled={disabled}
          >
            <Plus size={13} /> New advertiser
          </button>
          {advertisers.length === 0 && (
            <p className="mt-1 text-xs text-muted">No advertisers yet — create the first one above.</p>
          )}
        </>
      )}
    </div>
  )
}
