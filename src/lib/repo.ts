/**
 * حدود الكتابة الوحيدة.
 *
 * بعد أن صارت Supabase مصدر الحقيقة، **ما يُكتب محلياً وحده يمحوه أول
 * `pullAll`**: فبيعة تُسجَّل في Dexie ولا تصل الخادم تختفي عند إعادة فتح
 * الصفحة، بلا رسالة ولا أثر.
 *
 * لذلك كل دالة هنا لها فرعان:
 *   • سحابي — الخادم أولاً (دالة ذرّية حيث وُجدت)، ثم تحديث المرآة.
 *   • محلي  — السلوك نفسه على IndexedDB، للعرض على جهاز بلا قاعدة مربوطة.
 *
 * والبيع يتوقّف بلا إنترنت عمداً: بوكس واحد يُباع من جهازين في آنٍ واحد
 * أغلى من دقائق انقطاع.
 */
import { legacyKeysOf } from './expenseGroups'
import {
  applyMovement as applyMovementLocal,
  db,
  logAudit,
  nextNumber,
  saveSettings as saveSettingsLocal,
  uid,
} from './db'
import { cloudEnabled, humanError, requireClient } from './supabase'
import { refreshInvoice, refreshPart, refreshParts, refreshReturn } from './mirror'
import { returnUnitPrice, returnedByPart } from './analytics'
import { round2 } from './format'
import {
  fromCategory,
  fromCustomer,
  fromPart,
  fromPurchaseItem,
  fromPurchaseOrder,
  fromPurchaseOrderLine,
  fromAuditEntry,
  fromSettings,
  toInvoice,
  toPurchaseBill,
  toPurchaseOrder,
  toReturnNote,
} from './rows'
import type {
  Category,
  Customer,
  Invoice,
  Part,
  PaymentMethod,
  PurchaseBill,
  PurchaseItem,
  PurchaseOrder,
  ReturnLine,
  ReturnNote,
  Settings,
  StockMovement,
  Supplier,
  User,
} from './types'

/** خطأ واحد مفهوم بدل انهيار بمرجع فارغ حين ينقطع الاتصال. */
function guardOnline(): void {
  if (!navigator.onLine) {
    throw new Error('لا يوجد اتصال بالإنترنت. البيع والتعديل يحتاجان اتصالاً — العرض ما زال يعمل.')
  }
}

const fail = (err: unknown): never => {
  throw new Error(humanError(err))
}

/* -------------------------------------------------------------------------- */
/* دفتر الحركة                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * المنفذ الوحيد لتغيير الرصيد — القاعدة الأولى في المشروع.
 *
 * في الوضع السحابي ينادي `record_movement()` التي تكتب القيد وتُحدّث الرصيد
 * وتعيد حساب متوسط التكلفة داخل معاملة واحدة على الخادم. لا يُكتب `qty` هنا
 * إطلاقاً؛ يُعاد سحبه من الخادم بعد النداء.
 */
export async function applyMovement(input: {
  partId: string
  qty: number
  type: StockMovement['type']
  userId: string
  unitCost?: number
  ref?: string
  note?: string
  at?: number
}): Promise<void> {
  if (!cloudEnabled) return applyMovementLocal(input)
  guardOnline()
  const { error } = await requireClient().rpc('record_movement', {
    p_part_id: input.partId,
    p_qty: input.qty,
    p_type: input.type,
    p_unit_cost: input.unitCost ?? null,
    p_ref: input.ref ?? null,
    p_note: input.note ?? null,
  })
  if (error) fail(error)
  await refreshPart(input.partId)
}

/* -------------------------------------------------------------------------- */
/* البيع                                                                       */
/* -------------------------------------------------------------------------- */

export interface SaleLine {
  partId: string
  qty: number
  /** عينات مع البند — تُخصم من المخزون بلا سعر. */
  freeQty: number
  unitPrice: number
  discount: number
}

/**
 * البيع في نداء واحد.
 *
 * `create_sale()` تحجز رقم الفاتورة وتحسب الضريبة وتكتب البنود وتخصم الرصيد
 * (المحاسَب والعينات معاً) — كله ذرّياً. والنسخة المحلية تفعل ذلك في خطوات
 * متتابعة لأنها على جهاز واحد لا يقطعه شيء.
 *
 * ⚠️ رقم الفاتورة يأتي من الخادم لا من `nextNumber` المحلي: عدّاد في المتصفح
 * يعني جهازين يبيعان في آنٍ واحد فيولّدان نفس الرقم على فاتورتين ضريبيتين.
 */
export async function createSale(input: {
  customerId?: string
  paymentMethod: PaymentMethod
  discount: number
  lines: SaleLine[]
  notes?: string
  /** يُستعمل في الوضع المحلي وحده: الخادم يبني الفاتورة بنفسه. */
  localInvoice: Invoice
}): Promise<Invoice> {
  if (!cloudEnabled) {
    await db.invoices.add(input.localInvoice)
    for (const line of input.lines) {
      await applyMovementLocal({
        partId: line.partId,
        qty: -(line.qty + line.freeQty),
        type: 'sale',
        userId: input.localInvoice.userId,
        ref: input.localInvoice.number,
        note: line.freeQty ? `منها ${line.freeQty} عينة` : undefined,
      })
    }
    return input.localInvoice
  }

  guardOnline()
  const { data, error } = await requireClient().rpc('create_sale', {
    p_customer_id: input.customerId ?? null,
    p_payment_method: input.paymentMethod,
    p_discount: input.discount,
    p_lines: input.lines.map((l) => ({
      part_id: l.partId,
      qty: l.qty,
      free_qty: l.freeQty,
      unit_price: l.unitPrice,
      discount: l.discount,
    })),
    p_notes: input.notes ?? null,
  })
  if (error) fail(error)

  // الصفّ العائد لا يحمل البنود (الدالة تُرجع `invoices%rowtype`)، فتُمرَّر
  // البنود المحلية كلقطة وقت البيع حتى يصل السحب التالي بالنسخة الرسمية.
  const invoice = toInvoice(data as Record<string, unknown>, input.localInvoice)
  await db.invoices.put(invoice)
  await Promise.all(input.lines.map((l) => refreshPart(l.partId)))
  return invoice
}

/**
 * «تم السداد» / «لم يتم السداد». على الخادم يحتاج `sales.refund` (المالك والمدير):
 * تسجيل أن محلاً دفع دَينه قرار مالي لا يملكه الموظف.
 */
export async function setInvoicePaid(invoice: Invoice, paid: boolean): Promise<void> {
  if (invoice.status === 'refunded') throw new Error('الفاتورة مسترجعة — لا تُغيَّر حالة سدادها.')
  const method: PaymentMethod = paid
    ? invoice.paymentMethod === 'credit'
      ? 'transfer'
      : invoice.paymentMethod
    : 'credit'
  if (cloudEnabled) {
    guardOnline()
    const { error } = await requireClient().rpc('set_invoice_paid', {
      p_invoice_id: invoice.id,
      p_paid: paid,
    })
    if (error) fail(error)
  }
  await db.invoices.update(invoice.id, { status: paid ? 'paid' : 'unpaid', paymentMethod: method })
}

/* -------------------------------------------------------------------------- */
/* المرتجعات والاسترجاع                                                        */
/* -------------------------------------------------------------------------- */

export interface ReturnRequest {
  invoice: Invoice
  /** الكميات المرتجعة لكل منتج — ما ليس هنا لم يُرجع. */
  lines: Array<{ partId: string; qty: number }>
  restock: boolean
  reason?: string
}

/**
 * يبني بنود المرتجع وأرقامه من الفاتورة الأصل — نفس المعادلة محلياً وعلى الخادم.
 *
 * يُرفض ما يتجاوز المتاح: الكمية المحاسَبة ناقص ما رُجع سابقاً على نفس الفاتورة.
 * العينات ليست قابلة للردّ بمال لأنها لم تُدفع أصلاً.
 */
export async function buildReturn(
  req: ReturnRequest,
  existing: ReturnNote[],
): Promise<Omit<ReturnNote, 'id' | 'number' | 'userId' | 'createdAt'>> {
  const already = returnedByPart(req.invoice.id, existing)
  const lines: ReturnLine[] = []
  for (const r of req.lines) {
    if (r.qty <= 0) continue
    const src = req.invoice.lines.find((l) => l.partId === r.partId)
    if (!src) throw new Error('البند ليس في الفاتورة الأصل')
    const available = src.qty - (already.get(r.partId) ?? 0)
    if (r.qty > available) {
      throw new Error(`«${src.name}»: المتاح للإرجاع ${available} فقط`)
    }
    lines.push({
      partId: src.partId,
      name: src.name,
      sku: src.sku,
      qty: r.qty,
      unitPrice: returnUnitPrice(req.invoice, src),
      unitCost: src.unitCost,
      taxRate: src.taxRate,
    })
  }
  if (lines.length === 0) throw new Error('حدّد كمية مرتجعة لبند واحد على الأقل')

  const subtotal = round2(lines.reduce((n, l) => n + l.unitPrice * l.qty, 0))
  const vatAmount = round2(lines.reduce((n, l) => n + (l.unitPrice * l.qty * l.taxRate) / 100, 0))
  return {
    invoiceId: req.invoice.id,
    invoiceNumber: req.invoice.number,
    customerId: req.invoice.customerId,
    customerName: req.invoice.customerName,
    lines,
    subtotal,
    vatAmount,
    total: round2(subtotal + vatAmount),
    restock: req.restock,
    reason: req.reason?.trim() || undefined,
  }
}

/**
 * مرتجع جزئي: إشعار دائن على فاتورة قائمة.
 *
 * `create_return()` على الخادم تتحقق من الكميات، وتحجز الرقم، وتكتب البنود،
 * وتعيد البوكسات إلى الرصيد إن كانت صالحة — ذرّياً. المنتهي صلاحيته لا يعود:
 * لا حركة له، فالدفتر يبقى صادقاً (خرج عند البيع ولم يرجع).
 */
export async function createReturn(req: ReturnRequest, user: User): Promise<ReturnNote> {
  if (req.invoice.status === 'refunded') throw new Error('الفاتورة مسترجعة بالكامل أصلاً')

  if (!cloudEnabled) {
    const existing = await db.returns.where('invoiceId').equals(req.invoice.id).toArray()
    const draft = await buildReturn(req, existing)
    const note: ReturnNote = {
      ...draft,
      id: uid('ret_'),
      number: await nextNumber('return'),
      userId: user.id,
      createdAt: Date.now(),
    }
    await db.returns.add(note)
    if (note.restock) {
      for (const l of note.lines) {
        await applyMovementLocal({
          partId: l.partId,
          qty: l.qty,
          type: 'return_in',
          userId: user.id,
          ref: note.number,
          note: `مرتجع من ${req.invoice.number}`,
        })
      }
    }
    return note
  }

  guardOnline()
  const { data, error } = await requireClient().rpc('create_return', {
    p_invoice_id: req.invoice.id,
    p_lines: req.lines.filter((l) => l.qty > 0).map((l) => ({ part_id: l.partId, qty: l.qty })),
    p_restock: req.restock,
    p_reason: req.reason?.trim() || null,
  })
  if (error) fail(error)
  const note = toReturnNote(data as Record<string, unknown>)
  await refreshReturn(note.id)
  await refreshInvoice(req.invoice.id)
  if (note.restock) await Promise.all(req.lines.map((l) => refreshPart(l.partId)))
  return (await db.returns.get(note.id)) ?? note
}

/**
 * الاسترجاع الكامل: إلغاء الفاتورة كلها وإعادة كل بوكساتها (والعينات معها)
 * إلى الرصيد. يُرفض إن كان عليها مرتجع جزئي — وإلا رُدّ المال مرتين.
 */
export async function refundInvoice(invoice: Invoice, user: User): Promise<void> {
  if (!cloudEnabled) {
    const partial = await db.returns.where('invoiceId').equals(invoice.id).count()
    if (partial > 0) throw new Error('على هذه الفاتورة مرتجع جزئي — لا يمكن استرجاعها بالكامل')
    await db.invoices.update(invoice.id, { status: 'refunded', refundedAt: Date.now() })
    for (const line of invoice.lines) {
      await applyMovementLocal({
        partId: line.partId,
        qty: line.qty + line.freeQty,
        type: 'return_in',
        userId: user.id,
        ref: invoice.number,
        note: 'استرجاع فاتورة',
      })
    }
    return
  }

  guardOnline()
  const { error } = await requireClient().rpc('refund_invoice', { p_invoice_id: invoice.id })
  if (error) fail(error)
  await db.invoices.update(invoice.id, { status: 'refunded', refundedAt: Date.now() })
  await Promise.all(invoice.lines.map((l) => refreshPart(l.partId)))
}

/* -------------------------------------------------------------------------- */
/* المنتجات                                                                    */
/* -------------------------------------------------------------------------- */

/** الإنشاء بلا رصيد: أي كمية ابتدائية تدخل كحركة `purchase` بعدها. */
export async function createPart(
  draft: Omit<Part, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<string> {
  const id = uid('part_')
  const now = Date.now()
  const part: Part = { ...draft, id, qty: 0, archived: false, createdAt: now, updatedAt: now }
  if (!cloudEnabled) {
    await db.parts.add(part)
    return id
  }
  guardOnline()
  // التكلفة تُرسل صراحةً: `fromPart` يُسقطها، فكان كل منتج جديد يُحفظ بتكلفة صفر على
  // الخادم وتظهر أرباحه ١٠٠٪. في معمل الحلويات التكلفة رقم يحدّده صاحبه لا متوسط شراء.
  const { error } = await requireClient()
    .from('parts')
    .insert({
      ...fromPart(part),
      ...(part.cost !== undefined ? { cost: part.cost } : {}),
      created_at: new Date(now).toISOString(),
    })
  if (error) fail(error)
  await refreshPart(id)
  return id
}

/**
 * حذف منتج نهائياً — لمنتج أُضيف خطأً أو مكرّراً. للمنتج الذي توقّف بيعه: الأرشفة.
 *
 * ما يبقى: الفواتير والمرتجعات كما هي — بنودها لقطة وقت البيع (الاسم والسعر والتكلفة)،
 * و`part_id` يصير فارغاً على الخادم (`on delete set null`)، فلا يتغيّر رقم في تقرير.
 * ما يُحذف معه: دفتر حركته (`on delete cascade`) — رصيده لا معنى له بلا منتج.
 * ما يمنعه: طلب توريد يحويه (`on delete restrict`) — يُسمّى السبب قبل الذهاب للخادم.
 *
 * `.select()` لا زخرفة: الحذف بلا صلاحية لا يُرجع خطأً تحت RLS بل صفر صفوف، فبدونه
 * يختفي المنتج من جهاز الموظف ويبقى في القاعدة (جُرِّب على Postgres بحساب موظف).
 */
export async function deletePart(id: string): Promise<void> {
  const orders = await db.purchaseOrders.toArray()
  if (orders.some((po) => po.lines.some((l) => l.partId === id))) {
    throw new Error('المنتج موجود في طلب توريد — احذف الطلب أولاً، أو أرشف المنتج بدل حذفه.')
  }
  if (cloudEnabled) {
    guardOnline()
    const { data, error } = await requireClient().from('parts').delete().eq('id', id).select('id')
    if (error) fail(error)
    if (!data?.length) throw new Error('ما عندك صلاحية لحذف المنتجات.')
  }
  await db.transaction('rw', db.parts, db.movements, async () => {
    await db.parts.delete(id)
    await db.movements.where('partId').equals(id).delete()
  })
}

export async function updatePart(id: string, patch: Partial<Part>): Promise<void> {
  if (!cloudEnabled) {
    await db.parts.update(id, { ...patch, updatedAt: Date.now() })
    return
  }
  guardOnline()
  const current = await db.parts.get(id)
  if (!current) throw new Error('المنتج غير موجود')
  const next: Part = { ...current, ...patch }
  const row = fromPart(next)
  // `qty` لا يُكتب أبداً: يُشتق من الدفتر. و`fromPart` يُسقطه أصلاً — هذا تذكير لا حماية.
  // `cost` كان يُسقط أيضاً بحجّة أنه يُحسب بالمتوسط المرجّح عند الاستلام، فكان تعديل
  // التكلفة من «التسعير» أو بطاقة المنتج يُحفظ ظاهرياً ولا يصل الخادم. يُكتب الآن حين
  // يُرسل صراحةً في `patch` فقط: من لا يرى التكلفة تصله `undefined` فلا يمحوها بصفر.
  if (patch.cost !== undefined) row.cost = patch.cost
  const { error } = await requireClient().from('parts').update(row).eq('id', id)
  if (error) fail(error)
  await refreshPart(id)
}

/**
 * الحقول التي يجوز تعديلها على عدّة منتجات دفعةً واحدة.
 *
 * ما ليس هنا مقصود إخراجه: `qty` يُشتقّ من دفتر الحركة، و`cost` يُحسب بالمتوسط
 * المرجّح، والأسعار لها شاشة التسعير بحساباتها.
 */
export interface BulkPartPatch {
  categoryId?: string
  supplierId?: string | null
  location?: string | null
  reorderPoint?: number
  reorderQty?: number
  leadTimeDays?: number
  archived?: boolean
}

/** تعديل عدّة منتجات في نداء واحد — لا حلقة على `updatePart`. */
export async function bulkUpdateParts(ids: string[], patch: BulkPartPatch): Promise<void> {
  if (!ids.length) return
  const now = Date.now()

  if (!cloudEnabled) {
    // `null` في الواجهة يعني «امسح القيمة»، وDexie يعبّر عنه بـ`undefined`.
    const local: Partial<Part> = { updatedAt: now }
    for (const [k, v] of Object.entries(patch)) {
      ;(local as Record<string, unknown>)[k] = v === null ? undefined : v
    }
    await db.transaction('rw', db.parts, async () => {
      for (const id of ids) await db.parts.update(id, local)
    })
    return
  }

  guardOnline()
  const row: Record<string, unknown> = { updated_at: new Date(now).toISOString() }
  if (patch.categoryId !== undefined) row.category_id = patch.categoryId || null
  if (patch.supplierId !== undefined) row.supplier_id = patch.supplierId || null
  if (patch.location !== undefined) row.location = patch.location?.trim() || null
  if (patch.reorderPoint !== undefined) row.reorder_point = patch.reorderPoint
  if (patch.reorderQty !== undefined) row.reorder_qty = Math.max(1, patch.reorderQty)
  if (patch.leadTimeDays !== undefined) row.lead_time_days = patch.leadTimeDays
  if (patch.archived !== undefined) row.archived = patch.archived

  const { error } = await requireClient().from('parts').update(row).in('id', ids)
  if (error) fail(error)
  await refreshParts(ids)
}

/* -------------------------------------------------------------------------- */
/* العملاء والموردون                                                           */
/* -------------------------------------------------------------------------- */

/**
 * العميل **مرجع** لفواتير مضت لا بيانات حسّاسة، فالجدول مقروء ومكتوب مباشرة
 * بصلاحية `sales.create`. والاسم ورقم الضريبة يُلتقطان لقطةً على الفاتورة وقت
 * البيع، فتعديل العميل لاحقاً لا يعيد كتابة فاتورة قديمة.
 */
export async function createCustomer(draft: Omit<Customer, 'id' | 'createdAt'>): Promise<Customer> {
  const customer: Customer = { ...draft, id: uid('cus_'), createdAt: Date.now() }
  if (cloudEnabled) {
    guardOnline()
    const { error } = await requireClient().from('customers').insert(fromCustomer(customer))
    if (error) fail(error)
  }
  await db.customers.put(customer)
  return customer
}

export async function updateCustomer(id: string, patch: Partial<Customer>): Promise<void> {
  if (!cloudEnabled) {
    await db.customers.update(id, patch)
    return
  }
  guardOnline()
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.phone !== undefined) row.phone = patch.phone || null
  if (patch.type !== undefined) row.type = patch.type
  if (patch.vatNumber !== undefined) row.vat_number = patch.vatNumber || null
  if (patch.notes !== undefined) row.notes = patch.notes || null
  const { error } = await requireClient().from('customers').update(row).eq('id', id)
  if (error) fail(error)
  await db.customers.update(id, patch)
}

/**
 * الحذف لا يمسّ الفواتير: `invoices.customer_id` معرّف بـ `on delete set null`،
 * والفاتورة تحتفظ باسم العميل كلقطة. التاريخ المالي يبقى ويُفقد الربط وحده.
 */
export async function deleteCustomer(id: string): Promise<void> {
  if (cloudEnabled) {
    guardOnline()
    const { error } = await requireClient().from('customers').delete().eq('id', id)
    if (error) fail(error)
  }
  await db.customers.delete(id)
}

export async function createSupplier(draft: Omit<Supplier, 'id'>): Promise<Supplier> {
  const supplier: Supplier = { ...draft, id: uid('sup_') }
  if (cloudEnabled) {
    guardOnline()
    const { error } = await requireClient().from('suppliers').insert(fromSupplier(supplier))
    if (error) fail(error)
  }
  await db.suppliers.put(supplier)
  return supplier
}

export async function updateSupplier(id: string, patch: Partial<Supplier>): Promise<void> {
  if (!cloudEnabled) {
    await db.suppliers.update(id, patch)
    return
  }
  guardOnline()
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.phone !== undefined) row.phone = patch.phone || null
  if (patch.city !== undefined) row.city = patch.city || null
  if (patch.leadTimeDays !== undefined) row.lead_time_days = patch.leadTimeDays
  if (patch.notes !== undefined) row.notes = patch.notes || null
  const { error } = await requireClient().from('suppliers').update(row).eq('id', id)
  if (error) fail(error)
  await db.suppliers.update(id, patch)
}

/** `on delete set null` على المنتجات، و`restrict` على طلبات التوريد المفتوحة. */
export async function deleteSupplier(id: string): Promise<void> {
  if (cloudEnabled) {
    guardOnline()
    const { error } = await requireClient().from('suppliers').delete().eq('id', id)
    if (error) fail(error)
  }
  await db.suppliers.delete(id)
}

/**
 * إنشاء تصنيف. كان غائباً تماماً: وضع العرض يزرع تصنيفاته، فلم يظهر النقص إلا على
 * القاعدة الحقيقية الفارغة — حيث يشترط نموذج المنتج تصنيفاً، فلا يُضاف أي منتج.
 */
export async function createCategory(name: string, defaultMarkupPercent = 50): Promise<Category> {
  const clean = name.trim()
  if (!clean) throw new Error('اكتب اسم التصنيف.')
  const existing = await db.categories.toArray()
  if (existing.some((c) => c.name.trim() === clean)) {
    throw new Error(`التصنيف «${clean}» موجود من قبل.`)
  }
  const category: Category = { id: uid('cat_'), name: clean, defaultMarkupPercent }
  if (cloudEnabled) {
    guardOnline()
    const { error } = await requireClient().from('categories').insert(fromCategory(category))
    if (error) fail(error)
  }
  await db.categories.put(category)
  return category
}

/**
 * حذف تصنيف لا يحذف منتجاته: القاعدة تضعها «بلا تصنيف» (`on delete set null`).
 * المرآة تُحدَّث هنا بنفس المعنى كي لا تُعرض منتجات تشير إلى تصنيف لم يعد موجوداً.
 */
export async function deleteCategory(id: string): Promise<void> {
  if (cloudEnabled) {
    guardOnline()
    const { error } = await requireClient().from('categories').delete().eq('id', id)
    if (error) fail(error)
  }
  await db.transaction('rw', db.categories, db.parts, async () => {
    await db.categories.delete(id)
    await db.parts.where('categoryId').equals(id).modify({ categoryId: '' })
  })
}

export async function updateCategory(id: string, patch: Partial<Category>): Promise<void> {
  if (!cloudEnabled) {
    await db.categories.update(id, patch)
    return
  }
  guardOnline()
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.defaultMarkupPercent !== undefined)
    row.default_markup_percent = patch.defaultMarkupPercent
  if (patch.icon !== undefined) row.icon = patch.icon
  const { error } = await requireClient().from('categories').update(row).eq('id', id)
  if (error) fail(error)
  await db.categories.update(id, patch)
}

/* -------------------------------------------------------------------------- */
/* طلبات التوريد                                                               */
/* -------------------------------------------------------------------------- */

/**
 * رقم الطلب في الوضع السحابي يُشتق من أكبر رقم موجود لا من عدّاد محلي.
 *
 * ليست ذرّية تامة — طلبان في نفس اللحظة قد يتنازعان — لكن قيد التفرّد على
 * `code` يرفض الثاني بخطأ ظاهر بدل أن يقبل رقمين متطابقين بصمت. وطلبات
 * التوريد تُنشأ مرات في الأسبوع لا مرات في الدقيقة.
 */
async function nextPoCode(): Promise<string> {
  const settings = await db.settings.get('app')
  const prefix = settings?.poPrefix ?? 'PO-'
  const { data, error } = await requireClient()
    .from('purchase_orders')
    .select('code')
    .like('code', `${prefix}%`)
    .order('code', { ascending: false })
    .limit(1)
  if (error) fail(error)
  const last = Array.isArray(data) && data[0] ? String((data[0] as { code: string }).code) : ''
  const n = Number(last.slice(prefix.length)) || 0
  return `${prefix}${String(n + 1).padStart(4, '0')}`
}

export async function createPurchaseOrder(
  order: Omit<PurchaseOrder, 'id' | 'code'> & { id?: string; code?: string },
): Promise<PurchaseOrder> {
  if (!cloudEnabled) {
    const full: PurchaseOrder = {
      ...order,
      id: order.id ?? uid('po_'),
      code: order.code ?? (await nextNumber('po')),
    }
    await db.purchaseOrders.add(full)
    return full
  }
  guardOnline()
  const full: PurchaseOrder = {
    ...order,
    id: order.id ?? uid('po_'),
    code: order.code ?? (await nextPoCode()),
  }
  const client = requireClient()
  const head = await client.from('purchase_orders').insert(fromPurchaseOrder(full))
  if (head.error) fail(head.error)
  if (full.lines.length) {
    const lines = await client
      .from('purchase_order_lines')
      .insert(full.lines.map((l) => fromPurchaseOrderLine(full.id, l)))
    if (lines.error) fail(lines.error)
  }
  await db.purchaseOrders.put(full)
  return full
}

export async function updatePurchaseOrder(
  id: string,
  patch: Partial<PurchaseOrder>,
): Promise<void> {
  if (!cloudEnabled) {
    await db.purchaseOrders.update(id, patch)
    return
  }
  guardOnline()
  const row: Record<string, unknown> = {}
  if (patch.status !== undefined) row.status = patch.status
  if (patch.notes !== undefined) row.notes = patch.notes ?? null
  if (patch.customerId !== undefined) row.customer_id = patch.customerId || null
  if (patch.expectedAt !== undefined) {
    row.expected_at = patch.expectedAt ? new Date(patch.expectedAt).toISOString() : null
  }
  const { error } = await requireClient().from('purchase_orders').update(row).eq('id', id)
  if (error) fail(error)
  await db.purchaseOrders.update(id, patch)
}

/**
 * الاستلام عبر `receive_purchase()`: تحرّك المخزون وتحدّث حالة الطلب في عملية
 * واحدة. محلياً تُنفَّذ الخطوات نفسها على المرآة.
 */
export async function receivePurchase(
  poId: string,
  lines: { partId: string; qty: number }[],
  user: User,
): Promise<PurchaseOrder['status']> {
  if (!cloudEnabled) {
    const po = await db.purchaseOrders.get(poId)
    if (!po) throw new Error('طلب التوريد غير موجود')
    const next = po.lines.map((l) => ({ ...l }))
    for (const r of lines) {
      const line = next.find((l) => l.partId === r.partId)
      if (!line) continue
      const accept = Math.min(r.qty, line.qty - line.receivedQty)
      if (accept <= 0) continue
      await applyMovementLocal({
        partId: line.partId,
        qty: accept,
        type: 'purchase',
        unitCost: line.unitCost,
        userId: user.id,
        ref: po.code,
      })
      line.receivedQty += accept
    }
    const status: PurchaseOrder['status'] = next.every((l) => l.receivedQty >= l.qty)
      ? 'received'
      : 'partial'
    await db.purchaseOrders.update(poId, {
      lines: next,
      status,
      receivedAt: status === 'received' ? Date.now() : undefined,
    })
    return status
  }

  guardOnline()
  const client = requireClient()
  const { data, error } = await client.rpc('receive_purchase', {
    p_po_id: poId,
    p_lines: lines.map((l) => ({ part_id: l.partId, qty: l.qty })),
  })
  if (error) fail(error)
  await Promise.all(lines.map((l) => refreshPart(l.partId)))

  // الطلب يُعاد سحبه لا يُحدَّث حسابياً هنا: الخادم هو من قرّر الكميات المقبولة
  // وحالة الطلب، وإعادة حسابها في الواجهة تعني رقمين قد يختلفان.
  const fresh = await client
    .from('purchase_orders')
    .select('*, purchase_order_lines(*)')
    .eq('id', poId)
    .maybeSingle()
  if (fresh.error) fail(fresh.error)
  if (fresh.data) {
    const previous = await db.purchaseOrders.get(poId)
    await db.purchaseOrders.put(toPurchaseOrder(fresh.data as Record<string, unknown>, previous))
  }
  return String(data) as PurchaseOrder['status']
}

/* -------------------------------------------------------------------------- */
/* الإعدادات                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * إعدادات المحل تُكتب على الخادم لا في المرآة وحدها: أي تعديل محلي يُدهس عند
 * أول `pullAll`، و`create_sale()` تقرأ نسبة الضريبة والبادئات من صفّ الخادم.
 * والمحلية تبقى محلية: المظهر تفضيل جهاز، ومفتاح الذكاء الاصطناعي سرّ، والعدّادات
 * يحجزها الخادم — انظر `toSettings` في `rows.ts`.
 */
export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = await saveSettingsLocal(patch)
  if (!cloudEnabled) return next

  const serverKeys: (keyof Settings)[] = [
    'shopName',
    'shopNameEn',
    'vatNumber',
    'crNumber',
    'address',
    'phone',
    'currency',
    'vatRate',
    'vatEnabled',
    'zatcaQr',
    'invoicePrefix',
    'poPrefix',
    'returnPrefix',
    'aiProvider',
    'aiModel',
  ]
  if (!serverKeys.some((k) => k in patch)) return next // المظهر وحده مثلاً — لا داعي لجولة شبكة

  guardOnline()
  const row = fromSettings(next)
  delete row.id // المفتاح في الشرط لا في القيم
  const { error } = await requireClient().from('settings').update(row).eq('id', 'app')
  if (error) fail(error)
  return next
}

/* -------------------------------------------------------------------------- */
/* سجل التدقيق                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * القيد لا يُفشل العملية التي يوثّقها: فشل كتابة سجل التدقيق لا يصحّ أن يلغي
 * بيعة تمّت على الخادم فعلاً. يُبتلع الخطأ ويُسجَّل في الطرفية — وهذا
 * الاستثناء الوحيد لقاعدة «لا تبتلع خطأً».
 */
/* -------------------------------------------------------------------------- */
/* فواتير المشتريات (مكونات، تغليف، أدوات، مصاريف)                             */
/* -------------------------------------------------------------------------- */

export async function createPurchaseItem(
  draft: Omit<PurchaseItem, 'id' | 'createdAt' | 'archived'>,
): Promise<PurchaseItem> {
  const item: PurchaseItem = {
    ...draft,
    name: draft.name.trim(),
    kind: draft.kind.trim(),
    unit: draft.unit.trim() || 'حبة',
    id: uid('pi_'),
    archived: false,
    createdAt: Date.now(),
  }
  if (!item.name) throw new Error('اكتب اسم البند الفرعي.')
  if (!item.kind) throw new Error('اختر البند الرئيسي أو اكتب اسماً جديداً.')
  const all = await db.purchaseItems.toArray()
  // الخادم يرفض التكرار بفهرس فريد، لكن رسالته عامة؛ هنا تُسمّى المشكلة باسمها.
  if (all.some((x) => x.name.trim().toLowerCase() === item.name.toLowerCase())) {
    throw new Error(`الصنف «${item.name}» موجود من قبل — اختره من القائمة.`)
  }
  if (cloudEnabled) {
    guardOnline()
    const { error } = await requireClient().from('purchase_items').insert(fromPurchaseItem(item))
    if (error) fail(error)
  }
  await db.purchaseItems.put(item)
  return item
}

export async function updatePurchaseItem(id: string, patch: Partial<PurchaseItem>): Promise<void> {
  if (cloudEnabled) {
    guardOnline()
    const row: Record<string, unknown> = {}
    if (patch.name !== undefined) row.name = patch.name.trim()
    if (patch.kind !== undefined) row.kind = patch.kind.trim()
    if (patch.unit !== undefined) row.unit = patch.unit.trim()
    if (patch.notes !== undefined) row.notes = patch.notes || null
    if (patch.archived !== undefined) row.archived = patch.archived
    const { error } = await requireClient().from('purchase_items').update(row).eq('id', id)
    if (error) fail(error)
  }
  await db.purchaseItems.update(id, patch)
}

/**
 * إعادة تسمية بند رئيسي = تغيير `kind` على كل أصنافه. الفواتير السابقة لا تتغيّر:
 * بنودها لقطة وقت الشراء، فتبقى باسمها القديم في تقارير أشهرها.
 *
 * المفاتيح القديمة (`expense`…) تُشمل: مرآة لم تُسحب بعد الترحيل قد تحملها.
 */
export async function renamePurchaseGroup(from: string, to: string): Promise<void> {
  const name = to.trim()
  if (!name) throw new Error('اكتب اسم البند الرئيسي.')
  if (name === from) return
  const variants = [from, ...legacyKeysOf(from)]
  if (cloudEnabled) {
    guardOnline()
    const { error } = await requireClient()
      .from('purchase_items')
      .update({ kind: name })
      .in('kind', variants)
    if (error) fail(error)
  }
  await db.purchaseItems.where('kind').anyOf(variants).modify({ kind: name })
}

export interface PurchaseBillInput {
  supplierId?: string
  purchasedAt: number
  ref?: string
  notes?: string
  lines: Array<{ itemId: string; qty: number; unitPrice: number; unit?: string }>
}

/**
 * الخادم يحسب الإجمالي ويلتقط اسم الصنف ونوعه — لا يُرسل المتصفح مجموعاً.
 * محلياً تُطبَّق نفس المعادلة: تقريب كل بند ثم الجمع، كما يُطبع على الفاتورة.
 */
export async function createPurchaseBill(input: PurchaseBillInput): Promise<PurchaseBill> {
  if (input.lines.length === 0) throw new Error('أضف بنداً واحداً على الأقل.')
  for (const l of input.lines) {
    if (!(l.qty > 0)) throw new Error('الكمية في كل بند يجب أن تكون أكبر من صفر.')
    if (!(l.unitPrice >= 0)) throw new Error('السعر في كل بند يجب ألّا يكون سالباً.')
  }

  if (!cloudEnabled) {
    const items = new Map((await db.purchaseItems.toArray()).map((x) => [x.id, x]))
    const supplier = input.supplierId ? await db.suppliers.get(input.supplierId) : undefined
    const lines = input.lines.map((l) => {
      const item = items.get(l.itemId)
      if (!item) throw new Error('أحد الأصناف في الفاتورة غير موجود.')
      return {
        itemId: item.id,
        name: item.name,
        kind: item.kind,
        unit: l.unit?.trim() || item.unit,
        qty: l.qty,
        unitPrice: l.unitPrice,
      }
    })
    const bill: PurchaseBill = {
      id: uid('pb_'),
      supplierId: supplier?.id,
      supplierName: supplier?.name,
      ref: input.ref?.trim() || undefined,
      purchasedAt: input.purchasedAt,
      total: round2(lines.reduce((n, l) => n + round2(l.qty * l.unitPrice), 0)),
      notes: input.notes?.trim() || undefined,
      createdAt: Date.now(),
      lines,
    }
    await db.purchaseBills.put(bill)
    return bill
  }

  guardOnline()
  const client = requireClient()
  const { data, error } = await client.rpc('create_purchase_bill', {
    p_supplier_id: input.supplierId ?? null,
    p_purchased_at: new Date(input.purchasedAt).toISOString(),
    p_ref: input.ref ?? null,
    p_notes: input.notes ?? null,
    p_lines: input.lines.map((l) => ({
      item_id: l.itemId,
      qty: l.qty,
      unit_price: l.unitPrice,
      unit: l.unit ?? null,
    })),
  })
  if (error) fail(error)
  // الدالة تُرجع رأس الفاتورة وحده؛ البنود بلقطاتها تُقرأ من الخادم لا تُخمَّن.
  const { data: full, error: readErr } = await client
    .from('purchase_bills')
    .select('*, purchase_bill_lines(*)')
    .eq('id', (data as { id: string }).id)
    .single()
  if (readErr) fail(readErr)
  const bill = toPurchaseBill(full as Record<string, unknown>)
  await db.purchaseBills.put(bill)
  return bill
}

/**
 * تعديل مصروف = مصروف جديد بالبيانات المعدّلة ثم حذف القديم. لا سياسة تعديل على
 * `purchase_bills` عمداً (انظر `deletePurchaseBill`)، ودالة تعديل ذرّية على الخادم
 * تعديلٌ لدوال القاعدة يحتاج استشارة — فيُبنى التعديل من الدالتين القائمتين.
 *
 * الجديد أولاً: إن فشل حذف القديم بعده يبقى المصروفان ظاهرين ويُحذف أحدهما يدوياً؛
 * أما الحذف أولاً ففشل الإنشاء بعده يُضيع المصروف كله. `oldRemoved` يخبر الشاشة.
 */
export async function replacePurchaseBill(
  oldId: string,
  input: PurchaseBillInput,
): Promise<{ bill: PurchaseBill; oldRemoved: boolean }> {
  const bill = await createPurchaseBill(input)
  try {
    await deletePurchaseBill(oldId)
    return { bill, oldRemoved: true }
  } catch (err) {
    console.error('تعذّر حذف المصروف القديم بعد تعديله:', err)
    return { bill, oldRemoved: false }
  }
}

/** التصحيح حذفٌ ثم إعادة إدخال — لا تعديل صامت لبنود فاتورة محفوظة. */
export async function deletePurchaseBill(id: string): Promise<void> {
  if (cloudEnabled) {
    guardOnline()
    const { error } = await requireClient().from('purchase_bills').delete().eq('id', id)
    if (error) fail(error)
  }
  await db.purchaseBills.delete(id)
}

export async function audit(
  user: User,
  action: string,
  entity: string,
  entityId?: string,
  details?: string,
): Promise<void> {
  if (!cloudEnabled) return logAudit(user, action, entity, entityId, details)
  try {
    const { error } = await requireClient()
      .from('audit_log')
      .insert(
        fromAuditEntry({
          // `id` محلي فقط: العمود على الخادم `generated always as identity`.
          id: uid('aud_'),
          userId: user.id,
          userName: user.name,
          action,
          entity,
          entityId,
          details,
          at: Date.now(),
        }),
      )
    if (error) throw error
  } catch (err) {
    console.warn('تعذّر تسجيل قيد التدقيق:', err)
  }
}

function fromSupplier(v: Supplier): Record<string, unknown> {
  return {
    id: v.id,
    name: v.name,
    phone: v.phone ?? null,
    city: v.city ?? null,
    lead_time_days: v.leadTimeDays,
    notes: v.notes ?? null,
  }
}
