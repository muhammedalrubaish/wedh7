/**
 * أرقام أسفل الفاتورة (`invoiceFigures`): كل خصم يُطرح مرة واحدة.
 *
 * العيب الذي يمنعه: الفاتورة عرضت «المجموع ١٦٤ · الخصم −١٦ · الإجمالي ١٦٤» — المجموع
 * بعد الخصم ثم الخصم مرة ثانية، فبدا للمحل أن الحساب خاطئ.
 *
 * التشغيل: npm run test:rows (ضمن السلسلة)
 */
import { mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const OUT = mkdtempSync(join(tmpdir(), 'wedh7-fig-'))
execFileSync(
  'node_modules/.bin/esbuild',
  [
    'src/lib/invoiceFigures.ts',
    '--bundle',
    '--format=esm',
    '--platform=node',
    `--outfile=${OUT}/fig.mjs`,
  ],
  { stdio: 'pipe' },
)
const { invoiceFigures } = await import(`${OUT}/fig.mjs`)

let fail = 0
const ok = (c, m) => {
  console.log(`${c ? '✅' : '❌'} ${m}`)
  if (!c) fail++
}
const line = (qty, unitPrice, discount = 0) => ({
  qty,
  unitPrice,
  discount,
  freeQty: 0,
  taxRate: 0,
})

// فاتورة الصورة: ٥ × ٣٦ = ١٨٠، خصم فاتورة ١٦، بلا ضريبة
let f = invoiceFigures({ lines: [line(5, 36)], subtotal: 180, discount: 16, vatAmount: 0 })
ok(f.itemsTotal === 180, `المجموع = مجموع الأسطر ١٨٠ (كان ١٦٤): ${f.itemsTotal}`)
ok(f.discount === 16, `الخصم ١٦: ${f.discount}`)
ok(f.net === 164 && !f.showNet, 'الصافي ١٦٤ ولا سطر «قبل الضريبة» لفاتورة بلا ضريبة')
ok(f.itemsLabel === 'المجموع', 'العنوان «المجموع»')

// خصم بند ١٠ وخصم فاتورة ٥: السطر يُعرض بعد خصمه، والخصم المعروض ٥ فقط
f = invoiceFigures({ lines: [line(2, 50, 10)], subtotal: 100, discount: 15, vatAmount: 0 })
ok(f.itemsTotal === 90, `المجموع = ٩٠ كما في السطر بعد خصمه: ${f.itemsTotal}`)
ok(f.discount === 5, `الخصم المعروض خصم الفاتورة وحده ٥: ${f.discount}`)
ok(f.itemsTotal - f.discount === f.net, 'المجموع − الخصم = الصافي')

// ضريبية بلا خصم: السطر الأول «قبل الضريبة»
f = invoiceFigures({ lines: [line(1, 100)], subtotal: 100, discount: 0, vatAmount: 15 })
ok(f.itemsLabel === 'المجموع قبل الضريبة' && !f.showNet, 'ضريبية بلا خصم: «المجموع قبل الضريبة»')

// ضريبية بخصم: يظهر الصافي قبل الضريبة
f = invoiceFigures({ lines: [line(1, 100)], subtotal: 100, discount: 10, vatAmount: 13.5 })
ok(
  f.showNet && f.net === 90 && f.itemsLabel === 'المجموع',
  'ضريبية بخصم: سطر «الصافي قبل الضريبة» ٩٠',
)

console.log(fail ? `\n❌ ${fail} فحص فشل` : '\n✅ كل الفحوص نجحت')
process.exit(fail ? 1 : 0)
