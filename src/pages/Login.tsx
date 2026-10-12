import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AtSign, KeyRound, ShieldCheck } from 'lucide-react'
import { Button, Card, Field, Input } from '@/components/ui'
import { Logo } from '@/components/Logo'
import { useApp } from '@/store/app'
import { db } from '@/lib/db'
import { cloudAuth, requestPasswordReset, signUp } from '@/lib/auth'
import { ROLE_LABELS } from '@/lib/permissions'

/** الرموز تُعرض على شاشة الدخول لأن هذه النسخة تحمل بيانات عرض فقط. */
const DEMO_PINS: Record<string, string> = {
  owner: '1234',
  noura: '2222',
  fahad: '4444',
}

export default function Login() {
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden px-4 py-10">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 opacity-70">
        <div className="absolute -top-40 right-1/4 size-[32rem] rounded-full bg-brand/20 blur-3xl" />
        <div className="absolute -bottom-40 left-1/4 size-[28rem] rounded-full bg-accent/15 blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm animate-rise">
        <Header />
        {cloudAuth ? <CloudAuth /> : <LocalAuth />}
      </div>
    </div>
  )
}

function Header() {
  const { settings } = useApp()
  return (
    <div className="mb-7 flex flex-col items-center text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-brand text-on-brand shadow-lg">
        <Logo className="size-7" />
      </span>
      <h1 className="mt-4 text-2xl font-bold tracking-tight">وضح</h1>
      <p className="mt-1 text-sm text-muted">{settings.shopName}</p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* الوضع السحابي — Supabase Auth                                               */
/* -------------------------------------------------------------------------- */

/**
 * التسجيل الذاتي موجود عمداً بدل زر «مستخدم جديد» في شاشة المستخدمين: إنشاء
 * حساب لشخص آخر يحتاج مفتاح `service_role`، وهو ممنوع في الواجهة لأنه يتجاوز
 * كل سياسات الحماية. فيسجّل الموظف حسابه بنفسه ثم يمنحه صاحب الصلاحية دوره.
 *
 * أول حساب في القاعدة يصير مالكاً تلقائياً (حارس `app.handle_new_user`)، وما
 * بعده موظف — أضعف دور — حتى يرفعه أحد. الترتيب مقصود: لو صار العكس لكان كل
 * من يعرف رابط الموقع مالكاً للمحل.
 */
function CloudAuth() {
  const { login } = useApp()
  const [mode, setMode] = useState<'in' | 'up' | 'forgot'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setError(null)
    setNotice(null)
  }, [mode, email, password, name, username])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)

    if (mode === 'forgot') {
      if (!email.trim()) return setError('اكتب بريدك أولاً')
      setBusy(true)
      try {
        const res = await requestPasswordReset(email)
        if (!res.ok) return setError(res.error ?? 'تعذّر إرسال الرابط')
        setNotice(res.notice ?? null)
        setMode('in')
      } finally {
        setBusy(false)
      }
      return
    }

    if (mode === 'up') {
      if (!name.trim()) return setError('الاسم مطلوب')
      if (!/^[a-z0-9_]{3,20}$/.test(username.trim().toLowerCase()))
        return setError('اسم المستخدم: ٣-٢٠ حرفاً إنجليزياً أو رقماً')
      if (password.length < 8) return setError('كلمة المرور: ٨ أحرف على الأقل')
    }

    setBusy(true)
    try {
      if (mode === 'up') {
        const res = await signUp({ email, password, name, username, phone })
        if (!res.ok) return setError(res.error ?? 'تعذّر إنشاء الحساب')
        if (res.notice) {
          setNotice(res.notice)
          setMode('in')
          return
        }
        // الجلسة جاهزة (تأكيد البريد مطفأ) — ندخل مباشرة بدل مطالبته بالإعادة.
      }
      const res = await login(email, password)
      if (!res.ok) setError(res.error ?? 'تعذّر تسجيل الدخول')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Card className="p-5">
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
          {(
            [
              ['in', 'دخول'],
              ['up', 'حساب جديد'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setMode(v)}
              className={
                (v === 'in' ? mode !== 'up' : mode === v)
                  ? 'rounded-lg bg-surface px-3 py-2 text-sm font-semibold shadow-sm'
                  : 'rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:text-text'
              }
            >
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-3">
          {mode === 'up' && (
            <>
              <Field label="الاسم">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="نورة الأحمد"
                  autoFocus
                />
              </Field>
              <Field label="اسم المستخدم" hint="إنجليزي بدون مسافات">
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="tnum"
                  dir="ltr"
                  placeholder="noura"
                />
              </Field>
              <Field label="الجوال (اختياري)">
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="tnum"
                  dir="ltr"
                />
              </Field>
            </>
          )}

          <Field label="البريد الإلكتروني">
            <div className="relative">
              <AtSign className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
              <Input
                type="email"
                autoComplete="email"
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11 pr-9 text-right"
                autoFocus={mode === 'in'}
              />
            </div>
          </Field>

          {mode === 'forgot' ? (
            <Field label="" error={error}>
              <p className="rounded-xl bg-surface-2 px-3 py-2.5 text-[12px] leading-6 text-muted">
                نرسل رابطاً إلى بريدك يفتح شاشة تعيين كلمة مرور جديدة. الرابط صالح لفترة قصيرة، وقد
                يصل إلى «المهملات».
              </p>
            </Field>
          ) : (
            <Field
              label="كلمة المرور"
              error={error}
              hint={mode === 'up' ? '٨ أحرف على الأقل' : undefined}
            >
              <div className="relative">
                <KeyRound className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
                <Input
                  type="password"
                  autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 pr-9"
                  dir="ltr"
                />
              </div>
            </Field>
          )}

          {notice && (
            <p className="rounded-xl border border-ok/30 bg-ok-soft/50 px-3 py-2.5 text-[12px] leading-5 text-muted">
              {notice}
            </p>
          )}

          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
            {mode === 'up' ? 'إنشاء الحساب' : mode === 'forgot' ? 'أرسل رابط الاسترجاع' : 'دخول'}
          </Button>
        </form>

        {mode !== 'up' && (
          <button
            type="button"
            onClick={() => setMode(mode === 'forgot' ? 'in' : 'forgot')}
            className="mt-3 w-full rounded-lg px-3 py-2 text-[13px] text-muted transition-colors hover:text-text"
          >
            {mode === 'forgot' ? 'رجوع إلى الدخول' : 'نسيت كلمة المرور؟'}
          </button>
        )}
      </Card>

      <p className="mt-5 flex items-start gap-2 rounded-xl border border-ok/30 bg-ok-soft/50 px-3 py-2.5 text-[12px] leading-5 text-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" />
        <span>
          الحسابات والبيانات محفوظة في قاعدة بيانات مشتركة، والصلاحيات مطبّقة داخل الخادم نفسه لا في
          المتصفح. الحساب الجديد يبدأ موظفاً بلا تكلفة ولا أرباح حتى يرفعه المالك.
        </span>
      </p>
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* الوضع المحلي — IndexedDB                                                    */
/* -------------------------------------------------------------------------- */

function LocalAuth() {
  const { login } = useApp()
  const [username, setUsername] = useState('owner')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const users = useLiveQuery(() => db.users.filter((u) => u.active).toArray(), [], [])

  useEffect(() => setError(null), [username, pin])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const res = await login(username, pin)
    setBusy(false)
    if (!res.ok) setError(res.error ?? 'تعذّر تسجيل الدخول')
  }

  return (
    <>
      <Card className="p-5">
        <form onSubmit={submit} className="space-y-4">
          <Field label="المستخدم">
            <select
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="h-11 w-full cursor-pointer rounded-xl border border-border bg-surface px-3 text-sm transition-colors focus:border-brand focus:outline-none focus:ring-4 focus:ring-[var(--ring)]"
            >
              {users.map((u) => (
                <option key={u.id} value={u.username}>
                  {u.name} — {ROLE_LABELS[u.role]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="الرمز السري" error={error}>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
              <Input
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                placeholder="••••"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                className="tnum h-11 pr-9 tracking-[0.4em]"
                autoFocus
              />
            </div>
          </Field>

          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
            دخول
          </Button>
        </form>

        {DEMO_PINS[username] && (
          <button
            type="button"
            onClick={() => setPin(DEMO_PINS[username])}
            className="mt-3 w-full rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-muted transition-colors hover:text-text"
          >
            بيانات تجريبية — الرمز&nbsp;
            <span className="tnum font-semibold text-brand-strong">{DEMO_PINS[username]}</span>
            &nbsp;(اضغط للتعبئة)
          </button>
        )}
      </Card>

      <p className="mt-5 flex items-start gap-2 rounded-xl border border-warn/30 bg-warn-soft/50 px-3 py-2.5 text-[12px] leading-5 text-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-warn" />
        <span>
          البيانات محفوظة داخل هذا المتصفح فقط. الحسابات والأدوار هنا تنظّم العمل ولا تحمي البيانات
          من شخص يملك الجهاز — الحماية الحقيقية تحتاج خادماً.
        </span>
      </p>
    </>
  )
}
