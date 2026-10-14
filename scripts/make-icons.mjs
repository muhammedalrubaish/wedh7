/**
 * توليد أيقونات التطبيق (التبويب، الشاشة الرئيسية، أندرويد) وشعارَي الطباعة من شعار
 * العميل نفسه.
 *
 * المصدر `assets/brand/`: ملف الشعار الذي سلّمه العميل (PDF من صفحتين) مصدَّراً PNG
 * بخلفية شفافة — `wedh-logo-color.png` (الكلمة عنابية والجمل بيج) و`wedh-logo-solid.png`
 * (كله عنابي). خارج `public/` عمداً: مصدر للتوليد لا ملف يُنشر.
 * خلفية الأيقونات بيضاء كما في ملف العميل — الشعار عنابي ولا يُقرأ على العنابي.
 *
 * ولماذا بلا مكتبة: فكّ PNG وترميزه يحتاجان zlib وCRC فقط، وكلاهما في Node نفسه.
 * إضافة `sharp` أو `canvas` تعني اعتمادية ثنائية ثقيلة لأجل صور تُبنى مرة.
 *
 * التشغيل: node scripts/make-icons.mjs
 */
import { deflateSync, inflateSync } from 'node:zlib'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const WHITE = [255, 255, 255]
const BLACK = [0, 0, 0]

/* -------------------------------------------------------------------------- */
/* فكّ PNG — رمادي بشفافية (LA) أو RGBA، ٨ بت، بلا تشذير، كما يُصدَّر الشعار     */
/* -------------------------------------------------------------------------- */

/** البكسلات RGBA مضروبة بالشفافية (premultiplied)، بين ٠ و١ — جاهزة للتصغير بالمتوسط. */
function readPng(path) {
  const buf = readFileSync(path)
  let width = 0
  let height = 0
  let channels = 0
  const idat = []
  for (let off = 8; off < buf.length; ) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      const [depth, color, , , interlace] = data.subarray(8)
      channels = { 4: 2, 6: 4 }[color] ?? 0
      if (depth !== 8 || !channels || interlace) {
        throw new Error(`${path}: المتوقَّع PNG ‏٨ بت LA أو RGBA بلا تشذير`)
      }
    }
    if (type === 'IDAT') idat.push(data)
    off += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const px = Buffer.alloc(stride * height)
  // عكس مرشّحات PNG الخمسة سطراً سطراً
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const src = y * (stride + 1) + 1
    const row = y * stride
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[row + x - channels] : 0
      const b = y ? px[row - stride + x] : 0
      const c = y && x >= channels ? px[row - stride + x - channels] : 0
      const v = raw[src + x]
      let out = v
      if (filter === 1) out = v + a
      else if (filter === 2) out = v + b
      else if (filter === 3) out = v + ((a + b) >> 1)
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
      }
      px[row + x] = out & 0xff
    }
  }
  const rgba = new Float32Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const a = px[i * channels + channels - 1] / 255
    for (let c = 0; c < 3; c++) {
      // LA: قناة الرمادي الواحدة تُنسخ للألوان الثلاثة
      const v = px[i * channels + (channels === 2 ? 0 : c)] / 255
      rgba[i * 4 + c] = v * a
    }
    rgba[i * 4 + 3] = a
  }
  return { width, height, rgba }
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

/** RGBA8 بلا تشذيب: صور صغيرة لا تستحق تعقيد المرشّحات. */
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

const color = readPng('assets/brand/wedh-logo-color.png')
const solid = readPng('assets/brand/wedh-logo-solid.png')

/**
 * متوسط مستطيل من الصورة (مضروب بالشفافية) — تصغير بالمساحة لا بأقرب بكسل، فلا
 * تتكسّر حواف الحروف.
 */
function sample(img, x0, y0, x1, y1) {
  const out = [0, 0, 0, 0]
  const full = (x1 - x0) * (y1 - y0)
  if (full <= 0) return out
  const xa = Math.max(0, Math.floor(x0))
  const ya = Math.max(0, Math.floor(y0))
  const xb = Math.min(img.width, Math.ceil(x1))
  const yb = Math.min(img.height, Math.ceil(y1))
  for (let y = ya; y < yb; y++) {
    const wy = Math.min(y + 1, y1) - Math.max(y, y0)
    for (let x = xa; x < xb; x++) {
      const w = (Math.min(x + 1, x1) - Math.max(x, x0)) * wy
      const i = (y * img.width + x) * 4
      for (let c = 0; c < 4; c++) out[c] += img.rgba[i + c] * w
    }
  }
  return out.map((v) => v / full)
}

/**
 * الشعار عريض، فيُوسَّط أفقياً بعرض `width` من ضلع المربع فوق خلفية بيضاء. `rounded`
 * يقصّ زوايا الخلفية لأيقونة التبويب؛ iOS وأندرويد يقصّانها بأنفسهما.
 */
function render(size, { width = 0.82, rounded = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4)
  const w = size * width
  const scale = color.width / w // بكسلات الشعار لكل بكسل أيقونة
  const h = color.height / scale
  const ox = (size - w) / 2
  const oy = (size - h) / 2
  const r = size * 0.22

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [pr, pg, pb, pa] = sample(
        color,
        (x - ox) * scale,
        (y - oy) * scale,
        (x + 1 - ox) * scale,
        (y + 1 - oy) * scale,
      )
      // زاوية مستديرة بتنعيم بكسل واحد
      let a = 1
      if (rounded) {
        const dx = Math.max(r - x - 0.5, x + 0.5 - (size - r), 0)
        const dy = Math.max(r - y - 0.5, y + 0.5 - (size - r), 0)
        a = Math.min(1, Math.max(0, r - Math.hypot(dx, dy) + 0.5))
      }
      const i = (y * size + x) * 4
      // الشعار فوق الأبيض: اللون المضروب بالشفافية + الأبيض بما بقي منها
      ;[pr, pg, pb].forEach(
        (v, c) => (rgba[i + c] = Math.round(255 * (v + (WHITE[c] / 255) * (1 - pa)))),
      )
      rgba[i + 3] = Math.round(255 * a)
    }
  }
  return encodePng(size, size, rgba)
}

/**
 * الشعار على شفافية للطباعة. بلا `tint` يبقى بألوانه؛ مع `tint` يصير لوناً واحداً
 * (الأسود للطابعة الحرارية) بشفافية الأصل.
 */
function renderLogo(img, width, tint) {
  const scale = img.width / width
  const height = Math.round(img.height / scale)
  const rgba = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [pr, pg, pb, pa] = sample(img, x * scale, y * scale, (x + 1) * scale, (y + 1) * scale)
      const i = (y * width + x) * 4
      const rgb = tint ?? [pr, pg, pb].map((v) => (pa > 0 ? (255 * v) / pa : 0))
      for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(rgb[c])
      rgba[i + 3] = Math.round(255 * pa)
    }
  }
  return encodePng(width, height, rgba)
}

mkdirSync('public', { recursive: true })

const outputs = [
  // التبويب صغير جداً: الشعار أعرض ما يمكن كي تُقرأ الكلمة.
  ['public/favicon-64.png', render(64, { width: 0.9, rounded: true })],
  // iOS يتجاهل الشفافية ويضيف استدارته الخاصة — مربع كامل بلا استدارة.
  ['public/apple-touch-icon.png', render(180)],
  ['public/icon-192.png', render(192)],
  ['public/icon-512.png', render(512)],
  // أندرويد يقصّ الأطراف بأشكال مختلفة (دائرة، مربع مستدير)؛ المضمون هو الوسط.
  ['public/icon-maskable-512.png', render(512, { width: 0.66 })],
  // الفاتورة: النسخة العنابية كاملةً بالأسود — على الطابعة الحرارية أحادية اللون يخرج
  // العنابي رمادياً منقّطاً، وجمل النسخة الملوّنة البيج يكاد يختفي.
  ['public/brand-print-black.png', renderLogo(solid, 480, BLACK)],
  // التقرير A4 على طابعة ملوّنة غالباً — الشعار بألوانه كما سلّمه العميل.
  ['public/brand-print-color.png', renderLogo(color, 480)],
]

for (const [path, buf] of outputs) {
  writeFileSync(path, buf)
  console.log(`✅ ${path} — ${(buf.length / 1024).toFixed(1)} كيلوبايت`)
}
