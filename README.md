# Aurora Radio — Premium 24/7 Global Radio

A production-quality internet radio platform: one globally synchronized live
stream, real-time now-playing metadata, rotating banner ads, scheduled audio
advertisements, advertiser self-service, and a secure admin dashboard.

**Stack:** React + Vite + TypeScript + Tailwind (frontend) · Django + DRF
(backend) · PostgreSQL (production) / SQLite (dev) · Liquidsoap + Icecast
(broadcast) · Docker Compose (deployment).

---

## Architecture

```
┌────────────┐   M3U playlist    ┌──────────────┐   metadata/ads    ┌─────────────┐
│ Liquidsoap │ ────────────────► │   Django     │ ◄──────────────── │  Website    │
│ (engine)   │ ────────────────► │   backend    │ ────────────────► │  (React)    │
└─────┬──────┘   now-playing     └──────┬───────┘   REST + SSE      └──────┬──────┘
      │ audio                                        ▲                      │ audio
      ▼                                              │ Icecast stats        ▼
┌────────────┐                                ┌─────┴──────┐        ┌────────────┐
│  Icecast   │ ◄──── listener count ─────────│ PostgreSQL │        │  Browser   │
│ (stream)   │                               └────────────┘        │ <audio>    │
└────────────┘                                                     └────────────┘
```

Key invariant: **one broadcast timeline.** Liquidsoap is the only thing that
decides what plays; it reports every track to Django, which mirrors the state
and serves it to every visitor. Listeners attach to the single live Icecast
mount, so joining mid-song means hearing the song at its current position.

---

## Quick start (Docker)

```bash
cp .env.example .env
# edit .env: set DJANGO_SECRET_KEY, POSTGRES_PASSWORD, BROADCAST_API_KEY,
#            ICECAST_*_PASSWORD at minimum

docker compose up --build
```

| Service    | URL                          |
|------------|------------------------------|
| Website    | http://localhost:8080        |
| Admin UI   | http://localhost:8080/admin  |
| Django admin | http://localhost:8080/django-admin/ |
| Icecast    | http://localhost:8001/status.xsl |

Bootstrap the admin account (all content — tracks, playlists, campaigns — lives in
the database and is entered from `/admin`; there is no demo seed):

```bash
docker compose exec backend python manage.py init_station --fresh --email you@station.fm --password 'a-long-password'
```

`init_station` without `--fresh` only makes sure the admin from `ADMIN_EMAIL` /
`.env` exists (safe to run on every start; the container does this automatically).
`--fresh` wipes every table and removes every account first, so it asks for
`--yes` to confirm.

---

## Local development (no Docker)

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py init_station --email you@station.fm --password 'a-long-password'  # admin only
python manage.py runserver 8000
```

SQLite is used when `DATABASE_URL` is empty. Tests:

```bash
python manage.py test apps
```

### Frontend

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173, proxies /api → :8000
```

### Broadcast engine (optional locally)

Without Liquidsoap/Icecast the site runs fine and honestly reports
**Stream offline** — it never simulates playback. To get real audio locally,
run just the streaming services from the compose file (Icecast is published
on host port **8001**, never 8000, so it can't collide with the Django dev
server):

```bash
docker compose up icecast liquidsoap
```

Or install Liquidsoap 2.x + Icecast 2 natively and run Icecast on port 8001
with [streaming/icecast/icecast.xml](streaming/icecast/icecast.xml), then:

```bash
liquidsoap streaming/liquidsoap/radio.liq   # needs BACKEND_URL, BROADCAST_KEY,
                                            # ICECAST_* env vars set
```

The Vite dev server forwards `/live/*` to `http://localhost:8001` and strips
the `/live` prefix (mirroring the production nginx rule), so the browser
plays `/live/radio` exactly as it does in Docker. Override with
`VITE_ICECAST_ORIGIN` if your Icecast lives elsewhere.

---

## Environment variables

All configuration is via environment (see [`.env.example`](.env.example) for
the complete, commented list). Highlights:

| Variable | Purpose |
|----------|---------|
| `DJANGO_SECRET_KEY` | Django signing key — required, never commit |
| `DATABASE_URL` | Postgres URL; empty ⇒ SQLite (dev only) |
| `BROADCAST_API_KEY` | Shared secret: Liquidsoap → Django internal endpoints |
| `STREAM_PUBLIC_URL` | Public audio URL the browser plays (`/live/radio` behind nginx) |
| `ICECAST_STATS_URL` | Server-side stats URL for **measured** listener counts |
| `STATION_*` | Branding, contact, social links, timezone |
| `MAX_AUDIO_UPLOAD_MB` / `MAX_IMAGE_UPLOAD_MB` | Upload limits |
| `DEFAULT_STORAGE_BACKEND` | Swap local storage for S3 (django-storages) |

Secrets never ship in frontend code; the SPA only reads public config from
`GET /api/station/`.

---

## Streaming configuration

**Liquidsoap** ([streaming/liquidsoap/radio.liq](streaming/liquidsoap/radio.liq))
- Playlist: `GET /api/internal/playlist.m3u` (enabled tracks of the default playlist), reloaded every 60s
- Now playing: POSTs title/artist/album/duration/started-at to `/api/internal/ingest/` on every track change
- Heartbeat: every 15s to `/api/internal/heartbeat/` — marks the engine online (site shows OFFLINE after 90s of silence) and receives the broadcast switch: `broadcast_enabled` + the off-air track URL
- Ad breaks: polls `/api/internal/ad-break/` every 15s; when the backend opens a break window, it queues the campaign's adverts (capped by the schedule's max break length) and reports actual plays to `/api/internal/ad-played/`. Ads never air while the broadcast is off.
- Broadcast on/off: the admin toggle (`StationSettings.broadcast_enabled`) puts the engine into the off-air state — it loops the uploaded off-air track (or the local silence file) all day and skips the music rotation; flipping it back on returns to the library within ~15s
- Recovery: `fallback()` chain (off-air → ads → music → local emergency WAV); playlist/source failures never silence the mount

**Icecast** ([streaming/icecast/icecast.xml](streaming/icecast/icecast.xml))
- Mount `/radio`, public, CORS-enabled
- Listener counts read by Django via `/status-json.xsl` (`manage.py poll_icecast`, run from cron)

**Ad break scheduling policy (documented behavior):**
1. Django owns the schedule: one-time / daily / weekly, in `STATION_TIMEZONE`, with campaign start/end windows.
2. A break window opens at the scheduled instant and stays open up to 5 minutes — the engine finishes the current track before switching (safe-point policy). Tracks are never restarted or skipped.
3. Overlapping breaks: conflict detection warns at schedule-save time; at airtime the higher-priority campaign runs and the other is logged.
4. If the engine doesn't confirm a play, `manage.py check_ad_breaks` marks the break **missed** and raises a health event — scheduled-vs-played is reported honestly.

**Cron jobs (production):**

```cron
* * * * *  cd /app && python manage.py poll_icecast
*/5 * * * * cd /app && python manage.py check_ad_breaks
```

---

## Admin dashboard

`/admin` (station roles only; anonymous visitors are redirected to sign-in).

- **Overview** — broadcast status, live listener count (measured), active campaigns, pending requests, impressions/clicks, upcoming breaks, recent errors
- **Ad requests** — review, approve/reject submissions
- **Banner campaigns** — upload banners, set placement/priority/window, pause/activate, payment status, impressions/clicks/CTR
- **Audio campaigns** — upload adverts, schedules with recurrence + conflict warnings, kill-switch, broadcast logs (played vs missed)
- **Music library** — upload audio (validated types/sizes), tag metadata, ISRC/label/territories, enable/disable, per-track airing history
- **Playlists** — create, add/remove/reorder tracks, default + fallback designation
- **Settings** — station branding, theme colour, broadcast on/off switch, off-air track upload (loops while off)
- **Users** — role management (super admin only)
- **System log** — audit trail + broadcast health events

Roles: `super_admin`, `station_admin`, `ad_manager`, `advertiser`, `listener`.
Registration always creates a listener; privileged roles are assigned by a
super admin only.

---

## API overview

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/broadcast/now-playing/` | public | Current item, server clock, measured listeners |
| GET | `/api/broadcast/now-playing/stream/` | public | SSE: metadata updates without reload |
| GET | `/api/broadcast/history/` | public | Recently aired (engine log) |
| GET | `/api/ads/banners/` | public | Eligible banners in rotation order |
| POST | `/api/ads/banners/{id}/impression/` `/click/` | public | Measured events (throttled) |
| POST | `/api/ads/requests/` | public | Advertiser request form (throttled) |
| POST | `/api/auth/register/` `/login/` `/logout/` | public | Token auth |
| POST | `/api/internal/ingest/` | `X-Broadcast-Key` | Engine: now playing |
| POST | `/api/internal/heartbeat/` | `X-Broadcast-Key` | Engine: liveness + broadcast switch + off-air track URL |
| POST | `/api/internal/ad-break/` | `X-Broadcast-Key` | Engine: break window + advert queue |
| * | `/api/admin-panel/*` | token + role | Admin operations |

Interactive docs: `/api/` (DRF browsable root) — schema is reachable per-router.

---

## Music licensing considerations

- Record **ISRC, label, licensing notes, and permitted territories** per track
  (the library form has fields for all of them).
- Tracks with restricted territories should be kept out of the default
  rotation for those regions — currently enforced at playlist level; the
  per-track territory list is data your licensing workflow can act on.
- The station is responsible for blanket licenses with performing-rights
  organizations (ASCAP/BMI/PRS/GEMA/…) covering its broadcast footprint.
- Advertiser content: advertisers warrant rights to supplied creative; keep
  the request records (they're stored with timestamps for this purpose).
- The footer and `/legal/copyright` page state this plainly — update them
  with your actual PRO affiliations before launch.

---

## Deployment

1. **Reverse proxy with TLS** (Caddy/nginx) in front of the frontend container;
   redirect HTTP→HTTPS. The backend enables `SECURE_SSL_REDIRECT`,
   `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE` automatically when
   `DJANGO_DEBUG=false`.
2. Set strong `DJANGO_SECRET_KEY`, `POSTGRES_PASSWORD`, `BROADCAST_API_KEY`,
   `ICECAST_*_PASSWORD`.
3. Set `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env` — on start the container
   runs `init_station`, which creates that super admin (it never wipes data).
   ```bash
   # Optional: wipe everything (demo leftovers, test accounts) and start clean
   docker compose exec backend python manage.py init_station --fresh --yes \
     --email you@station.fm --password 'a-long-password'
   ```
5. Point `ICECAST_STATS_URL` at the reachable Icecast stats endpoint so the
   listener count is measured (leave empty to show "—" rather than a guess).
6. Back up the `pgdata` and `media_data` volumes (e.g. `pg_dump` cron +
   object-storage sync for media). For production media, set
   `DEFAULT_STORAGE_BACKEND` to an S3 storages backend.
7. Configure SMTP (`EMAIL_HOST*`) so password resets actually send.

---

## Testing

```bash
# Backend — 125 tests covering:
#   campaign eligibility & expired-ad exclusion
#   schedule conflict detection & break windows
#   missed-break detection
#   role permissions on every admin surface
#   admin CRUD: upload validation, edits, deletes (tracks + advert spots)
#   station settings (theme colour, broadcast toggle, off-air track) + init_station bootstrap
#   broadcast toggle flow: admin PATCH → heartbeat payload → public now-playing
#   broadcast metadata ingest & status truthfulness
#   internal endpoint authentication
#   upload → playlist.m3u → engine ingest → public now-playing chain
#   m3u fallback when the default playlist is empty
#   playlist default/fallback flag uniqueness
cd backend && python manage.py test apps

# Frontend — typecheck + production build
cd frontend && npm run build
```

Design honesty rules enforced in code:
- Listener counts appear only when Icecast actually reports them
- Track progress derives from server timestamps (offset-corrected), never from page-load time
- OFFLINE is shown whenever the engine heartbeat is stale (> 90s)
- Ad stats are measured events; CTR is `null` (rendered "—") until impressions exist
- Ad requests are stored as *pending*; the UI never implies approval or payment

---

## PWA

Installable: manifest + icons + service worker (cache-first static shell,
network-only for `/api`, `/live`, `/media` — the live stream is **never**
cached). An install button appears when the browser supports
`beforeinstallprompt`; iOS users get Add-to-Home-Screen instructions. Background
audio playback follows each mobile browser's own policies (iOS Safari keeps
playing with screen locked; some Android browsers pause — that's a platform
limitation, not a station one).
