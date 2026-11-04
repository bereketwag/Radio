import {
  Activity,
  Briefcase,
  Disc3,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  LayoutDashboard,
  ListMusic,
  LogOut,
  Megaphone,
  Radio,
  Settings,
  Users,
} from 'lucide-react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useStation } from '../../lib/useStation'
import { AdminOverview } from './AdminOverview'
import { AdminMusic } from './AdminMusic'
import { AdminPlaylists } from './AdminPlaylists'
import { AdminVisualAds } from './AdminVisualAds'
import { AdminAudioAds } from './AdminAudioAds'
import { AdminAdvertisers } from './AdminAdvertisers'
import { AdminRequests } from './AdminRequests'
import { AdminUsers } from './AdminUsers'
import { AdminLogs } from './AdminLogs'
import { AdminSettings } from './AdminSettings'

const nav = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/admin/audio', label: 'Audio adverts', icon: Megaphone },
  { to: '/admin/visual', label: 'Banner adverts', icon: ImageIcon },
  { to: '/admin/requests', label: 'Ad requests', icon: FileText },
  { to: '/admin/advertisers', label: 'Advertisers', icon: Briefcase },
  { to: '/admin/music', label: 'Music library', icon: Disc3 },
  { to: '/admin/playlists', label: 'Playlists', icon: ListMusic },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/logs', label: 'System log', icon: Activity },
]

export function AdminApp() {
  const { user, logout } = useAuth()
  const station = useStation()

  return (
    <div className="shell py-5 sm:py-6">
      <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8">
        <aside className="min-w-0 lg:sticky lg:top-6 lg:self-start">
          <div className="mb-3 hidden items-center gap-3 px-1 lg:flex">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-accent-ink shadow-sm">
              <Radio size={18} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight">{station?.name ?? 'Aurora Radio'}</p>
              <p className="text-xs text-muted">Station dashboard</p>
            </div>
          </div>

          <nav
            className="card no-scrollbar flex gap-1 overflow-x-auto p-2 lg:flex-col lg:gap-0.5 lg:overflow-visible"
            aria-label="Admin"
          >
            {nav.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? 'bg-accent/10 font-semibold text-accent'
                      : 'text-muted hover:bg-surface-2 hover:text-ink'
                  }`
                }
              >
                <Icon size={16} />
                <span className="whitespace-nowrap">{label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="mt-3 hidden gap-1 lg:flex lg:flex-col">
            <a
              href="/"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <ExternalLink size={15} /> View live site
            </a>
            {user && (
              <p className="truncate px-3 pt-2 text-xs text-muted" title={user.email}>
                Signed in as {user.display_name || user.email}
              </p>
            )}
            <button
              className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-ink"
              onClick={() => void logout()}
            >
              <LogOut size={15} /> Sign out
            </button>
          </div>

          {/* On phones the account actions live under the scrolling nav. */}
          <div className="mt-3 flex items-center justify-between gap-2 lg:hidden">
            <a href="/" target="_blank" rel="noreferrer" className="btn-ghost h-9 !px-3 text-xs">
              <ExternalLink size={13} /> Live site
            </a>
            <button className="btn-ghost h-9 !px-3 text-xs" onClick={() => void logout()}>
              <LogOut size={13} /> Sign out
            </button>
          </div>
        </aside>

        <div className="min-w-0">
          <Routes>
            <Route index element={<AdminOverview />} />
            <Route path="requests" element={<AdminRequests />} />
            <Route path="visual" element={<AdminVisualAds />} />
            <Route path="audio" element={<AdminAudioAds />} />
            <Route path="advertisers" element={<AdminAdvertisers />} />
            <Route path="music" element={<AdminMusic />} />
            <Route path="playlists" element={<AdminPlaylists />} />
            <Route path="settings" element={<AdminSettings />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="logs" element={<AdminLogs />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  )
}
