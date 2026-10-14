import { useEffect, useState } from 'react'
import { AtSign, KeyRound, ShieldCheck, UserRound, Vibrate } from 'lucide-react'
import { Badge, Button, Card, CardHeader, Field, Input, Switch, useToast } from '@/components/ui'
import { cloudAuth, currentEmail, updateEmail, updatePassword } from '@/lib/auth'
import { ROLE_LABELS } from '@/lib/permissions'
import { useApp } from '@/store/app'
import { getFeedbackPrefs, haptic, setFeedbackPrefs, tapSound } from '@/lib/feedback'

/**
 * شاشة «حسابي»: كلمة المرور والبريد بيد صاحبهما وحده.
 *
 * حالة الاستخدام الأولى هي التسليم: المطوّر ينشئ الحساب الأول ببريد مؤقت وكلمة
 * مؤقتة، ويسلّمهما لصاحب المحل. من هنا يغيّر صاحب المحل الكلمة، ثم ينقل الحساب
 * إلى بريده هو — فلا يبقى للمطوّر مدخل عبر شاشة الدخول.
 *
 * ⚠️ ما لا تفعله هذه الشاشة: حجب البيانات عن مالك مشروع Supabase. من يملك المشروع
 * يقرأ الجداول من لوحة التحكم بلا حساب في التطبيق أصلاً. انظر README «الخصوصية».
 */
export default function Account() {
  const { user } = useApp()
  const toast = useToast()
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    void currentEmail().then(setEmail)
  }, [])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">حسابي</h1>
        <p className="mt-0.5 text-sm text-muted">كلمة المرور والبريد لا يغيّرهما أحد غيرك</p>
      </div>

      <Card>
        <CardHeader title="بيانات الحساب" icon={<UserRound className="size-[18px]" />} />
        <dl className="divide-y divide-border text-[13px]">
          <Row label="الاسم" value={user?.name ?? '—'} />
          <Row label="اسم المستخدم" value={<span className="tnum">@{user?.username}</span>} />
          <Row
            label="الدور"
            value={
              user && (
                <Badge tone={user.role === 'owner' ? 'brand' : 'neutral'}>
                  {ROLE_LABELS[user.role]}
                </Badge>
              )
            }
          />
          <Row
            label="بريد الدخول"
            value={
              <span className="tnum" dir="ltr">
                {cloudAuth ? (email ?? '…') : 'وضع عرض — بلا بريد'}
              </span>
            }
          />
        </dl>
      </Card>

      {cloudAuth ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <PasswordCard onDone={() => toast('تم تغيير كلمة المرور')} />
          <EmailCard current={email} />
        </div>
      ) : (
        <p className="rounded-xl border border-warn/30 bg-warn-soft/50 px-3 py-2.5 text-[13px] leading-6 text-muted">
          في وضع العرض الحسابات محلية برموز ثابتة. تغيير كلمة المرور والبريد يعمل بعد ربط قاعدة
          البيانات.
        </p>
      )}

      <FeedbackCard />

      <p className="flex items-start gap-2 rounded-xl border border-ok/30 bg-ok-soft/50 px-3 py-2.5 text-[12px] leading-5 text-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" />
        <span>
          استلمت الحساب من غيرك؟ غيّر كلمة المرور أولاً، ثم انقل الحساب إلى بريدك أنت. بعدها لا
          يستطيع من أنشأ الحساب الدخول به — لكن من يملك مشروع قاعدة البيانات نفسه يبقى قادراً على
          قراءة بياناتها من لوحة تحكمه.
        </span>
      </p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}

function PasswordCard({ onDone }: { onDone: () => void }) {
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
      setPassword('')
      setConfirm('')
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="تغيير كلمة المرور"
        subtitle="تسري فوراً على كل أجهزتك"
        icon={<KeyRound className="size-[18px]" />}
      />
      <form onSubmit={submit} className="space-y-3 p-4">
        <Field label="كلمة المرور الجديدة" hint="٨ أحرف على الأقل">
          <Input
            type="password"
            autoComplete="new-password"
            dir="ltr"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Field label="أعد كتابتها" error={error}>
          <Input
            type="password"
            autoComplete="new-password"
            dir="ltr"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        <Button type="submit" variant="primary" loading={busy} disabled={!password}>
          حفظ كلمة المرور
        </Button>
      </form>
    </Card>
  )
}

function EmailCard({ current }: { current: string | null }) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    const next = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) return setError('اكتب بريداً صالحاً')
    if (current && next === current.toLowerCase()) return setError('هذا هو بريدك الحالي')
    setBusy(true)
    try {
      const res = await updateEmail(next)
      if (!res.ok) return setError(res.error ?? 'تعذّر تغيير البريد')
      setNotice(res.notice ?? null)
      setEmail('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="نقل الحساب إلى بريدك"
        subtitle="يصلك رابط تأكيد على البريد الجديد"
        icon={<AtSign className="size-[18px]" />}
      />
      <form onSubmit={submit} className="space-y-3 p-4">
        <Field label="البريد الجديد" error={error}>
          <Input
            type="email"
            autoComplete="email"
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
          />
        </Field>
        {notice && (
          <p className="rounded-xl border border-ok/30 bg-ok-soft/50 px-3 py-2.5 text-[12px] leading-5 text-muted">
            {notice}
          </p>
        )}
        <Button type="submit" variant="primary" loading={busy} disabled={!email.trim()}>
          أرسل رابط التأكيد
        </Button>
      </form>
    </Card>
  )
}

/**
 * الاهتزاز والصوت تفضيل لهذا الجهاز وحده (في ذاكرة المتصفح): صاحب المحل قد يريده
 * في جواله ويطفئه الموظف في جوال الكاونتر. لذلك هنا لا في «الإعدادات» التي للمالك فقط.
 */
function FeedbackCard() {
  const [prefs, setPrefs] = useState(getFeedbackPrefs)

  const update = (patch: Partial<typeof prefs>) => {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    setFeedbackPrefs(next)
    // معاينة فورية عند التشغيل: يعرف كيف يبدو قبل أن يقرّر.
    if (patch.haptics) haptic()
    if (patch.sound) tapSound()
  }

  return (
    <Card>
      <CardHeader
        title="اللمس والصوت"
        subtitle="عند الضغط على الأزرار والقوائم — لهذا الجهاز فقط"
        icon={<Vibrate className="size-[18px]" />}
      />
      <div className="space-y-3 p-4">
        {/* كل مفتاح في سطر: Switch عنصر سطري، ومتجاوران يلتصق اسم الأول بالثاني. */}
        <div>
          <Switch
            checked={prefs.haptics}
            onChange={(v) => update({ haptics: v })}
            label="اهتزاز خفيف"
          />
        </div>
        <div>
          <Switch checked={prefs.sound} onChange={(v) => update({ sound: v })} label="صوت ناعم" />
        </div>
        <p className="text-[12px] leading-5 text-muted">
          الصوت يتبع مفتاح الصامت في الجوال. والاهتزاز في الآيفون ميزة غير رسمية من النظام قد لا
          تعمل في بعض الإصدارات — إن لم تشعر به فالسبب الجهاز لا الإعداد.
        </p>
      </div>
    </Card>
  )
}
