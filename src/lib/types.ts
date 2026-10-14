/**
 * نموذج المجال — معمل ومحل «وضح» للحلويات.
 *
 * المحل يبيع عدداً قليلاً من الأصناف (بوكسات) لمحلات وكافيهات وأفراد، ويريد أن
 * يعرف في آخر الشهر: كم باع لكل محل، وكم رجع منه، وكم أعطى عينات. النموذج
 * مشتقّ من نظام مخزون قطع الجوالات بعد نزع ما لا يخصّ الحلويات (الأجهزة،
 * التوافق، السريال، درجات الجودة) وإضافة ما يخصّها (العينات، والمرتجع الجزئي).
 *
 * كل شيء هنا مستقلّ عن التخزين عمداً: `db.ts` تحفظه في IndexedDB كمرآة،
 * والأشكال نفسها تنطبق ١:١ على جداول Postgres في `supabase/migrations/`.
 *
 * ملاحظة تسمية: الكيان اسمه `Part` في الشيفرة وجدوله `parts` — ورثناهما من
 * النسخة الأصل ولم نُعد تسميتهما كي يبقى الفرق بين النسختين قابلاً للمقارنة.
 * في الواجهة يُسمّى «منتج» أو «بوكس» دائماً.
 */

export type Role = 'owner' | 'manager' | 'cashier'

export interface User {
  id: string
  name: string
  username: string
  /** SHA-256 للرمز — المصادقة المحلية (وضع العرض) فقط. */
  pinHash: string
  role: Role
  /**
   * فروق عن مصفوفة الدور، لا قائمة صلاحيات كاملة: مفتاح غائب = اتبع الدور.
   * انظر `permissions.ts` لسبب تخزين الفرق بدل النتيجة النهائية.
   */
  capOverrides?: Partial<Record<string, boolean>>
  phone?: string
  active: boolean
  createdAt: number
  lastLoginAt?: number
}

export interface Category {
  id: string
  name: string
  /** نسبة الربح الافتراضية فوق التكلفة عند تسعير منتج جديد في هذا التصنيف. */
  defaultMarkupPercent: number
  icon?: string
}

/** مورّد للمعمل: تغليف، مكسرات، مواد خام… الجوال هو ما يُطلب فعلاً عند الحاجة. */
export interface Supplier {
  id: string
  name: string
  phone?: string
  city?: string
  leadTimeDays: number
  notes?: string
}

/** منتج يُباع — في الغالب بوكس حلويات. */
export interface Part {
  id: string
  sku: string
  name: string
  nameEn?: string
  categoryId: string
  supplierId?: string
  /** متوسط التكلفة المرجّح — يُعاد حسابه عند كل استلام/إنتاج. */
  cost: number
  priceRetail: number
  priceWholesale: number
  qty: number
  reorderPoint: number
  reorderQty: number
  leadTimeDays: number
  location?: string
  barcode?: string
  /**
   * نسبة ضريبة خاصة بالمنتج حين تختلف عن نسبة المحل في `Settings.vatRate`.
   * غيابه = اتبع نسبة المحل. يُطبَّق على الخادم في `create_sale`.
   */
  taxRate?: number
  notes?: string
  archived: boolean
  createdAt: number
  updatedAt: number
}

export type MovementType =
  | 'purchase'
  | 'sale'
  | 'adjustment'
  | 'return_in'
  | 'return_out'
  | 'damage'

export interface StockMovement {
  id: string
  partId: string
  /** موجب يضيف للمخزون، سالب يخصم. */
  qty: number
  type: MovementType
  unitCost?: number
  /** رقم الفاتورة / رمز الطلب / سبب حرّ. */
  ref?: string
  userId: string
  at: number
  note?: string
}

export type PurchaseOrderStatus = 'draft' | 'ordered' | 'partial' | 'received' | 'cancelled'

export interface PurchaseOrderLine {
  partId: string
  qty: number
  unitCost: number
  receivedQty: number
}

export interface PurchaseOrder {
  id: string
  code: string
  supplierId: string
  /** زبون طُلب له الصنف خصيصاً — فارغ في طلبات تعبئة المخزون العادية. */
  customerId?: string
  status: PurchaseOrderStatus
  lines: PurchaseOrderLine[]
  createdAt: number
  expectedAt?: number
  receivedAt?: number
  createdBy: string
  notes?: string
}

/**
 * البند الرئيسي للمصروف («التشغيلية»، «مكونات»…) — اسم يكتبه صاحب المعمل، وتحته
 * أصنافه بنوداً فرعية. كان أربعة مفاتيح ثابتة؛ صار نصاً حرّاً بطلب العميل. يُقرأ
 * دائماً عبر `groupName` في `expenseGroups.ts` لأن المفاتيح القديمة قد تصل بعد.
 */
export type PurchaseKind = string

/**
 * صنف يشتريه المعمل غير البوكسات: قشطة، كرتون، فرن، إيجار…
 * لا يُباع ولا رصيد له — يُتابَع بما يُصرف عليه في فواتير المشتريات.
 */
export interface PurchaseItem {
  id: string
  name: string
  kind: PurchaseKind
  /** الوحدة المعتادة (كيلو، علبة، كرتون، شهر) — البند يستطيع تجاوزها. */
  unit: string
  notes?: string
  archived: boolean
  createdAt: number
}

/** بند فاتورة مشتريات — الاسم والنوع والوحدة لقطة وقت الشراء. */
export interface PurchaseBillLine {
  itemId?: string
  name: string
  kind: PurchaseKind
  unit: string
  qty: number
  unitPrice: number
}

/** فاتورة مشتريات. الإجمالي يحسبه الخادم من البنود. */
export interface PurchaseBill {
  id: string
  supplierId?: string
  supplierName?: string
  /** رقم فاتورة المورد الورقية إن وُجد. */
  ref?: string
  purchasedAt: number
  total: number
  notes?: string
  userId?: string
  createdAt: number
  lines: PurchaseBillLine[]
}

/** قطاعي = زبون يشتري من المحل. جملة = محل أو كافيه يأخذ بوكسات بسعر الجملة. */
export type CustomerType = 'retail' | 'wholesale'

export interface Customer {
  id: string
  name: string
  phone?: string
  type: CustomerType
  vatNumber?: string
  notes?: string
  createdAt: number
}

export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'credit'
export type InvoiceStatus = 'paid' | 'unpaid' | 'refunded'

export interface InvoiceLine {
  partId: string
  /** لقطة الاسم وقت البيع — تعديل المنتج لاحقاً لا يعيد كتابة التاريخ. */
  name: string
  sku: string
  /** الكمية المحاسَبة. */
  qty: number
  /**
   * عينات تُسلَّم مع البند بلا مقابل: تُخصم من المخزون وتُحسب تكلفتها
   * ولا تدخل في الإيراد. مثال العميل: «يأخذ ١١ بوكساً والفاتورة على ١٠».
   */
  freeQty: number
  unitPrice: number
  /** لقطة التكلفة كي تبقى تقارير الربح صحيحة بعد تغيّر التكلفة. */
  unitCost: number
  discount: number
  /** لقطة نسبة الضريبة لحظة البيع. */
  taxRate: number
}

export interface Invoice {
  id: string
  number: string
  customerId?: string
  customerName?: string
  customerVatNumber?: string
  lines: InvoiceLine[]
  subtotal: number
  discount: number
  vatRate: number
  vatAmount: number
  total: number
  paymentMethod: PaymentMethod
  status: InvoiceStatus
  userId: string
  createdAt: number
  refundedAt?: number
  notes?: string
}

export interface ReturnLine {
  partId: string
  name: string
  sku: string
  /** الكمية المرتجعة من الكمية المحاسَبة في الفاتورة الأصل. */
  qty: number
  /** صافي سعر الوحدة بعد خصومات الفاتورة — ما يُردّ للزبون عن كل وحدة قبل الضريبة. */
  unitPrice: number
  unitCost: number
  taxRate: number
}

/**
 * مرتجع جزئي على فاتورة قائمة (إشعار دائن).
 *
 * الحالة الواقعية: المحل يأخذ عشرين بوكساً، ينتهي خمسة منها قبل أن تُباع
 * فيرجعها. الفاتورة الأصل تبقى كما هي وتُخصم منها هذه الورقة في التقارير
 * وكشف حساب الزبون. و«الاسترجاع الكامل» القديم يبقى لحالة إلغاء الفاتورة كلها.
 */
export interface ReturnNote {
  id: string
  number: string
  invoiceId: string
  invoiceNumber: string
  customerId?: string
  customerName?: string
  lines: ReturnLine[]
  subtotal: number
  vatAmount: number
  total: number
  /**
   * هل عادت البوكسات إلى المخزون القابل للبيع؟ المنتهي صلاحيته لا يعود —
   * خرج من المخزون عند البيع ولم يرجع، فلا حركة له. غير ذلك حركة `return_in`.
   */
  restock: boolean
  reason?: string
  userId: string
  createdAt: number
}

export interface Settings {
  id: 'app'
  shopName: string
  shopNameEn?: string
  vatNumber: string
  crNumber: string
  address: string
  phone: string
  currency: string
  vatRate: number
  /** مفتاح الضريبة العام. إطفاؤه يجعل كل بند صفراً مهما كانت نسبته الخاصة. */
  vatEnabled: boolean
  /** رمز ZATCA على الفاتورة المطبوعة (فاتورة ضريبية مبسطة). */
  zatcaQr: boolean
  invoicePrefix: string
  invoiceCounter: number
  poPrefix: string
  poCounter: number
  returnPrefix: string
  returnCounter: number
  theme: 'light' | 'dark'
  aiProvider: 'none' | 'deepseek' | 'anthropic'
  aiModel: string
  /**
   * اتركه فارغاً ليمرّ الطلب عبر /api/ai والمفتاح يبقى على الخادم. تعبئته هنا
   * تعني إرسال الطلب من المتصفح مباشرةً — والمفتاح يصير مقروءاً لأي زائر.
   */
  aiApiKey: string
}

export interface AuditEntry {
  id: string
  userId: string
  userName: string
  action: string
  entity: string
  entityId?: string
  at: number
  details?: string
}

/** كل ما يحتاجه التطبيق ليجيب «هل نعيد إنتاج/طلب هذا الصنف؟». */
export interface ReorderSuggestion {
  part: Part
  /** وحدات مباعة يومياً خلال نافذة القياس. */
  velocity: number
  daysOfCover: number
  suggestedQty: number
  severity: 'out' | 'critical' | 'low'
  onOrderQty: number
}
