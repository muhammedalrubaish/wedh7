import QRCode from 'qrcode'
import { dateTime, money, num } from './format'
import { zatcaQrPayload } from './zatca'
import { invoiceFigures } from './invoiceFigures'
import { LIGHT, getPrintColor, logoUrl } from './print'
import type { Invoice, ReturnNote, Settings } from './types'

/**
 * الفاتورة ملف PDF بمقاس الجوال — تُرسل عبر واتساب أو تُحفظ في ملفات الجوال.
 *
 * لماذا تُرسم على `canvas` لا تُولَّد بمكتبة PDF: مكتبات PDF في المتصفح لا تشبك الحروف
 * العربية ولا ترتّب الاتجاه بثقة، فتخرج «و ض ح» حروفاً منفصلة. رسم المتصفح نفسه يشبكها
 * كما على الشاشة، ثم تُلفّ الصورة في PDF من صفحة واحدة يُكتب هنا يدوياً — بلا اعتمادية.
 * الثمن: النص في الملف صورة لا يُنسخ — مقبول لفاتورة تُقرأ وتُحفظ.
 *
 * الشكل يتبع تفضيل الطباعة (ملوّن بشكل الوضع الفاتح، أو أبيض وأسود) كالورقة المطبوعة.
 */

const W = 1080 // عرض التصميم بوحدات منطقية؛ يُرسم بضعفها للحدّة
const SCALE = 2
const PAD = 64
const FONT = '"IBM Plex Sans Arabic", system-ui, sans-serif'

interface Theme {
  page: string
  card: string | null
  border: string
  text: string
  muted: string
  faint: string
  brand: string
  tagBg: string | null
  headBg: string | null
}

const COLOR: Theme = {
  page: LIGHT.bg,
  card: LIGHT.surface,
  border: LIGHT.border,
  text: LIGHT.text,
  muted: LIGHT.muted,
  faint: LIGHT.faint,
  brand: LIGHT.brand,
  tagBg: LIGHT.brandSoft,
  headBg: LIGHT.surface2,
}

const MONO: Theme = {
  page: '#ffffff',
  card: null,
  border: '#bbbbbb',
  text: '#000000',
  muted: '#555555',
  faint: '#777777',
  brand: '#000000',
  tagBg: null,
  headBg: null,
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    // الشعار تجميل: إن تعذّر تحميله تخرج الفاتورة بدونه لا تفشل
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/** الخط العربي قبل الرسم: بدونه يرسم `canvas` بخط النظام ويختلف القياس عن الرسم. */
async function fontsReady() {
  try {
    await Promise.all(
      ['400', '600', '700'].map((w) => document.fonts.load(`${w} 32px ${FONT}`, 'وضح ١٢')),
    )
  } catch {
    // خط النظام العربي بديل مقبول
  }
}

interface Assets {
  logo: HTMLImageElement | null
  qr: HTMLImageElement | null
}

/**
 * يرسم الفاتورة ويعيد ارتفاعها. يُستدعى مرتين: للقياس (`draw = false`) ثم للرسم على
 * لوحة بالارتفاع المقيس — الفاتورة الطويلة صفحة واحدة طويلة لا صفحات مقطوعة.
 */
function layout(
  ctx: CanvasRenderingContext2D,
  draw: boolean,
  invoice: Invoice,
  settings: Settings,
  returns: ReturnNote[],
  t: Theme,
  a: Assets,
  height: number,
): number {
  const L = PAD
  const R = W - PAD
  const CW = R - L
  let y = PAD

  ctx.direction = 'rtl'
  ctx.textBaseline = 'top'

  if (draw) {
    ctx.fillStyle = t.page
    ctx.fillRect(0, 0, W, height)
    if (t.card) {
      roundRect(ctx, 24, 24, W - 48, height - 48, 36)
      ctx.fillStyle = t.card
      ctx.fill()
      ctx.strokeStyle = t.border
      ctx.lineWidth = 2
      ctx.stroke()
    }
  }

  const font = (size: number, weight = 400) => (ctx.font = `${weight} ${size}px ${FONT}`)
  const text = (
    s: string,
    x: number,
    yy: number,
    o: { size?: number; weight?: number; color?: string; align?: CanvasTextAlign } = {},
  ) => {
    font(o.size ?? 28, o.weight)
    if (!draw) return
    ctx.fillStyle = o.color ?? t.text
    ctx.textAlign = o.align ?? 'right'
    ctx.fillText(s, x, yy)
  }
  /** يلفّ النص على عرض محدّد — لا يُقصّ اسم ولا مبلغ. */
  const wrap = (s: string, max: number, size: number, weight = 400): string[] => {
    font(size, weight)
    const out: string[] = []
    let line = ''
    for (const word of s.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word
      if (line && ctx.measureText(next).width > max) {
        out.push(line)
        line = word
      } else line = next
    }
    if (line) out.push(line)
    return out.length ? out : ['']
  }
  const rule = (yy: number, dashed = false, color = t.border, x0 = L, x1 = R) => {
    if (!draw) return
    ctx.save()
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    if (dashed) ctx.setLineDash([10, 8])
    ctx.beginPath()
    ctx.moveTo(x0, yy)
    ctx.lineTo(x1, yy)
    ctx.stroke()
    ctx.restore()
  }
  const centered = (s: string, size: number, weight: number, color: string, gap = 8) => {
    for (const ln of wrap(s, CW, size, weight)) {
      text(ln, W / 2, y, { size, weight, color, align: 'center' })
      y += size * 1.35
    }
    y += gap
  }

  // ---- الرأس ----
  if (a.logo) {
    const lw = CW * 0.42
    const lh = (a.logo.naturalHeight / a.logo.naturalWidth) * lw
    if (draw) ctx.drawImage(a.logo, (W - lw) / 2, y, lw, lh)
    y += lh + 20
  }
  const fig = invoiceFigures(invoice)
  centered(settings.shopName, 44, 700, t.text, 4)
  if (settings.shopNameEn) centered(settings.shopNameEn, 26, 400, t.muted, 0)
  if (settings.address) centered(settings.address, 26, 400, t.muted, 0)
  const phone = [
    settings.phone && `هاتف ${settings.phone}`,
    fig.taxable && settings.vatNumber && `الرقم الضريبي ${settings.vatNumber}`,
  ]
    .filter(Boolean)
    .join(' · ')
  if (phone) centered(phone, 26, 400, t.muted, 0)

  // وسم نوع الفاتورة
  y += 16
  const tag = fig.taxable ? 'فاتورة ضريبية مبسطة' : 'فاتورة'
  font(28, 700)
  const tw = ctx.measureText(tag).width + 56
  if (draw) {
    roundRect(ctx, (W - tw) / 2, y, tw, 56, 28)
    if (t.tagBg) {
      ctx.fillStyle = t.tagBg
      ctx.fill()
    } else {
      ctx.strokeStyle = t.border
      ctx.lineWidth = 2
      ctx.stroke()
    }
  }
  text(tag, W / 2, y + 12, { size: 28, weight: 700, color: t.brand, align: 'center' })
  y += 56 + 28

  // ---- رقم الفاتورة وتاريخها ----
  rule(y, true)
  y += 18
  text(invoice.number, R, y, { size: 28, weight: 600 })
  text(dateTime(invoice.createdAt), L, y, { size: 28, align: 'left', color: t.muted })
  y += 44
  rule(y, true)
  y += 22

  if (invoice.customerName) {
    const who = `العميل: ${invoice.customerName}${
      invoice.customerVatNumber ? ` — ${invoice.customerVatNumber}` : ''
    }`
    for (const ln of wrap(who, CW, 28, 600)) {
      text(ln, R, y, { size: 28, weight: 600 })
      y += 38
    }
    y += 12
  }

  // ---- الجدول: الأعمدة الرقمية يساراً بعرض ثابت، والاسم يأخذ الباقي ----
  const colTotal = L
  const colPrice = L + 190
  const colQty = L + 350
  const nameRight = R
  const nameMax = R - (L + 460)

  if (draw && t.headBg) {
    roundRect(ctx, L, y - 6, CW, 52, 12)
    ctx.fillStyle = t.headBg
    ctx.fill()
  }
  const head = { size: 24, weight: 700, color: t.muted }
  text('الصنف', nameRight - (t.headBg ? 14 : 0), y + 6, head)
  text('كمية', colQty + (t.headBg ? 0 : 0), y + 6, { ...head, align: 'left' })
  text('السعر', colPrice, y + 6, { ...head, align: 'left' })
  text('الإجمالي', colTotal + (t.headBg ? 14 : 0), y + 6, { ...head, align: 'left' })
  y += 52
  rule(y, false, t.headBg ? t.border : t.text)
  y += 18

  for (const l of invoice.lines) {
    const top = y
    for (const ln of wrap(l.name, nameMax, 30, 600)) {
      text(ln, nameRight, y, { size: 30, weight: 600 })
      y += 40
    }
    text(l.sku, nameRight, y, { size: 22, color: t.faint })
    y += 30
    // سطر مستقلّ: بجانب رمز المنتج اللاتيني كان ترتيب الاتجاه يقلبه إلى «+1 · WDH عينة».
    if (l.freeQty) {
      text(`+ ${num(l.freeQty)} عينة بلا مقابل`, nameRight, y, { size: 22, color: t.muted })
      y += 30
    }
    const nums = { size: 30, align: 'left' as const }
    text(num(l.qty), colQty, top, nums)
    text(l.unitPrice.toFixed(2), colPrice, top, nums)
    text((l.unitPrice * l.qty - l.discount).toFixed(2), colTotal, top, nums)
    y += 14
    rule(y, true)
    y += 18
  }

  // ---- المجاميع، ورمز الضريبة بجانبها ----
  const qrSize = 230
  const sumLeft = a.qr ? L + qrSize + 36 : L
  const sumTop = y + 8
  y = sumTop
  const row = (
    label: string,
    value: string,
    o: { size?: number; weight?: number; color?: string } = {},
  ) => {
    const size = o.size ?? 28
    text(label, R, y, { size, weight: o.weight, color: o.weight ? (o.color ?? t.text) : t.muted })
    text(value, sumLeft, y, { size, weight: o.weight ?? 400, color: o.color, align: 'left' })
    y += size * 1.5
  }
  row(fig.itemsLabel, money(fig.itemsTotal))
  if (fig.discount > 0) row('الخصم', `- ${money(fig.discount)}`)
  if (fig.showNet) row('الصافي قبل الضريبة', money(fig.net))
  if (fig.taxable) {
    const rates = [...new Set(invoice.lines.map((l) => l.taxRate).filter((r) => r > 0))]
    row(
      rates.length > 1
        ? 'ضريبة القيمة المضافة (حسب البنود)'
        : `ضريبة القيمة المضافة (${rates[0] ?? invoice.vatRate}٪)`,
      money(invoice.vatAmount),
    )
  }
  y += 6
  rule(y, false, t.brand, sumLeft, R)
  y += 16
  row('الإجمالي المستحق', money(invoice.total), { size: 38, weight: 700, color: t.brand })
  row('السداد', invoice.status === 'unpaid' ? 'لم يتم السداد' : 'تم السداد')

  if (a.qr) {
    if (draw) ctx.drawImage(a.qr, L, sumTop, qrSize, qrSize)
    text('رمز الفاتورة الضريبية', L + qrSize / 2, sumTop + qrSize + 8, {
      size: 20,
      color: t.muted,
      align: 'center',
    })
    y = Math.max(y, sumTop + qrSize + 40)
  }

  if (invoice.notes) {
    y += 16
    for (const ln of wrap(`ملاحظة: ${invoice.notes}`, CW, 26)) {
      text(ln, R, y, { size: 26, color: t.muted })
      y += 36
    }
  }

  if (returns.length) {
    y += 20
    const boxTop = y
    y += 20
    text('مرتجعات على هذه الفاتورة', R - 20, y, { size: 26, weight: 700 })
    y += 44
    for (const r of returns) {
      text(`${r.number} · ${dateTime(r.createdAt)}`, R - 20, y, { size: 24, color: t.muted })
      text(`- ${money(r.total)}`, L + 20, y, { size: 24, align: 'left' })
      y += 36
    }
    const returned = returns.reduce((n, r) => n + r.total, 0)
    y += 6
    text('الصافي بعد المرتجع', R - 20, y, { size: 28, weight: 700 })
    text(money(invoice.total - returned), L + 20, y, { size: 28, weight: 700, align: 'left' })
    y += 52
    if (draw) {
      roundRect(ctx, L, boxTop, CW, y - boxTop, 16)
      ctx.strokeStyle = t.border
      ctx.lineWidth = 2
      ctx.stroke()
    }
  }

  if (invoice.status === 'refunded') {
    y += 24
    text('مسترجعة بالكامل', W / 2, y, { size: 32, weight: 700, color: '#c00000', align: 'center' })
    y += 48
  }

  return y + PAD
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/* -------------------------------------------------------------------------- */
/* PDF من صورة JPEG واحدة                                                       */
/* -------------------------------------------------------------------------- */

/**
 * أصغر PDF صالح: صفحة بمقاس الصورة تعرض صورة JPEG كما هي (`DCTDecode` يقبل بايتات
 * JPEG مباشرة بلا فكّ). عرض الصفحة ~١٠٥مم — مقاس جوال لا ورقة A4.
 */
function jpegToPdf(jpeg: Uint8Array, pxW: number, pxH: number): Blob {
  const ptW = 297
  const ptH = Math.round((pxH / pxW) * ptW * 100) / 100
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const offsets: number[] = []
  let size = 0
  const push = (p: Uint8Array | string) => {
    const b = typeof p === 'string' ? enc.encode(p) : p
    parts.push(b)
    size += b.length
  }
  const obj = (n: number, body: string) => {
    offsets[n] = size
    push(`${n} 0 obj\n${body}\nendobj\n`)
  }

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  obj(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptW} ${ptH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  )
  offsets[4] = size
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pxW} /Height ${pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
  )
  push(jpeg)
  push('\nendstream\nendobj\n')
  const content = `q ${ptW} 0 0 ${ptH} 0 0 cm /Im0 Do Q`
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`)

  const xref = size
  push(`xref\n0 6\n0000000000 65535 f \n`)
  for (let n = 1; n <= 5; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`)
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return new Blob(parts as BlobPart[], { type: 'application/pdf' })
}

/* -------------------------------------------------------------------------- */
/* الواجهة                                                                     */
/* -------------------------------------------------------------------------- */

export async function invoicePdf(
  invoice: Invoice,
  settings: Settings,
  returns: ReturnNote[] = [],
): Promise<File> {
  const color = getPrintColor()
  const t = color ? COLOR : MONO
  const fig = invoiceFigures(invoice)

  const qrData =
    settings.zatcaQr && fig.taxable
      ? await QRCode.toDataURL(
          zatcaQrPayload({
            sellerName: settings.shopName,
            vatNumber: settings.vatNumber,
            timestamp: invoice.createdAt,
            total: invoice.total,
            vatAmount: invoice.vatAmount,
          }),
          { width: 460, margin: 1 },
        )
      : null
  const [, logo, qr] = await Promise.all([
    fontsReady(),
    loadImage(logoUrl(color ? 'color' : 'black')),
    qrData ? loadImage(qrData) : Promise.resolve(null),
  ])
  const assets = { logo, qr }

  const probe = document.createElement('canvas').getContext('2d')!
  const height = Math.ceil(layout(probe, false, invoice, settings, returns, t, assets, 0))

  // سقف مساحة اللوحة في iOS (~١٦ مليون بكسل): فاتورة طويلة جداً تُرسم بدقة أقل لا تفشل.
  const scale = Math.min(SCALE, Math.sqrt(16_000_000 / (W * height)))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(W * scale)
  canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  layout(ctx, true, invoice, settings, returns, t, assets, height)

  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.92))
  if (!blob) throw new Error('تعذّر تجهيز ملف الفاتورة على هذا الجهاز.')
  const pdf = jpegToPdf(new Uint8Array(await blob.arrayBuffer()), canvas.width, canvas.height)
  // اسم لاتيني: Chrome يرفض الاسم العربي في التنزيل فيحفظ الملف باسم «download» (جُرِّب)،
  // وواتساب أندرويد يشوّه الأسماء غير اللاتينية أحياناً. رقم الفاتورة يكفي للتعرّف عليها.
  return new File([pdf], `Wedh-${invoice.number}.pdf`, { type: 'application/pdf' })
}
