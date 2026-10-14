import { groupName } from './expenseGroups'
import { dayKey, round2, startOfDay } from './format'
import type {
  Invoice,
  InvoiceLine,
  Part,
  PurchaseBill,
  PurchaseKind,
  PurchaseOrder,
  ReorderSuggestion,
  ReturnNote,
  StockMovement,
} from './types'

export interface PeriodSummary {
  /** المبيعات بدون ضريبة بعد خصم المرتجعات. */
  revenue: number
  /** تكلفة ما خرج فعلاً (المحاسَب + العينات) ناقص ما عاد إلى الرفّ. */
  cost: number
  profit: number
  vat: number
  invoices: number
  /** البوكسات المحاسَبة. */
  units: number
  /** بوكسات خرجت عينةً — تكلفة بلا إيراد. */
  freeUnits: number
  /** تكلفة العينات وحدها، لتظهر رقماً مستقلاً لصاحب المحل. */
  freeCost: number
  /** قيمة المرتجعات بدون ضريبة خلال الفترة. */
  returned: number
  returnedUnits: number
  averageTicket: number
  marginPercent: number
}

const EMPTY: PeriodSummary = {
  revenue: 0,
  cost: 0,
  profit: 0,
  vat: 0,
  invoices: 0,
  units: 0,
  freeUnits: 0,
  freeCost: 0,
  returned: 0,
  returnedUnits: 0,
  averageTicket: 0,
  marginPercent: 0,
}

export function isCounted(inv: Invoice): boolean {
  return inv.status !== 'refunded'
}

/** صافي الفاتورة بدون ضريبة — ما يُعدّ إيراداً فعلاً. */
export const invoiceNet = (inv: Invoice): number => inv.subtotal - inv.discount

/**
 * صافي سعر الوحدة بعد حصة البند من خصم الفاتورة — نفس معادلة `create_sale`
 * على الخادم: الخصم كله يُوزَّع على البنود بالتناسب مع قيمتها.
 * هذا ما يُردّ للزبون عن كل بوكس يرجعه، قبل الضريبة.
 */
export function returnUnitPrice(inv: Invoice, line: InvoiceLine): number {
  if (inv.subtotal <= 0) return line.unitPrice
  return round2(line.unitPrice * (1 - inv.discount / inv.subtotal))
}

/** كم رُجع من كل بند في فاتورة — المفتاح معرّف المنتج. */
export function returnedByPart(invoiceId: string, returns: ReturnNote[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of returns) {
    if (r.invoiceId !== invoiceId) continue
    for (const l of r.lines) out.set(l.partId, (out.get(l.partId) ?? 0) + l.qty)
  }
  return out
}

export function summarize(
  invoices: Invoice[],
  returns: ReturnNote[],
  from: number,
  to: number,
): PeriodSummary {
  const rows = invoices.filter((i) => i.createdAt >= from && i.createdAt <= to && isCounted(i))
  const rets = returns.filter((r) => r.createdAt >= from && r.createdAt <= to)
  if (rows.length === 0 && rets.length === 0) return { ...EMPTY }

  let revenue = 0
  let cost = 0
  let vat = 0
  let units = 0
  let freeUnits = 0
  let freeCost = 0

  for (const inv of rows) {
    // الإيراد بدون ضريبة — الضريبة تُحصَّل لا تُكسب.
    revenue += invoiceNet(inv)
    vat += inv.vatAmount
    for (const line of inv.lines) {
      cost += line.unitCost * (line.qty + line.freeQty)
      units += line.qty
      freeUnits += line.freeQty
      freeCost += line.unitCost * line.freeQty
    }
  }

  // المرتجع يُخصم في فترة حدوثه لا فترة الفاتورة الأصل: صاحب المحل يسأل
  // «كم رجع عليّ هذا الشهر»، لا «كم كانت فاتورة الشهر الماضي بعد التعديل».
  let returned = 0
  let returnedUnits = 0
  for (const r of rets) {
    returned += r.subtotal
    vat -= r.vatAmount
    for (const l of r.lines) {
      returnedUnits += l.qty
      // ما عاد إلى الرفّ تعود تكلفته؛ ما انتهت صلاحيته خسارة تبقى في التكلفة.
      if (r.restock) cost -= l.unitCost * l.qty
    }
  }

  revenue = round2(revenue - returned)
  cost = round2(cost)
  const profit = round2(revenue - cost)

  return {
    revenue,
    cost,
    profit,
    vat: round2(vat),
    invoices: rows.length,
    units,
    freeUnits,
    freeCost: round2(freeCost),
    returned: round2(returned),
    returnedUnits,
    averageTicket: rows.length ? round2(revenue / rows.length) : 0,
    marginPercent: revenue ? round2((profit / revenue) * 100) : 0,
  }
}

export interface DayPoint {
  key: string
  ts: number
  revenue: number
  profit: number
  invoices: number
}

export function dailySeries(
  invoices: Invoice[],
  returns: ReturnNote[],
  from: number,
  to: number,
): DayPoint[] {
  const buckets = new Map<string, DayPoint>()
  for (let ts = startOfDay(new Date(from)); ts <= to; ts += 86_400_000) {
    buckets.set(dayKey(ts), { key: dayKey(ts), ts, revenue: 0, profit: 0, invoices: 0 })
  }
  for (const inv of invoices) {
    if (inv.createdAt < from || inv.createdAt > to || !isCounted(inv)) continue
    const b = buckets.get(dayKey(inv.createdAt))
    if (!b) continue
    const rev = invoiceNet(inv)
    const cost = inv.lines.reduce((n, l) => n + l.unitCost * (l.qty + l.freeQty), 0)
    b.revenue = round2(b.revenue + rev)
    b.profit = round2(b.profit + rev - cost)
    b.invoices += 1
  }
  for (const r of returns) {
    if (r.createdAt < from || r.createdAt > to) continue
    const b = buckets.get(dayKey(r.createdAt))
    if (!b) continue
    const backCost = r.restock ? r.lines.reduce((n, l) => n + l.unitCost * l.qty, 0) : 0
    b.revenue = round2(b.revenue - r.subtotal)
    b.profit = round2(b.profit - r.subtotal + backCost)
  }
  return [...buckets.values()].sort((a, b) => a.ts - b.ts)
}

export interface PartPerformance {
  partId: string
  name: string
  sku: string
  units: number
  freeUnits: number
  revenue: number
  profit: number
}

export function topParts(
  invoices: Invoice[],
  returns: ReturnNote[],
  from: number,
  to: number,
  limit = 8,
): PartPerformance[] {
  const map = new Map<string, PartPerformance>()
  const rowFor = (partId: string, name: string, sku: string) =>
    map.get(partId) ?? { partId, name, sku, units: 0, freeUnits: 0, revenue: 0, profit: 0 }

  for (const inv of invoices) {
    if (inv.createdAt < from || inv.createdAt > to || !isCounted(inv)) continue
    for (const line of inv.lines) {
      const row = rowFor(line.partId, line.name, line.sku)
      const rev = line.unitPrice * line.qty - line.discount
      row.units += line.qty
      row.freeUnits += line.freeQty
      row.revenue = round2(row.revenue + rev)
      row.profit = round2(row.profit + rev - line.unitCost * (line.qty + line.freeQty))
      map.set(line.partId, row)
    }
  }
  for (const r of returns) {
    if (r.createdAt < from || r.createdAt > to) continue
    for (const l of r.lines) {
      const row = rowFor(l.partId, l.name, l.sku)
      const rev = l.unitPrice * l.qty
      row.units -= l.qty
      row.revenue = round2(row.revenue - rev)
      row.profit = round2(row.profit - rev + (r.restock ? l.unitCost * l.qty : 0))
      map.set(l.partId, row)
    }
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, limit)
}

export interface CustomerPerformance {
  customerId: string
  name: string
  invoices: number
  units: number
  freeUnits: number
  /** المبيعات بدون ضريبة قبل المرتجعات. */
  gross: number
  returned: number
  returnedUnits: number
  /** ما يُطالَب به فعلاً: الصافي بعد المرتجعات، بدون ضريبة. */
  net: number
  /** الإجمالي بالضريبة بعد المرتجعات — الرقم الذي يراه الزبون على ورقته. */
  totalWithVat: number
  profit: number
  unpaid: number
}

/**
 * «كم بعت على كل محل هذا الشهر» — سؤال العميل الأول. يُحسب من الفواتير
 * والمرتجعات في الفترة؛ البيع النقدي بلا زبون يُجمع تحت صفّ واحد.
 */
export function byCustomer(
  invoices: Invoice[],
  returns: ReturnNote[],
  from: number,
  to: number,
): CustomerPerformance[] {
  const map = new Map<string, CustomerPerformance>()
  const rowFor = (id: string | undefined, name: string | undefined) => {
    const key = id ?? '__cash'
    return (
      map.get(key) ?? {
        customerId: key,
        name: id ? (name ?? 'زبون محذوف') : 'بيع نقدي بلا اسم',
        invoices: 0,
        units: 0,
        freeUnits: 0,
        gross: 0,
        returned: 0,
        returnedUnits: 0,
        net: 0,
        totalWithVat: 0,
        profit: 0,
        unpaid: 0,
      }
    )
  }

  for (const inv of invoices) {
    if (inv.createdAt < from || inv.createdAt > to || !isCounted(inv)) continue
    const row = rowFor(inv.customerId, inv.customerName)
    const net = invoiceNet(inv)
    row.invoices += 1
    row.gross = round2(row.gross + net)
    row.totalWithVat = round2(row.totalWithVat + inv.total)
    // الحالة لا طريقة الدفع: الآجل الذي سُدّد لاحقاً لم يعد دَيناً.
    if (inv.status === 'unpaid') row.unpaid = round2(row.unpaid + inv.total)
    for (const l of inv.lines) {
      row.units += l.qty
      row.freeUnits += l.freeQty
      row.profit = round2(row.profit - l.unitCost * (l.qty + l.freeQty))
    }
    row.profit = round2(row.profit + net)
    map.set(row.customerId, row)
  }
  for (const r of returns) {
    if (r.createdAt < from || r.createdAt > to) continue
    const row = rowFor(r.customerId, r.customerName)
    row.returned = round2(row.returned + r.subtotal)
    row.totalWithVat = round2(row.totalWithVat - r.total)
    row.profit = round2(row.profit - r.subtotal)
    for (const l of r.lines) {
      row.returnedUnits += l.qty
      if (r.restock) row.profit = round2(row.profit + l.unitCost * l.qty)
    }
    map.set(row.customerId, row)
  }
  for (const row of map.values()) row.net = round2(row.gross - row.returned)
  return [...map.values()].sort((a, b) => b.net - a.net)
}

/** وحدات مباعة يومياً لمنتج، من دفتر الحركة. */
export function velocity(movements: StockMovement[], partId: string, days: number): number {
  const since = Date.now() - days * 86_400_000
  let sold = 0
  for (const m of movements) {
    if (m.partId !== partId || m.type !== 'sale' || m.at < since) continue
    sold += Math.abs(m.qty)
  }
  return sold / days
}

export function reorderSuggestions(
  parts: Part[],
  movements: StockMovement[],
  purchaseOrders: PurchaseOrder[],
  windowDays = 30,
): ReorderSuggestion[] {
  const since = Date.now() - windowDays * 86_400_000

  // مرور واحد على الدفتر بدل مرور لكل منتج.
  const soldByPart = new Map<string, number>()
  for (const m of movements) {
    if (m.type !== 'sale' || m.at < since) continue
    soldByPart.set(m.partId, (soldByPart.get(m.partId) ?? 0) + Math.abs(m.qty))
  }

  const onOrder = new Map<string, number>()
  for (const po of purchaseOrders) {
    if (po.status !== 'ordered' && po.status !== 'partial') continue
    for (const line of po.lines) {
      const pending = Math.max(0, line.qty - line.receivedQty)
      if (pending > 0) onOrder.set(line.partId, (onOrder.get(line.partId) ?? 0) + pending)
    }
  }

  const out: ReorderSuggestion[] = []
  for (const part of parts) {
    if (part.archived) continue
    // حدّ صفر = «بدون حد» (خيار في نموذج المنتج): بوكس يُصنع حسب الطلب لا يُنبَّه
    // عليه حتى لو نفد. كل تنبيهات النقص تمرّ من هنا — اللوحة والشارة والتوريد والمحاسب.
    if (part.reorderPoint <= 0) continue
    const pending = onOrder.get(part.id) ?? 0
    const effectiveQty = part.qty + pending
    if (effectiveQty > part.reorderPoint) continue

    const v = (soldByPart.get(part.id) ?? 0) / windowDays
    const daysOfCover = v > 0 ? effectiveQty / v : effectiveQty > 0 ? Infinity : 0

    // تغطية مدة التجهيز زائد أسبوعين احتياطاً، ولا أقل من كمية الإنتاج المعتادة.
    const target = Math.ceil(v * (part.leadTimeDays + 14))
    const suggestedQty = Math.max(part.reorderQty, target - effectiveQty, 1)

    const severity: ReorderSuggestion['severity'] =
      part.qty <= 0 ? 'out' : effectiveQty <= part.reorderPoint / 2 ? 'critical' : 'low'

    out.push({
      part,
      velocity: round2(v),
      daysOfCover,
      suggestedQty,
      severity,
      onOrderQty: pending,
    })
  }

  const rank = { out: 0, critical: 1, low: 2 }
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.daysOfCover - b.daysOfCover)
}

export interface DeadStockRow {
  part: Part
  lastSoldAt?: number
  tiedCapital: number
}

/**
 * نافذة الركود أقصر من محل قطع الغيار: الحلويات لها صلاحية، وبوكس ما تحرّك
 * ثلاثة أسابيع مشكلة لا ملاحظة.
 */
export function deadStock(parts: Part[], movements: StockMovement[], days = 21): DeadStockRow[] {
  const lastSale = new Map<string, number>()
  for (const m of movements) {
    if (m.type !== 'sale') continue
    const prev = lastSale.get(m.partId) ?? 0
    if (m.at > prev) lastSale.set(m.partId, m.at)
  }
  const cutoff = Date.now() - days * 86_400_000
  return parts
    .filter((p) => !p.archived && p.qty > 0 && (lastSale.get(p.id) ?? 0) < cutoff)
    .map((p) => ({ part: p, lastSoldAt: lastSale.get(p.id), tiedCapital: round2(p.qty * p.cost) }))
    .sort((a, b) => b.tiedCapital - a.tiedCapital)
}

export function inventoryValue(parts: Part[]): { cost: number; retail: number; units: number } {
  let cost = 0
  let retail = 0
  let units = 0
  for (const p of parts) {
    if (p.archived) continue
    cost += p.qty * p.cost
    retail += p.qty * p.priceRetail
    units += p.qty
  }
  return { cost: round2(cost), retail: round2(retail), units }
}

export function changePercent(current: number, previous: number): number | null {
  if (!previous) return current ? null : 0
  return round2(((current - previous) / Math.abs(previous)) * 100)
}

/* -------------------------------------------------------------------------- */
/* المشتريات                                                                   */
/* -------------------------------------------------------------------------- */

export interface PurchasesSummary {
  total: number
  bills: number
  /** البنود الرئيسية مرتّبة بما صُرف عليها — أسماء حرّة، فلا قائمة ثابتة تُملأ أصفاراً. */
  byKind: Array<{ kind: PurchaseKind; total: number }>
  /** الأصناف مرتّبة بما صُرف عليها — أين يذهب المال فعلاً. */
  items: Array<{ name: string; kind: PurchaseKind; unit: string; qty: number; total: number }>
}

/**
 * ما صُرف في الفترة `[from, to)` حسب تاريخ الشراء لا تاريخ الإدخال: فاتورة الأحد
 * تُدخل يوم الثلاثاء تُحسب يوم الأحد.
 *
 * ⚠️ هذا صرف نقدي لا تكلفة بضاعة مباعة: كرتون اشتُري اليوم قد يُستهلك بعد شهر،
 * والفرن يخدم سنوات. لذلك لا يُطرح من «الربح» في التقارير — يُعرض بجانبه.
 */
export function purchasesSummary(
  bills: PurchaseBill[],
  from: number,
  to: number,
): PurchasesSummary {
  const byKind = new Map<string, number>()
  const items = new Map<string, PurchasesSummary['items'][number]>()
  let total = 0
  let count = 0
  for (const bill of bills) {
    if (bill.purchasedAt < from || bill.purchasedAt >= to) continue
    count++
    total += bill.total
    for (const l of bill.lines) {
      const amount = round2(l.qty * l.unitPrice)
      // البند الرئيسي من لقطة الفاتورة لا من الصنف الحالي: إعادة تسمية البند لاحقاً
      // لا تنقل صرف الأشهر الماضية — نفس قاعدة لقطات وقت البيع.
      const group = groupName(l.kind)
      byKind.set(group, (byKind.get(group) ?? 0) + amount)
      // التجميع بالاسم والوحدة معاً: «قشطة بالعلبة» و«قشطة بالكرتون» لا تُجمع كمياتهما.
      const key = `${l.name}\u0000${l.unit}`
      const row = items.get(key) ?? { name: l.name, kind: group, unit: l.unit, qty: 0, total: 0 }
      row.qty += l.qty
      row.total = round2(row.total + amount)
      items.set(key, row)
    }
  }
  return {
    total: round2(total),
    bills: count,
    byKind: [...byKind.entries()]
      .map(([kind, v]) => ({ kind, total: round2(v) }))
      .sort((a, z) => z.total - a.total || a.kind.localeCompare(z.kind, 'ar')),
    items: [...items.values()].sort((a, z) => z.total - a.total),
  }
}
