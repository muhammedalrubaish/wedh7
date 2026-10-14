/**
 * فحص طبقة الترجمة بين صفوف Postgres ونماذج الواجهة.
 *
 * الفحص الأهم هنا ليس المنطق بل الأسماء: كل مفتاح تُنتجه `fromX()` يُقارَن
 * بأعمدة الجدول الحقيقية في `supabase/schema-columns.json`. الاسم الخاطئ نصٌّ صالح
 * لا يكشفه `tsc`، ويظهر لاحقاً كحقل `undefined` في فاتورة.
 *
 * لتحديث ملف الأعمدة بعد أي ترحيل جديد: طبّق الترحيلات على Postgres ثم
 *   select json_object_agg(table_name, cols) from (
 *     select table_name, json_agg(column_name order by ordinal_position) cols
 *     from information_schema.columns where table_schema='public'
 *       and table_name not like '%\_v' group by table_name) t;
 *
 * التشغيل: npm run test:rows
 */
import { readFileSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const OUT = mkdtempSync(join(tmpdir(), 'wedh7-'))
// نُجمّع rows.ts وحده — بلا استيراد أنواع وقت التشغيل (types.ts أنواع فقط).
execFileSync(
  'node_modules/.bin/esbuild',
  ['src/lib/rows.ts', '--bundle', '--format=esm', '--platform=node', `--outfile=${OUT}/rows.mjs`],
  { stdio: 'pipe' },
)
const R = await import(`${OUT}/rows.mjs`)
const schema = JSON.parse(readFileSync('supabase/schema-columns.json', 'utf8'))

let fail = 0
const ok = (c, m) => {
  console.log(`${c ? '✅' : '❌'} ${m}`)
  if (!c) fail++
}

// ---- 1) كل مفتاح تُنتجه fromX موجود فعلاً كعمود في الجدول ----
const writers = [
  ['categories', R.fromCategory, { id: 'c1', name: 'ش', defaultMarkupPercent: 30, icon: 'x' }],
  ['suppliers', R.fromSupplier, { id: 's1', name: 'م', leadTimeDays: 3 }],
  [
    'purchase_items',
    R.fromPurchaseItem,
    { id: 'pi1', name: 'قشطة', kind: 'ingredient', unit: 'علبة', archived: false, createdAt: 1 },
  ],
  [
    'customers',
    R.fromCustomer,
    { id: 'u1', name: 'ع', type: 'wholesale', createdAt: 1750000000000 },
  ],
  [
    'parts',
    R.fromPart,
    {
      id: 'p1',
      sku: 'S',
      name: 'بوكس',
      categoryId: 'c1',
      cost: 1,
      priceRetail: 2,
      priceWholesale: 2,
      qty: 5,
      reorderPoint: 1,
      reorderQty: 0,
      leadTimeDays: 3,
      unlimited: true,
      archived: false,
      createdAt: 1,
      updatedAt: 2,
    },
  ],
  [
    'purchase_orders',
    R.fromPurchaseOrder,
    {
      id: 'po1',
      code: 'PO-1',
      supplierId: 's1',
      status: 'ordered',
      lines: [],
      createdAt: 1,
      createdBy: 'u1',
    },
  ],
  [
    'purchase_order_lines',
    (l) => R.fromPurchaseOrderLine('po1', l),
    { partId: 'p1', qty: 5, unitCost: 10, receivedQty: 0 },
  ],
  [
    'settings',
    R.fromSettings,
    {
      id: 'app',
      shopName: 'وضح',
      vatNumber: '3',
      crNumber: '1',
      address: 'ر',
      phone: '05',
      currency: 'SAR',
      vatRate: 15,
      vatEnabled: true,
      zatcaQr: true,
      invoicePrefix: 'INV-',
      invoiceCounter: 1,
      poPrefix: 'PO-',
      poCounter: 1,
      returnPrefix: 'RET-',
      returnCounter: 1,
      theme: 'light',
      aiProvider: 'none',
      aiModel: 'm',
      aiApiKey: '',
    },
  ],
  [
    'audit_log',
    R.fromAuditEntry,
    { id: 'a1', userId: 'u1', userName: 'ن', action: 'x', entity: 'part', at: 1750000000000 },
  ],
]
for (const [table, fn, sample] of writers) {
  const cols = new Set(schema[table])
  const bad = Object.keys(fn(sample)).filter((k) => !cols.has(k))
  ok(
    bad.length === 0,
    `from ${table}: كل المفاتيح أعمدة حقيقية${bad.length ? ' — زائدة: ' + bad : ''}`,
  )
}

// ---- 2) المناظر تحمل ما تقرؤه toX: أعمدة الجدول مرجع المنظر ----
const readers = [
  [
    'parts',
    [
      'id',
      'sku',
      'name',
      'name_en',
      'category_id',
      'supplier_id',
      'tax_rate',
      'cost',
      'price_retail',
      'price_wholesale',
      'qty',
      'reorder_point',
      'reorder_qty',
      'lead_time_days',
      'location',
      'barcode',
      'notes',
      'archived',
      'created_at',
      'updated_at',
      'unlimited',
    ],
  ],
  [
    'invoice_lines',
    [
      'invoice_id',
      'part_id',
      'name',
      'sku',
      'qty',
      'free_qty',
      'unit_price',
      'unit_cost',
      'discount',
      'tax_rate',
    ],
  ],
  [
    'returns',
    [
      'id',
      'number',
      'invoice_id',
      'invoice_number',
      'customer_id',
      'customer_name',
      'subtotal',
      'vat_amount',
      'total',
      'restock',
      'reason',
      'user_id',
      'created_at',
    ],
  ],
  [
    'return_lines',
    ['return_id', 'part_id', 'name', 'sku', 'qty', 'unit_price', 'unit_cost', 'tax_rate'],
  ],
  ['settings', ['shop_name', 'vat_enabled', 'return_prefix', 'ai_model']],
]
for (const [table, needed] of readers) {
  const cols = new Set(schema[table])
  const missing = needed.filter((k) => !cols.has(k))
  ok(
    missing.length === 0,
    `to ${table}: الأعمدة المقروءة موجودة${missing.length ? ' — ناقصة: ' + missing : ''}`,
  )
}

// ---- 3) التكلفة المحجوبة تبقى undefined ولا تصير صفراً ----
const masked = R.toPart({
  id: 'p1',
  sku: 'S',
  name: 'ش',
  category_id: 'c1',
  cost: null,
  price_retail: 250,
  price_wholesale: 200,
  qty: 1,
  reorder_point: 0,
  reorder_qty: 1,
  lead_time_days: 1,
})
ok(masked.cost === undefined, 'cost = null (محجوب) ← undefined لا 0')
ok(masked.priceWholesale === 200, 'price_wholesale يُقرأ رقماً')

const inv = R.toInvoice({
  id: 'i1',
  number: 'INV-1',
  subtotal: '480.00',
  discount: '0',
  vat_rate: 15,
  vat_amount: '72.00',
  total: '552.00',
  payment_method: 'transfer',
  status: 'paid',
  user_id: 'u',
  created_at: '2026-10-12T00:00:00Z',
  invoice_lines: [
    {
      part_id: 'p1',
      name: 'ب',
      sku: 'S',
      qty: 10,
      free_qty: 1,
      unit_price: '48',
      unit_cost: null,
      discount: 0,
      tax_rate: 15,
    },
  ],
})
ok(
  inv.lines[0].freeQty === 1 && inv.lines[0].unitCost === undefined,
  'free_qty يُقرأ، وunit_cost المحجوب ← undefined',
)

const ret = R.toReturnNote({
  id: 'r1',
  number: 'RET-1',
  invoice_id: 'i1',
  invoice_number: 'INV-1',
  subtotal: '240.00',
  vat_amount: '36.00',
  total: '276.00',
  restock: false,
  user_id: 'u',
  created_at: '2026-10-12T00:00:00Z',
  return_lines: [
    { part_id: 'p1', name: 'ب', sku: 'S', qty: 5, unit_price: '48', unit_cost: '40', tax_rate: 15 },
  ],
})
ok(
  ret.restock === false && ret.lines[0].qty === 5 && ret.total === 276,
  'toReturnNote يفكّ البنود المضمَّنة',
)

ok(
  R.toMovement({
    id: 12,
    part_id: 'p1',
    qty: -3,
    type: 'sale',
    unit_cost: null,
    at: '2026-01-01T00:00:00Z',
  }).unitCost === undefined,
  'unit_cost المحجوب ← undefined لا 0',
)
ok(
  R.toMovement({ id: 12, part_id: 'p1', qty: -3, type: 'sale', at: '2026-01-01T00:00:00Z' }).id ===
    '12',
  'id الرقمي يتحوّل نصاً',
)

// ---- 4) الزمن ذهاباً وإياباً ----
const ms = 1750000000000
ok(R.toMs(R.toIso(ms)) === ms, 'ms → ISO → ms بلا فقد')
ok(R.toIso(0) === null && R.toMs(null) === 0, 'الصفر/الغائب لا يصير تاريخاً مخترعاً')
ok(R.toMs('غير صالح') === 0, 'تاريخ غير صالح ← 0 لا NaN')

// ---- 5) reorderQty صفر يُرفع إلى 1 مطابقةً للقيد في القاعدة ----
ok(
  R.fromPart({
    id: 'p',
    sku: 's',
    name: 'n',
    categoryId: 'c',
    cost: 0,
    priceRetail: 0,
    priceWholesale: 0,
    qty: 0,
    reorderPoint: 0,
    reorderQty: 0,
    leadTimeDays: 0,
    archived: false,
    createdAt: 0,
    updatedAt: 0,
  }).reorder_qty === 1,
  'reorder_qty = 0 يُرفع إلى 1 مطابقةً لقيد الجدول',
)

// ---- 5-ب) «بلا مورد» نص فارغ في النموذج ← null لا '' ----
// '' مفتاح أجنبي لا يطابق أي صف: Postgres يرفض المنتج كله (23503). حدث فعلاً
// على الإنتاج مع أول منتج أُضيف بلا مورد.
{
  const row = R.fromPart({
    id: 'p',
    sku: 's',
    name: 'n',
    categoryId: '',
    supplierId: '',
    cost: 0,
    priceRetail: 0,
    priceWholesale: 0,
    qty: 0,
    reorderPoint: 0,
    reorderQty: 1,
    leadTimeDays: 0,
    archived: false,
    createdAt: 0,
    updatedAt: 0,
  })
  ok(row.supplier_id === null, "supplier_id = '' ← null (بلا مورد)")
  ok(row.category_id === null, "category_id = '' ← null")
}

// ---- 5-ج) البند الرئيسي للمصروف: المفاتيح القديمة تُقرأ بأسمائها، والاسم الحرّ كما هو ----
ok(
  R.toPurchaseItem({ id: 'i', name: 'إيجار', kind: 'expense' }).kind === 'مصاريف',
  'kind=expense ← مصاريف',
)
ok(
  R.toPurchaseItem({ id: 'i', name: 'فرن', kind: 'equipment' }).kind === 'أخرى',
  'kind=equipment ← أخرى',
)
ok(
  R.toPurchaseItem({ id: 'i', name: 'راتب', kind: ' التشغيلية ' }).kind === 'التشغيلية',
  'بند رئيسي حرّ يُقرأ كما هو بلا مسافات طرفية',
)

// ---- 6) الإعدادات: vat_enabled الغائب يعني مفعّلة ----
ok(
  R.toSettings({ shop_name: 'وضح' }, { id: 'app', theme: 'dark', aiApiKey: 'k', invoiceCounter: 9 })
    .vatEnabled === true,
  'vat_enabled غائب ← true',
)
ok(
  R.toSettings({ shop_name: 'وضح' }, { id: 'app', theme: 'dark', aiApiKey: 'k', invoiceCounter: 9 })
    .theme === 'dark',
  'الحقول المحلية تبقى كما هي',
)

console.log(fail ? `\n❌ ${fail} فحص فشل` : '\n✅ كل الفحوص نجحت')
process.exit(fail ? 1 : 0)
