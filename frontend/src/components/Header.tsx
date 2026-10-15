import { Menu, Moon, Sun, User as UserIcon, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useTheme } from '../lib/theme'
import { useStation } from '../lib/useStation'

const nav = [
  { to: '/', label: 'Home' },
  { to: '/advertise', label: 'Advertise With Us' },
  { to: '/about', label: 'About' },
]

export function ThemeToggle() {
  const { theme, resolved, cycleTheme } = useTheme()
  const label =
    theme === 'system' ? `Theme: system (${resolved})` : `Theme: ${theme}`
  return (
    <button
      onClick={cycleTheme}
      className="btn-ghost h-9 w-9 !rounded-full !px-0"
      aria-label={label}
      title={label}
    >
      {resolved === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  )
}

export function Header() {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const { user, isStaff } = useAuth()
  const station = useStation()

  useEffect(() => setOpen(false), [location.pathname])

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-page/85 backdrop-blur-md">
      <div className="shell flex h-14 items-center justify-between gap-4">
        <Link to="/" className="flex items-baseline gap-2" aria-label="Home">
          <span className="inline-block h-2 w-2 rounded-full bg-accent animate-live-pulse" aria-hidden />
          <span className="text-[15px] font-semibold tracking-tight">{station?.name ?? 'Aurora Radio'}</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `rounded-full px-3 py-1.5 text-sm transition-colors ${
                  isActive ? 'bg-surface-2 font-medium text-ink' : 'text-muted hover:text-ink'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          {user ? (
            <Link to={isStaff ? '/admin' : '/account'} className="btn-ghost h-9 !px-3" title="Your account">
              <UserIcon size={15} />
              <span className="hidden sm:inline">{user.display_name || user.email.split('@')[0]}</span>
            </Link>
          ) : (
            <Link to="/account" className="btn-ghost h-9 !px-3">
              <UserIcon size={15} />
              <span className="hidden sm:inline">Sign in</span>
            </Link>
          )}
          <button
            className="btn-ghost h-9 w-9 !rounded-full !px-0 md:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>
      </div>

      {open && (
        <nav id="mobile-nav" className="shell flex flex-col gap-1 pb-3 md:hidden" aria-label="Mobile">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `rounded-xl px-3 py-2.5 text-sm ${
                  isActive ? 'bg-surface-2 font-medium text-ink' : 'text-muted hover:text-ink'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      )}
    </header>
  )
}
