import { Splash } from '@/components/Splash'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { getSettings } from '@/lib/db'
import { saveSettings } from '@/lib/repo'
import { currentUser, logAudit, onAuthChange, signIn, signOut } from '@/lib/auth'
import { setCurrency } from '@/lib/format'
import { ensureSeeded } from '@/lib/seed'
import { pullAll } from '@/lib/mirror'
import { cloudEnabled } from '@/lib/supabase'
import { userCan, type Capability } from '@/lib/permissions'
import type { Settings, User } from '@/lib/types'

interface AppState {
  ready: boolean
  user: User | null
  settings: Settings
  /**
   * محلياً: اسم مستخدم + رمز. سحابياً: بريد + كلمة مرور. الشاشة تسأل عن الحقل
   * المناسب حسب `cloudAuth`، والدالة تستقبل نفس الوسيطين في الحالتين.
   */
  login: (identifier: string, secret: string) => Promise<{ ok: boolean; error?: string }>
  logout: () => Promise<void>
  can: (cap: Capability) => boolean
  updateSettings: (patch: Partial<Settings>) => Promise<void>
  toggleTheme: () => void
  refreshUser: () => Promise<void>
}

const Ctx = createContext<AppState | null>(null)

export function useApp(): AppState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>')
  return ctx
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // الوضع السحابي: القاعدة مصدر الحقيقة وتُسحب إلى المرآة المحلية عند كل
      // إقلاع. فشل السحب لا يمنع فتح التطبيق — تبقى مرآة الجلسة السابقة معروضة
      // والبيع يرفض نفسه بخطأ واضح، وهذا أفضل من شاشة بيضاء خلف الكاونتر.
      if (cloudEnabled) {
        try {
          await pullAll()
        } catch (err) {
          console.error('تعذّر سحب البيانات من القاعدة:', err)
        }
      } else {
        await ensureSeeded()
      }
      const s = await getSettings()
      const savedUser = await currentUser()
      if (cancelled) return
      setCurrency(s.currency)
      setSettings(s)
      setUser(savedUser)
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // الجلسة قد تتغيّر من خارج هذه الشاشة: تجديد رمز، أو خروج من تبويب آخر، أو
  // انتهاء صلاحية. بدون هذا يبقى التبويب المفتوح يعرض واجهة لمستخدم خرج فعلاً.
  useEffect(() => {
    return onAuthChange(() => {
      void currentUser().then(setUser)
    })
  }, [])

  useEffect(() => {
    if (!settings) return
    document.documentElement.classList.toggle('dark', settings.theme === 'dark')
    // نسخة سريعة للمظهر: سكربت أعلى `index.html` يقرؤها قبل أول رسم، فلا تومض الصفحة
    // فاتحةً ثم تصير داكنة، وتظهر شاشة التحميل الأولى بلون المظهر الصحيح.
    try {
      localStorage.setItem('wedh7.theme', settings.theme)
    } catch {
      // تخزين محجوب: يبقى الوميض القديم فقط، لا شيء يتعطّل
    }
  }, [settings])

  const login = useCallback(async (identifier: string, secret: string) => {
    const res = await signIn(identifier, secret)
    if (!res.ok) return res
    const fresh = await currentUser()
    setUser(fresh)
    if (fresh) await logAudit(fresh, 'دخول', 'session')
    return { ok: true }
  }, [])

  const logout = useCallback(async () => {
    if (user) await logAudit(user, 'خروج', 'session')
    await signOut()
    setUser(null)
  }, [user])

  const refreshUser = useCallback(async () => {
    setUser(await currentUser())
  }, [])

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    const next = await saveSettings(patch)
    if (patch.currency) setCurrency(next.currency)
    setSettings(next)
  }, [])

  const toggleTheme = useCallback(() => {
    setSettings((cur) => {
      if (!cur) return cur
      const theme = cur.theme === 'dark' ? ('light' as const) : ('dark' as const)
      void saveSettings({ theme })
      return { ...cur, theme }
    })
  }, [])

  // الدور + استثناءات هذا الحساب. `roleCan` ما زالت موجودة لعرض مصفوفة الأدوار
  // المجرّدة في شاشة المستخدمين، لكن قرار «هل أعرض هذا الزر» يمر من هنا.
  const can = useCallback((cap: Capability) => userCan(user ?? undefined, cap), [user])

  const value = useMemo<AppState | null>(
    () =>
      settings
        ? { ready, user, settings, login, logout, can, updateSettings, toggleTheme, refreshUser }
        : null,
    [ready, user, settings, login, logout, can, updateSettings, toggleTheme, refreshUser],
  )

  if (!value) {
    return <Splash />
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
