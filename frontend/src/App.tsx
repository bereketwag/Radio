import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { Footer } from './components/Footer'
import { Header } from './components/Header'
import { ModalAds } from './components/ModalAds'
import { SplashScreen } from './components/SplashScreen'
import { useAuth } from './lib/auth'
import { PlayerProvider } from './lib/usePlayer'
import { useStation } from './lib/useStation'
import { HomePage } from './pages/HomePage'

const AdvertisePage = lazy(() => import('./pages/AdvertisePage').then((m) => ({ default: m.AdvertisePage })))
const AboutPage = lazy(() => import('./pages/AboutPage').then((m) => ({ default: m.AboutPage })))
const LegalPage = lazy(() => import('./pages/LegalPage').then((m) => ({ default: m.LegalPage })))
const AccountPage = lazy(() => import('./pages/AccountPage').then((m) => ({ default: m.AccountPage })))
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })))
const AdminApp = lazy(() => import('./pages/admin/AdminApp').then((m) => ({ default: m.AdminApp })))

function FullSpinner() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent" aria-label="Loading" />
    </div>
  )
}

function RequireStaff({ children }: { children: React.ReactNode }) {
  const { user, loading, isStaff } = useAuth()
  const location = useLocation()
  if (loading) return <FullSpinner />
  if (!user) return <Navigate to="/account" state={{ from: location.pathname }} replace />
  if (!isStaff) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  const station = useStation()
  const { loading: authLoading } = useAuth()
  const streamUrl = station?.stream_url ?? null

  // Splash: visible until branding + session resolve (min ~550ms so it never
  // flickers), hard-capped at 3s so a failed fetch can't trap the overlay.
  const mountedAt = useRef(Date.now())
  const [booted, setBooted] = useState(false)
  const [splashGone, setSplashGone] = useState(false)

  useEffect(() => {
    if (booted) {
      const t = setTimeout(() => setSplashGone(true), 500)
      return () => clearTimeout(t)
    }
  }, [booted])

  useEffect(() => {
    const hard = setTimeout(() => setBooted(true), 3000)
    return () => clearTimeout(hard)
  }, [])

  useEffect(() => {
    if (authLoading || !station) return
    const t = setTimeout(() => setBooted(true), Math.max(0, 550 - (Date.now() - mountedAt.current)))
    return () => clearTimeout(t)
  }, [authLoading, station])

  return (
    <PlayerProvider streamUrl={streamUrl}>
      {!splashGone && <SplashScreen name={station?.name} fading={booted} />}
      <div className="flex min-h-screen flex-col">
        <Header />
        <main className="flex-1">
          {/* Modal takeover ads run across every public page; they refuse to
              show inside /admin and /account on their own. */}
          <ModalAds />
          <Suspense fallback={<FullSpinner />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              {/* /live was a duplicate of Home — keep old links working. */}
              <Route path="/live" element={<Navigate to="/" replace />} />
              <Route path="/advertise" element={<AdvertisePage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/legal/:doc" element={<LegalPage />} />
              <Route path="/account" element={<AccountPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route
                path="/admin/*"
                element={
                  <RequireStaff>
                    <AdminApp />
                  </RequireStaff>
                }
              />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </main>
        <Footer />
      </div>
    </PlayerProvider>
  )
}

function NotFound() {
  return (
    <div className="shell py-24 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-muted">The page you’re looking for doesn’t exist.</p>
      <a href="/" className="btn-primary mt-6">
        Back to the radio
      </a>
    </div>
  )
}
