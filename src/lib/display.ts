/**
 * إخفاء الأرقام المالية على الشاشة بضغطة (زر العين في الترويسة)، كما في تطبيقات البنوك.
 *
 * الإخفاء طبقة عرض فقط: الشاشات تستورد `money` و`percent` من هنا بدل `format.ts`،
 * أما الطباعة وPDF وواتساب ولقطة المحاسب الذكي فتبقى على `format.ts` مباشرة. فاتورة
 * تُطبع أو تُرسل للزبون بنقاط مكان المبلغ قرار تجاري خاطئ لا خصوصية. ولهذا أيضاً تبقى
 * `InvoiceDoc` على الأرقام الحقيقية: هي المستند نفسه، و`Ctrl+P` يطبع ما على الشاشة.
 *
 * ⚠️ هذا ستار أمام من ينظر من فوق الكتف، لا حماية: من يضغط الزر يرى كل شيء. الحجب
 * الحقيقي لمن لا يملك `pricing.view` في RLS والمناظر `_v`.
 */
import * as fmt from './format'

const KEY = 'wedh7.hideNumbers'
export const HIDE_EVENT = 'wedh7:hide-numbers'
export const MASK = '••••'

function read(): boolean {
  // التخزين قد يُرفض (تصفّح خاص، بيانات ممسوحة): الأرقام ظاهرة افتراضاً كي لا يفاجأ
  // أحد بنقاط لا يعرف مصدرها.
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

let hidden = read()

export function numbersHidden(): boolean {
  return hidden
}

export function setNumbersHidden(next: boolean): void {
  hidden = next
  try {
    if (next) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    // يبقى الإخفاء لهذه الجلسة فقط — لا شيء يستحق إيقاف الشاشة لأجله.
  }
  window.dispatchEvent(new Event(HIDE_EVENT))
}

/** لـ`useSyncExternalStore`: يشمل تبويباً آخر غيّر الحالة عبر حدث `storage`. */
export function subscribeHidden(onChange: () => void): () => void {
  const fromStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return
    hidden = read()
    onChange()
  }
  window.addEventListener(HIDE_EVENT, onChange)
  window.addEventListener('storage', fromStorage)
  return () => {
    window.removeEventListener(HIDE_EVENT, onChange)
    window.removeEventListener('storage', fromStorage)
  }
}

export function money(n: number, opts: { compact?: boolean } = {}): string {
  return hidden ? `${MASK} ${fmt.symbol()}` : fmt.money(n, opts)
}

export function percent(n: number, digits = 1): string {
  return hidden ? `${MASK}٪` : fmt.percent(n, digits)
}

/** لنصّ مالي مُركّب خارج `money` (هامش بـ`toFixed` مثلاً). */
export function hide(text: string): string {
  return hidden ? MASK : text
}

/**
 * نصّ حرّ فيه أرقام لا نعرف مواضعها: ردّ المحاسب الذكي وتحليله. الأرقام العربية
 * والهندية معاً لأن النموذج قد يكتب أيّاً منهما.
 */
export function maskDigits(text: string): string {
  return hidden ? text.replace(/[0-9٠-٩][0-9٠-٩.,٫٬]*/g, MASK) : text
}
