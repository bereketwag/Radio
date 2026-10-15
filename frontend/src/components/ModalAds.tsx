import { X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api, Banner } from '../lib/api'

const COOLDOWN_MS = 45_000 // minimum gap between modal showings
const MAX_PER_SESSION = 3 // never nag: at most 3 modals per browsing session
const IMPRESSION_DELAY_MS = 1500
const OPEN_DELAY_MS = 4000 // let the page settle before the interstitial

const SEEN_KEY = 'aurora.modals.seen'
const COUNT_KEY = 'aurora.modals.shown'

function readSeen(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? '[]')
  } catch {
    return []
  }
}

function markSeen(id: string) {
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...readSeen(), id])]))
  } catch {
    /* private mode */
  }
}

function bumpShown(): number {
  try {
    const n = Number(sessionStorage.getItem(COUNT_KEY) ?? '0') + 1
    sessionStorage.setItem(COUNT_KEY, String(n))
    return n
  } catch {
    return MAX_PER_SESSION
  }
}

/**
 * Modal takeover ads — the third ad format (beside side-label banners and
 * mid-break voice spots).
 *
 * Rules, all enforced here or (eligibility/time-window) by the backend:
 * - only campaigns with placement=modal, served by /ads/banners/
 * - each campaign shows at most once per browsing session
 * - a cooldown separates showings; a hard cap ends them for the session
 * - fully dismissible (button, ESC, backdrop); never blocks audio playback
 * - impression recorded when the modal is actually visible; click on CTA
 */
export function ModalAds() {
  const location = useLocation()
  const [campaigns, setCampaigns] = useState<Banner[]>([])
  const [current, setCurrent] = useState<Banner | null>(null)
  const impressionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Never show ads inside the admin dashboard, account area, or auth flows.
  const blocked =
    location.pathname.startsWith('/admin') ||
    location.pathname.startsWith('/account') ||
    location.pathname.startsWith('/reset-password')

  useEffect(() => {
    let alive = true
    api
      .get<{ results: Banner[] }>('/ads/banners/?placement=modal')
      .then((res) => alive && setCampaigns(res.results))
      .catch(() => {
        /* no campaigns — nothing to show */
      })
    return () => {
      alive = false
    }
  }, [location.pathname])

  const close = useCallback(() => {
    setCurrent(null)
    if (impressionTimer.current) clearTimeout(impressionTimer.current)
  }, [])

  useEffect(() => {
    if (blocked || campaigns.length === 0) return
    let timer: ReturnType<typeof setTimeout> | null = null

    const schedule = (delay: number) => {
      timer = setTimeout(() => {
        // Wait for a visible tab; try again shortly.
        if (document.visibilityState !== 'visible') {
          schedule(COOLDOWN_MS)
          return
        }
        const seen = readSeen()
        const candidates = campaigns.filter((c) => !seen.includes(c.id))
        if (candidates.length === 0) return // every campaign shown this session
        if (bumpShown() > MAX_PER_SESSION) return // session cap reached
        setCurrent(candidates[0])
        markSeen(candidates[0].id)
        // Further unseen campaigns follow after the cooldown.
        schedule(COOLDOWN_MS)
      }, delay)
    }

    schedule(OPEN_DELAY_MS)
    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [blocked, campaigns])

  // Record an impression ~1.5s after the modal is actually on screen.
  useEffect(() => {
    if (!current) return
    impressionTimer.current = setTimeout(() => {
      api.post(`/ads/banners/${current.id}/impression/`).catch(() => {
        /* tracking must never break the UI */
      })
    }, IMPRESSION_DELAY_MS)
    return () => {
      if (impressionTimer.current) clearTimeout(impressionTimer.current)
    }
  }, [current])

  // ESC closes.
  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, close])

  const handleClick = () => {
    if (!current) return
    api.post(`/ads/banners/${current.id}/click/`).catch(() => {
      /* ignore */
    })
  }

  if (!current) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm motion-safe:animate-[fadein_200ms_ease-out]"
      role="dialog"
      aria-modal="true"
      aria-label={`Advertisement: ${current.name}`}
      onClick={close}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">Advertisement</span>
          <button
            className="btn-ghost h-8 w-8 !rounded-full !px-0"
            aria-label="Close advertisement"
            onClick={close}
          >
            <X size={15} />
          </button>
        </div>

        <a href={current.destination_url} target="_blank" rel="noopener noreferrer sponsored" onClick={handleClick}>
          {current.banner_url ? (
            <img
              src={current.banner_url}
              alt={`${current.name} — advertisement by ${current.advertiser_name}`}
              className="max-h-[65vh] w-full object-contain"
              decoding="async"
            />
          ) : (
            <div className="flex h-64 items-center justify-center bg-surface-2 text-sm text-muted">
              {current.name}
            </div>
          )}
          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{current.advertiser_name}</p>
              <p className="truncate text-xs text-muted">{current.name}</p>
            </div>
            <span className="btn-primary h-9 shrink-0 !px-4">
              Visit site <span aria-hidden>↗</span>
            </span>
          </div>
        </a>
      </div>
    </div>
  )
}
