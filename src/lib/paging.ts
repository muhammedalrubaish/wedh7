/**
 * سحب جدول كامل على صفحات.
 *
 * Supabase يُرجع ١٠٠٠ صف كحدّ أقصى للطلب الواحد (إعداد Max Rows) ويقصّ الباقي
 * **بصمت** — بلا خطأ ولا عدد. فطلب `select('*')` وحده كان يعني أن الفاتورة رقم ١٠٠١
 * وما بعدها لا تصل المرآة، والتقارير تنقص دون أن يلاحظ أحد. هنا تُطلب الصفحات
 * بترتيب ثابت (`id`) حتى تعود صفحة أقصر من المطلوب.
 *
 * ⚠️ يفترض أن Max Rows في إعدادات Supabase لا يقل عن `PAGE`. لو خُفّض إلى ٥٠٠ مثلاً
 * لعادت أول صفحة بـ٥٠٠ فظُنّت الأخيرة. القيمة الافتراضية ١٠٠٠ — لا تُخفَّض.
 */
export const PAGE = 1000

type Row = Record<string, unknown>
type Result = { data: unknown; error: unknown }
interface Ranged {
  range: (from: number, to: number) => PromiseLike<Result>
}
export type Source<C> = (client: C) => Ranged

export async function selectAllWith<C>(
  client: C,
  source: Source<C>,
  cap = Number.POSITIVE_INFINITY,
): Promise<{ data: Row[] | null; error: unknown }> {
  const out: Row[] = []
  for (let from = 0; from < cap; from += PAGE) {
    const to = Math.min(from + PAGE, cap) - 1
    const { data, error } = await source(client).range(from, to)
    if (error) return { data: null, error }
    const page = Array.isArray(data) ? (data as Row[]) : []
    out.push(...page)
    if (page.length < to - from + 1) break
  }
  return { data: out, error: null }
}
