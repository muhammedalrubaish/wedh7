import { useState } from 'react'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { Button, Card, Field, Input } from '@/components/ui'
import { Logo } from '@/components/Logo'
import { cancelRecovery, updatePassword } from '@/lib/auth'

/**
 * شاشة «عيّن كلمة مرور جديدة».
 *
 * تُعرض حين يفتح المستخدم رابط الاسترجاع، وقبل أي شاشة أخرى — حتى وإن صارت
 * الجلسة قائمة فعلاً. السبب أن جلسة الاسترجاع مؤقتة: لو تركناه يدخل إلى لوحة
 * التحكم مباشرة لانتهت الجلسة بعد قليل وهو لا يعرف كلمته بعد، فيعود إلى نقطة
 * الصفر ويظن أن الرابط لم يعمل.
 */
export default function ResetPassword() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) return setError('كلمة المرور: ٨ أحرف على الأقل')
    if (password !== confirm) return setError('الكلمتان غير متطابقتين')

    setBusy(true)
    try {
      const res = await updatePassword(password)
      if (!res.ok) return setError(res.error ?? 'تعذّر تغيير كلمة المرور')
      // إعادة التحميل أبسط من مزامنة الحالة يدوياً: الجلسة صارت جلسة دخول
      // عادية، وعلم الاسترجاع أُزيل، فتُبنى الشاشة الصحيحة من الصفر.
      window.location.replace(`${window.location.pathname}#/`)
      window.location.reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute inset-0 opacity-70">
        <div className="absolute -top-40 right-1/4 size-[32rem] rounded-full bg-brand/20 blur-3xl" />
        <div className="absolute -bottom-40 left-1/4 size-[28rem] rounded-full bg-accent/15 blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm animate-rise">
        <div className="mb-7 flex flex-col items-center text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-brand text-on-brand shadow-lg">
            <Logo className="size-7" />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">كلمة مرور جديدة</h1>
          <p className="mt-1 text-sm text-muted">اكتبها مرتين ثم ادخل بها مباشرة</p>
        </div>

        <Card className="p-5">
          <form onSubmit={submit} className="space-y-3">
            <Field label="كلمة المرور الجديدة" hint="٨ أحرف على الأقل">
              <div className="relative">
                <KeyRound className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
                <Input
                  type="password"
                  autoComplete="new-password"
                  dir="ltr"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 pr-9"
                  autoFocus
                />
              </div>
            </Field>

            <Field label="أعد كتابتها" error={error}>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
                <Input
                  type="password"
                  autoComplete="new-password"
                  dir="ltr"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="h-11 pr-9"
                />
              </div>
            </Field>

            <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
              احفظ وادخل
            </Button>
          </form>

          <button
            type="button"
            onClick={() => {
              void cancelRecovery().then(() => window.location.reload())
            }}
            className="mt-3 w-full rounded-lg px-3 py-2 text-[13px] text-muted transition-colors hover:text-text"
          >
            إلغاء والعودة إلى شاشة الدخول
          </button>
        </Card>

        <p className="mt-5 flex items-start gap-2 rounded-xl border border-warn/30 bg-warn-soft/50 px-3 py-2.5 text-[12px] leading-5 text-muted">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-warn" />
          <span>
            رابط الاسترجاع يفتح جلسة مؤقتة تنتهي بعد قليل. عيّن الكلمة الآن — الخروج من هذه الشاشة
            بلا حفظ يعني طلب رابط جديد.
          </span>
        </p>
      </div>
    </div>
  )
}
