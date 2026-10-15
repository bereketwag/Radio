/**
 * Minimal typed API client.
 *
 * Auth: DRF token in the Authorization header, persisted in localStorage.
 * CSRF: only needed for session auth (django-admin); token auth requests are
 * CSRF-exempt, so this client stays simple.
 */

const TOKEN_KEY = 'aurora.token'

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* private mode */
  }
}

export class ApiError extends Error {
  status: number
  details: unknown
  constructor(status: number, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.details = details
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  }
  const token = getToken()
  if (token) headers.Authorization = `Token ${token}`
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(path.startsWith('http') ? path : `/api${path}`, {
    ...options,
    headers,
  })

  if (res.status === 204) return undefined as T

  let data: unknown = null
  const text = await res.text()
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!res.ok) {
    const detail =
      (data as { detail?: string })?.detail ||
      (typeof data === 'object' && data !== null
        ? Object.entries(data as Record<string, unknown>)
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
            .join(' · ')
        : null) ||
      `Request failed (${res.status})`
    throw new ApiError(res.status, detail, data)
  }
  return data as T
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body ?? {}) }),
  patch: <T,>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T,>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  del: <T,>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T,>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
  /** Multipart PATCH — edits that may replace a file (audio, artwork, banner). */
  patchForm: <T,>(path: string, form: FormData) => request<T>(path, { method: 'PATCH', body: form }),
}

/* ---------------------------- domain types ------------------------------- */

export interface StationConfig {
  name: string
  tagline: string
  timezone: string
  contact_email: string
  contact_address: string
  social: Record<string, string>
  /** Theme colour chosen in the admin dashboard (hex, e.g. #169154). */
  accent_color: string
  stream_url: string
}

export interface StationSettings {
  name: string
  tagline: string
  contact_email: string
  contact_address: string
  accent_color: string
  broadcast_enabled: boolean
  fallback_audio_url: string | null
  updated_at: string
}

export interface NowPlaying {
  live: boolean
  /** False = the operator turned the station off; the engine loops the off-air track. */
  broadcast_enabled: boolean
  server_time: string
  kind: 'music' | 'advert' | 'fallback'
  title: string | null
  artist: string | null
  album: string | null
  artwork_url: string | null
  started_at: string | null
  duration_seconds: number | null
  position_seconds: number | null
  station_time: string
  broadcast_date: string
  timezone: string
  listeners: number | null
  listeners_measured: boolean
  stream_url: string | null
  track_id: string | null
}

export interface HistoryItem {
  id: string
  kind: string
  title: string
  artist: string
  album: string
  started_at: string
  duration_seconds: number
  artwork_url: string | null
  is_current: boolean
}

export interface Banner {
  id: string
  name: string
  advertiser_name: string
  banner_url: string | null
  destination_url: string
  placement: string
}

export interface User {
  id: string
  email: string
  username: string
  display_name: string
  role: string
  organization: string
  phone: string
  date_joined: string
}
