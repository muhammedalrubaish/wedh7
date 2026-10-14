import QRCode from 'qrcode'
import { dateTime, money } from './format'
import { zatcaQrPayload } from './zatca'
import type { Invoice, ReturnNote, Settings } from './types'

/** ما يهمّ المحل على فاتورته: هل دفع أم لا — لا وسيلة الدفع. */
const paidLabel = (inv: Invoice) => (inv.status === 'unpaid' ? 'لم يتم السداد' : 'تم السداد')

export function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

const STYLE = `
  @page { size: 80mm auto; margin: 4mm; }
  * { box-sizing: border-box; }
  body { font-family: "IBM Plex Sans Arabic", system-ui, sans-serif; margin: 0; color: #000; font-size: 12px; }
  .wrap { width: 72mm; margin: 0 auto; }
  header { text-align: center; }
  h1 { font-size: 15px; margin: 0 0 2px; }
  .muted { color: #555; font-size: 10px; margin: 1px 0; }
  .tag { display: inline-block; border: 1px solid #999; border-radius: 4px; padding: 2px 8px; font-size: 10px; font-weight: 700; margin-top: 6px; }
  .meta { display: flex; justify-content: space-between; font-size: 10px; border-top: 1px dashed #999; border-bottom: 1px dashed #999; padding: 4px 0; margin: 8px 0; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: right; font-size: 10px; border-bottom: 1px solid #333; padding: 3px 0; }
  td { padding: 4px 0; border-bottom: 1px dotted #ccc; vertical-align: top; }
  .name { font-weight: 600; font-size: 11px; }
  .sku { color: #666; font-size: 9px; }
  .n { text-align: left; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .totals { margin-top: 8px; font-size: 11px; }
  .totals div { display: flex; justify-content: space-between; padding: 1px 0; }
  .grand { border-top: 1px solid #333; margin-top: 4px; padding-top: 4px !important; font-size: 13px; font-weight: 700; }
  .qr { text-align: center; margin-top: 12px; }
  .qr img { width: 100px; height: 100px; }
  .foot { text-align: center; color: #666; font-size: 9px; margin-top: 10px; }
  .refunded { border: 1px solid #c00; color: #c00; text-align: center; font-weight: 700; padding: 3px; margin-top: 8px; }
  .box { border: 1px solid #999; border-radius: 4px; padding: 4px 6px; margin-top: 8px; font-size: 10px; }
  .logo { display: block; width: 40mm; height: auto; margin: 0 auto 4px; }
`

/**
 * شعار العميل للطباعة. رابط كامل لا نسبي: النافذة الجديدة `about:blank` وقد لا
 * تحلّ الرابط النسبي على أصل الموقع في كل متصفح.
 */
export const logoUrl = (variant: 'black' | 'color') =>
  `${location.origin}/brand-print-${variant}.png`

export const logoImg = (variant: 'black' | 'color', cls = 'logo') =>
  `<img class="${cls}" src="${logoUrl(variant)}" alt="">`

/** `false` حين يحجب المتصفح النافذة — المستدعي يخبر المستخدم بدل أن لا يحدث شيء. */
export function openAndPrint(html: string, features = 'width=420,height=700'): boolean {
  const win = window.open('', '_blank', features)
  if (!win) return false
  win.document.write(html)
  win.document.close()
  win.focus()
  // الشعار صورة تُحمَّل من الشبكة: الطباعة قبل وصولها تُخرج الورقة بلا شعار. سقف
  // ثانيتين ونصف كي لا تعلق الطباعة إن تعذّر تحميلها — الفاتورة أهم من شعارها.
  const pending = [...win.document.images]
    .filter((img) => !img.complete)
    .map(
      (img) =>
        new Promise((done) => {
          img.addEventListener('load', done)
          img.addEventListener('error', done)
        }),
    )
  void Promise.race([Promise.all(pending), new Promise((done) => setTimeout(done, 2500))]).then(
    () => setTimeout(() => win.print(), 200),
  )
  return true
}

/**
 * يبني الفاتورة مستنداً مستقلاً ويطبعها من نافذة جديدة — يناسب الطابعات
 * الحرارية ٨٠مم ويُبقي تنسيق الشاشة بلا تجاوزات طباعة.
 */
export async function printInvoice(
  invoice: Invoice,
  settings: Settings,
  returns: ReturnNote[] = [],
): Promise<void> {
  // «فاتورة ضريبية» وصف قانوني: الحكم من الفاتورة نفسها لا من الإعدادات الحالية.
  const taxable = invoice.vatAmount > 0

  const rates = [...new Set(invoice.lines.map((l) => l.taxRate).filter((r) => r > 0))]
  const vatLabel =
    rates.length > 1
      ? 'ضريبة القيمة المضافة (حسب البنود)'
      : `ضريبة القيمة المضافة (${rates[0] ?? invoice.vatRate}٪)`

  // رمز ZATCA يحمل الرقم الضريبي ومبلغ الضريبة — لا يُولَّد لفاتورة بلا ضريبة.
  const qr =
    settings.zatcaQr && taxable
      ? await QRCode.toDataURL(
          zatcaQrPayload({
            sellerName: settings.shopName,
            vatNumber: settings.vatNumber,
            timestamp: invoice.createdAt,
            total: invoice.total,
            vatAmount: invoice.vatAmount,
          }),
          { width: 220, margin: 1 },
        )
      : null

  const lines = invoice.lines
    .map(
      (l) => `<tr>
        <td>
          <div class="name">${esc(l.name)}</div>
          <div class="sku">${esc(l.sku)}${l.freeQty ? ` · +${l.freeQty} عينة بلا مقابل` : ''}</div>
        </td>
        <td class="n">${l.qty}</td>
        <td class="n">${l.unitPrice.toFixed(2)}</td>
        <td class="n">${(l.unitPrice * l.qty - l.discount).toFixed(2)}</td>
      </tr>`,
    )
    .join('')

  const returned = returns.reduce((n, r) => n + r.total, 0)
  const returnsBlock = returns.length
    ? `<div class="box"><strong>مرتجعات على هذه الفاتورة</strong>${returns
        .map(
          (r) =>
            `<div class="totals"><div><span>${esc(r.number)} · ${esc(dateTime(r.createdAt))}</span><span>- ${esc(money(r.total))}</span></div></div>`,
        )
        .join(
          '',
        )}<div class="totals"><div class="grand"><span>الصافي بعد المرتجع</span><span>${esc(money(invoice.total - returned))}</span></div></div></div>`
    : ''

  const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>${esc(invoice.number)}</title>
<style>${STYLE}</style></head><body><div class="wrap">
<header>
  ${logoImg('black')}
  <h1>${esc(settings.shopName)}</h1>
  ${settings.shopNameEn ? `<p class="muted">${esc(settings.shopNameEn)}</p>` : ''}
  <p class="muted">${esc(settings.address)}</p>
  <p class="muted">هاتف ${esc(settings.phone)}${
    taxable && settings.vatNumber ? ` · الرقم الضريبي ${esc(settings.vatNumber)}` : ''
  }</p>
  <span class="tag">${taxable ? 'فاتورة ضريبية مبسطة' : 'فاتورة'}</span>
</header>
<div class="meta"><span>${esc(invoice.number)}</span><span>${esc(dateTime(invoice.createdAt))}</span></div>
${invoice.customerName ? `<p class="muted">العميل: ${esc(invoice.customerName)}${invoice.customerVatNumber ? ` — ${esc(invoice.customerVatNumber)}` : ''}</p>` : ''}
<table><thead><tr><th>الصنف</th><th class="n">كمية</th><th class="n">السعر</th><th class="n">الإجمالي</th></tr></thead><tbody>${lines}</tbody></table>
<div class="totals">
  <div><span>${taxable ? 'المجموع قبل الضريبة' : 'المجموع'}</span><span>${esc(money(invoice.subtotal - invoice.discount))}</span></div>
  ${invoice.discount > 0 ? `<div><span>الخصم</span><span>- ${esc(money(invoice.discount))}</span></div>` : ''}
  ${taxable ? `<div><span>${vatLabel}</span><span>${esc(money(invoice.vatAmount))}</span></div>` : ''}
  <div class="grand"><span>الإجمالي المستحق</span><span>${esc(money(invoice.total))}</span></div>
  <div><span>السداد</span><span>${paidLabel(invoice)}</span></div>
</div>
${invoice.notes ? `<p class="muted" style="white-space:pre-wrap;margin-top:6px">ملاحظة: ${esc(invoice.notes)}</p>` : ''}
${returnsBlock}
${qr ? `<div class="qr"><img src="${qr}" alt="ZATCA QR"><p class="muted">رمز الفاتورة الضريبية</p></div>` : ''}
${invoice.status === 'refunded' ? '<p class="refunded">مسترجعة بالكامل</p>' : ''}
<p class="foot">يُرجى حفظ الحلويات مبرّدة · المرتجع حسب الاتفاق مع المحل</p>
</div></body></html>`

  openAndPrint(html)
}

/** إشعار مرتجع (إشعار دائن) للزبون — ورقة تثبت ما رجع وكم خُصم. */
export function printReturn(note: ReturnNote, settings: Settings): void {
  const lines = note.lines
    .map(
      (l) => `<tr>
        <td><div class="name">${esc(l.name)}</div><div class="sku">${esc(l.sku)}</div></td>
        <td class="n">${l.qty}</td>
        <td class="n">${l.unitPrice.toFixed(2)}</td>
        <td class="n">${(l.unitPrice * l.qty).toFixed(2)}</td>
      </tr>`,
    )
    .join('')

  const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>${esc(note.number)}</title>
<style>${STYLE}</style></head><body><div class="wrap">
<header>
  ${logoImg('black')}
  <h1>${esc(settings.shopName)}</h1>
  <p class="muted">${esc(settings.address)}</p>
  <p class="muted">هاتف ${esc(settings.phone)}</p>
  <span class="tag">إشعار مرتجع</span>
</header>
<div class="meta"><span>${esc(note.number)}</span><span>${esc(dateTime(note.createdAt))}</span></div>
<p class="muted">على الفاتورة ${esc(note.invoiceNumber)}${note.customerName ? ` · ${esc(note.customerName)}` : ''}</p>
${note.reason ? `<p class="muted">السبب: ${esc(note.reason)}</p>` : ''}
<p class="muted">${note.restock ? 'أُعيدت البوكسات إلى المخزون' : 'بوكسات غير صالحة للبيع — لم تُعد إلى المخزون'}</p>
<table><thead><tr><th>الصنف</th><th class="n">كمية</th><th class="n">السعر</th><th class="n">الإجمالي</th></tr></thead><tbody>${lines}</tbody></table>
<div class="totals">
  <div><span>المجموع قبل الضريبة</span><span>${esc(money(note.subtotal))}</span></div>
  ${note.vatAmount > 0 ? `<div><span>الضريبة المردودة</span><span>${esc(money(note.vatAmount))}</span></div>` : ''}
  <div class="grand"><span>المبلغ المردود</span><span>${esc(money(note.total))}</span></div>
</div>
</div></body></html>`

  openAndPrint(html)
}
