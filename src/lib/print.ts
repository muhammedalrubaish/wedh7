import { invoiceFigures } from './invoiceFigures'
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

/**
 * الفاتورة بمقاس شاشة الجوال افتراضياً لا بشريط الطابعة الحرارية: أغلب الفواتير تُحفظ
 * PDF من الجوال وتُرسل للمحل. Safari الآيفون يتجاهل `@page size` ويطبع على ورقة
 * Letter كاملة، فكان شريط ٨٠مم يصغر في وسطها ويضيع.
 *
 * الحلّ وحدة `--u` = جزء من ٤٨٠ من عرض الصفحة: التصميم يتمدّد
 * بالتناسب ليملأ أي ورقة يختارها المتصفح — ورقة Letter، أو A4، أو مقاس الجوال الذي
 * يطلبه `@page` أدناه (يحترمه Chrome وأندرويد).
 *
 * ٤٨٠ لا ٣٦٠ (عرض الجوال): على ورقة Letter كانت فاتورة ببند واحد تنقسم على صفحتين
 * فيقع رمز الضريبة وحده في الثانية. ٤٨٠ تُبقيها صفحة واحدة، ويبقى الخط عند فتح الـPDF
 * على الجوال بعرض الشاشة نحو ١٢ بكسل — مقروءاً.
 *
 * `cqw` لا `vw`: `vw` في الطباعة يبقى عرض نافذة الشاشة في Chrome (جُرِّب: شريط في
 * وسط الورقة)، أما `body` حاويةً فعرضها عرض الورقة نفسها عند التخطيط للطباعة.
 */
const STYLE = `
  @page { size: 90mm 180mm; margin: 5mm; }
  * { box-sizing: border-box; }
  body { font-family: "IBM Plex Sans Arabic", system-ui, sans-serif; margin: 0; color: #000; container-type: inline-size; }
  .wrap { --u: calc(100cqw / 480); width: 100%; font-size: calc(var(--u) * 15); line-height: 1.45; padding: calc(var(--u) * 12) calc(var(--u) * 14); }
  header { text-align: center; }
  h1 { font-size: calc(var(--u) * 20); margin: 0 0 calc(var(--u) * 2); }
  .muted { color: #555; font-size: calc(var(--u) * 12.5); margin: calc(var(--u) * 1) 0; }
  .tag { display: inline-block; border: 1px solid #999; border-radius: calc(var(--u) * 5); padding: calc(var(--u) * 2) calc(var(--u) * 10); font-size: calc(var(--u) * 12.5); font-weight: 700; margin-top: calc(var(--u) * 8); }
  .meta { display: flex; justify-content: space-between; gap: calc(var(--u) * 8); font-size: calc(var(--u) * 12.5); border-top: 1px dashed #999; border-bottom: 1px dashed #999; padding: calc(var(--u) * 6) 0; margin: calc(var(--u) * 12) 0; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: right; font-size: calc(var(--u) * 12.5); border-bottom: 1px solid #333; padding: calc(var(--u) * 4) 0; }
  td { padding: calc(var(--u) * 6) 0; border-bottom: 1px dotted #ccc; vertical-align: top; }
  tr, .totals, .qr, .box { break-inside: avoid; }
  th + th, td + td { padding-right: calc(var(--u) * 8); }
  .name { font-weight: 600; font-size: calc(var(--u) * 14); }
  .sku { color: #666; font-size: calc(var(--u) * 11.5); }
  .n { text-align: left; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .totals { margin-top: calc(var(--u) * 12); font-size: calc(var(--u) * 14); }
  .totals div { display: flex; justify-content: space-between; gap: calc(var(--u) * 8); padding: calc(var(--u) * 2) 0; }
  .grand { border-top: 1px solid #333; margin-top: calc(var(--u) * 6); padding-top: calc(var(--u) * 6) !important; font-size: calc(var(--u) * 18); font-weight: 700; }
  /* الرمز بجانب المجاميع لا تحتها: تحتها كانت الفاتورة الضريبية تنقسم على صفحتين في
     ورقة Letter فيقع الرمز وحده في الثانية. */
  .sum { display: flex; align-items: flex-start; gap: calc(var(--u) * 16); break-inside: avoid; }
  .sum .totals { flex: 1; min-width: 0; }
  .qr { text-align: center; margin-top: calc(var(--u) * 12); flex-shrink: 0; }
  .qr img { width: calc(var(--u) * 110); height: calc(var(--u) * 110); }
  .qr .muted { margin-top: 0; }
  .refunded { border: 1px solid #c00; color: #c00; text-align: center; font-weight: 700; padding: calc(var(--u) * 4); margin-top: calc(var(--u) * 10); }
  .box { border: 1px solid #999; border-radius: calc(var(--u) * 5); padding: calc(var(--u) * 6) calc(var(--u) * 8); margin-top: calc(var(--u) * 12); font-size: calc(var(--u) * 12.5); }
  .logo { display: block; width: 36%; height: auto; margin: 0 auto calc(var(--u) * 6); }
`

/**
 * شعار العميل للطباعة. رابط كامل لا نسبي: النافذة الجديدة `about:blank` وقد لا
 * تحلّ الرابط النسبي على أصل الموقع في كل متصفح.
 */
export const logoUrl = (variant: 'black' | 'color') =>
  `${location.origin}/brand-print-${variant}.png`

export const logoImg = (variant: 'black' | 'color', cls = 'logo') =>
  `<img class="${cls}" src="${logoUrl(variant)}" alt="">`

/* -------------------------------------------------------------------------- */
/* ملوّن أو أبيض وأسود                                                          */
/* -------------------------------------------------------------------------- */

const PRINT_COLOR_KEY = 'wedh7.printColor'

/**
 * تفضيل لكل جهاز لا للمحل: الجوال الذي يحفظ PDF ويرسله ملوّن، وجهاز موصول بطابعة
 * حرارية أبيض وأسود. الافتراضي ملوّن — أغلب الطباعة PDF يُرسل من الجوال.
 */
export function getPrintColor(): boolean {
  try {
    return localStorage.getItem(PRINT_COLOR_KEY) !== '0'
  } catch {
    return true
  }
}

export function setPrintColor(color: boolean): void {
  try {
    localStorage.setItem(PRINT_COLOR_KEY, color ? '1' : '0')
  } catch {
    // تخزين محجوب (تصفّح خاص): يعود للافتراضي عند الفتح التالي — مقبول
  }
}

/** شعار الورقة حسب التفضيل: الملوّن بألوانه، والأبيض والأسود بالنسخة العنابية مسودّةً. */
export const printLogo = (color = getPrintColor()) => logoImg(color ? 'color' : 'black')

/**
 * ألوان الوضع الفاتح للموقع — نسخة من رموز `:root` في `index.css`. منسوخة لا مقروءة:
 * نافذة الطباعة مستند مستقلّ لا يرى متغيّرات الصفحة، والموقع قد يكون في الوضع الداكن
 * لحظة الطباعة بينما الورقة الملوّنة فاتحة دائماً. إن تغيّرت الهوية تتغيّر هنا معها.
 */
export const LIGHT = {
  bg: 'oklch(0.972 0.012 65)',
  surface: 'oklch(0.995 0.004 70)',
  surface2: 'oklch(0.962 0.014 60)',
  border: 'oklch(0.895 0.022 52)',
  text: 'oklch(0.27 0.055 20)',
  muted: 'oklch(0.5 0.04 32)',
  faint: 'oklch(0.63 0.032 45)',
  brand: 'oklch(0.385 0.101 24)',
  brandStrong: 'oklch(0.304 0.07 18)',
  brandSoft: 'oklch(0.935 0.028 45)',
}

/**
 * الطباعة الملوّنة بشكل الوضع الفاتح: خلفية كريمية والفاتورة بطاقة فوقها. المتصفحات
 * لا تطبع الخلفيات افتراضاً، و`print-color-adjust: exact` يطلبها صراحةً. الخلفية على
 * `html` لا `body` كي تملأ كل صفحة لا أول صفحة فقط.
 */
export const LIGHT_PAGE = `
  html { background: ${LIGHT.bg}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { color: ${LIGHT.text}; }
`

/** الفاتورة الملوّنة: بطاقة الموقع بحدودها وزواياها، والعناوين والمجموع بالعنابي. */
const INVOICE_COLOR = `${LIGHT_PAGE}
  .wrap { background: ${LIGHT.surface}; border: 1px solid ${LIGHT.border}; border-radius: calc(var(--u) * 16); }
  h1 { color: ${LIGHT.brandStrong}; }
  .muted { color: ${LIGHT.muted}; }
  .sku { color: ${LIGHT.faint}; }
  .tag { background: ${LIGHT.brandSoft}; border-color: transparent; color: ${LIGHT.brandStrong}; border-radius: 999px; }
  .meta { border-color: ${LIGHT.border}; }
  th { background: ${LIGHT.surface2}; color: ${LIGHT.muted}; border-bottom-color: ${LIGHT.border}; padding-left: calc(var(--u) * 6); padding-right: calc(var(--u) * 6); }
  td { border-bottom-color: ${LIGHT.border}; }
  td:first-child, th:first-child { padding-right: calc(var(--u) * 6); }
  td:last-child, th:last-child { padding-left: calc(var(--u) * 6); }
  .grand { color: ${LIGHT.brand}; border-top-color: ${LIGHT.brand}; }
  .box { background: ${LIGHT.surface2}; border-color: ${LIGHT.border}; }
`

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
  const fig = invoiceFigures(invoice)

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
          <div class="sku">${esc(l.sku)}</div>
          ${l.freeQty ? `<div class="sku">+ ${l.freeQty} عينة بلا مقابل</div>` : ''}
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
<style>${STYLE}${getPrintColor() ? INVOICE_COLOR : ''}</style></head><body><div class="wrap">
<header>
  ${printLogo()}
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
<div class="sum"><div class="totals">
  <div><span>${fig.itemsLabel}</span><span>${esc(money(fig.itemsTotal))}</span></div>
  ${fig.discount > 0 ? `<div><span>الخصم</span><span>- ${esc(money(fig.discount))}</span></div>` : ''}
  ${fig.showNet ? `<div><span>الصافي قبل الضريبة</span><span>${esc(money(fig.net))}</span></div>` : ''}
  ${taxable ? `<div><span>${vatLabel}</span><span>${esc(money(invoice.vatAmount))}</span></div>` : ''}
  <div class="grand"><span>الإجمالي المستحق</span><span>${esc(money(invoice.total))}</span></div>
  <div><span>السداد</span><span>${paidLabel(invoice)}</span></div>
</div>
${qr ? `<div class="qr"><img src="${qr}" alt="ZATCA QR"><p class="muted">رمز الفاتورة الضريبية</p></div>` : ''}
</div>
${invoice.notes ? `<p class="muted" style="white-space:pre-wrap;margin-top:6px">ملاحظة: ${esc(invoice.notes)}</p>` : ''}
${returnsBlock}
${invoice.status === 'refunded' ? '<p class="refunded">مسترجعة بالكامل</p>' : ''}
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
<style>${STYLE}${getPrintColor() ? INVOICE_COLOR : ''}</style></head><body><div class="wrap">
<header>
  ${printLogo()}
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
