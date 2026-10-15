import {
  Disc3,
  FileAudio,
  FileText,
  Image as ImageIcon,
  LayoutDashboard,
  ListMusic,
  Settings,
  Users,
  Activity,
} from 'lucide-react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { AdminOverview } from './AdminOverview'
import { AdminMusic } from './AdminMusic'
import { AdminPlaylists } from './AdminPlaylists'
import { AdminVisualAds } from './AdminVisualAds'
import { AdminAudioAds } from './AdminAudioAds'
import { AdminRequests } from './AdminRequests'
import { AdminUsers } from './AdminUsers'
import { AdminLogs } from './AdminLogs'
import { AdminSettings } from './AdminSettings'

const nav = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/admin/requests', label: 'Ad requests', icon: FileText },
  { to: '/admin/visual', label: 'Banner campaigns', icon: ImageIcon },
  { to: '/admin/audio', label: 'Audio campaigns', icon: FileAudio },
  { to: '/admin/music', label: 'Music library', icon: Disc3 },
  { to: '/admin/playlists', label: 'Playlists', icon: ListMusic },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/logs', label: 'System log', icon: Activity },
]

export function AdminApp() {
  return (
    <div className="shell py-6">
      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible" aria-label="Admin">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors ${
                  isActive ? 'bg-surface-2 font-medium text-ink' : 'text-muted hover:bg-surface-2/60 hover:text-ink'
                }`
              }
            >
              <Icon size={15} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="min-w-0">
          <Routes>
            <Route index element={<AdminOverview />} />
            <Route path="requests" element={<AdminRequests />} />
            <Route path="visual" element={<AdminVisualAds />} />
            <Route path="audio" element={<AdminAudioAds />} />
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
