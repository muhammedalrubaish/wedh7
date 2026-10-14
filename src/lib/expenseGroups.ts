/**
 * البنود الرئيسية للمصروفات («التشغيلية»، «مكونات»…) — أسماء يكتبها صاحب المعمل،
 * وتحت كل بند رئيسي بنوده الفرعية (أصناف `purchase_items`).
 *
 * البند الرئيسي ليس جدولاً: هو `kind` على الصنف. يوجد ما دام تحته صنف، فلا بند
 * فارغ يتيم. انظر ترحيل `20261016000000_expense_groups.sql`.
 */

/**
 * المفاتيح الثابتة قبل الترحيل وأسماؤها. تبقى هنا لسببين: نسخة احتياطية قديمة أو
 * مرآة محلية لم تُسحب بعد قد تحمل المفتاح، وقاعدة لم يُطبَّق عليها الترحيل تُرجعه.
 */
const LEGACY: Record<string, string> = {
  ingredient: 'مكونات',
  packaging: 'تغليف',
  expense: 'مصاريف',
  equipment: 'أخرى',
}

/** اسم البند الرئيسي للعرض والتجميع — كل قراءة لـ`kind` تمرّ من هنا. */
export const groupName = (kind: string): string => LEGACY[kind] ?? kind.trim()

/** المفاتيح القديمة التي تُعرض بهذا الاسم — لتشملها إعادة التسمية. */
export const legacyKeysOf = (name: string): string[] =>
  Object.entries(LEGACY)
    .filter(([, v]) => v === name)
    .map(([k]) => k)

/** اقتراحات لأول مرة فقط، حين لا يوجد بند رئيسي بعد. */
export const STARTER_GROUPS = ['مكونات', 'تغليف', 'التشغيلية']

/** البنود الرئيسية الموجودة، أبجدياً. المؤرشف لا يُقترح لصنف جديد. */
export function groupsOf(items: Array<{ kind: string; archived?: boolean }>): string[] {
  const names = new Set<string>()
  for (const it of items) if (!it.archived) names.add(groupName(it.kind))
  return [...names].sort((a, b) => a.localeCompare(b, 'ar'))
}

const HINTS: Record<string, { name: string; unit: string }> = {
  مكونات: { name: 'قشطة، سكر، دقيق…', unit: 'كيلو' },
  تغليف: { name: 'كرتون بوكس، شريطة…', unit: 'كرتون' },
  مصاريف: { name: 'إيجار المحل، كهرباء…', unit: 'شهر' },
  التشغيلية: { name: 'راتب العامل، الكهرباء، الإيجار…', unit: 'شهر' },
  أخرى: { name: 'شراء ثلاجة، صيانة الفرن…', unit: 'حبة' },
}

/** مثال الاسم والوحدة المقترحة تحت بند رئيسي — توفّر كتابة «شهر» عشرين مرة. */
export const groupHint = (group: string): { name: string; unit: string } =>
  HINTS[group] ?? { name: 'اسم البند الفرعي…', unit: 'حبة' }
