/**
 * حدود المصادقة وإدارة المستخدمين.
 *
 * الملف كله موجود لسبب واحد: التطبيق يعمل بوضعين، ولا يجوز أن تعرف الشاشات
 * بأيّهما تعمل. لو غاب `VITE_SUPABASE_URL` بقيت الحسابات في IndexedDB برمز
 * محلي كما كانت؛ ولو حضر صارت المصادقة عبر Supabase Auth والصلاحيات من جدول
 * `profiles` داخل Postgres.
 *
 * ⚠️ فرق جوهري بين الوضعين لا يصح إخفاؤه عن صاحب المحل:
 *   • محلياً: `permissions.ts` يخفي أزراراً فقط. من يملك الجهاز يفتح IndexedDB
 *     ويقرأ كل شيء.
 *   • سحابياً: القرار الحقيقي في سياسات RLS داخل Postgres. ما تراه الواجهة
 *     مجرد انعكاس لما تسمح به القاعدة أصلاً.
 *
 * وفرق عملي ثانٍ: إنشاء حساب لشخص آخر يحتاج مفتاح `service_role`، وهو ممنوع
 * منعاً باتاً في الواجهة (يتجاوز كل سياسة). لذلك في الوضع السحابي يسجّل الموظف
 * حسابه بنفسه، ثم يمنحه صاحب `users.manage` دوره. أول حساب في القاعدة يصير
 * مالكاً تلقائياً عبر حارس `app.handle_new_user()`.
 */
import { cloudEnabled, humanError, requireClient } from './supabase'
import { db, logAudit as logAuditLocal, sha256, uid } from './db'
import { toMs, toUser, type Row } from './rows'
import type { AuditEntry, Role, User } from './types'
import type { CapOverrides } from './permissions'

/** الوضع يُحسم من متغيّرات البيئة وحدها — لا من إعداد داخل الواجهة. */
export const cloudAuth = cloudEnabled

const SESSION_KEY = 'wedh7.session'

export interface AuthResult {
  ok: boolean
  error?: string
  /** رسالة نجاح تحتاج انتباه المستخدم (تأكيد البريد مثلاً) لا خطأ. */
  notice?: string
}

/* -------------------------------------------------------------------------- */
/* الدخول والخروج                                                              */
/* -------------------------------------------------------------------------- */

/**
 * محلياً: اسم مستخدم + رمز. سحابياً: بريد + كلمة مرور.
 * الشاشة تسأل عن الحقل المناسب، والدالة تستقبل نفس الوسيطين في الحالتين.
 */
export async function signIn(identifier: string, secret: string): Promise<AuthResult> {
  if (!cloudAuth) return signInLocal(identifier, secret)

  const client = requireClient()
  const { data, error } = await client.auth.signInWithPassword({
    email: identifier.trim(),
    password: secret,
  })
  if (error) return { ok: false, error: humanError(error) }

  // الملف الشخصي هو مصدر الدور. غيابه يعني حساباً في Auth بلا صف مقابل — حالة
  // لا يفترض أن تحدث (الحارس ينشئه)، لكن تركها تمرّ يعني مستخدماً بلا صلاحيات
  // يحدّق في شاشة فارغة بلا سبب مفهوم.
  // الخطأ يُعرض كما هو لا يُبتلع: «ما له ملف» و«رفضت القاعدة القراءة» حالتان
  // مختلفتان تماماً، وإخفاء الفرق يجعل العطل غير قابل للتشخيص من الشاشة.
  let profile: User | null
  try {
    profile = await fetchProfile(data.user.id)
  } catch (err) {
    await client.auth.signOut()
    return { ok: false, error: err instanceof Error ? err.message : 'تعذّر قراءة ملف الحساب.' }
  }
  if (!profile) {
    await client.auth.signOut()
    return {
      ok: false,
      error:
        'الحساب موجود في نظام المصادقة لكن ما له صف في جدول profiles. ' +
        'غالباً حارس on_auth_user_created ما اشتغل. راجع صاحب المحل.',
    }
  }
  if (!profile.active) {
    await client.auth.signOut()
    return { ok: false, error: 'هذا الحساب موقوف.' }
  }

  // فشل تسجيل وقت الدخول لا يُفشل الدخول نفسه: معلومة إدارية لا شرط دخول،
  // ورفضها ما يصح يمنع الموظف من فتح الشاشة والزبون واقف.
  await client.rpc('touch_last_login')
  return { ok: true }
}

async function signInLocal(username: string, pin: string): Promise<AuthResult> {
  const found = await db.users.where('username').equals(username.trim().toLowerCase()).first()
  if (!found) return { ok: false, error: 'اسم المستخدم غير موجود' }
  if (!found.active) return { ok: false, error: 'هذا الحساب موقوف' }
  if (found.pinHash !== (await sha256(pin))) return { ok: false, error: 'الرمز السري غير صحيح' }

  await db.users.put({ ...found, lastLoginAt: Date.now() })
  localStorage.setItem(SESSION_KEY, found.id)
  return { ok: true }
}

/**
 * تسجيل حساب جديد — الوضع السحابي وحده.
 *
 * الدور لا يُرسل إطلاقاً مع بيانات التسجيل: من يسجّل يتحكم بها، فلو قرأها
 * الخادم لصار كل من يفتح صفحة التسجيل مالكاً. الحارس في القاعدة يحسب الدور
 * وحده (أول حساب مالك، وما بعده موظف).
 */
export async function signUp(input: {
  email: string
  password: string
  name: string
  username: string
  phone?: string
}): Promise<AuthResult> {
  if (!cloudAuth) return { ok: false, error: 'التسجيل الذاتي يحتاج قاعدة بيانات مربوطة.' }

  const client = requireClient()
  const { data, error } = await client.auth.signUp({
    email: input.email.trim(),
    password: input.password,
    options: {
      data: {
        name: input.name.trim(),
        username: input.username.trim().toLowerCase(),
        phone: input.phone?.trim() || null,
      },
    },
  })
  if (error) return { ok: false, error: humanError(error) }

  // لو كان تأكيد البريد مفعّلاً في المشروع تعود الجلسة فارغة. الصمت هنا يترك
  // المستخدم يظن أن التسجيل فشل، فيعيد المحاولة ببريد آخر.
  if (!data.session) {
    return { ok: true, notice: 'تم إنشاء الحساب. افتح بريدك وأكّد الرابط ثم سجّل الدخول.' }
  }
  return { ok: true }
}

export async function signOut(): Promise<void> {
  if (cloudAuth) {
    await requireClient().auth.signOut()
    return
  }
  localStorage.removeItem(SESSION_KEY)
}

/** المستخدم الحالي، أو `null` لو ما فيه جلسة صالحة. */
export async function currentUser(): Promise<User | null> {
  if (!cloudAuth) {
    const savedId = localStorage.getItem(SESSION_KEY)
    const saved = savedId ? ((await db.users.get(savedId)) ?? null) : null
    return saved?.active ? saved : null
  }

  const client = requireClient()
  const { data } = await client.auth.getSession()
  if (!data.session) return null
  const profile = await fetchProfile(data.session.user.id)
  return profile?.active ? profile : null
}

/**
 * تغيّر الجلسة من خارج هذه الشاشة: تجديد الرمز، أو خروج من تبويب آخر، أو
 * انتهاء صلاحية. بدونها يبقى التبويب المفتوح يعرض واجهة لمستخدم خرج فعلاً.
 */
export function onAuthChange(cb: () => void): () => void {
  if (!cloudAuth) return () => undefined
  const { data } = requireClient().auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') cb()
  })
  return () => data.subscription.unsubscribe()
}

/* -------------------------------------------------------------------------- */
/* استرجاع كلمة المرور                                                         */
/* -------------------------------------------------------------------------- */

/**
 * علم الاسترجاع في `sessionStorage` لا في متغيّر داخل الوحدة: رابط الاسترجاع
 * يفتح تبويباً جديداً، وابتلاع الرمز من العنوان يحدث قبل أن يُركَّب أي مكوّن.
 * لو ضاع العلم لدخل المستخدم إلى لوحة التحكم مباشرة بجلسة استرجاع، وهي جلسة
 * مؤقتة تنتهي وهو لا يعرف كلمته بعد — فيعود إلى نقطة الصفر.
 */
const RECOVERY_KEY = 'wedh7.recovery'

/** هل نحن داخل مسار «عيّن كلمة مرور جديدة»؟ */
export function recoveryActive(): boolean {
  try {
    return sessionStorage.getItem(RECOVERY_KEY) === '1'
  } catch {
    return false
  }
}

function setRecovery(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(RECOVERY_KEY, '1')
    else sessionStorage.removeItem(RECOVERY_KEY)
  } catch {
    // متصفح يمنع التخزين — المسار يبقى عاملاً لهذه الجلسة بلا صمود عبر التحديث.
  }
}

/**
 * ابتلاع رمز الاسترجاع من العنوان — يُنادى مرة واحدة قبل تركيب الواجهة.
 *
 * `detectSessionInUrl` مطفأ عمداً: Supabase تضع الرمز في `hash` العنوان،
 * والتوجيه عندنا `HashRouter` يقرأ نفس الجزء. لو تُرك الاكتشاف التلقائي
 * لتنازعا: يصير `#access_token=…` مساراً غير موجود وتظهر شاشة فارغة. فنقرأه
 * هنا يدوياً ثم نمسحه ونضع المسار الصحيح مكانه.
 */
export async function consumeRecoveryLink(): Promise<boolean> {
  if (!cloudAuth) return false

  const raw = window.location.hash.replace(/^#/, '')
  if (!raw.includes('access_token') && !raw.includes('error_description')) return false

  const params = new URLSearchParams(raw)
  const accessToken = params.get('access_token')
  const refreshToken = params.get('refresh_token')
  const type = params.get('type')

  // العنوان يُنظَّف في كل الحالات: تركه يعني رمز جلسة يبقى في سجلّ المتصفح
  // ويُشارَك مع أي رابط يُنسخ من شريط العنوان.
  window.location.hash = '#/'

  if (type !== 'recovery' || !accessToken || !refreshToken) return false

  const { error } = await requireClient().auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  })
  if (error) return false

  setRecovery(true)
  return true
}

/** إرسال رسالة الاسترجاع. الرابط يعود إلى نفس النطاق الذي طُلب منه. */
export async function requestPasswordReset(email: string): Promise<AuthResult> {
  if (!cloudAuth) return { ok: false, error: 'الاسترجاع يحتاج قاعدة بيانات مربوطة.' }

  const { error } = await requireClient().auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${window.location.origin}${window.location.pathname}`,
  })
  if (error) return { ok: false, error: humanError(error) }

  // الرسالة واحدة سواء وُجد البريد أو لا: التفريق بينهما يكشف من عنده حساب
  // في النظام لأي شخص يجرّب بريداً في شاشة الدخول.
  return {
    ok: true,
    notice: 'إذا كان البريد مسجّلاً فستصلك رسالة فيها رابط تعيين كلمة مرور جديدة.',
  }
}

/** تعيين كلمة المرور الجديدة — يحتاج جلسة قائمة (جلسة الاسترجاع تكفي). */
export async function updatePassword(password: string): Promise<AuthResult> {
  if (!cloudAuth) return { ok: false, error: 'تغيير كلمة المرور يحتاج قاعدة بيانات مربوطة.' }

  const { error } = await requireClient().auth.updateUser({ password })
  if (error) return { ok: false, error: humanError(error) }
  setRecovery(false)
  return { ok: true }
}

/** الخروج من مسار الاسترجاع بلا تغيير — يُنهي الجلسة المؤقتة معه. */
export async function cancelRecovery(): Promise<void> {
  setRecovery(false)
  await signOut()
}

/* -------------------------------------------------------------------------- */
/* قراءة المستخدمين                                                            */
/* -------------------------------------------------------------------------- */

interface CapRow {
  user_id?: string
  capability: string
  granted: boolean
}

/**
 * استعلامان لا استعلام واحد بتضمين (`profiles(*, user_capabilities(...))`).
 * التضمين يعتمد على مفتاح أجنبي تكتشفه طبقة الـ API من ذاكرة مخطّط قد تتأخّر
 * عن آخر ترحيل — وفشلها يمنع الدخول كلياً. الاستثناءات ثانوية: غيابها يعني
 * «اتبع الدور» وهو سلوك صحيح، بينما منع الدخول ليس صحيحاً أبداً.
 */
async function fetchProfile(id: string): Promise<User | null> {
  const client = requireClient()
  const { data, error } = await client.from('profiles').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(humanError(error))
  if (!data) return null

  const { data: caps } = await client
    .from('user_capabilities')
    .select('capability, granted')
    .eq('user_id', id)
  return toUser(data as Row, (caps ?? []) as CapRow[])
}

export async function listUsers(): Promise<User[]> {
  if (!cloudAuth) return db.users.toArray()

  const client = requireClient()
  const { data, error } = await client
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) throw new Error(humanError(error))

  const { data: caps } = await client
    .from('user_capabilities')
    .select('user_id, capability, granted')
  const byUser = new Map<string, CapRow[]>()
  for (const c of (caps ?? []) as CapRow[]) {
    const key = c.user_id ?? ''
    byUser.set(key, [...(byUser.get(key) ?? []), c])
  }
  return (data ?? []).map((r) => toUser(r as Row, byUser.get(String((r as Row).id)) ?? []))
}

/* -------------------------------------------------------------------------- */
/* تعديل المستخدمين                                                            */
/* -------------------------------------------------------------------------- */

export interface UserPatch {
  name: string
  username: string
  role: Role
  phone?: string
  capOverrides: CapOverrides
  /** محلياً فقط: رمز جديد. سحابياً كلمة المرور بيد صاحبها عبر Supabase Auth. */
  pin?: string
}

export async function updateUser(user: User, patch: UserPatch): Promise<void> {
  if (!cloudAuth) {
    await db.users.update(user.id, {
      name: patch.name,
      username: patch.username,
      role: patch.role,
      phone: patch.phone,
      capOverrides: Object.keys(patch.capOverrides).length ? patch.capOverrides : undefined,
      ...(patch.pin ? { pinHash: await sha256(patch.pin) } : {}),
    })
    return
  }

  const client = requireClient()
  const { error } = await client
    .from('profiles')
    .update({
      name: patch.name,
      username: patch.username,
      role: patch.role,
      phone: patch.phone ?? null,
    })
    .eq('id', user.id)
  if (error) throw new Error(humanError(error))

  await syncCapabilities(user, patch.capOverrides)
}

/**
 * الاستثناءات تُخزَّن كفروق لا كقائمة نهائية، فالمزامنة حذفٌ لما رجع إلى الدور
 * وكتابةٌ لما خالفه. الحذف أولاً: لو كُتب الجديد قبل حذف القديم لجاز أن يمرّ
 * حارس «آخر مدير» على حالة وسيطة لا يريدها أحد.
 */
async function syncCapabilities(user: User, next: CapOverrides): Promise<void> {
  const client = requireClient()
  const previous = user.capOverrides ?? {}
  const removed = Object.keys(previous).filter((c) => next[c as keyof CapOverrides] === undefined)

  if (removed.length) {
    const { error } = await client
      .from('user_capabilities')
      .delete()
      .eq('user_id', user.id)
      .in('capability', removed)
    if (error) throw new Error(humanError(error))
  }

  const rows = Object.entries(next)
    .filter(([cap, granted]) => granted !== undefined && previous[cap as never] !== granted)
    .map(([capability, granted]) => ({ user_id: user.id, capability, granted }))

  if (rows.length) {
    const { error } = await client
      .from('user_capabilities')
      .upsert(rows, { onConflict: 'user_id,capability' })
    if (error) throw new Error(humanError(error))
  }
}

export async function setUserActive(user: User, active: boolean): Promise<void> {
  if (!cloudAuth) {
    await db.users.update(user.id, { active })
    return
  }
  const { error } = await requireClient().from('profiles').update({ active }).eq('id', user.id)
  if (error) throw new Error(humanError(error))
}

/* -------------------------------------------------------------------------- */
/* سجل النشاط                                                                  */
/* -------------------------------------------------------------------------- */

export async function logAudit(
  user: { id: string; name: string },
  action: string,
  entity: string,
  entityId?: string,
  details?: string,
): Promise<void> {
  if (!cloudAuth) {
    await logAuditLocal(user, action, entity, entityId, details)
    return
  }
  // السجل أثر لا شرط: فشل كتابته لا يُبطل العملية التي تمّت أصلاً.
  await requireClient()
    .from('audit_log')
    .insert({
      user_id: user.id,
      user_name: user.name,
      action,
      entity,
      entity_id: entityId ?? null,
      details: details ?? null,
    })
    .then(undefined, () => undefined)
}

export async function listAudit(limit = 60): Promise<AuditEntry[]> {
  if (!cloudAuth) {
    return (await db.audit.toArray()).sort((a, b) => b.at - a.at).slice(0, limit)
  }
  const { data, error } = await requireClient()
    .from('audit_log')
    .select('*')
    .order('at', { ascending: false })
    .limit(limit)
  // قراءة السجل تحتاج `users.manage`؛ من لا يملكها يرى سجلاً فارغاً لا خطأً.
  if (error) return []
  return (data ?? []).map((r) => ({
    id: String((r as Row).id),
    userId: String((r as Row).user_id ?? ''),
    userName: String((r as Row).user_name ?? ''),
    action: String((r as Row).action ?? ''),
    entity: String((r as Row).entity ?? ''),
    entityId: (r as Row).entity_id ? String((r as Row).entity_id) : undefined,
    at: toMs((r as Row).at),
    details: (r as Row).details ? String((r as Row).details) : undefined,
  }))
}

/** يُستخدم في الوضع المحلي وحده: إنشاء حساب برمز سري. */
export async function createLocalUser(patch: UserPatch): Promise<string> {
  const id = uid('u_')
  await db.users.add({
    id,
    name: patch.name,
    username: patch.username,
    pinHash: await sha256(patch.pin ?? ''),
    role: patch.role,
    capOverrides: Object.keys(patch.capOverrides).length ? patch.capOverrides : undefined,
    phone: patch.phone,
    active: true,
    createdAt: Date.now(),
  })
  return id
}
