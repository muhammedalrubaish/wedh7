/**
 * ترجمة بين صفوف Postgres ونماذج المجال.
 *
 * فرقان لا ثالث لهما، وكلاهما مصدر أخطاء صامتة لو تُرك للتخمين:
 *   • التسمية: `price_retail` في القاعدة مقابل `priceRetail` في الواجهة.
 *   • الزمن: `timestamptz` نصّ ISO في القاعدة، وعدد ميلي ثانية في الواجهة.
 *
 * كُتبت يدوياً لا بتحويل آلي (`camelCase()` على كل مفتاح) عن قصد: التحويل الآلي
 * يمرّر أي خطأ تسمية بصمت ويظهر لاحقاً كحقل `undefined` في فاتورة، بينما الجدول
 * الصريح يكسر البناء عند أول اختلاف. الأرقام المالية تستحق هذا الثمن.
 *
 * ⚠️ الأعمدة المحجوبة عن بعض الأدوار (`cost`, `unit_cost`) تصل `null` من
 * المناظر، لا صفراً. الفرق جوهري: صفر يعني «تكلفتها صفر» ويُفسد حساب الهامش،
 * و`undefined` يعني «ما لك صلاحية تشوفها» وتعرف الواجهة أن تخفي العمود.
 */
import type {
  AuditEntry,
  Category,
  Customer,
  Invoice,
  InvoiceLine,
  Part,
  PurchaseOrder,
  PurchaseOrderLine,
  ReturnLine,
  ReturnNote,
  Role,
  Settings,
  StockMovement,
  Supplier,
  User,
} from './types'

/* -------------------------------------------------------------------------- */
/* أدوات مشتركة                                                                */
/* -------------------------------------------------------------------------- */

export type Row = Record<string, unknown>

const s = (v: unknown): string => (typeof v === 'string' ? v : String(v ?? ''))
const os = (v: unknown): string | undefined =>
  v === null || v === undefined || v === '' ? undefined : String(v)
const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
/** رقم اختياري: `null` يعني محجوب أو غير مسجَّل، ولا يجوز أن يصير صفراً. */
const on = (v: unknown): number | undefined =>
  v === null || v === undefined ? undefined : Number(v)
const b = (v: unknown): boolean => v === true

/** ISO ← ميلي ثانية. الغائب يصير 0 لا `Date.now()`: تاريخ مخترع أسوأ من صفر. */
export const toMs = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0
  const t = new Date(String(v)).getTime()
  return Number.isNaN(t) ? 0 : t
}

/** ميلي ثانية ← ISO. الصفر يعني «لا قيمة» فيُرسَل `null`. */
export const toIso = (ms: number | undefined): string | null =>
  ms === undefined || ms === 0 ? null : new Date(ms).toISOString()

/* -------------------------------------------------------------------------- */
/* المستخدمون                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * الملف الشخصي لا يحمل `pinHash`: المصادقة في Supabase Auth، والرمز المحلي
 * (SHA-256 بلا ملح) لم يُنقل عمداً. النوع يبقى كما هو حتى لا تتغيّر الشاشات.
 */
export function toUser(
  r: Row,
  overrides: Array<{ capability: string; granted: boolean }> = [],
): User {
  const capOverrides: Record<string, boolean> = {}
  for (const o of overrides) capOverrides[o.capability] = o.granted
  return {
    id: s(r.id),
    name: s(r.name),
    username: s(r.username),
    pinHash: '',
    role: s(r.role) as Role,
    capOverrides: Object.keys(capOverrides).length ? capOverrides : undefined,
    phone: os(r.phone),
    active: b(r.active),
    createdAt: toMs(r.created_at),
    lastLoginAt: r.last_login_at ? toMs(r.last_login_at) : undefined,
  }
}

/* -------------------------------------------------------------------------- */
/* البيانات المرجعية                                                           */
/* -------------------------------------------------------------------------- */

export const toCategory = (r: Row): Category => ({
  id: s(r.id),
  name: s(r.name),
  defaultMarkupPercent: n(r.default_markup_percent),
  icon: os(r.icon),
})

export const fromCategory = (c: Category): Row => ({
  id: c.id,
  name: c.name,
  default_markup_percent: c.defaultMarkupPercent,
  icon: c.icon ?? null,
})

export const toSupplier = (r: Row): Supplier => ({
  id: s(r.id),
  name: s(r.name),
  phone: os(r.phone),
  city: os(r.city),
  leadTimeDays: n(r.lead_time_days),
  notes: os(r.notes),
})

export const fromSupplier = (v: Supplier): Row => ({
  id: v.id,
  name: v.name,
  phone: v.phone ?? null,
  city: v.city ?? null,
  lead_time_days: v.leadTimeDays,
  notes: v.notes ?? null,
})

export const toCustomer = (r: Row): Customer => ({
  id: s(r.id),
  name: s(r.name),
  phone: os(r.phone),
  type: s(r.type) as Customer['type'],
  vatNumber: os(r.vat_number),
  notes: os(r.notes),
  createdAt: toMs(r.created_at),
})

export const fromCustomer = (v: Customer): Row => ({
  id: v.id,
  name: v.name,
  phone: v.phone ?? null,
  type: v.type,
  vat_number: v.vatNumber ?? null,
  notes: v.notes ?? null,
  created_at: toIso(v.createdAt),
})

/* -------------------------------------------------------------------------- */
/* المنتجات                                                                    */
/* -------------------------------------------------------------------------- */

export function toPart(r: Row): Part {
  return {
    id: s(r.id),
    sku: s(r.sku),
    name: s(r.name),
    nameEn: os(r.name_en),
    categoryId: s(r.category_id),
    supplierId: os(r.supplier_id),
    taxRate: on(r.tax_rate),
    cost: on(r.cost) as number, // محجوب عن بعض الأدوار — انظر رأس الملف
    priceRetail: n(r.price_retail),
    priceWholesale: n(r.price_wholesale),
    qty: n(r.qty),
    reorderPoint: n(r.reorder_point),
    reorderQty: n(r.reorder_qty),
    leadTimeDays: n(r.lead_time_days),
    location: os(r.location),
    barcode: os(r.barcode),
    notes: os(r.notes),
    archived: b(r.archived),
    createdAt: toMs(r.created_at),
    updatedAt: toMs(r.updated_at),
  }
}

/** `qty` و`cost` مستثنيان: الأول يُشتق من دفتر الحركة، والثاني من المتوسط المرجّح. */
export function fromPart(p: Part): Row {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    name_en: p.nameEn ?? null,
    category_id: p.categoryId,
    supplier_id: p.supplierId ?? null,
    tax_rate: p.taxRate ?? null,
    price_retail: p.priceRetail,
    price_wholesale: p.priceWholesale,
    reorder_point: p.reorderPoint,
    reorder_qty: Math.max(1, p.reorderQty),
    lead_time_days: p.leadTimeDays,
    location: p.location ?? null,
    barcode: p.barcode ?? null,
    notes: p.notes ?? null,
    archived: p.archived,
    updated_at: new Date().toISOString(),
  }
}

/* -------------------------------------------------------------------------- */
/* دفتر الحركة                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * `id` رقم متسلسل من الخادم، والواجهة تتعامل مع نصوص. التحويل هنا لا في الشاشات.
 * لا يوجد `fromMovement`: الحركة تُنشأ عبر `record_movement()` وحدها ولا تُكتب
 * مباشرة أبداً — وهذه قاعدة المشروع الأولى.
 */
export const toMovement = (r: Row): StockMovement => ({
  id: s(r.id),
  partId: s(r.part_id),
  qty: n(r.qty),
  type: s(r.type) as StockMovement['type'],
  unitCost: on(r.unit_cost),
  ref: os(r.ref),
  note: os(r.note),
  userId: s(r.user_id),
  at: toMs(r.at),
})

/* -------------------------------------------------------------------------- */
/* الفواتير                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * لا يوجد `fromInvoice` ولا `fromInvoiceLine` عمداً.
 *
 * الفاتورة تُنشأ عبر `create_sale()` وتُسترجع عبر `refund_invoice()` وتُخصم
 * منها المرتجعات عبر `create_return()` — كلها تحسب الضريبة وتحرّك الرصيد وتكتب
 * الدفتر في عملية ذرّية واحدة. فتح مسار كتابة مباشر هنا يعني فاتورة بلا حركة
 * مقابلة، أو رصيداً لا يفسّره الدفتر.
 */

/** بنود الفاتورة لقطة وقت البيع: الاسم والتكلفة كما كانا، لا كما صارا. */
const toInvoiceLine = (r: Row): InvoiceLine => ({
  partId: s(r.part_id),
  name: s(r.name),
  sku: s(r.sku),
  qty: n(r.qty),
  freeQty: n(r.free_qty),
  unitPrice: n(r.unit_price),
  unitCost: on(r.unit_cost) as number, // محجوب عن بعض الأدوار — انظر رأس الملف
  discount: n(r.discount),
  taxRate: n(r.tax_rate),
})

/**
 * البنود تصل مضمّنة من `invoice_lines`. وغيابها لا يُترجم إلى مصفوفة فارغة:
 * فاتورة بلا بنود تعني «لم تُطلب البنود» أو «حجبتها سياسة»، وعرضها كفاتورة
 * فارغة يوهم صاحب المحل أن بيعة ضاعت.
 */
export function toInvoice(r: Row, previous?: Invoice): Invoice {
  const joined = Array.isArray(r.invoice_lines)
    ? (r.invoice_lines as Row[]).map(toInvoiceLine)
    : undefined
  return {
    id: s(r.id),
    number: s(r.number),
    customerId: os(r.customer_id),
    customerName: os(r.customer_name),
    customerVatNumber: os(r.customer_vat_number),
    lines: joined ?? previous?.lines ?? [],
    subtotal: n(r.subtotal),
    discount: n(r.discount),
    vatRate: n(r.vat_rate),
    vatAmount: n(r.vat_amount),
    total: n(r.total),
    paymentMethod: s(r.payment_method) as Invoice['paymentMethod'],
    status: s(r.status) as Invoice['status'],
    userId: s(r.user_id),
    createdAt: toMs(r.created_at),
    refundedAt: r.refunded_at ? toMs(r.refunded_at) : undefined,
    notes: os(r.notes),
  }
}

/* -------------------------------------------------------------------------- */
/* المرتجعات                                                                   */
/* -------------------------------------------------------------------------- */

const toReturnLine = (r: Row): ReturnLine => ({
  partId: s(r.part_id),
  name: s(r.name),
  sku: s(r.sku),
  qty: n(r.qty),
  unitPrice: n(r.unit_price),
  unitCost: on(r.unit_cost) as number, // محجوب عن بعض الأدوار
  taxRate: n(r.tax_rate),
})

export function toReturnNote(r: Row, previous?: ReturnNote): ReturnNote {
  const joined = Array.isArray(r.return_lines)
    ? (r.return_lines as Row[]).map(toReturnLine)
    : undefined
  return {
    id: s(r.id),
    number: s(r.number),
    invoiceId: s(r.invoice_id),
    invoiceNumber: s(r.invoice_number),
    customerId: os(r.customer_id),
    customerName: os(r.customer_name),
    lines: joined ?? previous?.lines ?? [],
    subtotal: n(r.subtotal),
    vatAmount: n(r.vat_amount),
    total: n(r.total),
    restock: b(r.restock),
    reason: os(r.reason),
    userId: s(r.user_id),
    createdAt: toMs(r.created_at),
  }
}

/* -------------------------------------------------------------------------- */
/* طلبات التوريد                                                               */
/* -------------------------------------------------------------------------- */

const toPurchaseOrderLine = (r: Row): PurchaseOrderLine => ({
  partId: s(r.part_id),
  qty: n(r.qty),
  unitCost: n(r.unit_cost),
  receivedQty: n(r.received_qty),
})

export function toPurchaseOrder(r: Row, previous?: PurchaseOrder): PurchaseOrder {
  const joined = Array.isArray(r.purchase_order_lines)
    ? (r.purchase_order_lines as Row[]).map(toPurchaseOrderLine)
    : undefined
  return {
    id: s(r.id),
    code: s(r.code),
    supplierId: s(r.supplier_id),
    customerId: os(r.customer_id),
    status: s(r.status) as PurchaseOrder['status'],
    lines: joined ?? previous?.lines ?? [],
    createdAt: toMs(r.created_at),
    expectedAt: r.expected_at ? toMs(r.expected_at) : undefined,
    receivedAt: r.received_at ? toMs(r.received_at) : undefined,
    createdBy: s(r.created_by),
    notes: os(r.notes),
  }
}

/** البنود جدول مستقل فتُكتب على حدة — انظر `fromPurchaseOrderLine`. */
export const fromPurchaseOrder = (v: PurchaseOrder): Row => ({
  id: v.id,
  code: v.code,
  supplier_id: v.supplierId,
  customer_id: v.customerId ?? null,
  status: v.status,
  created_at: toIso(v.createdAt),
  expected_at: toIso(v.expectedAt),
  received_at: toIso(v.receivedAt),
  created_by: v.createdBy,
  notes: v.notes ?? null,
})

/**
 * `received_qty` لا يُكتب من هنا بعد الإنشاء: الاستلام يمرّ بـ
 * `receive_purchase()` التي تسجّل حركة المخزون المقابلة في نفس العملية.
 */
export const fromPurchaseOrderLine = (poId: string, l: PurchaseOrderLine): Row => ({
  po_id: poId,
  part_id: l.partId,
  qty: l.qty,
  unit_cost: l.unitCost,
  received_qty: l.receivedQty,
})

/* -------------------------------------------------------------------------- */
/* الإعدادات                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * حقول تبقى محلية بلا عمود مقابل، وكلها مقصودة:
 *   • `theme` تفضيل جهاز: الموظف قد يريد الداكن والمالك الفاتح.
 *   • `aiApiKey` سرّ لا يُشارك بين الأجهزة ولا يُخزَّن في قاعدة مشتركة.
 *   • العدّادات يحجزها الخادم عبر `next_number()`، لأن عدّاداً في المتصفح يعني
 *     جهازين يبيعان فيولّدان نفس رقم الفاتورة.
 *
 * لذلك يأخذ `local` ويُبقي هذه الحقول كما هي بدل الكتابة فوقها بفراغ.
 */
export const toSettings = (r: Row, local: Settings): Settings => ({
  ...local,
  id: 'app',
  shopName: s(r.shop_name),
  shopNameEn: os(r.shop_name_en),
  vatNumber: s(r.vat_number),
  crNumber: s(r.cr_number),
  address: s(r.address),
  phone: s(r.phone),
  currency: s(r.currency),
  vatRate: n(r.vat_rate),
  vatEnabled: r.vat_enabled === undefined ? true : b(r.vat_enabled),
  zatcaQr: b(r.zatca_qr),
  invoicePrefix: s(r.invoice_prefix),
  poPrefix: s(r.po_prefix),
  returnPrefix: s(r.return_prefix),
  aiProvider: s(r.ai_provider) as Settings['aiProvider'],
  aiModel: s(r.ai_model),
})

export const fromSettings = (v: Settings): Row => ({
  id: 'app',
  shop_name: v.shopName,
  shop_name_en: v.shopNameEn ?? null,
  vat_number: v.vatNumber,
  cr_number: v.crNumber,
  address: v.address,
  phone: v.phone,
  currency: v.currency,
  vat_rate: v.vatRate,
  vat_enabled: v.vatEnabled,
  zatca_qr: v.zatcaQr,
  invoice_prefix: v.invoicePrefix,
  po_prefix: v.poPrefix,
  return_prefix: v.returnPrefix,
  ai_provider: v.aiProvider,
  ai_model: v.aiModel,
})

/* -------------------------------------------------------------------------- */
/* سجل التدقيق                                                                 */
/* -------------------------------------------------------------------------- */

export const toAuditEntry = (r: Row): AuditEntry => ({
  id: s(r.id),
  userId: s(r.user_id),
  userName: s(r.user_name),
  action: s(r.action),
  entity: s(r.entity),
  entityId: os(r.entity_id),
  details: os(r.details),
  at: toMs(r.at),
})

/**
 * `id` لا يُرسل: العمود `bigint generated always as identity` ويرفض أي قيمة.
 *
 * و`user_id` يُرسل ولا يُترك للخادم: لا يوجد `default auth.uid()` على العمود،
 * فتركه يعني قيد تدقيق بلا صاحب. والانتحال تمنعه سياسة `audit_insert` مع
 * مفتاح `anon` الذي لا يملك جلسة أصلاً.
 */
export const fromAuditEntry = (v: AuditEntry): Row => ({
  user_id: v.userId,
  user_name: v.userName,
  action: v.action,
  entity: v.entity,
  entity_id: v.entityId ?? null,
  details: v.details ?? null,
  at: toIso(v.at),
})
