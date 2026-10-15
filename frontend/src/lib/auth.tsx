import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, getToken, setToken, User } from './api'

interface AuthContextValue {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (payload: Record<string, string>) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
  isStaff: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null)
      setLoading(false)
      return
    }
    try {
      setUser(await api.get<User>('/auth/me/'))
    } catch {
      setToken(null)
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ user: User; token: string }>('/auth/login/', { email, password })
    setToken(res.token)
    setUser(res.user)
  }, [])

  const register = useCallback(async (payload: Record<string, string>) => {
    const res = await api.post<{ user: User; token: string }>('/auth/register/', payload)
    setToken(res.token)
    setUser(res.user)
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout/')
    } catch {
      /* token may already be invalid */
    }
    setToken(null)
    setUser(null)
  }, [])

  const isStaff = !!user && ['super_admin', 'station_admin', 'ad_manager'].includes(user.role)

  const value = useMemo(
    () => ({ user, loading, login, register, logout, refresh, isStaff }),
    [user, loading, login, register, logout, refresh, isStaff],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
