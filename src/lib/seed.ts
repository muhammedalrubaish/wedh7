import { DEFAULT_SETTINGS, db, sha256, uid } from './db'
import { cloudEnabled } from './supabase'
import { round2, startOfDay } from './format'
import type {
  Category,
  Customer,
  Invoice,
  InvoiceLine,
  Part,
  PurchaseOrder,
  ReturnNote,
  StockMovement,
  Supplier,
  User,
} from './types'

/** مولّد عشوائي ثابت كي يبدو محل العرض واحداً على كل جهاز. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

const rand = rng(20261012)
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]
const between = (a: number, b: number) => a + rand() * (b - a)
const intBetween = (a: number, b: number) => Math.floor(between(a, b + 1))

const CATEGORIES: Array<Omit<Category, 'id'>> = [
  { name: 'بوكسات', defaultMarkupPercent: 60, icon: 'package' },
  { name: 'حلويات بالكيلو', defaultMarkupPercent: 70, icon: 'cookie' },
  { name: 'مناسبات', defaultMarkupPercent: 55, icon: 'gift' },
]

const SUPPLIERS: Array<Omit<Supplier, 'id'>> = [
  { name: 'مصنع التغليف الحديث', phone: '0551234567', city: 'الرياض', leadTimeDays: 7 },
  { name: 'مؤسسة المكسرات الذهبية', phone: '0532223344', city: 'جدة', leadTimeDays: 4 },
  { name: 'شركة الدقيق والسكر', phone: '0509876543', city: 'الدمام', leadTimeDays: 3 },
]

interface ProductSpec {
  name: string
  nameEn: string
  cat: string
  cost: number
  qty: number
  /** وزن الطلب في المبيعات التجريبية — ما يُطلب كثيراً يبيع كثيراً. */
  weight: number
}

/**
 * الكتالوج قصير عمداً: العميل قال «ما عندنا منتجات كثيرة». بوكس واحد رئيسي
 * وحوله أصناف قليلة — هذا ما يجعل التقارير تُقرأ على الجوال بلا تمرير.
 */
const PRODUCTS: ProductSpec[] = [
  {
    name: 'بوكس وضح — الكلاسيك',
    nameEn: 'Wadhah Classic Box',
    cat: 'بوكسات',
    cost: 38,
    qty: 120,
    weight: 10,
  },
  {
    name: 'بوكس وضح — الكبير',
    nameEn: 'Wadhah Large Box',
    cat: 'بوكسات',
    cost: 62,
    qty: 60,
    weight: 5,
  },
  {
    name: 'بوكس وضح — ميني',
    nameEn: 'Wadhah Mini Box',
    cat: 'بوكسات',
    cost: 22,
    qty: 150,
    weight: 7,
  },
  {
    name: 'بوكس معمول بالتمر',
    nameEn: 'Date Maamoul Box',
    cat: 'بوكسات',
    cost: 30,
    qty: 40,
    weight: 3,
  },
  {
    name: 'بوكس كوكيز مشكّل',
    nameEn: 'Assorted Cookies Box',
    cat: 'بوكسات',
    cost: 26,
    qty: 45,
    weight: 3,
  },
  {
    name: 'كيلو بسبوسة',
    nameEn: 'Basbousa (kg)',
    cat: 'حلويات بالكيلو',
    cost: 28,
    qty: 30,
    weight: 2,
  },
  {
    name: 'كيلو كنافة',
    nameEn: 'Kunafa (kg)',
    cat: 'حلويات بالكيلو',
    cost: 34,
    qty: 20,
    weight: 2,
  },
  {
    name: 'بوكس حلى — مناسبات',
    nameEn: 'Occasion Sweets Box',
    cat: 'مناسبات',
    cost: 90,
    qty: 15,
    weight: 1,
  },
  { name: 'بوكس العيد', nameEn: 'Eid Box', cat: 'مناسبات', cost: 75, qty: 0, weight: 0 },
]

/** باركود رقمي بصيغة EAN-13 (مع خانة التحقق) كي تتعامل معه القارئات بلا شكوى. */
function barcodeFor(index: number): string {
  const base = `628${String(2000000 + index * 137).padStart(9, '0')}`.slice(0, 12)
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3)
  return base + ((10 - (sum % 10)) % 10)
}

export async function seed(): Promise<void> {
  const now = Date.now()

  const users: User[] = [
    {
      id: 'u_owner',
      name: 'أبو عبدالله (المالك)',
      username: 'owner',
      pinHash: await sha256('1234'),
      role: 'owner',
      phone: '0555555555',
      active: true,
      createdAt: now - 200 * 86_400_000,
    },
    {
      id: 'u_manager',
      name: 'نورة — مديرة المحل',
      username: 'noura',
      pinHash: await sha256('2222'),
      role: 'manager',
      active: true,
      createdAt: now - 160 * 86_400_000,
    },
    {
      id: 'u_cashier',
      name: 'فهد — موظف المبيعات',
      username: 'fahad',
      pinHash: await sha256('4444'),
      role: 'cashier',
      active: true,
      createdAt: now - 90 * 86_400_000,
    },
  ]

  const categories: Category[] = CATEGORIES.map((c) => ({
    ...c,
    id: `cat_${c.name.replace(/\s+/g, '_')}`,
  }))
  const catByName = new Map(categories.map((c) => [c.name, c]))

  const suppliers: Supplier[] = SUPPLIERS.map((s, i) => ({ ...s, id: `sup_${i + 1}` }))

  const parts: Part[] = PRODUCTS.map((spec, i) => {
    const cat = catByName.get(spec.cat)!
    const retail = round2(spec.cost * (1 + cat.defaultMarkupPercent / 100))
    return {
      id: `part_${i + 1}`,
      sku: `WDH-${String(i + 1).padStart(3, '0')}`,
      name: spec.name,
      nameEn: spec.nameEn,
      categoryId: cat.id,
      supplierId: suppliers[0].id,
      cost: spec.cost,
      priceRetail: retail,
      priceWholesale: round2(retail * 0.8),
      qty: spec.qty,
      reorderPoint: Math.max(5, Math.round(spec.qty * 0.25)),
      reorderQty: Math.max(20, Math.round(spec.qty * 0.5)),
      leadTimeDays: 2,
      location: i < 5 ? 'ثلاجة العرض' : 'المعمل',
      barcode: barcodeFor(i),
      archived: false,
      createdAt: now - intBetween(60, 200) * 86_400_000,
      updatedAt: now,
    }
  })

  // الزبائن محلات وكافيهات في الغالب — هذا نموذج عمل «وضح»: بوكسات تُوزَّع على
  // نقاط بيع، والفرد النقدي أقلّية.
  const customers: Customer[] = [
    { id: 'cus_1', name: 'كافيه لاتيه', phone: '0561112233', type: 'wholesale', createdAt: now },
    {
      id: 'cus_2',
      name: 'بقالة الحي',
      phone: '0544445566',
      type: 'wholesale',
      vatNumber: '310000000000003',
      createdAt: now,
    },
    { id: 'cus_3', name: 'محل ورد الربيع', phone: '0577778888', type: 'wholesale', createdAt: now },
    { id: 'cus_4', name: 'كافيه الركن', phone: '0533334444', type: 'wholesale', createdAt: now },
    { id: 'cus_5', name: 'صالون ليالي', phone: '0598887766', type: 'wholesale', createdAt: now },
    { id: 'cus_6', name: 'عبدالله السالم', phone: '0511112222', type: 'retail', createdAt: now },
  ]

  const movements: StockMovement[] = []
  const invoices: Invoice[] = []
  const returns: ReturnNote[] = []

  // الرصيد الافتتاحي: إنتاج دخل المخزون قبل ٦٠ يوماً.
  for (const part of parts) {
    if (part.qty === 0) continue
    movements.push({
      id: uid('mv_'),
      partId: part.id,
      qty: part.qty,
      type: 'purchase',
      unitCost: part.cost,
      ref: 'رصيد افتتاحي',
      userId: 'u_owner',
      at: now - 60 * 86_400_000,
    })
  }

  const demandPool: Part[] = []
  for (const [i, spec] of PRODUCTS.entries()) {
    for (let k = 0; k < spec.weight; k++) demandPool.push(parts[i])
  }

  let invoiceNo = 1
  let returnNo = 1
  const staff = ['u_cashier', 'u_manager', 'u_owner']
  const sold = new Map<string, number>()

  // ٦٠ يوماً من التوزيع. الخميس يوم التوريد الكبير للكافيهات قبل الويكند.
  for (let d = 59; d >= 0; d--) {
    const dayStart = startOfDay(new Date(now - d * 86_400_000))
    const weekday = new Date(dayStart).getDay()
    const busy = weekday === 4 ? 1.8 : weekday === 5 ? 0.6 : 1
    const count = Math.max(0, Math.round(between(1, 4) * busy))

    for (let n = 0; n < count; n++) {
      const at = dayStart + intBetween(9, 21) * 3_600_000 + intBetween(0, 59) * 60_000
      if (at > now) continue

      const customer = rand() < 0.15 ? customers[5] : pick(customers.slice(0, 5))
      const wholesale = customer.type === 'wholesale'
      const lineCount = wholesale ? intBetween(1, 3) : 1
      const lines: InvoiceLine[] = []

      for (let l = 0; l < lineCount; l++) {
        const part = pick(demandPool)
        if (lines.some((x) => x.partId === part.id)) continue
        const qty = wholesale ? intBetween(6, 24) : intBetween(1, 2)
        // كل عشرة بوكسات تقريباً واحد عينة — عادة العميل الفعلية مع المحلات.
        const freeQty = wholesale && rand() < 0.5 ? Math.max(1, Math.round(qty / 10)) : 0
        const unitPrice = wholesale ? part.priceWholesale : part.priceRetail
        lines.push({
          partId: part.id,
          name: part.name,
          sku: part.sku,
          qty,
          freeQty,
          unitPrice,
          unitCost: part.cost,
          discount: 0,
          taxRate: 15,
        })
      }
      if (lines.length === 0) continue

      const subtotal = round2(lines.reduce((s, l) => s + l.unitPrice * l.qty, 0))
      const discount = rand() < 0.1 ? round2(subtotal * 0.05) : 0
      const net = round2(subtotal - discount)
      const vatAmount = round2(net * (DEFAULT_SETTINGS.vatRate / 100))

      const invoice: Invoice = {
        id: uid('inv_'),
        number: `${DEFAULT_SETTINGS.invoicePrefix}${String(invoiceNo++).padStart(5, '0')}`,
        customerId: customer.id,
        customerName: customer.name,
        customerVatNumber: customer.vatNumber,
        lines,
        subtotal,
        discount,
        vatRate: DEFAULT_SETTINGS.vatRate,
        vatAmount,
        total: round2(net + vatAmount),
        paymentMethod: wholesale
          ? rand() < 0.6
            ? 'transfer'
            : 'credit'
          : rand() < 0.7
            ? 'cash'
            : 'card',
        status: 'paid',
        userId: pick(staff),
        createdAt: at,
      }
      invoices.push(invoice)

      for (const line of lines) {
        const out = line.qty + line.freeQty
        movements.push({
          id: uid('mv_'),
          partId: line.partId,
          qty: -out,
          type: 'sale',
          ref: invoice.number,
          userId: invoice.userId,
          at,
          note: line.freeQty ? `منها ${line.freeQty} عينة` : undefined,
        })
        sold.set(line.partId, (sold.get(line.partId) ?? 0) + out)
      }

      // مرتجع منتهي الصلاحية على بعض فواتير الجملة بعد أسبوعين — الحالة التي
      // وصفها العميل: «صار عندي إكسباير خمس بوكسات».
      if (wholesale && rand() < 0.12 && d >= 14) {
        const src = lines[0]
        const qty = Math.min(src.qty, intBetween(2, 6))
        const retAt = at + intBetween(10, 14) * 86_400_000
        const expired = rand() < 0.7
        const unitPrice = round2(src.unitPrice * (1 - discount / subtotal))
        const rSub = round2(unitPrice * qty)
        const rVat = round2(rSub * 0.15)
        returns.push({
          id: uid('ret_'),
          number: `${DEFAULT_SETTINGS.returnPrefix}${String(returnNo++).padStart(4, '0')}`,
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
          customerId: customer.id,
          customerName: customer.name,
          lines: [
            {
              partId: src.partId,
              name: src.name,
              sku: src.sku,
              qty,
              unitPrice,
              unitCost: src.unitCost,
              taxRate: 15,
            },
          ],
          subtotal: rSub,
          vatAmount: rVat,
          total: round2(rSub + rVat),
          restock: !expired,
          reason: expired ? 'انتهت الصلاحية' : 'زيادة عن الحاجة',
          userId: 'u_manager',
          createdAt: retAt,
        })
        if (!expired) {
          movements.push({
            id: uid('mv_'),
            partId: src.partId,
            qty,
            type: 'return_in',
            ref: `RET-${String(returnNo - 1).padStart(4, '0')}`,
            userId: 'u_manager',
            at: retAt,
            note: `مرتجع من ${invoice.number}`,
          })
          sold.set(src.partId, (sold.get(src.partId) ?? 0) - qty)
        }
      }
    }
  }

  // دفعات إنتاج دورية كي تبقى الأرصدة معقولة بعد شهرين، مع ترك صنف أو اثنين
  // تحت الحدّ ليظهر تنبيه الإنتاج وشيء في تقرير الراكد.
  for (const part of parts) {
    const out = sold.get(part.id) ?? 0
    const opening = part.qty
    const roll = rand()
    const target =
      part.qty === 0
        ? 0
        : roll < 0.2
          ? Math.max(1, Math.round(part.reorderPoint * between(0.3, 0.9)))
          : Math.max(part.reorderPoint + 2, Math.round(opening * between(0.6, 1.2)))
    const produce = Math.max(0, target - opening + out)
    if (produce > 0) {
      const batches = Math.max(1, Math.round(produce / 40))
      for (let b = 0; b < batches; b++) {
        const qty =
          b === batches - 1
            ? produce - Math.floor(produce / batches) * b
            : Math.floor(produce / batches)
        if (qty <= 0) continue
        movements.push({
          id: uid('mv_'),
          partId: part.id,
          qty,
          type: 'purchase',
          unitCost: round2(part.cost * between(0.97, 1.04)),
          ref: 'دفعة إنتاج',
          userId: 'u_owner',
          at: now - intBetween(2, 50) * 86_400_000,
        })
      }
    }
    part.qty = target
  }

  // طلب توريد مفتوح واحد من مورد التغليف — يكفي لعرض الشاشة.
  const purchaseOrders: PurchaseOrder[] = [
    {
      id: uid('po_'),
      code: `${DEFAULT_SETTINGS.poPrefix}0001`,
      supplierId: suppliers[0].id,
      status: 'ordered',
      lines: [{ partId: parts[0].id, qty: 100, unitCost: parts[0].cost, receivedQty: 0 }],
      createdAt: now - 3 * 86_400_000,
      expectedAt: now + 4 * 86_400_000,
      createdBy: 'u_manager',
      notes: 'علب الكلاسيك — الدفعة الشهرية',
    },
  ]

  await db.transaction(
    'rw',
    [
      db.users,
      db.categories,
      db.suppliers,
      db.customers,
      db.parts,
      db.movements,
      db.purchaseOrders,
      db.invoices,
      db.returns,
      db.settings,
    ],
    async () => {
      await db.users.bulkPut(users)
      await db.categories.bulkPut(categories)
      await db.suppliers.bulkPut(suppliers)
      await db.customers.bulkPut(customers)
      await db.parts.bulkPut(parts)
      await db.movements.bulkPut(movements)
      await db.purchaseOrders.bulkPut(purchaseOrders)
      await db.invoices.bulkPut(invoices)
      await db.returns.bulkPut(returns)
      await db.settings.put({
        ...DEFAULT_SETTINGS,
        invoiceCounter: invoiceNo,
        poCounter: 2,
        returnCounter: returnNo,
      })
    },
  )
}

/**
 * البذر في الوضع السحابي خطر لا راحة.
 *
 * `IndexedDB` مرتبطة بالمتصفح **وبالنطاق** معاً: فأي فتح من جهاز ثانٍ كان
 * سيجد المرآة فارغة فيملؤها بمحل وهمي كامل وفواتير لم تحدث. وصاحب محل يعمل
 * فعلاً لا يميّز ذلك عن بياناته. فالبذر يبقى لوضع العرض وحده.
 */
export async function ensureSeeded(): Promise<void> {
  if (cloudEnabled) return
  const count = await db.parts.count()
  if (count === 0) await seed()
}
