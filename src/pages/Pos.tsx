import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Barcode,
  Check,
  Gift,
  MessageCircle,
  Minus,
  Plus,
  Printer,
  Search,
  ShoppingCart,
  Trash2,
  User,
  UserPlus,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  Select,
  cn,
  useDebounced,
  useToast,
} from '@/components/ui'
import { InvoiceDoc } from '@/components/InvoiceDoc'
import { CustomerForm } from '@/components/CustomerForm'
import { nextNumber } from '@/lib/db'
import { cloudEnabled } from '@/lib/supabase'
import { audit, createSale } from '@/lib/repo'
import { money, num, round2 } from '@/lib/format'
import { printInvoice } from '@/lib/print'
import { invoiceMessage, waLink } from '@/lib/whatsapp'
import { useApp } from '@/store/app'
import { useActiveParts, useCustomers } from '@/hooks/useShopData'
import type { Customer, Invoice, InvoiceLine, Part, PaymentMethod } from '@/lib/types'

interface CartLine {
  part: Part
  qty: number
  /** هدايا/عينات مع البند — تُخصم من الرصيد ولا تُحاسَب. */
  freeQty: number
  unitPrice: number
  discount: number
}

const PAYMENTS: Array<[PaymentMethod, string]> = [
  ['cash', 'نقداً'],
  ['card', 'شبكة'],
  ['transfer', 'تحويل'],
  ['credit', 'آجل'],
]

export default function Pos() {
  const { user, settings } = useApp()
  const toast = useToast()
  const parts = useActiveParts()
  const customers = useCustomers()

  const [query, setQuery] = useState('')
  const debounced = useDebounced(query, 180)
  const [cart, setCart] = useState<CartLine[]>([])
  // الفراغ يعني «بيع نقدي بلا اسم» لا «لم يُختَر بعد».
  const [customerId, setCustomerId] = useState('')
  const [newCustomer, setNewCustomer] = useState(false)
  const [payment, setPayment] = useState<PaymentMethod>('transfer')
  const [invoiceDiscount, setInvoiceDiscount] = useState(0)
  const [done, setDone] = useState<Invoice | null>(null)
  const [busy, setBusy] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const customer = customers.find((c) => c.id === customerId)
  /**
   * المعرّف المُرسَل يُشتقّ من العميل الموجود فعلاً لا من الحالة: المرآة
   * تُستبدل عند كل إقلاع، وعميل كان مختاراً قد يختفي، فيُفشل الفاتورة كلها.
   */
  const customerRef = customer?.id
  const tier = customer?.type ?? 'retail'

  const priceFor = (p: Part, c: Customer | undefined) =>
    c?.type === 'wholesale' ? p.priceWholesale : p.priceRetail

  // تغيير العميل يعيد تسعير السلة، وإلا كانت الشريحة كذبة.
  useEffect(() => {
    setCart((cur) => cur.map((l) => ({ ...l, unitPrice: priceFor(l.part, customer) })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId])

  const results = useMemo(() => {
    const q = debounced.trim().toLowerCase()
    if (!q) return parts.slice(0, 24)
    return parts
      .filter((p) => `${p.name} ${p.sku} ${p.barcode ?? ''}`.toLowerCase().includes(q))
      .slice(0, 40)
  }, [parts, debounced])

  /** المخصوم فعلاً من الرصيد لهذا البند: المحاسَب والهدايا معاً. */
  const outOf = (l: CartLine) => l.qty + l.freeQty

  function addPart(part: Part) {
    if (part.qty <= 0) {
      toast('هذا المنتج نفد من المخزون', 'warn')
      return
    }
    setCart((cur) => {
      const existing = cur.find((l) => l.part.id === part.id)
      if (existing) {
        if (outOf(existing) >= part.qty) {
          toast(`الرصيد المتاح ${part.qty} فقط`, 'warn')
          return cur
        }
        return cur.map((l) => (l.part.id === part.id ? { ...l, qty: l.qty + 1 } : l))
      }
      return [
        ...cur,
        { part, qty: 1, freeQty: 0, unitPrice: priceFor(part, customer), discount: 0 },
      ]
    })
    setQuery('')
    searchRef.current?.focus()
  }

  function onScanEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    const code = query.trim()
    if (!code) return
    const hit = parts.find((p) => p.barcode === code || p.sku.toLowerCase() === code.toLowerCase())
    if (hit) addPart(hit)
    else if (results.length === 1) addPart(results[0])
    else toast('لا يوجد منتج بهذا الرمز', 'warn')
  }

  const updateLine = (id: string, patch: Partial<CartLine>) =>
    setCart((cur) =>
      cur.map((l) => {
        if (l.part.id !== id) return l
        const next = { ...l, ...patch }
        // الهدايا تُخصم من نفس الرصيد: ١٠ محاسَبة + ١ هدية = ١١ بوكساً يخرج من الرفّ.
        if (outOf(next) > l.part.qty) {
          toast(`الرصيد المتاح ${l.part.qty} فقط (محاسَب + هدايا)`, 'warn')
          return l
        }
        return next
      }),
    )

  const removeLine = (id: string) => setCart((cur) => cur.filter((l) => l.part.id !== id))

  /** نسبة البند: مفتاح المحل يغلب، ثم نسبة المنتج، ثم نسبة المحل — نفس ترتيب `create_sale`. */
  const rateFor = (p: Part) => (settings.vatEnabled ? (p.taxRate ?? settings.vatRate) : 0)

  const totals = useMemo(() => {
    const subtotal = round2(cart.reduce((n, l) => n + l.unitPrice * l.qty, 0))
    const lineDiscounts = round2(cart.reduce((n, l) => n + l.discount, 0))
    const discount = round2(Math.min(subtotal, lineDiscounts + invoiceDiscount))
    const net = round2(subtotal - discount)
    // الضريبة لكل بند بنسبته بعد حصته من الخصم — نسخة مما يفعله الخادم.
    const vatAmount = round2(
      cart.reduce((n, l) => {
        const gross = l.unitPrice * l.qty
        const share = subtotal > 0 ? (discount * gross) / subtotal : 0
        return n + round2((gross - share) * (rateFor(l.part) / 100))
      }, 0),
    )
    const freeUnits = cart.reduce((n, l) => n + l.freeQty, 0)
    const freeCost = round2(cart.reduce((n, l) => n + (l.part.cost || 0) * l.freeQty, 0))
    return {
      subtotal,
      discount,
      net,
      vatAmount,
      total: round2(net + vatAmount),
      freeUnits,
      freeCost,
    }
  }, [cart, invoiceDiscount, settings.vatRate, settings.vatEnabled])

  async function checkout() {
    if (!user || cart.length === 0) return
    if (cart.every((l) => l.qty === 0)) {
      toast('فاتورة كل بنودها هدايا؟ سجّلها تسوية «عينات» من بطاقة المنتج بدل فاتورة', 'warn')
      return
    }
    setBusy(true)
    try {
      // الخادم يحجز الرقم في الوضع السحابي عبر `next_number()` تحت قفل صفّي.
      const number = cloudEnabled ? '' : await nextNumber('invoice')
      const lines: InvoiceLine[] = cart
        .filter((l) => l.qty > 0 || l.freeQty > 0)
        .map((l) => ({
          partId: l.part.id,
          name: l.part.name,
          sku: l.part.sku,
          qty: l.qty,
          freeQty: l.freeQty,
          unitPrice: l.unitPrice,
          unitCost: l.part.cost,
          discount: l.discount,
          taxRate: rateFor(l.part),
        }))

      const invoice: Invoice = {
        id: `inv_${Date.now().toString(36)}`,
        number,
        customerId: customerRef,
        customerName: customer?.name,
        customerVatNumber: customer?.vatNumber,
        lines,
        subtotal: totals.subtotal,
        discount: totals.discount,
        vatRate: settings.vatRate,
        vatAmount: totals.vatAmount,
        total: totals.total,
        paymentMethod: payment,
        status: 'paid',
        userId: user.id,
        createdAt: Date.now(),
      }

      const saved = await createSale({
        customerId: customerRef,
        paymentMethod: payment,
        discount: totals.discount,
        notes: undefined,
        lines: lines.map((l) => ({
          partId: l.partId,
          qty: l.qty,
          freeQty: l.freeQty,
          unitPrice: l.unitPrice,
          discount: l.discount,
        })),
        localInvoice: invoice,
      })
      await audit(
        user,
        'إصدار فاتورة',
        'invoice',
        saved.id,
        `${saved.number} — ${money(saved.total)}${totals.freeUnits ? ` — ${totals.freeUnits} هدية` : ''}`,
      )

      setDone(saved)
      setCart([])
      setInvoiceDiscount(0)
      toast(`تم إصدار الفاتورة ${saved.number}`)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'تعذّر إتمام البيع', 'error')
    } finally {
      setBusy(false)
    }
  }

  const donePhone = done ? customers.find((c) => c.id === done.customerId)?.phone : undefined

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      {/* الكتالوج */}
      <div className="space-y-3">
        <Card className="p-3">
          <div className="relative">
            <Barcode className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-brand" />
            <Input
              ref={searchRef}
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onScanEnter}
              placeholder="امسح الباركود أو ابحث بالاسم… ثم Enter"
              className="h-12 pr-10 text-base"
            />
          </div>
        </Card>

        {results.length === 0 ? (
          <Card>
            <EmptyState icon={<Search className="size-6" />} title="لا توجد منتجات مطابقة" />
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
            {results.map((p) => {
              const price = priceFor(p, customer)
              return (
                <button
                  key={p.id}
                  onClick={() => addPart(p)}
                  disabled={p.qty <= 0}
                  className={cn(
                    'lift flex flex-col rounded-card border border-border bg-surface p-3 text-right transition-colors',
                    'hover:border-brand disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="line-clamp-2 min-h-[2.4em] text-[13px] font-medium leading-tight">
                      {p.name}
                    </span>
                    <span
                      className={cn(
                        'tnum shrink-0 rounded-lg px-1.5 py-0.5 text-[11px] font-bold',
                        p.qty === 0
                          ? 'bg-danger-soft text-danger'
                          : p.qty <= p.reorderPoint
                            ? 'bg-warn-soft text-warn'
                            : 'bg-ok-soft text-ok',
                      )}
                    >
                      {p.qty}
                    </span>
                  </div>
                  <div className="mt-2 flex items-end justify-between gap-1">
                    <span className="tnum text-sm font-bold text-brand-strong">{money(price)}</span>
                    <span className="tnum text-[10px] text-faint">{p.sku}</span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* السلة */}
      <Card className="flex h-fit flex-col lg:sticky lg:top-[4.5rem]">
        <div className="flex items-center gap-2 border-b border-border p-3">
          <ShoppingCart className="size-[18px] text-brand" />
          <h2 className="flex-1 text-sm font-semibold">الفاتورة</h2>
          {cart.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setCart([])}>
              تفريغ
            </Button>
          )}
        </div>

        <div className="space-y-2 border-b border-border p-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <User className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
              <Select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="pr-9 pl-3"
              >
                <option value="">بيع نقدي بلا اسم</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            {/* المحل الجديد يُضاف من هنا وقت أول توريد، لا من شاشة أخرى. */}
            <Button
              variant="secondary"
              size="icon"
              onClick={() => setNewCustomer(true)}
              aria-label="عميل جديد"
              title="إضافة عميل جديد"
            >
              <UserPlus className="size-4" />
            </Button>
          </div>
          {tier === 'wholesale' && <Badge tone="accent">سعر الجملة مطبّق</Badge>}
        </div>

        {cart.length === 0 ? (
          <EmptyState
            icon={<ShoppingCart className="size-6" />}
            title="الفاتورة فارغة"
            description="امسح باركود أو اختر منتجاً من القائمة."
          />
        ) : (
          <ul className="max-h-[24rem] divide-y divide-border overflow-y-auto">
            {cart.map((l) => (
              <li key={l.part.id} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[13px] font-medium leading-snug">{l.part.name}</span>
                  <button
                    onClick={() => removeLine(l.part.id)}
                    className="shrink-0 text-faint transition-colors hover:text-danger"
                    aria-label="حذف"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="secondary"
                      className="size-7"
                      aria-label="أقل"
                      onClick={() =>
                        l.qty > 1 || l.freeQty > 0
                          ? updateLine(l.part.id, { qty: Math.max(0, l.qty - 1) })
                          : removeLine(l.part.id)
                      }
                    >
                      <Minus className="size-3.5" />
                    </Button>
                    <span className="tnum w-7 text-center text-sm font-semibold">{l.qty}</span>
                    <Button
                      size="icon"
                      variant="secondary"
                      className="size-7"
                      aria-label="أكثر"
                      disabled={outOf(l) >= l.part.qty}
                      onClick={() => updateLine(l.part.id, { qty: l.qty + 1 })}
                    >
                      <Plus className="size-3.5" />
                    </Button>
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    aria-label="سعر الوحدة"
                    value={l.unitPrice}
                    onChange={(e) => updateLine(l.part.id, { unitPrice: Number(e.target.value) })}
                    className="tnum h-8 w-24 rounded-lg border border-border bg-surface px-2 text-left text-[13px] focus:border-brand focus:outline-none"
                  />
                  <span className="tnum w-20 text-left text-[13px] font-semibold">
                    {money(l.unitPrice * l.qty - l.discount)}
                  </span>
                </div>
                {/* الهدية عدّاد مستقل عن الكمية: «١١ بوكس والفاتورة على ١٠» تعني
                    qty=10 و freeQty=1، والرصيد ينقص ١١. */}
                <div className="mt-2 flex items-center gap-2 text-[12px]">
                  <Gift className="size-3.5 text-accent" />
                  <span className="text-muted">هدية / عينة</span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6"
                      aria-label="هدية أقل"
                      disabled={l.freeQty === 0}
                      onClick={() => updateLine(l.part.id, { freeQty: l.freeQty - 1 })}
                    >
                      <Minus className="size-3" />
                    </Button>
                    <span
                      className={cn(
                        'tnum w-5 text-center font-semibold',
                        l.freeQty > 0 && 'text-accent',
                      )}
                    >
                      {l.freeQty}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6"
                      aria-label="هدية أكثر"
                      disabled={outOf(l) >= l.part.qty}
                      onClick={() => updateLine(l.part.id, { freeQty: l.freeQty + 1 })}
                    >
                      <Plus className="size-3" />
                    </Button>
                  </div>
                  {l.freeQty > 0 && (
                    <span className="tnum mr-auto text-faint">يخرج {outOf(l)} من الرصيد</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2.5 border-t border-border p-3">
          <div className="tnum space-y-1 text-[13px]">
            <Row label="المجموع" value={money(totals.subtotal)} />
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted">خصم على الفاتورة</span>
              <input
                type="number"
                min="0"
                step="0.5"
                aria-label="خصم الفاتورة"
                value={invoiceDiscount || ''}
                onChange={(e) => setInvoiceDiscount(Math.max(0, Number(e.target.value)))}
                placeholder="0"
                className="tnum h-8 w-24 rounded-lg border border-border bg-surface px-2 text-left focus:border-brand focus:outline-none"
              />
            </div>
            {settings.vatEnabled && (
              <Row label={`ضريبة ${settings.vatRate}٪`} value={money(totals.vatAmount)} />
            )}
            {totals.freeUnits > 0 && (
              <Row
                label={`${num(totals.freeUnits)} هدية — تكلفتها`}
                value={totals.freeCost ? money(totals.freeCost) : '—'}
              />
            )}
          </div>

          <div className="flex items-center justify-between rounded-xl bg-brand-soft px-3 py-2.5">
            <span className="text-sm font-medium text-brand-strong">الإجمالي</span>
            <span className="tnum text-lg font-bold text-brand-strong">{money(totals.total)}</span>
          </div>

          <div className="grid grid-cols-4 gap-1">
            {PAYMENTS.map(([value, label]) => (
              <button
                key={value}
                onClick={() => setPayment(value)}
                className={cn(
                  'rounded-lg border px-1 py-1.5 text-[12px] font-medium transition-colors',
                  payment === value
                    ? 'border-brand bg-brand-soft text-brand-strong'
                    : 'border-border text-muted hover:border-border-strong',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={cart.length === 0}
            loading={busy}
            onClick={checkout}
          >
            <Check className="size-4" />
            إصدار الفاتورة
          </Button>
        </div>
      </Card>

      {/* الفاتورة بعد الإصدار: طباعة أو واتساب — طلب العميل الحرفي. */}
      <Modal
        open={Boolean(done)}
        onClose={() => setDone(null)}
        title="صدرت الفاتورة"
        subtitle={done?.number}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDone(null)}>
              إغلاق
            </Button>
            {done && (
              <a
                href={waLink(donePhone, invoiceMessage(done, settings))}
                target="_blank"
                rel="noreferrer"
              >
                <Button variant="soft">
                  <MessageCircle className="size-4" />
                  واتساب
                </Button>
              </a>
            )}
            <Button variant="primary" onClick={() => done && printInvoice(done, settings)}>
              <Printer className="size-4" />
              طباعة
            </Button>
          </>
        }
      >
        {done && (
          <div className="rounded-xl border border-border p-2">
            <InvoiceDoc invoice={done} settings={settings} sellerName={user?.name} />
          </div>
        )}
      </Modal>

      {/* العميل المُنشأ يُختار فوراً: من أضافه وهو يجهّز الفاتورة يقصدها. */}
      <CustomerForm
        open={newCustomer}
        customer={null}
        onClose={() => setNewCustomer(false)}
        onSaved={(c) => setCustomerId(c.id)}
      />
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span>{value}</span>
    </div>
  )
}
