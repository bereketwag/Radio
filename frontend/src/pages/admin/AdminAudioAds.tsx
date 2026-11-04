import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  CreditCard,
  ExternalLink,
  FileAudio,
  Headphones,
  Loader2,
  Megaphone,
  Pause,
  Play,
  Plus,
  Radio,
  Trash2,
  Upload,
  Volume2,
  X,
} from 'lucide-react'
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { api, StationConfig } from '../../lib/api'
import { useNowPlaying } from '../../lib/useNowPlaying'
import { AdminSection, ErrorState, Spinner, useAdminFetch } from './useAdminApi'

/* ----------------------------- API shapes ------------------------------- */

interface Advert {
  id: string
  name: string
  audio_url: string | null
  duration_seconds: number
  approved: boolean
  active: boolean
}

interface Schedule {
  id: string
  recurrence: 'once' | 'daily' | 'weekly'
  starts_at: string
  local_time: string | null
  weekday: number | null
  max_break_seconds: number
  enabled: boolean
}

interface AudioCampaign {
  id: string
  advertiser: string
  advertiser_name: string
  name: string
  status: string
  payment_status: string
  priority: number
  starts_at: string | null
  ends_at: string | null
  eligible: boolean
  next_break_at: string | null
  readiness: { ready: boolean; reason: string | null }
  adverts: Advert[]
  schedules: Schedule[]
}

interface BreakLog {
  id: string
  campaign_name: string
  scheduled_for: string
  result: string
  seconds_played: number
  advert_names: string[]
  detail: string
}

interface Partner {
  id: string
  name: string
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const PRESETS = [
  { id: 'daily', label: 'Every day', hint: 'A steady reminder' },
  { id: 'weekdays', label: 'Weekdays', hint: 'Monday to Friday' },
  { id: 'weekends', label: 'Weekends', hint: 'Saturday & Sunday' },
  { id: 'once', label: 'Just once', hint: 'One single break' },
] as const
type Preset = (typeof PRESETS)[number]['id']

/* ------------------------------ formatting ------------------------------ */

function formatDuration(seconds?: number | null): string {
  if (!seconds) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function timeInZone(iso: string, tz: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

function dateInZone(iso: string, tz: string, withYear = false): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  }).format(new Date(iso))
}

function dayKey(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

/** "today at 18:00" / "tomorrow at 06:00" / "12 Nov at 18:00" (station clock). */
function friendlyMoment(iso: string, tz: string): string {
  const target = dayKey(iso, tz)
  const now = new Date()
  const today = dayKey(now.toISOString(), tz)
  const tomorrow = dayKey(new Date(now.getTime() + 86_400_000).toISOString(), tz)
  const time = timeInZone(iso, tz)
  if (target === today) return `today at ${time}`
  if (target === tomorrow) return `tomorrow at ${time}`
  return `${dateInZone(iso, tz)} at ${time}`
}

/** First full hour after now, on the station clock ("18:00"). */
function nextStationHour(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
  }).formatToParts(new Date())
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 12)
  return `${String((hour + 1) % 24).padStart(2, '0')}:00`
}

/**
 * Convert a `datetime-local` value ("2026-11-03T18:30") that the operator
 * picked on the station clock into an exact UTC instant. Without this the
 * browser's own time zone decides, so a 6 PM advert could air hours off.
 */
function stationWallClockToIso(local: string, timeZone: string): string {
  const [datePart, timePart] = local.split('T')
  if (!datePart || !timePart) return local
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute] = timePart.split(':').map(Number)
  const wall = Date.UTC(year, month - 1, day, hour, minute)

  const offsetAt = (instant: number): number => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(instant))
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value ?? 0)
    const asUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
      get('second'),
    )
    return asUtc - instant
  }

  // Two passes: the first guesses the instant, the second settles it even
  // when the station zone changes offset (DST) on that date.
  let instant = wall - offsetAt(wall)
  instant = wall - offsetAt(instant)
  return new Date(instant).toISOString()
}

/** Plain-language summary of every enabled schedule on a campaign. */
function describeSchedules(schedules: Schedule[], tz: string): string {
  const active = schedules.filter((s) => s.enabled)
  if (active.length === 0) return 'No airing times yet'

  const once = active.find((s) => s.recurrence === 'once')
  if (once && active.length === 1) return `Once, ${friendlyMoment(once.starts_at, tz)}`

  const recurring = active.filter((s) => s.recurrence !== 'once')
  if (recurring.length === 0) return 'No future airings'

  const times = [...new Set(recurring.map((s) => (s.local_time ?? '').slice(0, 5)).filter(Boolean))].sort()
  if (times.length === 0) return 'No airing times yet'

  if (recurring.every((s) => s.recurrence === 'daily')) return `Every day at ${times.join(', ')}`

  const days = [...new Set(recurring.map((s) => s.weekday).filter((d): d is number => d !== null))].sort(
    (a, b) => a - b,
  )
  const dayLabel =
    days.length === 7
      ? 'Every day'
      : days.length === 5 && days.every((d) => d <= 4)
        ? 'Mon–Fri'
        : days.length === 2 && days[0] === 5 && days[1] === 6
          ? 'Weekends'
          : days.map((d) => WEEKDAYS[d]).join(', ')
  return `${dayLabel} at ${times.join(', ')}`
}

function scheduleChipLabel(s: Schedule, tz: string): string {
  if (s.recurrence === 'once') return friendlyMoment(s.starts_at, tz)
  const time = (s.local_time ?? '').slice(0, 5)
  if (s.recurrence === 'daily') return `Every day ${time}`
  return `${WEEKDAYS[s.weekday ?? 0]} ${time}`
}

function stateOf(c: AudioCampaign): { label: string; tone: 'good' | 'warn' | 'bad' | 'mute' } {
  if (c.status === 'paused') return { label: 'Paused', tone: 'warn' }
  if (c.readiness.ready) return { label: 'On air', tone: 'good' }
  if (c.status === 'draft' || c.status === 'pending') return { label: 'Not started', tone: 'mute' }
  if (c.readiness.reason === 'Billing is marked unpaid') return { label: 'Needs billing', tone: 'warn' }
  return { label: 'Needs attention', tone: 'bad' }
}

const TONE_CLASS: Record<string, string> = {
  good: 'bg-accent/10 text-accent',
  warn: 'bg-warning/10 text-warning',
  bad: 'bg-danger/10 text-danger',
  mute: 'bg-surface-2 text-muted',
}

/* ------------------------------- page ----------------------------------- */

export function AdminAudioAds() {
  const campaignsFetch = useAdminFetch<{ results: AudioCampaign[] }>('/admin-panel/audio-campaigns/')
  const libraryFetch = useAdminFetch<Advert[] | { results: Advert[] }>('/admin-panel/audio-adverts/')
  const logsFetch = useAdminFetch<BreakLog[] | { results: BreakLog[] }>('/admin-panel/ad-break-logs/')
  const stationFetch = useAdminFetch<StationConfig>('/station/')
  const { data: nowPlaying, refresh: refreshNowPlaying } = useNowPlaying()

  const tz = stationFetch.data?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const campaigns = campaignsFetch.data?.results ?? []
  const library = Array.isArray(libraryFetch.data)
    ? libraryFetch.data
    : (libraryFetch.data?.results ?? [])
  const logs = Array.isArray(logsFetch.data) ? logsFetch.data : (logsFetch.data?.results ?? [])

  const [busyId, setBusyId] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [openDetails, setOpenDetails] = useState<Record<string, boolean>>({})
  const [showLibrary, setShowLibrary] = useState(false)
  const [showLog, setShowLog] = useState(false)

  const onAir = campaigns.filter((c) => c.readiness.ready)
  const nextUp = useMemo(() => {
    const upcoming = campaigns
      .filter((c) => c.readiness.ready && c.next_break_at)
      .map((c) => c.next_break_at as string)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
    return upcoming[0] ?? null
  }, [campaigns])

  const liveAdvert = nowPlaying?.kind === 'advert' ? nowPlaying : null

  const refreshAll = () => {
    campaignsFetch.reload()
    libraryFetch.reload()
    logsFetch.reload()
    refreshNowPlaying()
  }

  const run = async (id: string, fn: () => Promise<unknown>) => {
    setBusyId(id)
    setPageError(null)
    try {
      await fn()
      refreshAll()
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Something went wrong — please try again.')
    } finally {
      setBusyId(null)
    }
  }

  const startCampaign = (c: AudioCampaign) =>
    run(c.id, async () => {
      await api.post(`/admin-panel/audio-campaigns/${c.id}/start/`)
      setNotice(`“${c.name}” is on air. It will play at the times below.`)
    })

  const pauseCampaign = (c: AudioCampaign) =>
    run(c.id, async () => {
      await api.post(`/admin-panel/audio-campaigns/${c.id}/set_status/`, { status: 'paused' })
      setNotice(`“${c.name}” is paused. It will not play until you start it again.`)
    })

  const playNow = (c: AudioCampaign) =>
    run(c.id, async () => {
      const res = await api.post<{ spot: string; seconds: number }>(
        `/admin-panel/audio-campaigns/${c.id}/play_now/`,
      )
      setNotice(`“${res.spot}” is on air now. Open the player to hear it.`)
      // The engine polls every few seconds; refresh the banner twice so it
      // appears even if the first poll lands just before the advert starts.
      window.setTimeout(refreshNowPlaying, 2500)
      window.setTimeout(refreshNowPlaying, 6000)
    })

  const deleteCampaign = (c: AudioCampaign) => {
    if (!window.confirm(`Delete “${c.name}”? It will stop playing and its airing times will be removed.`)) return
    run(c.id, async () => {
      await api.del(`/admin-panel/audio-campaigns/${c.id}/`)
      setNotice(`“${c.name}” was deleted.`)
    })
  }

  return (
    <AdminSection
      title="Audio adverts"
      description="Upload a recording, choose when it plays, and the station inserts it between songs."
      actions={
        <button className="btn-primary" onClick={() => setWizardOpen(true)}>
          <Plus size={16} /> New advert
        </button>
      }
    >
      {/* Live advert banner ------------------------------------------------ */}
      {liveAdvert && (
        <div className="mb-4 flex flex-wrap items-center gap-4 rounded-2xl border border-accent/30 bg-accent/10 px-4 py-3 sm:px-5">
          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink">
            <Megaphone size={18} />
            <span className="absolute inset-0 animate-ping rounded-full bg-accent/40" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">
              Advertisement on air now
            </p>
            <p className="truncate font-semibold">{liveAdvert.title ?? 'Advert'}</p>
            <p className="truncate text-sm text-muted">{liveAdvert.artist ?? 'Live stream'}</p>
          </div>
          <a className="btn-ghost !bg-surface" href="/" target="_blank" rel="noreferrer">
            <Headphones size={15} /> Listen live <ExternalLink size={12} />
          </a>
        </div>
      )}

      {/* Summary ----------------------------------------------------------- */}
      {campaignsFetch.data && (
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <Stat
            icon={<Radio size={17} />}
            label="Active campaigns"
            value={`${onAir.length} campaign${onAir.length === 1 ? '' : 's'}`}
            hint={onAir.length > 0 ? 'Airs at the times below' : 'Nothing is airing yet'}
            tone="accent"
          />
          <Stat
            icon={<Clock size={17} />}
            label="Next advert"
            value={nextUp ? friendlyMoment(nextUp, tz) : 'Nothing scheduled'}
            hint={nextUp ? 'Station clock' : campaigns.length === 0 ? 'Create your first advert' : 'Add an airing time'}
          />
          <Stat
            icon={<FileAudio size={17} />}
            label="Recordings ready"
            value={`${library.filter((a) => a.approved && a.active).length} of ${library.length}`}
            hint={library.length === 0 ? 'Upload your first spot' : 'Includes all saved spots'}
          />
        </div>
      )}

      {notice && (
        <p className="mb-4 flex items-start justify-between gap-3 rounded-xl bg-accent/10 px-4 py-3 text-sm text-accent" role="status">
          <span className="flex items-start gap-2">
            <Check size={15} className="mt-0.5 shrink-0" /> {notice}
          </span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss message" className="shrink-0">
            <X size={14} />
          </button>
        </p>
      )}
      {pageError && (
        <p className="mb-4 flex items-start justify-between gap-3 rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger" role="alert">
          <span className="flex items-start gap-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {pageError}
          </span>
          <button onClick={() => setPageError(null)} aria-label="Dismiss error" className="shrink-0">
            <X size={14} />
          </button>
        </p>
      )}

      {campaignsFetch.loading && <Spinner />}
      {campaignsFetch.error && (
        <ErrorState message={campaignsFetch.error} onRetry={campaignsFetch.reload} />
      )}

      {/* Empty state ------------------------------------------------------ */}
      {campaignsFetch.data && campaigns.length === 0 && (
        <div className="card overflow-hidden">
          <div className="border-b border-line bg-gradient-to-br from-accent/10 via-surface to-surface px-6 py-8 text-center sm:py-10">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-accent-ink shadow-lg">
              <Megaphone size={26} />
            </span>
            <h2 className="mt-4 text-xl font-semibold tracking-tight">Put your first advert on air</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">
              It takes about a minute. Upload the recording, pick a time, and press one button.
            </p>
            <button className="btn-primary mt-5" onClick={() => setWizardOpen(true)}>
              <Plus size={16} /> Create an advert
            </button>
          </div>
          <ol className="grid gap-3 p-5 sm:grid-cols-3 sm:p-6">
            {[
              ['1', 'Upload a recording', 'MP3, M4A, WAV or OGG. Listen to it once before it airs.'],
              ['2', 'Choose when it plays', 'Every day, weekdays, weekends, or one single time.'],
              ['3', 'Press “Put on air”', 'We approve the spot and start it automatically.'],
            ].map(([n, title, text]) => (
              <li key={n} className="rounded-xl bg-surface-2 px-4 py-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-ink">
                  {n}
                </span>
                <p className="mt-2 text-sm font-medium">{title}</p>
                <p className="mt-0.5 text-xs text-muted">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Campaigns -------------------------------------------------------- */}
      {campaigns.length > 0 && (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
            <h2 className="font-semibold">Your campaigns</h2>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">
              {campaigns.length}
            </span>
          </div>
          <ul className="divide-y divide-line">
            {campaigns.map((c) => {
              const state = stateOf(c)
              const spot = c.adverts[0]
              const busy = busyId === c.id
              return (
                <li key={c.id}>
                  <div className="flex flex-wrap items-start gap-3 px-4 py-4 sm:px-5">
                    <span
                      className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                        state.tone === 'good'
                          ? 'bg-accent animate-live-pulse'
                          : state.tone === 'warn'
                            ? 'bg-warning'
                            : state.tone === 'bad'
                              ? 'bg-danger'
                              : 'bg-muted/50'
                      }`}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate font-semibold">{c.name}</h3>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE_CLASS[state.tone]}`}>
                          {state.label}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-sm text-muted">
                        {c.advertiser_name} · {describeSchedules(c.schedules, tz)}
                      </p>
                      <p className={`mt-1 text-xs ${c.readiness.ready ? 'text-accent' : 'text-muted'}`}>
                        {c.readiness.ready
                          ? c.next_break_at
                            ? `Next: ${friendlyMoment(c.next_break_at, tz)}`
                            : 'Waiting for the next scheduled time'
                          : c.readiness.reason}
                      </p>
                    </div>
                    <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto">
                      <button
                        className="btn-ghost h-9 text-xs"
                        disabled={busy}
                        onClick={() => playNow(c)}
                        title="Play this recording once, right now"
                      >
                        {busy ? <Loader2 size={14} className="animate-spin" /> : <Volume2 size={14} />}
                        Play now
                      </button>
                      {c.readiness.ready ? (
                        <button className="btn-ghost h-9 text-xs" disabled={busy} onClick={() => pauseCampaign(c)}>
                          <Pause size={14} /> Pause
                        </button>
                      ) : (
                        <button className="btn-primary h-9 text-xs" disabled={busy} onClick={() => startCampaign(c)}>
                          <Play size={14} /> {c.status === 'paused' ? 'Resume' : 'Start airing'}
                        </button>
                      )}
                      <button
                        className="btn-ghost h-9 w-9 !px-0"
                        aria-label={openDetails[c.id] ? 'Hide details' : 'Show details'}
                        aria-expanded={!!openDetails[c.id]}
                        onClick={() => setOpenDetails((prev) => ({ ...prev, [c.id]: !prev[c.id] }))}
                      >
                        <ChevronDown
                          size={16}
                          className={`transition-transform ${openDetails[c.id] ? 'rotate-180' : ''}`}
                        />
                      </button>
                    </div>
                  </div>

                  {openDetails[c.id] && (
                    <div className="border-t border-line bg-surface-2/40 px-4 py-4 sm:px-5">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted">The recording</p>
                        {c.adverts.length === 0 ? (
                          <p className="mt-1 text-sm text-muted">No spot attached.</p>
                        ) : (
                          <ul className="mt-2 space-y-2">
                            {c.adverts.map((a) => (
                              <li
                                key={a.id}
                                className="flex flex-wrap items-center gap-3 rounded-xl bg-surface px-3 py-2"
                              >
                                {a.audio_url && (
                                  <audio
                                    controls
                                    preload="none"
                                    src={a.audio_url}
                                    className="h-8 max-w-[220px]"
                                    aria-label={`Preview ${a.name}`}
                                  />
                                )}
                                <span className="min-w-0 flex-1 truncate text-sm font-medium">{a.name}</span>
                                <span className="text-xs tabular-nums text-muted">
                                  {formatDuration(a.duration_seconds)}
                                </span>
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                    a.approved && a.active
                                      ? 'bg-accent/10 text-accent'
                                      : 'bg-warning/10 text-warning'
                                  }`}
                                >
                                  {a.approved && a.active ? 'Approved' : a.active ? 'Not approved' : 'Off'}
                                </span>
                                <button
                                  className="text-xs text-muted underline-offset-2 hover:underline"
                                  disabled={busy}
                                  onClick={() =>
                                    run(c.id, () =>
                                      api.patch(`/admin-panel/audio-adverts/${a.id}/`, {
                                        approved: !a.approved,
                                      }),
                                    )
                                  }
                                >
                                  {a.approved ? 'Unapprove' : 'Approve'}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      <div className="mt-4">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Airing times</p>
                        {c.schedules.filter((s) => s.enabled).length === 0 ? (
                          <p className="mt-1 text-sm text-muted">No times yet — add one below.</p>
                        ) : (
                          <ul className="mt-2 flex flex-wrap gap-2">
                            {c.schedules.filter((s) => s.enabled).map((s) => (
                              <li
                                key={s.id}
                                className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs"
                              >
                                <CalendarClock size={12} className="text-muted" />
                                {scheduleChipLabel(s, tz)}
                                <button
                                  className="text-muted hover:text-danger"
                                  aria-label="Remove this time"
                                  disabled={busy}
                                  onClick={() => run(c.id, () => api.del(`/admin-panel/ad-schedules/${s.id}/`))}
                                >
                                  <X size={12} />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                        <AddTimeForm
                          campaignId={c.id}
                          busy={busy}
                          defaultMax={spot ? Math.max(60, spot.duration_seconds + 10) : 60}
                          onSaved={refreshAll}
                        />
                      </div>

                      <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-line pt-3">
                        <label className="flex items-center gap-2 text-sm">
                          <CreditCard size={14} className="text-muted" />
                          <span className="text-muted">Billing</span>
                          <select
                            className="input !w-auto !py-1 text-xs"
                            value={c.payment_status}
                            disabled={busy}
                            onChange={(e) =>
                              run(c.id, () =>
                                api.post(`/admin-panel/audio-campaigns/${c.id}/set_payment/`, {
                                  payment_status: e.target.value,
                                }),
                              )
                            }
                          >
                            <option value="paid">Paid</option>
                            <option value="pending">Pending</option>
                            <option value="unpaid">Unpaid</option>
                          </select>
                        </label>
                        <button
                          className="btn-ghost h-8 !px-3 text-danger"
                          disabled={busy}
                          onClick={() => deleteCampaign(c)}
                        >
                          <Trash2 size={13} /> Delete campaign
                        </button>
                      </div>
                      {!spot || spot.duration_seconds === 0 ? (
                        <p className="mt-2 flex items-center gap-1 text-xs text-warning">
                          <AlertTriangle size={12} /> This recording has no measured length yet. Re-upload it if
                          it never airs.
                        </p>
                      ) : null}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Library + history ------------------------------------------------ */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Collapsible
          icon={<FileAudio size={16} />}
          title="Saved recordings"
          count={library.length}
          open={showLibrary}
          onToggle={() => setShowLibrary((v) => !v)}
        >
          <p className="mb-3 text-sm text-muted">
            Spots saved on their own. Campaigns created with the button above add their recording automatically.
          </p>
          <AdvertUpload busy={busyId !== null} onUploaded={refreshAll} />
          {library.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No recordings saved yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {library.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  {a.audio_url && (
                    <audio
                      controls
                      preload="none"
                      src={a.audio_url}
                      className="h-8 max-w-[200px]"
                      aria-label={`Preview ${a.name}`}
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm">{a.name}</span>
                  <span className="text-xs tabular-nums text-muted">{formatDuration(a.duration_seconds)}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      a.approved && a.active
                        ? 'bg-accent/10 text-accent'
                        : 'bg-warning/10 text-warning'
                    }`}
                  >
                    {a.approved && a.active ? 'Ready' : 'Not usable'}
                  </span>
                  <button
                    className="btn-ghost h-8 !px-2 text-danger"
                    aria-label={`Delete ${a.name}`}
                    disabled={busyId !== null}
                    onClick={() => {
                      if (!window.confirm(`Delete the recording “${a.name}”?`)) return
                      void run(a.id, () => api.del(`/admin-panel/audio-adverts/${a.id}/`))
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Collapsible>

        <Collapsible
          icon={<Radio size={16} />}
          title="Recent breaks"
          count={logs.length}
          open={showLog}
          onToggle={() => setShowLog((v) => !v)}
        >
          {logs.length === 0 ? (
            <p className="text-sm text-muted">
              Nothing has played yet. Confirmed breaks appear here with the exact time.
            </p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {logs.slice(0, 8).map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                  <span className="tabular-nums text-muted">
                    {dateInZone(l.scheduled_for, tz)} {timeInZone(l.scheduled_for, tz)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{l.campaign_name}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      l.result === 'played'
                        ? 'bg-accent/10 text-accent'
                        : l.result === 'partial'
                          ? 'bg-warning/10 text-warning'
                          : 'bg-danger/10 text-danger'
                    }`}
                  >
                    {l.result === 'played' ? 'Played' : l.result === 'partial' ? 'Partly played' : 'Missed'}
                  </span>
                  <span className="text-xs tabular-nums text-muted">{l.seconds_played}s</span>
                </li>
              ))}
            </ul>
          )}
        </Collapsible>
      </div>

      {wizardOpen && (
        <CampaignWizard
          tz={tz}
          stationName={stationFetch.data?.name || 'the live stream'}
          onClose={() => setWizardOpen(false)}
          onDone={(campaign) => {
            setWizardOpen(false)
            setNotice(
              `“${campaign.name}” is on air.${
                campaign.next_break_at ? ` First break ${friendlyMoment(campaign.next_break_at, tz)}.` : ''
              }`,
            )
            refreshAll()
          }}
        />
      )}
    </AdminSection>
  )
}

/* --------------------------- small pieces ------------------------------- */

function Stat({
  icon,
  label,
  value,
  hint,
  tone = 'plain',
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint: string
  tone?: 'plain' | 'accent'
}) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <span
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${
          tone === 'accent' ? 'bg-accent/10 text-accent' : 'bg-surface-2 text-ink'
        }`}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
        <p className="truncate text-base font-semibold leading-tight">{value}</p>
        <p className="truncate text-xs text-muted">{hint}</p>
      </div>
    </div>
  )
}

function Collapsible({
  icon,
  title,
  count,
  open,
  onToggle,
  children,
}: {
  icon: React.ReactNode
  title: string
  count: number
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="card overflow-hidden">
      <button
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left sm:px-5"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 font-medium">
          {icon} {title}
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">{count}</span>
        </span>
        <ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="border-t border-line px-4 py-4 sm:px-5">{children}</div>}
    </div>
  )
}

/* --------------------------- wizard modal ------------------------------- */

function CampaignWizard({
  tz,
  stationName,
  onClose,
  onDone,
}: {
  tz: string
  stationName: string
  onClose: () => void
  onDone: (campaign: AudioCampaign) => void
}) {
  const [step, setStep] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<AudioCampaign | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [advertName, setAdvertName] = useState('')

  const [preset, setPreset] = useState<Preset>('daily')
  const [times, setTimes] = useState<string[]>(() => [nextStationHour(tz)])
  const [onceAt, setOnceAt] = useState('')
  const [endDate, setEndDate] = useState('')
  const [maxBreak, setMaxBreak] = useState(60)

  const [partners, setPartners] = useState<Partner[]>([])
  const [advertiserId, setAdvertiserId] = useState('')
  const [advertiserName, setAdvertiserName] = useState('')
  const [advertiserEmail, setAdvertiserEmail] = useState('')
  const [campaignName, setCampaignName] = useState('')

  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    api
      .get<Partner[] | { results: Partner[] }>('/admin-panel/partners/')
      .then((res) => {
        if (!alive) return
        setPartners(Array.isArray(res) ? res : (res.results ?? []))
      })
      .catch(() => alive && setPartners([]))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [busy, onClose])

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const pickFile = (picked: File | null) => {
    setFile(picked)
    setDuration(null)
    if (!picked) return
    if (!advertName.trim()) {
      setAdvertName(
        picked.name
          .replace(/\.[^.]+$/, '')
          .replace(/[_-]+/g, ' ')
          .trim(),
      )
    }
  }

  const canContinue = (() => {
    if (step === 1) return !!file && advertName.trim().length > 0
    if (step === 2) {
      if (preset === 'once') return onceAt.length > 0
      return times.length > 0 && times.every((t) => t.length > 0)
    }
    return advertiserId.length > 0 || advertiserName.trim().length > 0
  })()

  const next = () => {
    setError(null)
    if (!canContinue) {
      setError(
        step === 1
          ? 'Choose an audio file and give the advert a name.'
          : step === 2
            ? 'Pick at least one time for the advert to play.'
            : 'Tell us who the advert is for.',
      )
      return
    }
    setStep((s) => Math.min(3, s + 1))
  }

  const submit = async () => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('audio_file', file)
      fd.append('advert_name', advertName.trim())
      if (advertiserId) {
        fd.append('advertiser', advertiserId)
      } else {
        fd.append('advertiser_name', advertiserName.trim())
        if (advertiserEmail.trim()) fd.append('advertiser_email', advertiserEmail.trim())
      }
      if (campaignName.trim()) fd.append('campaign_name', campaignName.trim())
      fd.append('recurrence', preset)
      if (preset === 'once') {
        fd.append('once_at', stationWallClockToIso(onceAt, tz))
      } else {
        fd.append('times', times.join(','))
      }
      fd.append('max_break_seconds', String(maxBreak))
      if (endDate) fd.append('ends_at', stationWallClockToIso(`${endDate}T23:59`, tz))

      const res = await api.upload<{ campaign: AudioCampaign }>(
        '/admin-panel/audio-campaigns/quick-start/',
        fd,
      )
      setCreated(res.campaign)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the campaign. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const scheduleSummary =
    preset === 'once'
      ? onceAt
        ? `Once, ${friendlyMoment(stationWallClockToIso(onceAt, tz), tz)}`
        : 'Choose a date and time'
      : `${PRESETS.find((p) => p.id === preset)?.label} at ${times
          .filter(Boolean)
          .map((t) => t.slice(0, 5))
          .join(', ')}`

  const effectiveCampaignName =
    campaignName.trim() ||
    `${advertiserName.trim() || 'Campaign'} — ${advertName.trim() || 'Advert'}`

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wizard-title"
        className="flex max-h-[94vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-surface shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-accent">
              {created ? 'Ready' : `Step ${step} of 3`}
            </p>
            <h2 id="wizard-title" className="mt-0.5 text-lg font-semibold">
              {created
                ? 'Your advert is on air'
                : step === 1
                  ? 'Upload the recording'
                  : step === 2
                    ? 'When should it play?'
                    : 'Who is it for?'}
            </h2>
          </div>
          <button className="btn-ghost h-9 w-9 !px-0" onClick={onClose} disabled={busy} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {!created && (
          <div className="flex gap-1 px-5 pt-3">
            {[1, 2, 3].map((n) => (
              <span
                key={n}
                className={`h-1 flex-1 rounded-full transition-colors ${n <= step ? 'bg-accent' : 'bg-surface-2'}`}
              />
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <p className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
              {error}
            </p>
          )}

          {created ? (
            <div className="py-4 text-center">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-accent">
                <CheckCircle2 size={28} />
              </span>
              <p className="mt-3 font-semibold">{created.name}</p>
              <p className="mt-1 text-sm text-muted">
                {describeSchedules(created.schedules, tz)}
                {created.next_break_at ? ` · First play ${friendlyMoment(created.next_break_at, tz)}` : ''}
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <button
                  className="btn-primary"
                  onClick={async () => {
                    setBusy(true)
                    try {
                      await api.post(`/admin-panel/audio-campaigns/${created.id}/play_now/`)
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Could not play it right now.')
                    } finally {
                      setBusy(false)
                    }
                  }}
                  disabled={busy}
                >
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <Volume2 size={15} />}
                  Hear it now
                </button>
                <button className="btn-ghost" onClick={() => onDone(created)} disabled={busy}>
                  Done
                </button>
              </div>
              <p className="mt-3 text-xs text-muted">
                “Hear it now” plays the spot once on the live stream. Open the site player to listen.
              </p>
            </div>
          ) : (
            <>
              {step === 1 && (
                <div className="space-y-4">
                  <div>
                    <label className="label">Audio recording</label>
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".mp3,.ogg,.opus,.flac,.m4a,.aac,.wav"
                      className="sr-only"
                      onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                    />
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line bg-surface-2/60 px-4 py-8 text-center transition-colors hover:border-accent/50 hover:bg-surface-2"
                    >
                      <span className="grid h-11 w-11 place-items-center rounded-full bg-accent/10 text-accent">
                        <Upload size={19} />
                      </span>
                      <span className="text-sm font-medium">
                        {file ? file.name : 'Click to choose an audio file'}
                      </span>
                      <span className="text-xs text-muted">MP3, M4A, WAV, OGG, FLAC or AAC — up to 150 MB</span>
                    </button>
                    {previewUrl && (
                      <div className="mt-3 rounded-xl bg-surface-2 p-3">
                        <audio
                          controls
                          src={previewUrl}
                          className="w-full"
                          onLoadedMetadata={(e) => {
                            const d = e.currentTarget.duration
                            if (Number.isFinite(d) && d > 0) {
                              setDuration(d)
                              setMaxBreak(Math.max(60, Math.ceil(d) + 10))
                            }
                          }}
                        />
                        <p className="mt-1 text-xs text-muted">
                          Length {duration ? formatDuration(duration) : 'checking…'} · Listen once to be sure
                          it sounds right.
                        </p>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="label" htmlFor="advert-name">
                      What should we call this advert?
                    </label>
                    <input
                      id="advert-name"
                      className="input"
                      value={advertName}
                      onChange={(e) => setAdvertName(e.target.value)}
                      placeholder="e.g. Sunday service invitation"
                      maxLength={160}
                    />
                    <p className="hint">Only you see this name — it is not read out on air.</p>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-4">
                  <div>
                    <span className="label">How often?</span>
                    <div className="grid grid-cols-2 gap-2">
                      {PRESETS.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setPreset(p.id)}
                          className={`rounded-xl border px-3 py-3 text-left transition-colors ${
                            preset === p.id
                              ? 'border-accent bg-accent/5 ring-1 ring-accent/30'
                              : 'border-line bg-surface hover:bg-surface-2'
                          }`}
                        >
                          <span className="block text-sm font-medium">{p.label}</span>
                          <span className="block text-xs text-muted">{p.hint}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {preset === 'once' ? (
                    <div>
                      <label className="label" htmlFor="once-at">
                        Date and time
                      </label>
                      <input
                        id="once-at"
                        type="datetime-local"
                        className="input"
                        value={onceAt}
                        onChange={(e) => setOnceAt(e.target.value)}
                      />
                      <p className="hint">Station clock: {tz}</p>
                    </div>
                  ) : (
                    <div>
                      <span className="label">Time{times.length > 1 ? 's' : ''} of day</span>
                      <div className="space-y-2">
                        {times.map((t, i) => (
                          <div key={i} className="flex gap-2">
                            <input
                              type="time"
                              className="input"
                              value={t}
                              onChange={(e) => {
                                const nextTimes = [...times]
                                nextTimes[i] = e.target.value
                                setTimes(nextTimes)
                              }}
                            />
                            {times.length > 1 && (
                              <button
                                type="button"
                                className="btn-ghost h-10 w-10 shrink-0 !px-0 text-danger"
                                aria-label="Remove this time"
                                onClick={() => setTimes(times.filter((_, j) => j !== i))}
                              >
                                <X size={14} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="btn-ghost mt-2 !px-2 text-xs"
                        onClick={() => setTimes([...times, '18:00'])}
                      >
                        <Plus size={13} /> Add another time
                      </button>
                      <p className="hint">
                        Times use the station clock ({tz}). The break starts at the next song change.
                      </p>
                    </div>
                  )}

                  <div className="rounded-xl bg-surface-2 px-3 py-2.5 text-sm">
                    <span className="text-muted">Will play: </span>
                    <span className="font-medium">{scheduleSummary}</span>
                  </div>

                  <details className="rounded-xl border border-line px-3 py-2">
                    <summary className="cursor-pointer text-sm font-medium text-muted">
                      Advanced (optional)
                    </summary>
                    <div className="mt-3 grid gap-3">
                      <div>
                        <label className="label" htmlFor="max-break">
                          Maximum break length
                        </label>
                        <select
                          id="max-break"
                          className="input"
                          value={maxBreak}
                          onChange={(e) => setMaxBreak(Number(e.target.value))}
                        >
                          {[30, 60, 90, 120, 180].map((v) => (
                            <option key={v} value={v}>
                              {v} seconds
                            </option>
                          ))}
                        </select>
                        <p className="hint">Auto-picked to fit your recording.</p>
                      </div>
                      <div>
                        <label className="label" htmlFor="end-date">
                          Stop after (optional)
                        </label>
                        <input
                          id="end-date"
                          type="date"
                          className="input"
                          value={endDate}
                          onChange={(e) => setEndDate(e.target.value)}
                        />
                        <p className="hint">Leave empty to keep playing until you pause it.</p>
                      </div>
                    </div>
                  </details>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-4">
                  <div>
                    <label className="label" htmlFor="advertiser-select">
                      Who is this advert for?
                    </label>
                    <select
                      id="advertiser-select"
                      className="input"
                      value={advertiserId}
                      onChange={(e) => setAdvertiserId(e.target.value)}
                    >
                      <option value="">New advertiser…</option>
                      {partners.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    {!advertiserId && (
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <input
                          className="input"
                          value={advertiserName}
                          onChange={(e) => setAdvertiserName(e.target.value)}
                          placeholder="Business or station name"
                          maxLength={160}
                        />
                        <input
                          className="input"
                          type="email"
                          value={advertiserEmail}
                          onChange={(e) => setAdvertiserEmail(e.target.value)}
                          placeholder="Billing email (optional)"
                        />
                      </div>
                    )}
                    <p className="hint">
                      {advertiserId
                        ? 'Using an advertiser you already saved.'
                        : 'We will save this name for next time — no separate setup needed.'}
                    </p>
                  </div>

                  <div>
                    <label className="label" htmlFor="campaign-name">
                      Campaign name <span className="font-normal text-muted">(optional)</span>
                    </label>
                    <input
                      id="campaign-name"
                      className="input"
                      value={campaignName}
                      onChange={(e) => setCampaignName(e.target.value)}
                      placeholder={effectiveCampaignName}
                      maxLength={160}
                    />
                    <p className="hint">Leave empty and we name it for you.</p>
                  </div>

                  <div className="rounded-xl border border-line bg-surface-2 p-3 text-sm">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Review</p>
                    <dl className="space-y-1.5">
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted">Campaign</dt>
                        <dd className="truncate text-right font-medium">{effectiveCampaignName}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted">Recording</dt>
                        <dd className="truncate text-right font-medium">
                          {advertName || '—'} {duration ? `(${formatDuration(duration)})` : ''}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted">Plays</dt>
                        <dd className="text-right font-medium">{scheduleSummary}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted">Starts</dt>
                        <dd className="text-right font-medium">Right away</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted">Station</dt>
                        <dd className="text-right font-medium">{stationName}</dd>
                      </div>
                    </dl>
                  </div>

                  <p className="flex items-start gap-2 rounded-xl bg-accent/5 px-3 py-2 text-xs text-muted">
                    <Check size={14} className="mt-0.5 shrink-0 text-accent" />
                    Pressing “Put on air” approves the recording, marks billing as paid and switches the campaign
                    on. You can pause it any time.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {!created && (
          <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-4">
            <button
              className="btn-ghost"
              onClick={() => (step === 1 ? onClose() : setStep((s) => s - 1))}
              disabled={busy}
            >
              {step === 1 ? 'Cancel' : 'Back'}
            </button>
            {step < 3 ? (
              <button className="btn-primary" onClick={next} disabled={busy}>
                Continue
              </button>
            ) : (
              <button
                className="btn-primary"
                onClick={() => void submit()}
                disabled={busy || !file || !(advertiserId || advertiserName.trim())}
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
                {busy ? 'Starting…' : 'Put on air'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/* -------------------------- add time form ------------------------------- */

function AddTimeForm({
  campaignId,
  busy,
  defaultMax,
  onSaved,
}: {
  campaignId: string
  busy: boolean
  defaultMax: number
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [preset, setPreset] = useState<Exclude<Preset, 'once'>>('daily')
  const [time, setTime] = useState('12:00')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {
        recurrence: preset === 'daily' ? 'daily' : 'weekly',
        starts_at: new Date().toISOString(),
        local_time: time,
        max_break_seconds: Math.max(10, Math.min(300, defaultMax)),
      }
      if (preset === 'weekdays') {
        for (const day of [0, 1, 2, 3, 4]) {
          await api.post(`/admin-panel/audio-campaigns/${campaignId}/schedules/`, { ...payload, weekday: day })
        }
      } else if (preset === 'weekends') {
        for (const day of [5, 6]) {
          await api.post(`/admin-panel/audio-campaigns/${campaignId}/schedules/`, { ...payload, weekday: day })
        }
      } else {
        await api.post(`/admin-panel/audio-campaigns/${campaignId}/schedules/`, payload)
      }
      setOpen(false)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add this time.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button className="btn-ghost mt-2 !px-2 text-xs" onClick={() => setOpen(true)} disabled={busy}>
        <Plus size={13} /> Add another time
      </button>
    )
  }

  return (
    <form onSubmit={save} className="mt-3 flex flex-wrap items-end gap-2 rounded-xl bg-surface p-3">
      <label className="text-xs">
        <span className="mb-1 block font-medium text-muted">When</span>
        <select
          className="input !w-auto !py-1.5 text-xs"
          value={preset}
          onChange={(e) => setPreset(e.target.value as Exclude<Preset, 'once'>)}
        >
          <option value="daily">Every day</option>
          <option value="weekdays">Weekdays</option>
          <option value="weekends">Weekends</option>
        </select>
      </label>
      <label className="text-xs">
        <span className="mb-1 block font-medium text-muted">At</span>
        <input
          type="time"
          className="input !w-auto !py-1.5 text-xs"
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
      </label>
      <button type="submit" className="btn-primary h-8 !px-3 text-xs" disabled={saving || busy}>
        {saving ? 'Saving…' : 'Add time'}
      </button>
      <button type="button" className="btn-ghost h-8 !px-3 text-xs" onClick={() => setOpen(false)} disabled={saving}>
        Cancel
      </button>
      {error && <p className="w-full text-xs text-danger">{error}</p>}
    </form>
  )
}

/* -------------------------- advert upload -------------------------------- */

function AdvertUpload({ busy, onUploaded }: { busy: boolean; onUploaded: () => void }) {
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!file || !name.trim()) {
      setError('Choose a file and give the recording a name.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('name', name.trim())
      fd.append('approved', 'true')
      fd.append('active', 'true')
      fd.append('audio_file', file)
      await api.upload('/admin-panel/audio-adverts/', fd)
      setName('')
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
      onUploaded()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
      <input
        className="input"
        placeholder="Recording name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={160}
      />
      <input ref={inputRef} className="input" type="file" accept=".mp3,.ogg,.opus,.flac,.m4a,.aac,.wav" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <button type="submit" className="btn-primary" disabled={saving || busy}>
        {saving ? 'Uploading…' : 'Upload'}
      </button>
      {error && <p className="text-xs text-danger sm:col-span-3">{error}</p>}
    </form>
  )
}
