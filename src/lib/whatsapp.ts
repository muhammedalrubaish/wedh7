/**
 * إرسال الفاتورة وكشف الحساب عبر واتساب.
 *
 * طلب العميل حرفياً: «أصدر الفاتورة وأعطيه إياها وأرسلها واتساب». لا توجد واجهة
 * برمجية لواتساب من متصفح بلا حساب أعمال معتمد، فالمتاح هو رابط `wa.me` يفتح
 * المحادثة مع الزبون والنصّ مكتوب جاهزاً — يضغط إرسال وينتهي.
 *
 * نصّ لا صورة: الرابط لا يحمل مرفقات. والنصّ يحوي كل ما يحتاجه الزبون ليراجع
 * ورقته (الرقم والبنود والمبلغ)، وهو ما يُبحث عنه في المحادثة بعد شهر.
 */
import { date, money, num } from './format'
import type { Customer, Invoice, ReturnNote, Settings } from './types'

/**
 * يحوّل جوالاً سعودياً مكتوباً كما يكتبه الناس إلى الصيغة الدولية التي يفهمها
 * `wa.me`: `05xxxxxxxx` ← `9665xxxxxxxx`. ما لا يُفهم يُعاد كأرقام فقط.
 */
export function waNumber(phone: string | undefined): string {
  const digits = (phone ?? '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('00')) return digits.slice(2)
  if (digits.startsWith('966')) return digits
  if (digits.startsWith('05') && digits.length === 10) return `966${digits.slice(1)}`
  if (digits.startsWith('5') && digits.length === 9) return `966${digits}`
  return digits
}

/** رابط يفتح واتساب على جوال الزبون أو على اختيار جهة اتصال إن لم يُعرف جواله. */
export function waLink(phone: string | undefined, text: string): string {
  const to = waNumber(phone)
  const body = encodeURIComponent(text)
  return to ? `https://wa.me/${to}?text=${body}` : `https://wa.me/?text=${body}`
}

export function invoiceMessage(invoice: Invoice, settings: Settings): string {
  const lines = invoice.lines.map((l) => {
    const free = l.freeQty ? ` (+${num(l.freeQty)} هدية)` : ''
    return `• ${l.name} × ${num(l.qty)}${free} = ${money(l.unitPrice * l.qty - l.discount)}`
  })
  const out = [
    `🧾 ${settings.shopName} — فاتورة ${invoice.number}`,
    `📅 ${date(invoice.createdAt)}`,
    invoice.customerName ? `👤 ${invoice.customerName}` : '',
    '',
    ...lines,
    '',
    invoice.discount > 0 ? `خصم: ${money(invoice.discount)}` : '',
    invoice.vatAmount > 0 ? `الضريبة: ${money(invoice.vatAmount)}` : '',
    `✅ الإجمالي: ${money(invoice.total)}`,
    '',
    settings.phone ? `للاستفسار: ${settings.phone}` : '',
  ]
  return out.filter((l) => l !== '').join('\n')
}

export function returnMessage(note: ReturnNote, settings: Settings): string {
  const lines = note.lines.map((l) => `• ${l.name} × ${num(l.qty)} = ${money(l.unitPrice * l.qty)}`)
  return [
    `↩️ ${settings.shopName} — إشعار مرتجع ${note.number}`,
    `على فاتورة ${note.invoiceNumber} · ${date(note.createdAt)}`,
    note.reason ? `السبب: ${note.reason}` : '',
    '',
    ...lines,
    '',
    note.vatAmount > 0 ? `الضريبة المردودة: ${money(note.vatAmount)}` : '',
    `✅ المبلغ المردود: ${money(note.total)}`,
  ]
    .filter((l) => l !== '')
    .join('\n')
}

/**
 * كشف حساب الشهر لزبون واحد: فواتيره ومرتجعاته والصافي.
 * هذا ما يُرسَل آخر الشهر للمحل كي يُسدّد — سؤال العميل الثاني بعد الفاتورة.
 */
export function statementMessage(input: {
  customer: Customer
  invoices: Invoice[]
  returns: ReturnNote[]
  from: number
  to: number
  settings: Settings
}): string {
  const { customer, invoices, returns, from, to, settings } = input
  const inv = invoices
    .filter((i) => i.customerId === customer.id && i.status !== 'refunded')
    .filter((i) => i.createdAt >= from && i.createdAt <= to)
    .sort((a, b) => a.createdAt - b.createdAt)
  const ret = returns
    .filter((r) => r.customerId === customer.id)
    .filter((r) => r.createdAt >= from && r.createdAt <= to)
    .sort((a, b) => a.createdAt - b.createdAt)

  const boxes = inv.reduce((n, i) => n + i.lines.reduce((m, l) => m + l.qty, 0), 0)
  const free = inv.reduce((n, i) => n + i.lines.reduce((m, l) => m + l.freeQty, 0), 0)
  const sold = inv.reduce((n, i) => n + i.total, 0)
  const back = ret.reduce((n, r) => n + r.total, 0)

  return [
    `📒 ${settings.shopName} — كشف حساب ${customer.name}`,
    `من ${date(from)} إلى ${date(to)}`,
    '',
    ...inv.map((i) => `🧾 ${i.number} · ${date(i.createdAt)} · ${money(i.total)}`),
    ...ret.map((r) => `↩️ ${r.number} · ${date(r.createdAt)} · -${money(r.total)}`),
    '',
    `📦 البوكسات: ${num(boxes)}${free ? ` (+${num(free)} هدية)` : ''}`,
    `المبيعات: ${money(sold)}`,
    back > 0 ? `المرتجع: -${money(back)}` : '',
    `✅ الصافي المستحق: ${money(sold - back)}`,
  ]
    .filter((l) => l !== '')
    .join('\n')
}
