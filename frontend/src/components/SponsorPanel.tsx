import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, Banner } from '../lib/api'

const ROTATION_MS = 8000
const REFRESH_MS = 45_000 // re-check eligibility: campaigns start/stop on a schedule

/**
 * Sponsor panel: rotates eligible banners served by the backend.
 * - impression recorded (debounced) when a banner becomes visible
 * - click recorded before navigating
 * - rotation pauses while the tab is hidden
 * - renders poster-shaped creatives (tall) and banners (wide) faithfully:
 *   images keep their aspect ratio inside a generous frame instead of being
 *   cropped, so advertisers can upload posters
 * - shows an "Advertise With Us" placeholder when no campaign is eligible
 */
export function SponsorPanel({ placement = 'sidebar' }: { placement?: string }) {
  const [banners, setBanners] = useState<Banner[]>([])
  const [index, setIndex] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const impressionTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  useEffect(() => {
    let alive = true
    const load = () => {
      api
        .get<{ results: Banner[] }>(`/ads/banners/?placement=${placement}`)
        .then((res) => {
          if (alive) {
            setBanners(res.results)
            setLoaded(true)
          }
        })
        .catch(() => alive && setLoaded(true))
    }
    load()
    // Scheduled campaigns flip on/off without a page reload — re-check
    // periodically and whenever the tab returns to the foreground.
    const id = setInterval(load, REFRESH_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      Object.values(impressionTimers.current).forEach(clearTimeout)
    }
  }, [placement])

  const current = banners.length > 0 ? banners[index % banners.length] : null

  // Rotation — skip ticks while the tab is hidden.
  useEffect(() => {
    if (banners.length < 2) return
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') setIndex((i) => (i + 1) % banners.length)
    }, ROTATION_MS)
    return () => clearInterval(id)
  }, [banners.length])

  // Record an impression ~1.5s after a banner is actually shown.
  useEffect(() => {
    if (!current) return
    const timer = setTimeout(() => {
      api.post(`/ads/banners/${current.id}/impression/`).catch(() => {
        /* tracking must never break the UI */
      })
    }, 1500)
    impressionTimers.current[current.id] = timer
    return () => clearTimeout(timer)
  }, [current])

  const handleClick = () => {
    if (!current) return
    api.post(`/ads/banners/${current.id}/click/`).catch(() => {
      /* ignore */
    })
  }

  const label = useMemo(() => (banners.length > 1 ? `${(index % banners.length) + 1}/${banners.length}` : null), [index, banners.length])

  return (
    <aside className="card flex flex-col overflow-hidden" aria-label="Advertisement">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">Sponsored</span>
        {label && <span className="text-xs tabular-nums text-muted">{label}</span>}
      </div>

      <div className="p-4">
        {!loaded && <div className="aspect-[16/9] animate-pulse rounded-lg bg-surface-2" aria-hidden />}

        {loaded && current && (
          <a
            key={current.id}
            href={current.destination_url}
            target="_blank"
            rel="noopener noreferrer sponsored"
            onClick={handleClick}
            className="group block"
          >
            {current.banner_url ? (
              <div className="overflow-hidden rounded-lg bg-surface-2">
                <img
                  src={current.banner_url}
                  alt={`${current.name} — advertisement by ${current.advertiser_name}`}
                  className="max-h-[520px] w-full object-contain transition-opacity group-hover:opacity-90"
                  decoding="async"
                />
              </div>
            ) : (
              <div className="flex aspect-[16/9] items-center justify-center rounded-lg bg-surface-2 text-sm text-muted">
                {current.name}
              </div>
            )}
            <p className="mt-2 truncate text-xs text-muted">
              {current.advertiser_name}
              <span className="ml-1 opacity-60">↗</span>
            </p>
          </a>
        )}

        {loaded && !current && (
          <Link
            to="/advertise"
            className="flex aspect-[16/9] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line bg-surface-2 px-4 text-center transition-colors hover:border-accent/50"
          >
            <span className="text-sm font-medium">Advertise With Us</span>
            <span className="text-xs text-muted">Reach a global audience — banner & audio spots</span>
          </Link>
        )}
      </div>
    </aside>
  )
}
