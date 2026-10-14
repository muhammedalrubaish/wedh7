import { useMemo, useState } from 'react'
import { CheckCircle2, PackageCheck, Plus, Truck, X } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Tabs,
  Textarea,
  cn,
  useToast,
} from '@/components/ui'
import { audit, createPurchaseOrder, receivePurchase, updatePurchaseOrder } from '@/lib/repo'
import { date, money, num, relative } from '@/lib/format'
import { reorderSuggestions } from '@/lib/analytics'
import { useApp } from '@/store/app'
import {
  useActiveParts,
  useCustomers,
  useMovements,
  usePurchaseOrders,
  useSuppliers,
} from '@/hooks/useShopData'
import type { Part, PurchaseOrder, PurchaseOrderStatus } from '@/lib/types'

const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  draft: 'مسودة',
  ordered: 'مطلوب',
  partial: 'استلام جزئي',
  received: 'مستلم',
  cancelled: 'ملغي',
}

const STATUS_TONE: Record<PurchaseOrderStatus, 'neutral' | 'brand' | 'warn' | 'ok' | 'danger'> = {
  draft: 'neutral',
  ordered: 'brand',
  partial: 'warn',
  received: 'ok',
  cancelled: 'danger',
}

export default function Purchases() {
  const { can } = useApp()

  const orders = usePurchaseOrders()
  const parts = useActiveParts()
  const suppliers = useSuppliers()
  const customers = useCustomers()
  const movements = useMovements()

  const [filter, setFilter] = useState<'open' | 'all' | PurchaseOrderStatus>('open')
  const [openOrder, setOpenOrder] = useState<PurchaseOrder | null>(null)
  const [creating, setCreating] = useState(false)

  const partById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts])
  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers])
  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers])

  const suggestions = useMemo(
    () => reorderSuggestions(parts, movements, orders),
    [parts, movements, orders],
  )

  const rows = useMemo(() => {
    const list = [...orders].sort((a, b) => b.createdAt - a.createdAt)
    if (filter === 'all') return list
    if (filter === 'open')
      return list.filter(
        (o) => o.status === 'draft' || o.status === 'ordered' || o.status === 'partial',
      )
    return list.filter((o) => o.status === filter)
  }, [orders, filter])

  const orderTotal = (o: PurchaseOrder) => o.lines.reduce((n, l) => n + l.qty * l.unitCost, 0)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">طلبات التوريد</h1>
        <p className="mt-0.5 text-sm text-muted">
          {suggestions.length > 0
            ? `${suggestions.length} صنف تحت حدّ التنبيه`
            : 'كل الأصناف فوق حدّ التنبيه'}
        </p>
      </div>

      {/* الحالات و«طلب جديد» في سطر واحد بطلب العميل. على الجوال لا يتسع الزر بنصّه
          بجانب خمس حالات، فيصير أيقونة والاسم في `aria-label`؛ ويعود النص من sm. */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        <Tabs
          value={filter}
          onChange={setFilter}
          className="min-w-0 flex-1 justify-between gap-0 [&>button]:px-1.5 [&>button]:text-[12px] [&>button]:whitespace-nowrap sm:flex-none sm:gap-1 sm:[&>button]:px-3 sm:[&>button]:text-[13px]"
          items={[
            { value: 'open', label: 'المفتوحة' },
            { value: 'draft', label: 'مسودات' },
            { value: 'ordered', label: 'مطلوبة' },
            { value: 'received', label: 'مستلمة' },
            { value: 'all', label: 'الكل' },
          ]}
        />
        {/* «طلب مقترح» أُخفي بطلب العميل: أيقونته وحدها لا تقول ما تفعل. التنبيه نفسه
            باقٍ في اللوحة وفي سطر «صنف تحت حدّ التنبيه» أعلاه. */}
        {can('purchase.edit') && (
          <Button
            variant="primary"
            className="shrink-0 max-sm:h-9 max-sm:w-9 max-sm:justify-center max-sm:px-0 sm:ms-auto"
            onClick={() => setCreating(true)}
            aria-label="طلب جديد"
            title="طلب جديد"
          >
            <Plus className="size-4" />
            <span className="hidden sm:inline">طلب جديد</span>
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={<Truck className="size-6" />} title="لا توجد طلبات في هذا التصنيف" />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((o) => {
            const received = o.lines.reduce((n, l) => n + l.receivedQty, 0)
            const ordered = o.lines.reduce((n, l) => n + l.qty, 0)
            return (
              <button
                key={o.id}
                onClick={() => setOpenOrder(o)}
                className="lift rounded-card border border-border bg-surface p-4 text-right transition-colors hover:border-brand"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="tnum font-semibold text-brand-strong">{o.code}</p>
                    <p className="mt-0.5 text-[13px] text-muted">
                      {supplierById.get(o.supplierId)?.name ?? '—'}
                    </p>
                    {/* طلب زبون يُميَّز في القائمة نفسها: من يفتح الشاشة يريد
                        أن يعرف بلمحة أيّ الطلبات ينتظرها زبون على الباب. */}
                    {o.customerId && (
                      <p className="mt-1 text-[12px] font-medium text-brand-strong">
                        لزبون: {customerById.get(o.customerId)?.name ?? 'محذوف'}
                      </p>
                    )}
                  </div>
                  <Badge tone={STATUS_TONE[o.status]} dot>
                    {STATUS_LABELS[o.status]}
                  </Badge>
                </div>

                <div className="tnum mt-3 flex items-end justify-between text-[13px]">
                  <span className="text-muted">
                    {o.lines.length} صنف · {received}/{ordered} وحدة
                  </span>
                  <span className="font-semibold">{money(orderTotal(o))}</span>
                </div>

                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className={cn(
                      'h-full rounded-full transition-[width] duration-500',
                      o.status === 'received' ? 'bg-ok' : 'bg-brand',
                    )}
                    style={{ width: `${ordered ? (received / ordered) * 100 : 0}%` }}
                  />
                </div>

                <p className="mt-2 text-[11px] text-faint">
                  أُنشئ {relative(o.createdAt)}
                  {o.expectedAt && ` · متوقع ${date(o.expectedAt)}`}
                </p>
              </button>
            )
          })}
        </div>
      )}

      <OrderModal
        order={openOrder}
        parts={partById}
        supplierName={openOrder ? (supplierById.get(openOrder.supplierId)?.name ?? '') : ''}
        customerName={
          openOrder?.customerId
            ? (customerById.get(openOrder.customerId)?.name ?? 'محذوف')
            : undefined
        }
        onClose={() => setOpenOrder(null)}
      />

      <CreateOrderModal open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}

function OrderModal({
  order,
  parts,
  supplierName,
  customerName,
  onClose,
}: {
  order: PurchaseOrder | null
  parts: Map<string, Part>
  supplierName: string
  /** اسم الزبون إن كان الطلب باسمه — يظهر في العنوان كي لا يُستلَم ويُرفّ. */
  customerName?: string
  onClose: () => void
}) {
  const { user, can } = useApp()
  const toast = useToast()
  const [receiving, setReceiving] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)

  if (!order) return null

  const total = order.lines.reduce((n, l) => n + l.qty * l.unitCost, 0)
  const canReceive =
    can('purchase.receive') && (order.status === 'ordered' || order.status === 'partial')

  async function setStatus(status: PurchaseOrderStatus) {
    if (!user || !order) return
    await updatePurchaseOrder(order.id, { status })
    await audit(user, `طلب توريد: ${STATUS_LABELS[status]}`, 'purchaseOrder', order.id, order.code)
    toast(`تم تحديث حالة الطلب إلى «${STATUS_LABELS[status]}»`)
    onClose()
  }

  async function receive() {
    if (!user || !order) return
    const entries = Object.entries(receiving).filter(([, qty]) => qty > 0)
    if (entries.length === 0) {
      toast('حدد الكميات المستلمة أولاً', 'warn')
      return
    }
    setBusy(true)
    try {
      // الخادم يقرّر الكميات المقبولة ويحدّث حالة الطلب في عملية واحدة.
      // إعادة حسابها هنا تعني رقمين قد يختلفان عن بعضهما.
      const status = await receivePurchase(
        order.id,
        entries.map(([partId, qty]) => ({ partId, qty })),
        user,
      )
      const complete = status === 'received'

      await audit(user, 'استلام شحنة', 'purchaseOrder', order.id, order.code)
      toast(complete ? 'تم استلام الطلب بالكامل' : 'تم تسجيل الاستلام الجزئي')
      setReceiving({})
      onClose()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'تعذّر تسجيل الاستلام', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={order.code}
      subtitle={`${supplierName} · ${STATUS_LABELS[order.status]}${
        customerName ? ` · لزبون: ${customerName}` : ''
      }`}
      footer={
        <>
          {order.status === 'draft' && can('purchase.edit') && (
            <>
              <Button variant="ghost" onClick={() => setStatus('cancelled')}>
                <X className="size-4" />
                إلغاء الطلب
              </Button>
              <Button variant="primary" onClick={() => setStatus('ordered')}>
                <CheckCircle2 className="size-4" />
                اعتماد وإرسال للمورد
              </Button>
            </>
          )}
          {canReceive && (
            <Button variant="primary" onClick={receive} loading={busy}>
              <PackageCheck className="size-4" />
              تسجيل الاستلام
            </Button>
          )}
          {!canReceive && order.status !== 'draft' && (
            <Button variant="ghost" onClick={onClose}>
              إغلاق
            </Button>
          )}
        </>
      }
    >
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-right text-[12px] text-muted">
              <th className="px-3 py-2 font-medium">الصنف</th>
              <th className="px-3 py-2 font-medium">مطلوب</th>
              <th className="px-3 py-2 font-medium">مستلم</th>
              <th className="px-3 py-2 font-medium">التكلفة</th>
              {canReceive && <th className="px-3 py-2 font-medium">استلام الآن</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {order.lines.map((l) => {
              const part = parts.get(l.partId)
              const remaining = l.qty - l.receivedQty
              return (
                <tr key={l.partId}>
                  <td className="px-3 py-2">
                    <p className="font-medium">{part?.name ?? 'صنف محذوف'}</p>
                    <p className="tnum text-[11px] text-faint">{part?.sku}</p>
                  </td>
                  <td className="tnum px-3 py-2">{l.qty}</td>
                  <td className="tnum px-3 py-2 text-muted">{l.receivedQty}</td>
                  <td className="tnum px-3 py-2">{money(l.unitCost)}</td>
                  {canReceive && (
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0"
                        max={remaining}
                        disabled={remaining <= 0}
                        value={receiving[l.partId] ?? ''}
                        onChange={(e) =>
                          setReceiving((cur) => ({
                            ...cur,
                            [l.partId]: Math.max(0, Math.min(remaining, Number(e.target.value))),
                          }))
                        }
                        placeholder={String(remaining)}
                        className="tnum h-8 w-20 rounded-lg border border-border bg-surface px-2 text-[13px] focus:border-brand focus:outline-none disabled:opacity-40"
                      />
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="tnum mt-3 flex justify-between rounded-xl bg-surface-2 px-4 py-2.5 text-sm">
        <span className="text-muted">إجمالي الطلب</span>
        <span className="font-bold">{money(total)}</span>
      </div>

      {order.notes && <p className="mt-3 text-[13px] text-muted">{order.notes}</p>}

      {canReceive && (
        <Button
          size="sm"
          variant="ghost"
          className="mt-2"
          onClick={() =>
            setReceiving(
              Object.fromEntries(order.lines.map((l) => [l.partId, l.qty - l.receivedQty])),
            )
          }
        >
          تعبئة الكل بالمتبقي
        </Button>
      )}
    </Modal>
  )
}

function CreateOrderModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useApp()
  const toast = useToast()
  const parts = useActiveParts()
  const suppliers = useSuppliers()
  const customers = useCustomers()

  const [supplierId, setSupplierId] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [lines, setLines] = useState<Array<{ partId: string; qty: number; unitCost: number }>>([])
  const [pick, setPick] = useState('')
  const [notes, setNotes] = useState('')
  const [expected, setExpected] = useState('')
  const [busy, setBusy] = useState(false)

  const supplierParts = useMemo(
    () => (supplierId ? parts.filter((p) => p.supplierId === supplierId) : parts),
    [parts, supplierId],
  )

  function addLine(partId: string) {
    const part = parts.find((p) => p.id === partId)
    if (!part || lines.some((l) => l.partId === partId)) return
    setLines((cur) => [...cur, { partId, qty: part.reorderQty, unitCost: part.cost }])
    setPick('')
  }

  async function save() {
    if (!user || !supplierId || lines.length === 0) return
    setBusy(true)
    try {
      const po = await createPurchaseOrder({
        supplierId,
        customerId: customerId || undefined,
        status: 'draft',
        lines: lines.map((l) => ({ ...l, receivedQty: 0 })),
        createdAt: Date.now(),
        expectedAt: expected ? new Date(expected).getTime() : undefined,
        createdBy: user.id,
        notes: notes.trim() || undefined,
      })
      await audit(user, 'إنشاء طلب توريد', 'purchaseOrder', po.id, po.code)
      toast(`تم إنشاء الطلب ${po.code}`)
      setLines([])
      setNotes('')
      setExpected('')
      setCustomerId('')
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const total = lines.reduce((n, l) => n + l.qty * l.unitCost, 0)

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="طلب توريد جديد"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!supplierId || lines.length === 0}
            onClick={save}
          >
            حفظ كمسودة
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="المورد">
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">— اختر المورد —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.leadTimeDays} يوم)
                </option>
              ))}
            </Select>
          </Field>
          <Field label="تاريخ الوصول المتوقع">
            <Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
          </Field>
          {/* اختياري: أغلب الطلبات تعبئة مخزون. وحين يكون الطلب لزبون بعينه
              يظهر في ملفّه، فلا يُسلَّم لغيره ولا يُنسى حتى يتصل يسأل. */}
          <Field label="طلب لزبون" hint="اتركه فارغاً إن كان الطلب لتعبئة المخزون">
            <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">— بلا زبون —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="أضف صنفاً">
          <Select value={pick} onChange={(e) => addLine(e.target.value)}>
            <option value="">— اختر صنفاً —</option>
            {supplierParts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — الرصيد {p.qty}
              </option>
            ))}
          </Select>
        </Field>

        {lines.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface-2 text-right text-[12px] text-muted">
                  <th className="px-3 py-2 font-medium">الصنف</th>
                  <th className="px-3 py-2 font-medium">الكمية</th>
                  <th className="px-3 py-2 font-medium">التكلفة</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lines.map((l) => {
                  const part = parts.find((p) => p.id === l.partId)
                  return (
                    <tr key={l.partId}>
                      <td className="px-3 py-2">{part?.name}</td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="1"
                          value={l.qty}
                          onChange={(e) =>
                            setLines((cur) =>
                              cur.map((x) =>
                                x.partId === l.partId
                                  ? { ...x, qty: Math.max(1, Number(e.target.value)) }
                                  : x,
                              ),
                            )
                          }
                          className="tnum h-8 w-20 rounded-lg border border-border bg-surface px-2 focus:border-brand focus:outline-none"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={l.unitCost}
                          onChange={(e) =>
                            setLines((cur) =>
                              cur.map((x) =>
                                x.partId === l.partId
                                  ? { ...x, unitCost: Math.max(0, Number(e.target.value)) }
                                  : x,
                              ),
                            )
                          }
                          className="tnum h-8 w-24 rounded-lg border border-border bg-surface px-2 focus:border-brand focus:outline-none"
                        />
                      </td>
                      <td className="px-3 py-2 text-left">
                        <button
                          onClick={() =>
                            setLines((cur) => cur.filter((x) => x.partId !== l.partId))
                          }
                          className="text-faint transition-colors hover:text-danger"
                          aria-label="حذف"
                        >
                          <X className="size-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="tnum flex justify-between border-t border-border bg-surface-2 px-3 py-2 text-sm">
              <span className="text-muted">{num(lines.length)} صنف</span>
              <span className="font-bold">{money(total)}</span>
            </div>
          </div>
        )}

        <Field label="ملاحظات">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
