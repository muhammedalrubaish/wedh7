import { useMemo, useState } from 'react'
import { FileText, MessageCircle, Printer, RotateCcw, Search, Undo2 } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Pager,
  Select,
  Switch,
  Tabs,
  Textarea,
  cn,
  useDebounced,
  usePagination,
  useToast,
} from '@/components/ui'
import { InvoiceDoc } from '@/components/InvoiceDoc'
import { Stat } from '@/components/Stat'
import { db } from '@/lib/db'
import { audit, buildReturn, createReturn, refundInvoice } from '@/lib/repo'
import { daysAgo, dateTime, endOfDay, money, num } from '@/lib/format'
import { printInvoice, printReturn } from '@/lib/print'
import { returnedByPart, summarize } from '@/lib/analytics'
import { invoiceMessage, returnMessage, waLink } from '@/lib/whatsapp'
import { useApp } from '@/store/app'
import { useCustomers, useInvoices, useReturns } from '@/hooks/useShopData'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Invoice, ReturnNote } from '@/lib/types'

type RangeKey = 'today' | 'week' | 'month' | 'all'
type View = 'invoices' | 'returns'

const RANGE_DAYS: Record<RangeKey, number> = { today: 1, week: 7, month: 30, all: 3650 }

const PAYMENT_LABELS: Record<Invoice['paymentMethod'], string> = {
  cash: 'نقداً',
  card: 'شبكة',
  transfer: 'تحويل',
  credit: 'آجل',
}

export default function Invoices() {
  const { settings, user, can } = useApp()
  const toast = useToast()
  const invoices = useInvoices()
  const returns = useReturns()
  const customers = useCustomers()
  const users = useLiveQuery(() => db.users.toArray(), [], [])

  const [view, setView] = useState<View>('invoices')
  const [range, setRange] = useState<RangeKey>('week')
  const [query, setQuery] = useState('')
  const debounced = useDebounced(query)
  const [seller, setSeller] = useState('all')
  const [open, setOpen] = useState<Invoice | null>(null)
  const [openReturn, setOpenReturn] = useState<ReturnNote | null>(null)
  const [refunding, setRefunding] = useState<Invoice | null>(null)
  const [returning, setReturning] = useState<Invoice | null>(null)

  const from = daysAgo(RANGE_DAYS[range] - 1)
  const to = endOfDay()

  const rows = useMemo(() => {
    const q = debounced.trim().toLowerCase()
    return invoices
      .filter((i) => i.createdAt >= from && i.createdAt <= to)
      .filter((i) => (seller === 'all' ? true : i.userId === seller))
      .filter((i) =>
        q
          ? `${i.number} ${i.customerName ?? ''} ${i.lines.map((l) => l.name).join(' ')}`
              .toLowerCase()
              .includes(q)
          : true,
      )
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [invoices, from, to, seller, debounced])

  const returnRows = useMemo(() => {
    const q = debounced.trim().toLowerCase()
    return returns
      .filter((r) => r.createdAt >= from && r.createdAt <= to)
      .filter((r) =>
        q
          ? `${r.number} ${r.invoiceNumber} ${r.customerName ?? ''}`.toLowerCase().includes(q)
          : true,
      )
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [returns, from, to, debounced])

  /** المرتجعات على كل فاتورة — لتمييزها في القائمة وطباعتها تحت الفاتورة. */
  const returnsByInvoice = useMemo(() => {
    const m = new Map<string, ReturnNote[]>()
    for (const r of returns) m.set(r.invoiceId, [...(m.get(r.invoiceId) ?? []), r])
    return m
  }, [returns])

  const summary = useMemo(() => summarize(rows, returnRows, from, to), [rows, returnRows, from, to])
  const { page, pages, slice, setPage } = usePagination(rows, 25)
  const userNames = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users])
  const phoneOf = (customerId?: string) => customers.find((c) => c.id === customerId)?.phone
  const showMoney = can('reports.financial')

  async function refund(invoice: Invoice) {
    if (!user) return
    try {
      await refundInvoice(invoice, user)
      await audit(user, 'استرجاع فاتورة كاملة', 'invoice', invoice.id, invoice.number)
      toast(`تم استرجاع الفاتورة ${invoice.number} بالكامل`)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'تعذّر الاسترجاع', 'error')
    } finally {
      setRefunding(null)
      setOpen(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold tracking-tight">الفواتير والمرتجعات</h1>
          <Tabs
            value={view}
            onChange={setView}
            items={[
              { value: 'invoices', label: 'الفواتير', count: rows.length },
              { value: 'returns', label: 'المرتجعات', count: returnRows.length },
            ]}
          />
        </div>
        <Tabs
          value={range}
          onChange={setRange}
          items={[
            { value: 'today', label: 'اليوم' },
            { value: 'week', label: '٧ أيام' },
            { value: 'month', label: '٣٠ يوم' },
            { value: 'all', label: 'الكل' },
          ]}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="عدد الفواتير" value={num(summary.invoices)} />
        <Stat
          label="المبيعات (بدون ضريبة)"
          value={money(summary.revenue, { compact: true })}
          sub={
            summary.returned > 0
              ? `بعد مرتجع ${money(summary.returned, { compact: true })}`
              : undefined
          }
        />
        <Stat
          label="هدايا وعينات"
          value={num(summary.freeUnits)}
          tone="accent"
          sub={
            showMoney && summary.freeCost > 0
              ? `تكلفتها ${money(summary.freeCost, { compact: true })}`
              : 'بوكس'
          }
        />
        {showMoney ? (
          <Stat label="الربح" value={money(summary.profit, { compact: true })} tone="ok" />
        ) : (
          <Stat
            label="الضريبة المحصّلة"
            value={money(summary.vat, { compact: true })}
            tone="warn"
          />
        )}
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="رقم الفاتورة أو اسم العميل أو الصنف…"
              className="pr-9"
            />
          </div>
          {view === 'invoices' && (
            <Select value={seller} onChange={(e) => setSeller(e.target.value)} className="w-44">
              <option value="all">كل الموظفين</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          )}
        </div>
      </Card>

      {view === 'invoices' ? (
        <Card className="overflow-hidden">
          {rows.length === 0 ? (
            <EmptyState
              icon={<FileText className="size-6" />}
              title="لا توجد فواتير في هذه الفترة"
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border bg-surface-2 text-right text-[12px] text-muted">
                      <th className="px-4 py-2.5 font-medium">الرقم</th>
                      <th className="px-3 py-2.5 font-medium">التاريخ</th>
                      <th className="hidden px-3 py-2.5 font-medium sm:table-cell">العميل</th>
                      <th className="hidden px-3 py-2.5 font-medium lg:table-cell">البائع</th>
                      <th className="hidden px-3 py-2.5 font-medium sm:table-cell">الدفع</th>
                      <th className="px-3 py-2.5 font-medium">الإجمالي</th>
                      <th className="px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {slice.map((inv) => {
                      const rets = returnsByInvoice.get(inv.id) ?? []
                      const free = inv.lines.reduce((n, l) => n + l.freeQty, 0)
                      return (
                        <tr
                          key={inv.id}
                          onClick={() => setOpen(inv)}
                          className="cursor-pointer transition-colors hover:bg-surface-2"
                        >
                          <td className="tnum px-4 py-2.5 font-medium text-brand-strong">
                            <span className="flex flex-wrap items-center gap-1.5">
                              {inv.number}
                              {inv.status === 'refunded' && <Badge tone="danger">مسترجعة</Badge>}
                              {rets.length > 0 && <Badge tone="warn">مرتجع جزئي</Badge>}
                              {free > 0 && <Badge tone="accent">+{free} هدية</Badge>}
                            </span>
                          </td>
                          <td className="tnum px-3 py-2.5 text-muted">{dateTime(inv.createdAt)}</td>
                          <td className="hidden truncate px-3 py-2.5 sm:table-cell">
                            {inv.customerName ?? 'بيع نقدي'}
                          </td>
                          <td className="hidden px-3 py-2.5 text-muted lg:table-cell">
                            {userNames.get(inv.userId) ?? '—'}
                          </td>
                          <td className="hidden px-3 py-2.5 text-muted sm:table-cell">
                            {PAYMENT_LABELS[inv.paymentMethod]}
                          </td>
                          <td
                            className={cn(
                              'tnum px-3 py-2.5 font-semibold',
                              inv.status === 'refunded' && 'text-faint line-through',
                            )}
                          >
                            {money(inv.total)}
                          </td>
                          <td className="px-3 py-2.5 text-left">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation()
                                void printInvoice(inv, settings, rets)
                              }}
                              aria-label="طباعة"
                            >
                              <Printer className="size-4" />
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <Pager page={page} pages={pages} onChange={setPage} total={rows.length} />
            </>
          )}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {returnRows.length === 0 ? (
            <EmptyState
              icon={<Undo2 className="size-6" />}
              title="لا توجد مرتجعات في هذه الفترة"
              description="المرتجع يُسجَّل من داخل الفاتورة الأصل: افتح الفاتورة ثم «مرتجع»."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-surface-2 text-right text-[12px] text-muted">
                    <th className="px-4 py-2.5 font-medium">الرقم</th>
                    <th className="px-3 py-2.5 font-medium">التاريخ</th>
                    <th className="hidden px-3 py-2.5 font-medium sm:table-cell">العميل</th>
                    <th className="hidden px-3 py-2.5 font-medium sm:table-cell">على فاتورة</th>
                    <th className="px-3 py-2.5 font-medium">الحالة</th>
                    <th className="px-3 py-2.5 font-medium">المبلغ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {returnRows.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => setOpenReturn(r)}
                      className="cursor-pointer transition-colors hover:bg-surface-2"
                    >
                      <td className="tnum px-4 py-2.5 font-medium text-brand-strong">{r.number}</td>
                      <td className="tnum px-3 py-2.5 text-muted">{dateTime(r.createdAt)}</td>
                      <td className="hidden px-3 py-2.5 sm:table-cell">{r.customerName ?? '—'}</td>
                      <td className="tnum hidden px-3 py-2.5 text-muted sm:table-cell">
                        {r.invoiceNumber}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone={r.restock ? 'ok' : 'danger'}>
                          {r.restock ? 'عاد للمخزون' : 'منتهي / تالف'}
                        </Badge>
                      </td>
                      <td className="tnum px-3 py-2.5 font-semibold">- {money(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* نافذة الفاتورة */}
      <Modal
        open={Boolean(open)}
        onClose={() => setOpen(null)}
        title={open?.number ?? ''}
        subtitle={open && dateTime(open.createdAt)}
        footer={
          <>
            {open && open.status !== 'refunded' && can('sales.refund') && (
              <>
                <Button variant="secondary" onClick={() => setReturning(open)}>
                  <Undo2 className="size-4" />
                  مرتجع
                </Button>
                {(returnsByInvoice.get(open.id) ?? []).length === 0 && (
                  <Button variant="danger" onClick={() => setRefunding(open)}>
                    <RotateCcw className="size-4" />
                    استرجاع كامل
                  </Button>
                )}
              </>
            )}
            <span className="flex-1" />
            {open && (
              <a
                href={waLink(phoneOf(open.customerId), invoiceMessage(open, settings))}
                target="_blank"
                rel="noreferrer"
              >
                <Button variant="soft">
                  <MessageCircle className="size-4" />
                  واتساب
                </Button>
              </a>
            )}
            <Button
              variant="primary"
              onClick={() => open && printInvoice(open, settings, returnsByInvoice.get(open.id))}
            >
              <Printer className="size-4" />
              طباعة
            </Button>
          </>
        }
      >
        {open && (
          <div className="rounded-xl border border-border p-2">
            <InvoiceDoc
              invoice={open}
              settings={settings}
              sellerName={userNames.get(open.userId)}
              returns={returnsByInvoice.get(open.id)}
            />
          </div>
        )}
      </Modal>

      {/* نافذة المرتجع */}
      <Modal
        open={Boolean(openReturn)}
        onClose={() => setOpenReturn(null)}
        size="sm"
        title={openReturn?.number ?? ''}
        subtitle={
          openReturn && `على ${openReturn.invoiceNumber} · ${dateTime(openReturn.createdAt)}`
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpenReturn(null)}>
              إغلاق
            </Button>
            {openReturn && (
              <a
                href={waLink(phoneOf(openReturn.customerId), returnMessage(openReturn, settings))}
                target="_blank"
                rel="noreferrer"
              >
                <Button variant="soft">
                  <MessageCircle className="size-4" />
                  واتساب
                </Button>
              </a>
            )}
            <Button
              variant="primary"
              onClick={() => openReturn && printReturn(openReturn, settings)}
            >
              <Printer className="size-4" />
              طباعة
            </Button>
          </>
        }
      >
        {openReturn && (
          <div className="space-y-3 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={openReturn.restock ? 'ok' : 'danger'}>
                {openReturn.restock ? 'عاد للمخزون' : 'منتهي الصلاحية — لم يعد للمخزون'}
              </Badge>
              {openReturn.customerName && (
                <span className="text-muted">{openReturn.customerName}</span>
              )}
            </div>
            {openReturn.reason && <p className="text-muted">السبب: {openReturn.reason}</p>}
            <ul className="divide-y divide-border rounded-xl border border-border">
              {openReturn.lines.map((l) => (
                <li key={l.partId} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span>
                    {l.name} <span className="tnum text-faint">× {l.qty}</span>
                  </span>
                  <span className="tnum font-medium">{money(l.unitPrice * l.qty)}</span>
                </li>
              ))}
            </ul>
            <div className="tnum space-y-1 rounded-xl bg-surface-2 px-3 py-2">
              <div className="flex justify-between text-muted">
                <span>قبل الضريبة</span>
                <span>{money(openReturn.subtotal)}</span>
              </div>
              {openReturn.vatAmount > 0 && (
                <div className="flex justify-between text-muted">
                  <span>الضريبة المردودة</span>
                  <span>{money(openReturn.vatAmount)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold">
                <span>المردود للزبون</span>
                <span>{money(openReturn.total)}</span>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <ReturnModal
        invoice={returning}
        existing={returning ? (returnsByInvoice.get(returning.id) ?? []) : []}
        onClose={() => setReturning(null)}
        onDone={(note) => {
          setReturning(null)
          setOpen(null)
          setOpenReturn(note)
        }}
      />

      <Modal
        open={Boolean(refunding)}
        onClose={() => setRefunding(null)}
        size="sm"
        title="استرجاع الفاتورة بالكامل"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRefunding(null)}>
              إلغاء
            </Button>
            <Button variant="danger" onClick={() => refunding && refund(refunding)}>
              تأكيد الاسترجاع
            </Button>
          </>
        }
      >
        <p className="text-sm leading-6">
          ستُلغى الفاتورة <span className="tnum font-semibold">{refunding?.number}</span> وتعود كل
          بوكساتها (والهدايا معها) إلى المخزون، وتُستثنى من التقارير. لو رجع جزء فقط فاستخدم «مرتجع»
          بدلها. لا يمكن التراجع.
        </p>
      </Modal>
    </div>
  )
}

/**
 * نافذة المرتجع الجزئي: كمية لكل بند، وهل تعود للمخزون.
 *
 * الافتراضي «لا تعود»: الحالة التي وصفها العميل هي بوكسات انتهت صلاحيتها،
 * وإعادتها للرفّ خطأً تعني بيع منتهٍ لزبون آخر. من يرجّع صالحاً يفعّل المفتاح.
 */
function ReturnModal({
  invoice,
  existing,
  onClose,
  onDone,
}: {
  invoice: Invoice | null
  existing: ReturnNote[]
  onClose: () => void
  onDone: (note: ReturnNote) => void
}) {
  const { user } = useApp()
  const toast = useToast()
  const [qtys, setQtys] = useState<Record<string, number>>({})
  const [restock, setRestock] = useState(false)
  const [reason, setReason] = useState('انتهت الصلاحية')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<{ subtotal: number; vat: number; total: number } | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)

  const [key, setKey] = useState('')
  if (invoice && key !== invoice.id) {
    setKey(invoice.id)
    setQtys({})
    setRestock(false)
    setReason('انتهت الصلاحية')
    setPreview(null)
    setError(null)
  }

  const already = useMemo(
    () => (invoice ? returnedByPart(invoice.id, existing) : new Map<string, number>()),
    [invoice, existing],
  )

  async function recompute(next: Record<string, number>) {
    if (!invoice) return
    setError(null)
    try {
      const lines = Object.entries(next).map(([partId, qty]) => ({ partId, qty }))
      if (lines.every((l) => l.qty <= 0)) return setPreview(null)
      const d = await buildReturn({ invoice, lines, restock, reason }, existing)
      setPreview({ subtotal: d.subtotal, vat: d.vatAmount, total: d.total })
    } catch (err) {
      setPreview(null)
      setError(err instanceof Error ? err.message : 'تعذّر الحساب')
    }
  }

  async function submit() {
    if (!invoice || !user) return
    setBusy(true)
    try {
      const note = await createReturn(
        {
          invoice,
          lines: Object.entries(qtys).map(([partId, qty]) => ({ partId, qty })),
          restock,
          reason,
        },
        user,
      )
      await audit(
        user,
        'مرتجع جزئي',
        'return',
        note.id,
        `${note.number} على ${invoice.number} — ${money(note.total)}`,
      )
      toast(`تم تسجيل المرتجع ${note.number}`)
      onDone(note)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر تسجيل المرتجع')
    } finally {
      setBusy(false)
    }
  }

  if (!invoice) return null

  return (
    <Modal
      open
      onClose={onClose}
      title="مرتجع على الفاتورة"
      subtitle={`${invoice.number} · إجمالي ${money(invoice.total)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!preview || Boolean(error)}
            onClick={submit}
          >
            <Undo2 className="size-4" />
            تسجيل المرتجع {preview ? `(${money(preview.total)})` : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ul className="divide-y divide-border rounded-xl border border-border">
          {invoice.lines.map((l) => {
            const max = l.qty - (already.get(l.partId) ?? 0)
            return (
              <li key={l.partId} className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{l.name}</p>
                  <p className="tnum text-[11px] text-faint">
                    بيع {l.qty} × {money(l.unitPrice)}
                    {(already.get(l.partId) ?? 0) > 0 && ` · رُجع ${already.get(l.partId)} سابقاً`}
                    {l.freeQty > 0 && ` · ${l.freeQty} هدية (لا تُردّ بمال)`}
                  </p>
                </div>
                <input
                  type="number"
                  min="0"
                  max={max}
                  disabled={max <= 0}
                  aria-label={`كمية مرتجعة من ${l.name}`}
                  value={qtys[l.partId] ?? ''}
                  placeholder={`0 / ${max}`}
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(max, Number(e.target.value)))
                    const next = { ...qtys, [l.partId]: v }
                    setQtys(next)
                    void recompute(next)
                  }}
                  className="tnum h-9 w-24 rounded-lg border border-border bg-surface px-2 text-[13px] focus:border-brand focus:outline-none disabled:opacity-40"
                />
              </li>
            )
          })}
        </ul>

        <div className="rounded-xl border border-border p-3">
          <Switch
            checked={restock}
            onChange={(v) => {
              setRestock(v)
              if (!v && reason === 'زيادة عن الحاجة') setReason('انتهت الصلاحية')
              if (v && reason === 'انتهت الصلاحية') setReason('زيادة عن الحاجة')
              void recompute(qtys)
            }}
            label="البوكسات صالحة وتعود إلى المخزون"
          />
          <p className="mt-1.5 pr-[52px] text-[12px] text-faint">
            اتركه مطفأً للمنتهي صلاحيته أو التالف: يُخصم من حساب الزبون ولا يعود للرفّ.
          </p>
        </div>

        <Field label="السبب" hint="يظهر على إشعار المرتجع">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>

        {error && (
          <p className="rounded-xl bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>
        )}

        {preview && (
          <div className="tnum space-y-1 rounded-xl bg-surface-2 px-3 py-2.5 text-[13px]">
            <div className="flex justify-between text-muted">
              <span>قبل الضريبة</span>
              <span>{money(preview.subtotal)}</span>
            </div>
            {preview.vat > 0 && (
              <div className="flex justify-between text-muted">
                <span>الضريبة المردودة</span>
                <span>{money(preview.vat)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold">
              <span>يُخصم من حساب الزبون</span>
              <span>{money(preview.total)}</span>
            </div>
            <div className="flex justify-between text-muted">
              <span>صافي الفاتورة بعده</span>
              <span>
                {money(invoice.total - existing.reduce((n, r) => n + r.total, 0) - preview.total)}
              </span>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
