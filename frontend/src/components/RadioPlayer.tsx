import { Loader2, Pause, Play, RotateCw, Volume1, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNowPlaying } from '../lib/useNowPlaying'
import { usePlayer } from '../lib/usePlayer'
import { useStation } from '../lib/useStation'
import { AudioVisualizer } from './AudioVisualizer'

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

function formatDateTime(ms: number): string {
  // "October 14, 2026 · 8:15 PM" — date plus hour:minute, nothing more.
  const d = new Date(ms)
  const date = new Intl.DateTimeFormat(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(d)
  const time = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
  return `${date} · ${time}`
}

/** Ticking "now" anchored to the server clock, so progress never drifts. */
function useServerNow(offsetMs: number): number {
  const [now, setNow] = useState(() => Date.now() + offsetMs)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offsetMs), 1000)
    return () => clearInterval(t)
  }, [offsetMs])
  return now
}

export function RadioPlayer({ compact = false }: { compact?: boolean }) {
  const { data, status, clockOffsetMs } = useNowPlaying()
  const { state, errorMessage, volume, muted, needsUserGesture, toggle, setVolume, setMuted } = usePlayer()
  const station = useStation()
  const serverNow = useServerNow(clockOffsetMs)

  const position = useMemo(() => {
    if (!data?.started_at || !data.duration_seconds) return null
    const started = new Date(data.started_at).getTime()
    if (Number.isNaN(started)) return null
    const elapsed = (serverNow - started) / 1000
    return Math.min(Math.max(elapsed, 0), data.duration_seconds)
  }, [data?.started_at, data?.duration_seconds, serverNow])

  const isPlaying = state === 'playing' || state === 'connecting' || state === 'reconnecting'
  const progressPct =
    position !== null && data?.duration_seconds ? (position / data.duration_seconds) * 100 : null

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  const statusLabel = (() => {
    switch (state) {
      case 'idle':
        return 'Ready to play'
      case 'connecting':
        return 'Connecting…'
      case 'playing':
        return 'Listening live'
      case 'paused':
        return 'Paused'
      case 'reconnecting':
        return 'Reconnecting…'
      case 'error':
        return 'Stream unavailable'
    }
  })()

  const errorNote =
    errorMessage ??
    (status === 'offline' ? 'The broadcast engine is offline. The stream will resume automatically.' : null)

  const liveBadge = data?.live ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent">
      <span className="h-1.5 w-1.5 rounded-full bg-accent animate-live-pulse" aria-hidden />
      LIVE
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning">
      <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden />
      OFFLINE
    </span>
  )

  const artwork = data?.artwork_url

  return (
    <section className="player-card" aria-label="Radio player">
      {/* Glass-layered spectrum drawn inside the card; the fixed background
          visualizer in App keeps the whole page alive. */}
      <AudioVisualizer variant="card" />
      <div className={`relative z-10 ${compact ? 'p-5 sm:p-6' : 'p-5 sm:p-8'}`}>
        <div className={compact ? 'flex flex-col gap-5' : 'flex flex-col gap-6 sm:flex-row sm:items-center sm:gap-8'}>
          <div
            className={`relative mx-auto w-full max-w-[260px] shrink-0 overflow-hidden rounded-xl bg-surface-2/80 sm:mx-0 ${
              compact ? 'aspect-square max-w-[140px]' : 'aspect-square sm:w-48'
            }`}
          >
            {artwork ? (
              <img
                src={artwork}
                alt={data?.title ? `Artwork for ${data.title}` : 'Album artwork'}
                className="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-muted" aria-hidden>
                <svg viewBox="0 0 48 48" className="h-12 w-12 opacity-40" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="24" cy="24" r="20" />
                  <circle cx="24" cy="24" r="6" />
                  <path d="M24 4v8M24 36v8M4 24h8M36 24h8" strokeLinecap="round" />
                </svg>
              </div>
            )}
            <div className="absolute left-3 top-3">{liveBadge}</div>
          </div>

          <div className="min-w-0 flex-1 text-center sm:text-left">
            <p className="text-xs font-medium uppercase tracking-wider text-muted">
              {station?.name ?? 'Aurora Radio'}
            </p>
            <h1
              className={`mt-1 truncate font-semibold tracking-tight ${compact ? 'text-xl' : 'text-2xl sm:text-3xl'}`}
              title={data?.title ?? undefined}
            >
              {data?.title ?? (data?.live ? 'On air' : 'Stream offline')}
            </h1>
            <p className="mt-1 truncate text-muted">
              {data?.artist ?? (data?.live ? 'Metadata unavailable' : 'Waiting for the broadcast engine…')}
            </p>
            {data?.album && <p className="mt-0.5 truncate text-sm text-muted">{data.album}</p>}

            {progressPct !== null && position !== null && data?.duration_seconds ? (
              <div className="mt-4" aria-label="Track progress">
                <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2/80">
                  <div className="h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear" style={{ width: `${progressPct}%` }} />
                </div>
                <div className="mt-1.5 flex justify-between text-xs text-muted">
                  <span>{formatClock(position)}</span>
                  <span>{formatClock(data.duration_seconds)}</span>
                </div>
              </div>
            ) : (
              <div className="mt-4 h-1" aria-hidden />
            )}

            <div className="mt-4 flex flex-wrap items-center justify-center gap-3 sm:justify-start">
              <button
                onClick={toggle}
                className="btn-primary h-12 px-6 text-base"
                aria-label={isPlaying ? 'Pause the radio' : 'Play the radio live'}
              >
                {state === 'connecting' || state === 'reconnecting' ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    {state === 'reconnecting' ? 'Reconnecting' : 'Connecting'}
                  </>
                ) : isPlaying ? (
                  <>
                    <Pause size={18} />
                    Pause
                  </>
                ) : (
                  <>
                    <Play size={18} />
                    Play Radio
                  </>
                )}
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setMuted(!muted)}
                  className="btn-ghost h-9 w-9 !rounded-full !px-0"
                  aria-label={muted ? 'Unmute' : 'Mute'}
                >
                  <VolumeIcon size={16} />
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={muted ? 0 : volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-surface-2 accent-accent"
                  aria-label="Volume"
                />
              </div>
            </div>

            <div className="mt-3 flex items-center justify-center gap-2 text-xs text-muted sm:justify-start" role="status" aria-live="polite">
              {state === 'reconnecting' && <RotateCw size={12} className="animate-spin" />}
              <span>{statusLabel}</span>
              {data?.listeners_measured && data.listeners !== null && (
                <>
                  <span aria-hidden>·</span>
                  <span>
                    {data.listeners} {data.listeners === 1 ? 'listener' : 'listeners'}
                  </span>
                </>
              )}
            </div>

            {needsUserGesture && !errorMessage && (
              <p className="mt-2 text-sm text-warning" role="alert">
                Your browser blocked autoplay — tap Play to start listening.
              </p>
            )}
            {errorNote && (state === 'error' || state === 'reconnecting' || status === 'offline') && (
              <p className="mt-2 text-sm text-danger" role="alert">
                {errorNote}
              </p>
            )}
          </div>
        </div>

        <p className="relative z-10 mt-6 border-t border-line/70 pt-4 text-sm tabular-nums text-ink/90">
          {formatDateTime(serverNow)}
        </p>
      </div>
    </section>
  )
}
