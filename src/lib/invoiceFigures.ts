import { round2 } from './format'
import type { Invoice } from './types'

/**
 * أرقام أسفل الفاتورة بترتيب يُقرأ حساباً من أعلى لأسفل: المجموع ثم الخصم ثم الصافي.
 *
 * `invoice.discount` يجمع خصومات البنود مع خصم الفاتورة، وأسطر الجدول تُعرض بعد خصم
 * بندها. كانت الفاتورة تعرض «المجموع» بعد الخصم كله ثم «الخصم» مرة أخرى، فيرى المحل
 * ١٦٤ − ١٦ = ١٦٤ ويظن الحساب خاطئاً. هنا كل رقم يُطرح مرة واحدة:
 *   المجموع = مجموع أسطر الجدول كما تُرى
 *   الخصم   = خصم الفاتورة وحده (خصم البند ظاهر في سطره)
 *   الصافي  = المجموع − الخصم = `subtotal − discount` على الخادم
 */
export function invoiceFigures(invoice: Invoice) {
  const lineDiscount = round2(invoice.lines.reduce((n, l) => n + l.discount, 0))
  const discount = round2(invoice.discount - lineDiscount)
  const taxable = invoice.vatAmount > 0
  return {
    itemsTotal: round2(invoice.subtotal - lineDiscount),
    discount,
    net: round2(invoice.subtotal - invoice.discount),
    taxable,
    /** عنوان السطر الأول: «قبل الضريبة» فقط حين لا خصم يفصله عن الضريبة. */
    itemsLabel: taxable && discount <= 0 ? 'المجموع قبل الضريبة' : 'المجموع',
    /** سطر «الصافي قبل الضريبة» يلزم فقط حين يقع خصم بين المجموع والضريبة. */
    showNet: taxable && discount > 0,
  }
}
