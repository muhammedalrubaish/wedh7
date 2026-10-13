/**
 * تذكير النسخ الاحتياطي.
 *
 * لماذا تذكير لا جدولة: خطة Supabase المجانية لا تأخذ نسخاً يومية قابلة للتنزيل،
 * فزر «تنزيل نسخة احتياطية» هو الحماية الوحيدة لبيانات المحل — وهو يعتمد على أن
 * يتذكّره صاحب المحل. والنسخ الآلي إلى بريده يحتاج مفتاحاً على الخادم يقرأ كل
 * الجداول، أي باباً خلفياً بيد من يملك حساب النشر. فالتذكير هو ما يحفظ الخصوصية.
 *
 * لماذا في ذاكرة الجهاز لا في القاعدة: يُغني عن ترحيل، وخطؤه الوحيد الممكن تنبيه
 * زائد على جهاز ثانٍ أُخذت النسخة من غيره — لا تنبيه غائب حين يستحق.
 */

export const BACKUP_EVERY_DAYS = 7
const DAY = 86_400_000
const KEY = 'wedh7.lastBackupAt'
const SNOOZE_KEY = 'wedh7.backupSnoozeUntil'
export const BACKUP_EVENT = 'wedh7:backup'

const read = (key: string): number => {
  try {
    const v = Number(localStorage.getItem(key))
    return Number.isFinite(v) && v > 0 ? v : 0
  } catch {
    return 0 // تصفّح خاص أو تخزين محجوب: يُعامل كأن لا نسخة — التنبيه أسلم من الصمت
  }
}

const write = (key: string, value: number | null) => {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, String(value))
  } catch {
    // لا شيء يُفعل: التنبيه سيظهر مجدداً، وهذا مقبول
  }
  window.dispatchEvent(new Event(BACKUP_EVENT))
}

export const lastBackupAt = () => read(KEY)
export const snoozedUntil = () => read(SNOOZE_KEY)

export function markBackedUp(at = Date.now()) {
  write(KEY, at)
  write(SNOOZE_KEY, null)
}

/** «لاحقاً» تؤجّل يوماً واحداً لا أسبوعاً: التأجيل الطويل هو بالضبط ما يُنسي. */
export const snoozeBackup = (now = Date.now()) => write(SNOOZE_KEY, now + DAY)

export interface BackupStatus {
  due: boolean
  /** أيام منذ آخر نسخة من هذا الجهاز، أو `null` إن لم تؤخذ نسخة أبداً. */
  days: number | null
}

/**
 * المرجع آخر نسخة، أو — إن لم تؤخذ أبداً — أول بيانات حقيقية (أول فاتورة أو مشتريات).
 * قاعدة فارغة لا تستحق تنبيهاً: لا شيء يضيع، والتنبيه يومها يعلّم تجاهله.
 */
export function backupStatus(input: {
  lastAt: number
  snoozeUntil: number
  firstDataAt: number | null
  now: number
}): BackupStatus {
  const { lastAt, snoozeUntil, firstDataAt, now } = input
  const days = lastAt ? Math.floor((now - lastAt) / DAY) : null
  const since = lastAt || firstDataAt
  if (!since) return { due: false, days }
  const due = now - since >= BACKUP_EVERY_DAYS * DAY && now >= snoozeUntil
  return { due, days }
}

/** «يوم، يومان، ٣ أيام، ١١ يوماً» — العدد العربي لا يقبل صيغة واحدة. */
export function daysLabel(n: number): string {
  if (n === 1) return 'يوم واحد'
  if (n === 2) return 'يومان'
  if (n >= 3 && n <= 10) return `${n} أيام`
  return `${n} يوماً`
}
