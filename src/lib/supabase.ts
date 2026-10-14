/**
 * عميل Supabase وحدود تشغيله.
 *
 * التطبيق يعمل في وضعين، والوضع يُحسم من متغيّرات البيئة لا من إعداد داخل
 * الواجهة: لو غاب `VITE_SUPABASE_URL` بقي كل شيء على IndexedDB كما هو اليوم.
 * السبب أن نصف انتقال أسوأ من عدمه — لا يصح أن يعتمد مصدر حقيقة بيانات المحل
 * على مفتاح في `localStorage` يقدر أي أحد يقلبه.
 *
 * ⚠️ مفتاح `anon` علني بحكم التصميم: يُشحن داخل صفحة المتصفح ويقرأه أي زائر.
 * أمان النظام لا يعتمد عليه إطلاقاً بل على سياسات RLS داخل Postgres. ولهذا
 * تحديداً لا يجوز أن يقترب مفتاح `service_role` من هذا الملف — يتجاوز كل سياسة.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ''
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? ''

/** هل التطبيق مربوط بقاعدة بيانات؟ يُقرأ مرة واحدة عند التحميل. */
export const cloudEnabled = Boolean(url && anonKey)

/**
 * حارس ضد خطأ نشر شائع: وضع مفتاح `service_role` مكان `anon`. كلاهما JWT صالح
 * وسيعمل التطبيق بشكل طبيعي تماماً — بينما تكون كل سياسات RLS معطّلة وكل زائر
 * يملك القاعدة. الفشل الصامت هنا هو الخطر، فنُفشلها بصوت عالٍ.
 */
function assertNotServiceRole(key: string): void {
  // صيغة المفاتيح الحديثة تعلن نفسها بالبادئة: `sb_publishable_` علني بحكم
  // التصميم، و`sb_secret_` سرّ خادم يتجاوز كل سياسة. الثاني ليس JWT فلا يكشفه
  // الفحص أدناه — والنتيجة لو مرّ: تطبيق يعمل بشكل طبيعي تماماً وكل زائر يملك
  // القاعدة. البادئة أصرح دليل متاح، فتُفحص أولاً.
  if (key.startsWith('sb_secret_')) {
    throw new Error(
      'مفتاح سرّي (sb_secret_) موضوع في VITE_SUPABASE_ANON_KEY. هذا المفتاح يتجاوز ' +
        'كل سياسات الحماية ويُشحن داخل الصفحة لكل زائر. استبدله بمفتاح ' +
        'sb_publishable_ فوراً.',
    )
  }

  try {
    const payload = JSON.parse(atob(key.split('.')[1] ?? '')) as { role?: string }
    if (payload.role === 'service_role') {
      throw new Error(
        'مفتاح service_role موضوع في VITE_SUPABASE_ANON_KEY. هذا المفتاح يتجاوز كل ' +
          'سياسات الحماية ويُشحن داخل الصفحة لكل زائر. استبدله بمفتاح anon فوراً.',
      )
    }
  } catch (err) {
    // مفتاح publishable الحديث (sb_publishable_…) ليس JWT فلا يُفكّ — وهذا مقبول.
    if (err instanceof Error && err.message.startsWith('مفتاح')) throw err
  }
}

/**
 * خطأ إعداد يمنع ربط القاعدة — يُعرض على الشاشة بدل أن يُرمى.
 *
 * كان الرمي هنا يُسقط التطبيق قبل أول رسم: `createClient` يرفض رابطاً غير صالح
 * وحارس المفتاح السرّي يرمي، وكلاهما وقت تحميل الوحدة. النتيجة صفحة بيضاء بلا
 * رسالة — وهذا ما حدث فعلاً حين وُضع المفتاح مكان الرابط في متغيّرات Vercel.
 * صفحة بيضاء لصاحب المحل تعني «النظام خربان»، لا «متغيّر واحد خطأ».
 */
export const configError: string | null = (() => {
  if (!cloudEnabled) return null
  if (url.startsWith('sb_') || url.startsWith('eyJ')) {
    return (
      'قيمة VITE_SUPABASE_URL في Vercel هي مفتاح لا رابط. ضع فيها رابط المشروع ' +
      '(https://xxxx.supabase.co) من Supabase ← Project Settings ← API، ثم أعد النشر.'
    )
  }
  if (!/^https:\/\/[^\s/]+\.[^\s/]+\/?$/.test(url)) {
    return (
      'قيمة VITE_SUPABASE_URL ليست رابطاً صالحاً. المطلوب بالضبط: https://xxxx.supabase.co ' +
      'بلا مسافة ولا مسار بعده، ثم أعد النشر من Vercel.'
    )
  }
  try {
    assertNotServiceRole(anonKey)
  } catch (err) {
    return err instanceof Error ? err.message : 'مفتاح Supabase غير صالح.'
  }
  return null
})()

export const supabase: SupabaseClient | null =
  cloudEnabled && !configError
    ? createClient(url, anonKey, {
        auth: {
          // الجلسة تُحفظ وتُجدَّد تلقائياً: صاحب المحل ما يبي يسجّل دخول كل ساعة.
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false, // التوجيه HashRouter — لا نريد تنازعاً على الـ hash
        },
      })
    : null

/** يُستدعى في مسارات الكتابة: يوضّح السبب بدل انهيار بمرجع فارغ. */
export function requireClient(): SupabaseClient {
  if (!supabase) {
    throw new Error('قاعدة البيانات غير مربوطة. اضبط VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY.')
  }
  return supabase
}

/**
 * ترجمة أخطاء Supabase إلى عربية يفهمها صاحب المحل.
 *
 * الرسالة الإنجليزية الخام تعني للمستخدم «تعطّل شيء» فقط، وهذا يدفعه إلى إعادة
 * المحاولة على بيعة نجحت أصلاً. التمييز بين «لا اتصال» و«ممنوع» و«رصيد لا يكفي»
 * هو الفرق بين قرار صحيح وقرار خاطئ خلف الكاونتر.
 */
/**
 * جدول أو دالة غير موجودة على الخادم: الواجهة أحدث من آخر ترحيل طُبّق.
 * `42P01` من Postgres مباشرة، و`PGRST205`/`PGRST202` من PostgREST حين لا يجد
 * الجدول أو الدالة في مخطّطه المخزَّن.
 */
export function isMissingSchema(err: unknown): boolean {
  if (!err) return false
  const code = (err as { code?: string }).code ?? ''
  return code === '42P01' || code === 'PGRST205' || code === 'PGRST202'
}

export function humanError(err: unknown): string {
  if (!navigator.onLine) {
    return 'لا يوجد اتصال بالإنترنت. البيع يحتاج اتصالاً — تصفّح المنتجات والأسعار ما زال يعمل.'
  }
  const msg = errorText(err)
  const code = (err as { code?: string } | null)?.code ?? ''

  if (code === '42501' || /permission denied|row-level security/i.test(msg)) {
    return msg.startsWith('ليس لديك') || /[؀-ۿ]/.test(msg)
      ? msg // رسالة الدالة نفسها عربية أصلاً وأدقّ من أي تعميم هنا
      : 'ما عندك صلاحية لهذه العملية.'
  }
  if (isMissingSchema(err)) {
    return 'قاعدة البيانات تحتاج تحديثاً: شغّل آخر ترحيل من مجلد supabase/migrations في SQL Editor.'
  }
  // القيد القديم على الأنواع الأربعة: الواجهة سبقت ترحيل البنود الرئيسية الحرّة.
  if (code === '23514' && /purchase_items_kind_check/.test(msg)) {
    return 'قاعدة البيانات تحتاج تحديثاً لتقبل بنوداً رئيسية جديدة: شغّل الترحيل 20261016000000_expense_groups.sql في SQL Editor.'
  }
  if (code === '23505') return 'هذه القيمة مستخدمة من قبل.'
  if (code === '23503') {
    // نفس الرمز لاتجاهين: حذف صفّ تعتمد عليه صفوف أخرى، أو إدراج يشير إلى صفّ مفقود.
    if (/update or delete on table/i.test(msg)) {
      return 'لا يمكن الحذف: هذا السجل مستخدم في فواتير أو طلبات قائمة.'
    }
    // اسم القيد يحدّد ما المفقود؛ «سجل غير موجود» وحدها لا تخبر صاحب المحل ماذا يغيّر.
    if (/supplier/i.test(msg))
      return 'المورد المختار غير موجود في القاعدة — اختر مورداً آخر أو «بلا مورد».'
    if (/categor/i.test(msg))
      return 'التصنيف المختار غير موجود في القاعدة — حدّث الصفحة واختر تصنيفاً.'
    if (/customer/i.test(msg))
      return 'العميل المختار غير موجود في القاعدة — حدّث الصفحة واختره من جديد.'
    return 'العملية تشير إلى سجل غير موجود — ربما حُذف من جهاز آخر. حدّث الصفحة وأعد المحاولة.'
  }
  if (/Invalid login credentials/i.test(msg)) return 'البريد أو كلمة المرور غير صحيحة.'
  if (/Email not confirmed/i.test(msg)) return 'الحساب يحتاج تأكيد البريد أولاً.'
  if (/Failed to fetch|NetworkError|fetch failed/i.test(msg)) {
    return 'تعذّر الوصول إلى قاعدة البيانات. تحقّق من الاتصال ثم أعد المحاولة.'
  }
  return msg || 'حدث خطأ غير متوقّع.'
}

/**
 * استخراج نصّ الخطأ من أي شكل يصل.
 *
 * أخطاء Supabase كائنات عادية `{message, details, hint, code}` لا نسخ من
 * `Error`. و`String()` عليها يعطي `[object Object]` — وهذا ما ظهر فعلاً لصاحب
 * المحل بدل سبب فشل الرفع، فضاع الخطأ الحقيقي تماماً.
 *
 * `details` و`hint` تُضمّان لأن رسالة Postgres وحدها كثيراً ما تكون مقتضبة
 * («insert violates foreign key») بينما التفصيل يسمّي العمود والقيمة.
 */
function errorText(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>
    const parts = [e.message, e.details, e.hint].filter(
      (p): p is string => typeof p === 'string' && p.length > 0,
    )
    // الخطأ الخام يبقى في الطرفية: الرسالة المترجَمة للمستخدم، والأصل للتشخيص.
    if (parts.length) {
      console.error('خطأ من القاعدة:', err)
      return parts.join(' — ')
    }
  }
  console.error('خطأ غير معروف الشكل:', err)
  return ''
}
