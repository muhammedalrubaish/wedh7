import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Check,
  Cloud,
  History,
  KeyRound,
  Minus,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  UserPlus,
  Users2,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Switch,
  Tabs,
  cn,
  useToast,
} from '@/components/ui'
import {
  cloudAuth,
  createLocalUser,
  listAudit,
  listUsers,
  logAudit,
  setUserActive,
  updateUser,
} from '@/lib/auth'
import { dateTime, relative } from '@/lib/format'
import {
  CAPABILITIES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_MATRIX,
  effectiveCaps,
  isOverridden,
  lockoutError,
  userCan,
  type CapOverrides,
  type Capability,
} from '@/lib/permissions'
import { useApp } from '@/store/app'
import type { AuditEntry, Role, User } from '@/lib/types'

const ROLES = Object.keys(ROLE_LABELS) as Role[]
const ALL_CAPS = Object.keys(CAPABILITIES) as Capability[]

export default function UsersPage() {
  const { user: me, refreshUser } = useApp()
  const toast = useToast()

  // الوضع السحابي لا يملك اشتراكاً حياً كـ Dexie، فالتحديث بإعادة قراءة صريحة
  // بعد كل تعديل. مصدر واحد للقائمة في الوضعين يبقي بقية الشاشة كما هي.
  const [users, setUsers] = useState<User[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])

  const reload = useCallback(async () => {
    try {
      setUsers(await listUsers())
      setAudit(await listAudit())
    } catch (err) {
      toast(err instanceof Error ? err.message : 'تعذّر تحميل المستخدمين', 'warn')
    }
  }, [toast])

  useEffect(() => {
    void reload()
  }, [reload])

  const [tab, setTab] = useState<'users' | 'roles' | 'audit'>('users')
  const [editing, setEditing] = useState<User | null>(null)
  const [open, setOpen] = useState(false)

  async function toggleActive(u: User) {
    if (!me) return
    if (u.id === me.id) {
      toast('ما تقدر توقف حسابك أنت', 'warn')
      return
    }
    // إيقاف حساب يسحب صلاحياته فعلياً، فيخضع لنفس حارس القفل الخارج. الفحص هنا
    // للرسالة الفورية؛ القرار النهائي عند حارس القاعدة في الوضع السحابي.
    const lock = lockoutError(users, u.id, u.role, (u.capOverrides ?? {}) as never, !u.active)
    if (lock) {
      toast(lock, 'warn')
      return
    }
    try {
      await setUserActive(u, !u.active)
      await logAudit(me, u.active ? 'إيقاف مستخدم' : 'تفعيل مستخدم', 'user', u.id, u.name)
      toast(u.active ? `تم إيقاف ${u.name}` : `تم تفعيل ${u.name}`)
      await reload()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'تعذّر تعديل الحساب', 'warn')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight">المستخدمون والصلاحيات</h1>
        <div className="flex gap-2">
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { value: 'users', label: 'الحسابات', count: users.length },
              { value: 'roles', label: 'الأدوار' },
              { value: 'audit', label: 'السجل' },
            ]}
          />
          {tab === 'users' && !cloudAuth && (
            <Button
              variant="primary"
              onClick={() => {
                setEditing(null)
                setOpen(true)
              }}
            >
              <UserPlus className="size-4" />
              مستخدم جديد
            </Button>
          )}
        </div>
      </div>

      {tab === 'users' && cloudAuth && (
        <p className="flex items-start gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-[12px] leading-6 text-muted">
          <Cloud className="mt-0.5 size-4 shrink-0 text-brand" />
          <span>
            الحسابات في قاعدة البيانات المشتركة. إنشاء حساب لشخص آخر من هنا يحتاج مفتاحاً يتجاوز كل
            سياسات الحماية، ولا يجوز وضعه في المتصفح — فيسجّل الموظف حسابه بنفسه من شاشة الدخول، ثم
            ترفع دوره من هنا. كلمة المرور بيد صاحبها وحده.
          </span>
        </p>
      )}

      {tab === 'users' && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {users.map((u) => (
            <Card key={u.id} className={cn('p-4', !u.active && 'opacity-60')}>
              <div className="flex items-start gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-soft text-base font-bold text-accent">
                  {u.name.charAt(0)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{u.name}</p>
                  <p className="tnum truncate text-[12px] text-faint">@{u.username}</p>
                </div>
                <Badge tone={u.role === 'owner' ? 'brand' : 'neutral'}>{ROLE_LABELS[u.role]}</Badge>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-muted">
                <span>
                  {u.lastLoginAt ? `آخر دخول ${relative(u.lastLoginAt)}` : 'لم يسجّل دخول بعد'}
                </span>
                {(() => {
                  const n = ALL_CAPS.filter((c) => isOverridden(u, c)).length
                  return n > 0 ? (
                    <Badge tone="warn" className="tnum px-1.5 py-0 text-[11px]">
                      {n} استثناء
                    </Badge>
                  ) : null
                })()}
              </div>

              <div className="mt-3 flex items-center justify-between gap-2">
                <Switch checked={u.active} onChange={() => toggleActive(u)} label="نشط" />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setEditing(u)
                    setOpen(true)
                  }}
                >
                  تعديل
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {tab === 'roles' && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {ROLES.map((r) => (
              <Card key={r} className="p-4">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-brand" />
                  <h3 className="font-semibold">{ROLE_LABELS[r]}</h3>
                </div>
                <p className="mt-1.5 text-[13px] leading-6 text-muted">{ROLE_DESCRIPTIONS[r]}</p>
                <Badge className="mt-3" tone="brand">
                  {ROLE_MATRIX[r].length} صلاحية
                </Badge>
              </Card>
            ))}
          </div>

          <Card className="overflow-hidden">
            <CardHeader title="مصفوفة الصلاحيات" icon={<Users2 className="size-[18px]" />} />
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-surface-2 text-[12px] text-muted">
                    <th className="px-4 py-2.5 text-right font-medium">الصلاحية</th>
                    {ROLES.map((r) => (
                      <th key={r} className="px-3 py-2.5 font-medium">
                        {ROLE_LABELS[r]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(Object.keys(CAPABILITIES) as Capability[]).map((cap) => (
                    <tr key={cap}>
                      <td className="px-4 py-2 text-right">{CAPABILITIES[cap]}</td>
                      {ROLES.map((r) => (
                        <td key={r} className="px-3 py-2 text-center">
                          {ROLE_MATRIX[r].includes(cap) ? (
                            <Check className="mx-auto size-4 text-ok" />
                          ) : (
                            <Minus className="mx-auto size-4 text-faint" />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-border bg-surface-2 px-4 py-2.5 text-[12px] leading-6 text-muted">
              هذه المصفوفة هي <strong className="font-semibold">نقطة البداية</strong> لكل حساب.
              لتخصيص شخص واحد بلا تغيير دوره ودور زملائه، افتح الحساب من تبويب «الحسابات» وعدّل
              صلاحياته هناك. تعديل المصفوفة نفسها يحتاج تغييراً في الكود (
              <span className="tnum">src/lib/permissions.ts</span>).
            </p>
          </Card>
        </div>
      )}

      {tab === 'audit' && (
        <Card>
          <CardHeader
            title="سجل النشاط"
            subtitle="آخر ٦٠ عملية"
            icon={<History className="size-[18px]" />}
          />
          {audit.length === 0 ? (
            <EmptyState title="السجل فارغ" />
          ) : (
            <ul className="divide-y divide-border">
              {audit.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-[11px] font-semibold">
                    {a.userName.charAt(0)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate">
                      <span className="font-medium">{a.userName}</span>{' '}
                      <span className="text-muted">{a.action}</span>
                      {a.details && <span className="text-faint"> — {a.details}</span>}
                    </p>
                  </div>
                  <span className="tnum shrink-0 text-[11px] text-faint">{dateTime(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <UserForm
        open={open}
        user={editing}
        users={users}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false)
          void reload()
          void refreshUser()
        }}
      />
    </div>
  )
}

function UserForm({
  open,
  user,
  users,
  onClose,
  onSaved,
}: {
  open: boolean
  user: User | null
  users: User[]
  onClose: () => void
  onSaved: () => void
}) {
  const { user: me } = useApp()
  const toast = useToast()
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [role, setRole] = useState<Role>('cashier')
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [overrides, setOverrides] = useState<CapOverrides>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setError(null)
    setPin('')
    setName(user?.name ?? '')
    setUsername(user?.username ?? '')
    setRole(user?.role ?? 'cashier')
    setPhone(user?.phone ?? '')
    setOverrides({ ...(user?.capOverrides as CapOverrides | undefined) })
  }, [open, user])

  const draft = useMemo(() => ({ role, capOverrides: overrides }), [role, overrides])
  const caps = useMemo(() => effectiveCaps(draft), [draft])
  const overrideCount = useMemo(
    () => ALL_CAPS.filter((c) => isOverridden(draft, c)).length,
    [draft],
  )

  /** هل مُسّت الاستثناءات فعلاً؟ فتح النافذة وحده لا يُعد تعديلاً. */
  const overridesChanged = useMemo(() => {
    const before = (user?.capOverrides ?? {}) as CapOverrides
    const keys = new Set([...Object.keys(before), ...Object.keys(overrides)])
    return [...keys].some((k) => before[k as Capability] !== overrides[k as Capability])
  }, [user, overrides])

  /** ثلاث حالات لا اثنتان: الضغط يقلب الحالة، والزر المستقل يعيدها إلى الدور. */
  function toggleCap(cap: Capability) {
    const current = userCan(draft, cap)
    setOverrides((prev) => {
      const next = { ...prev }
      if (ROLE_MATRIX[role].includes(cap) === !current) delete next[cap]
      else next[cap] = !current
      return next
    })
  }

  async function save() {
    setError(null)
    if (!me) return
    if (!name.trim()) return setError('الاسم مطلوب')
    const uname = username.trim().toLowerCase()
    if (!/^[a-z0-9_]{3,20}$/.test(uname))
      return setError('اسم المستخدم: ٣-٢٠ حرفاً إنجليزياً أو رقماً')

    // الرمز السري شأن محلي: سحابياً كلمة المرور بيد صاحبها داخل Supabase Auth،
    // ولا تمرّ من هنا إطلاقاً.
    if (!cloudAuth) {
      if (!user && !/^\d{4,8}$/.test(pin)) return setError('الرمز السري: ٤-٨ أرقام')
      if (user && pin && !/^\d{4,8}$/.test(pin)) return setError('الرمز السري: ٤-٨ أرقام')
    }

    const clash = users.find((u) => u.username === uname)
    if (clash && clash.id !== user?.id) return setError('اسم المستخدم محجوز')

    // يُفحص قبل الكتابة لا بعدها. محلياً هذا الفحص الوحيد؛ سحابياً يقابله حارس
    // في القاعدة يرفض نفس الحالة ولو نودي عليها من خارج التطبيق.
    if (user) {
      const lock = lockoutError(users, user.id, role, overrides, user.active)
      if (lock) return setError(lock)
    }

    // حارس القاعدة يمنع أن يعدّل أحدٌ استثناءات نفسه ولو ملك «إدارة المستخدمين».
    // نمنعها هنا برسالة واضحة بدل خطأ 42501 بعد ضغط «حفظ».
    if (cloudAuth && user && user.id === me.id && overridesChanged) {
      return setError('ما تقدر تعدّل استثناءات صلاحياتك أنت — لازم شخص آخر يملك إدارة المستخدمين')
    }

    setBusy(true)
    try {
      const patch = {
        name: name.trim(),
        username: uname,
        role,
        phone: phone.trim() || undefined,
        capOverrides: overrides,
        ...(pin ? { pin } : {}),
      }
      if (user) {
        await updateUser(user, patch)
        await logAudit(
          me,
          'تعديل مستخدم',
          'user',
          user.id,
          overrideCount ? `${name} — ${overrideCount} استثناء صلاحية` : name,
        )
        toast('تم حفظ بيانات المستخدم')
      } else {
        const id = await createLocalUser(patch)
        await logAudit(me, 'إضافة مستخدم', 'user', id, name)
        toast('تمت إضافة المستخدم')
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر حفظ التعديل')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={user ? 'تعديل مستخدم' : 'مستخدم جديد'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
          <Button variant="primary" onClick={save} loading={busy}>
            حفظ
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="الاسم">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="سامي العتيبي"
          />
        </Field>
        <Field label="اسم المستخدم" hint="إنجليزي بدون مسافات">
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="tnum"
            dir="ltr"
            placeholder="sami"
          />
        </Field>
        <Field label="الجوال">
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="tnum"
            dir="ltr"
          />
        </Field>
        <Field label="الدور">
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
        {/* كلمة المرور سحابياً بيد صاحبها داخل Supabase Auth — لا يعيّنها المدير
            من هنا. الرسالة تبقى ظاهرة في الحالتين وإلا ضاع الخطأ مع الحقل. */}
        {cloudAuth ? (
          <Field label="كلمة المرور" error={error}>
            <p className="rounded-xl bg-surface-2 px-3 py-2.5 text-[12px] leading-6 text-muted">
              يغيّرها صاحب الحساب بنفسه من شاشة «حسابي» (اضغط اسمك أسفل القائمة). لا تُعرض ولا
              تُعيَّن من هنا.
            </p>
          </Field>
        ) : (
          <Field
            label={user ? 'رمز سري جديد (اتركه فارغاً للإبقاء)' : 'الرمز السري'}
            error={error}
            hint="٤-٨ أرقام"
          >
            <div className="relative">
              <KeyRound className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
              <Input
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                className="tnum pr-9"
              />
            </div>
          </Field>
        )}

        <div className="rounded-xl bg-surface-2 p-3">
          <p className="text-[12px] font-medium text-muted">{ROLE_DESCRIPTIONS[role]}</p>

          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold">
              <SlidersHorizontal className="size-3.5 text-brand" />
              صلاحيات هذا الحساب
              <span className="tnum text-faint">({caps.length})</span>
            </div>
            {overrideCount > 0 && (
              <button
                type="button"
                onClick={() => setOverrides({})}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface hover:text-text"
              >
                <RotateCcw className="size-3" />
                رجّعها لصلاحيات الدور
              </button>
            )}
          </div>

          <div className="mt-2 space-y-0.5">
            {ALL_CAPS.map((cap) => {
              const on = userCan(draft, cap)
              const changed = isOverridden(draft, cap)
              return (
                <button
                  key={cap}
                  type="button"
                  onClick={() => toggleCap(cap)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-right text-[12px] transition-colors',
                    on ? 'text-text' : 'text-faint',
                    'hover:bg-surface',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-4 shrink-0 place-items-center rounded border transition-colors',
                      on ? 'border-brand bg-brand text-on-brand' : 'border-border bg-surface',
                    )}
                  >
                    {on && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <span className="flex-1 truncate">{CAPABILITIES[cap]}</span>
                  {changed && (
                    <Badge tone="warn" className="shrink-0 px-1 py-0 text-[10px]">
                      {on ? 'مضافة' : 'مسحوبة'}
                    </Badge>
                  )}
                </button>
              )
            })}
          </div>

          <p className="mt-2 border-t border-border pt-2 text-[11px] leading-5 text-faint">
            {overrideCount === 0
              ? 'الحساب يتبع صلاحيات دوره بالكامل. اضغط أي صلاحية لتخصيصها لهذا الشخص وحده.'
              : `${overrideCount} صلاحية مخالفة للدور. تعديل الدور لاحقاً يسري على البقية.`}
          </p>
        </div>
      </div>
    </Modal>
  )
}
