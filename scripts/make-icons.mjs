/**
 * توليد أيقونات التطبيق من نفس هندسة الأيقونة في `index.html`.
 *
 * لماذا تُولَّد بدل أن تُرسم يدوياً: الأيقونة موجودة أصلاً كـ SVG مضمّن في
 * `index.html`، ونسخها كصور ثابتة يعني مصدرين للحقيقة ينحرفان عند أول تعديل
 * لون. هنا تبقى الإحداثيات واحدة، وإعادة التوليد أمر واحد.
 *
 * ولماذا بلا مكتبة: توليد PNG يحتاج zlib وCRC فقط، وكلاهما في Node نفسه.
 * إضافة `sharp` أو `canvas` تعني اعتمادية ثنائية ثقيلة لأجل ثلاث صور تُبنى مرة.
 *
 * التشغيل: node scripts/make-icons.mjs
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

// عنابي البوكس وبيج الحروف على غطائه — نفس ألوان `index.css` وأيقونة التبويب.
const BRAND = [0x70, 0x29, 0x28]
const WHITE = [0xd9, 0xaf, 0x97]

/* -------------------------------------------------------------------------- */
/* هندسة الأيقونة — بإحداثيات الـ viewBox الأصلي (32×32)، انظر `Logo.tsx`       */
/* -------------------------------------------------------------------------- */

/** `translate(3.2 3.2) scale(0.8)` في الـ SVG — يُطبَّق على شكل البوكس وحده. */
const gx = (x) => 3.2 + 0.8 * x
const gy = (y) => 3.2 + 0.8 * y

/** مستطيل `x y w h rx` في الـ SVG إلى مركز ونصفَي عرض وارتفاع بعد التحجيم. */
const rect = ([x, y, w, h, r]) => ({
  cx: gx(x + w / 2),
  cy: gy(y + h / 2),
  hw: (0.8 * w) / 2,
  hh: (0.8 * h) / 2,
  r: 0.8 * r,
})

/** جسم البوكس: حدّ لا تعبئة. */
const BODY = rect([5, 12.5, 22, 13, 2.6])
const BODY_STROKE = (2.6 * 0.8) / 2 // نصف عرض الحدّ بعد التحجيم

/** لا أشكال مستطيلة معبّأة بعد حذف الغطاء؛ تبقى المصفوفة كي يضاف إليها بلا تعديل الرسم. */
const FILLS = []

/** قطع الحلى الثلاث البارزة فوق حافة البوكس: `cx cy r` قبل التحجيم. */
const SWEETS = [
  [9.8, 11, 3.1],
  [16, 9.6, 3.1],
  [22.2, 11, 3.1],
].map(([x, y, r]) => ({ cx: gx(x), cy: gy(y), r: 0.8 * r }))

/* -------------------------------------------------------------------------- */
/* دوال المسافة — التنعيم يأتي من أخذ عيّنات فرعية لا من تمويه                  */
/* -------------------------------------------------------------------------- */

const sdRoundRect = (px, py, { cx, cy, hw, hh, r }) => {
  const dx = Math.abs(px - cx) - (hw - r)
  const dy = Math.abs(py - cy) - (hh - r)
  const ax = Math.max(dx, 0)
  const ay = Math.max(dy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - r
}

/* -------------------------------------------------------------------------- */
/* ترميز PNG                                                                   */
/* -------------------------------------------------------------------------- */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

const crc32 = (buf) => {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** RGBA8 بلا تشذيب: ثلاث صور صغيرة لا تستحق تعقيد المرشّحات. */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // عمق البت
  ihdr[9] = 6 // RGBA
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // نوع المرشّح: بلا
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* -------------------------------------------------------------------------- */
/* الرسم                                                                       */
/* -------------------------------------------------------------------------- */

const SS = 4 // عيّنات فرعية لكل محور

/**
 * `inset` يصغّر الشكل داخل المربع لأيقونات `maskable`: أندرويد يقصّ الأطراف
 * بأشكال مختلفة (دائرة، مربع مستدير، معيّن)، والمضمون هو الـ٨٠٪ الوسطى.
 */
function render(size, { rounded = true, inset = 1 } = {}) {
  const rgba = Buffer.alloc(size * size * 4)
  const scale = size / 32
  const pad = (32 * (1 - inset)) / 2

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0
      let fg = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          // إلى فضاء الـ 32×32
          const ux = (x + (sx + 0.5) / SS) / scale
          const uy = (y + (sy + 0.5) / SS) / scale
          // الخلفية تملأ المربع كاملاً؛ الشكل وحده هو ما ينكمش في maskable
          if (!rounded || sdRoundRect(ux, uy, { cx: 16, cy: 16, hw: 16, hh: 16, r: 7 }) <= 0) bg++

          const px = (ux - pad) / inset
          const py = (uy - pad) / inset
          if (Math.abs(sdRoundRect(px, py, BODY)) <= BODY_STROKE) fg++
          else if (FILLS.some((b) => sdRoundRect(px, py, b) <= 0)) fg++
          else if (SWEETS.some((c) => Math.hypot(px - c.cx, py - c.cy) <= c.r)) fg++
        }
      }
      const n = SS * SS
      const a = bg / n
      const f = fg / n
      const i = (y * size + x) * 4
      // الشكل بيج فوق خلفية عنابية — يُمزجان قبل الكتابة كي تبقى الحواف نظيفة
      for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(BRAND[c] * (1 - f) + WHITE[c] * f)
      rgba[i + 3] = Math.round(255 * a)
    }
  }
  return encodePng(size, size, rgba)
}

mkdirSync('public', { recursive: true })

const outputs = [
  // iOS يتجاهل الشفافية ويضيف استدارته الخاصة — تُولَّد بمربع كامل بلا استدارة.
  ['public/apple-touch-icon.png', render(180, { rounded: false })],
  ['public/icon-192.png', render(192)],
  ['public/icon-512.png', render(512)],
  ['public/icon-maskable-512.png', render(512, { rounded: false, inset: 0.72 })],
]

for (const [path, buf] of outputs) {
  writeFileSync(path, buf)
  console.log(`✅ ${path} — ${(buf.length / 1024).toFixed(1)} كيلوبايت`)
}
