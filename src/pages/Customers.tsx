import { useMemo, useState } from 'react'
import {
  FileText,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  Search,
  Trash2,
  Undo2,
  UsersRound,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  Pager,
  Select,
  useDebounced,
  usePagination,
  useToast,
} from '@/components/ui'
import { Stat } from '@/components/Stat'
import { CustomerForm } from '@/components/CustomerForm'
import { audit, deleteCustomer } from '@/lib/repo'
import { date, money, monthLabel, num } from '@/lib/format'
import { statementMessage, waLink } from '@/lib/whatsapp'
import { useApp } from '@/store/app'
import { useCustomers, useInvoices, useReturns } from '@/hooks/useShopData'
import type { Customer, CustomerType, Invoice, ReturnNote } from '@/lib/types'

const TYPE_LABELS: Record<CustomerType, string> = {
  retail: 'فرد',
  wholesale: 'محل / جملة',
}

const TYPE_TONES: Record<CustomerType, 'neutral' | 'accent'> = {
  retail: 'neutral',
  wholesale: 'accent',
}

type SortKey = 'spent' | 'recent' | 'name' | 'invoices'

/**
 * ملخّص كل عميل — يُحسب من الفواتير والمرتجعات لا يُخزَّن.
 *
 * الفاتورة المسترجعة بالكامل تُستثنى من المبلغ لكنها تبقى في العدّ: «اشترى ثم
 * أرجع» واقعة تخصّ الزبون ويجب أن تُرى. والمرتجع الجزئي يُخصم من المبلغ ويُعدّ
 * على حدة — المحل الذي يرجّع كثيراً يُعرف من رقمه.
 */
interface Rollup {
  customer: Customer
  invoices: Invoice[]
  returns: ReturnNote[]
  /** إجمالي الفواتير بالضريبة بعد المرتجعات. */
  spent: number
  returned: number
  boxes: number
  freeBoxes: number
  lastAt: number
  unpaid: number
}

export default function Customers() {
  const { user, can, settings } = useApp()
  const toast = useToast()
  const customers = useCustomers()
  const invoices = useInvoices()
  const returns = useReturns()

  const [query, setQuery] = useState('')
  const debounced = useDebounced(query)
  const [type, setType] = useState<'all' | CustomerType>('all')
  const [sort, setSort] = useState<SortKey>('spent')
  const [editing, setEditing] = useState<Customer | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [open, setOpen] = useState<Customer | null>(null)
  const [removing, setRemoving] = useState<Customer | null>(null)

  const rollups = useMemo(() => {
    const byCustomer = new Map<string, Rollup>()
    for (const c of customers) {
      byCustomer.set(c.id, {
        customer: c,
        invoices: [],
        returns: [],
        spent: 0,
        returned: 0,
        boxes: 0,
        freeBoxes: 0,
        lastAt: 0,
        unpaid: 0,
      })
    }
    for (const inv of invoices) {
      const r = inv.customerId ? byCustomer.get(inv.customerId) : undefined
      if (!r) continue
      r.invoices.push(inv)
      r.lastAt = Math.max(r.lastAt, inv.createdAt)
      if (inv.status !== 'refunded') {
        r.spent += inv.total
        for (const l of inv.lines) {
          r.boxes += l.qty
          r.freeBoxes += l.freeQty
        }
        // الآجل دَين على الزبون لا مبيعة مقبوضة — يُعرض وحده كي يُطالَب به.
        // الحالة لا طريقة الدفع: ما سُدّد لاحقاً يخرج من الدَّين.
        if (inv.status === 'unpaid') r.unpaid += inv.total
      }
    }
    for (const ret of returns) {
      const r = ret.customerId ? byCustomer.get(ret.customerId) : undefined
      if (!r) continue
      r.returns.push(ret)
      r.spent -= ret.total
      r.returned += ret.total
      const inv = r.invoices.find((i) => i.id === ret.invoiceId)
      if (inv?.status === 'unpaid') r.unpaid -= ret.total
    }
    for (const r of byCustomer.values()) {
      r.invoices.sort((a, b) => b.createdAt - a.createdAt)
      r.returns.sort((a, b) => b.createdAt - a.createdAt)
    }
    return byCustomer
  }, [customers, invoices, returns])

  const rows = useMemo(() => {
    const q = debounced.trim().toLowerCase()
    const list = [...rollups.values()]
      .filter((r) => (type === 'all' ? true : r.customer.type === type))
      .filter((r) =>
        q
          ? `${r.customer.name} ${r.customer.phone ?? ''} ${r.customer.vatNumber ?? ''}`
              .toLowerCase()
              .includes(q)
          : true,
      )
    const by: Record<SortKey, (a: Rollup, b: Rollup) => number> = {
      spent: (a, b) => b.spent - a.spent,
      recent: (a, b) => b.lastAt - a.lastAt,
      invoices: (a, b) => b.invoices.length - a.invoices.length,
      name: (a, b) => a.customer.name.localeCompare(b.customer.name, 'ar'),
    }
    return list.sort(by[sort])
  }, [rollups, type, sort, debounced])

  const totals = useMemo(() => {
    const all = [...rollups.values()]
    return {
      count: all.length,
      spent: all.reduce((n, r) => n + r.spent, 0),
      unpaid: all.reduce((n, r) => n + r.unpaid, 0),
      named: invoices.length ? invoices.filter((i) => i.customerId).length : 0,
    }
  }, [rollups, invoices])

  const showMoney = can('reports.financial')

  async function remove(customer: Customer) {
    try {
      await deleteCustomer(customer.id)
      if (user) await audit(user, 'حذف عميل', 'customer', customer.id, customer.name)
      toast(`تم حذف العميل ${customer.name}`)
      setOpen(null)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'تعذّر الحذف', 'error')
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight">العملاء</h1>
        <Button
          variant="primary"
          onClick={() => {
            setEditing(null)
            setFormOpen(true)
          }}
        >
          <Plus className="size-4" />
          عميل جديد
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="عدد العملاء" value={num(totals.count)} />
        <Stat label="فواتير منسوبة لعميل" value={num(totals.named)} />
        {showMoney && (
          <Stat label="إجمالي مشترياتهم" value={money(totals.spent, { compact: true })} tone="ok" />
        )}
        {showMoney && (
          <Stat label="لم يتم السداد" value={money(totals.unpaid, { compact: true })} tone="warn" />
        )}
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="اسم المحل أو جواله أو رقمه الضريبي…"
              className="pr-9"
            />
          </div>
          <Select
            value={type}
            onChange={(e) => setType(e.target.value as 'all' | CustomerType)}
            className="w-36"
          >
            <option value="all">كل الأنواع</option>
            <option value="wholesale">محلات / جملة</option>
            <option value="retail">أفراد</option>
          </Select>
          <Select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="w-44"
          >
            <option value="spent">الأكثر شراءً</option>
            <option value="recent">الأحدث شراءً</option>
            <option value="invoices">الأكثر فواتير</option>
            <option value="name">الترتيب الأبجدي</option>
          </Select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={<UsersRound className="size-6" />}
            title="لا يوجد عملاء"
            description="أضف المحلات التي توزّع عليها ليُربط كل محل بفواتيره وكشف حسابه."
          />
        ) : (
          <CustomerTable
            rows={rows}
            showMoney={showMoney}
            onOpen={setOpen}
            onEdit={(c) => {
              setEditing(c)
              setFormOpen(true)
            }}
          />
        )}
      </Card>

      <CustomerForm
        open={formOpen}
        customer={editing}
        onClose={() => setFormOpen(false)}
        onSaved={(c) => {
          setFormOpen(false)
          if (open) setOpen(c)
        }}
      />

      <CustomerDetail
        rollup={open ? rollups.get(open.id) : undefined}
        allInvoices={invoices}
        allReturns={returns}
        settings={settings}
        onClose={() => setOpen(null)}
        showMoney={showMoney}
        onEdit={(c) => {
          setEditing(c)
          setFormOpen(true)
        }}
        onDelete={setRemoving}
      />

      <Modal
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        size="sm"
        title="حذف العميل"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              إلغاء
            </Button>
            <Button variant="danger" onClick={() => removing && remove(removing)}>
              تأكيد الحذف
            </Button>
          </>
        }
      >
        <p className="text-sm leading-6">
          سيُحذف <span className="font-semibold">{removing?.name}</span> من قائمة العملاء. فواتيره
          تبقى كما هي باسمه المحفوظ فيها، لكن يُفقد ربطها به فلا يظهر له كشف حساب بعد اليوم.
        </p>
      </Modal>
    </div>
  )
}

function CustomerTable({
  rows,
  showMoney,
  onOpen,
  onEdit,
}: {
  rows: Rollup[]
  showMoney: boolean
  onOpen: (c: Customer) => void
  onEdit: (c: Customer) => void
}) {
  const { page, pages, slice, setPage } = usePagination(rows, 25)
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-right text-[12px] text-muted">
              <th className="px-4 py-2.5 font-medium">الاسم</th>
              <th className="hidden px-3 py-2.5 font-medium sm:table-cell">الجوال</th>
              <th className="hidden px-3 py-2.5 font-medium md:table-cell">النوع</th>
              <th className="px-3 py-2.5 font-medium">البوكسات</th>
              {showMoney && <th className="whitespace-nowrap px-3 py-2.5 font-medium">الصافي</th>}
              <th className="hidden px-3 py-2.5 font-medium lg:table-cell">آخر شراء</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {slice.map((r) => (
              <tr
                key={r.customer.id}
                onClick={() => onOpen(r.customer)}
                className="cursor-pointer transition-colors hover:bg-surface-2"
              >
                <td className="px-4 py-2.5 font-medium">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {r.customer.name}
                    {r.unpaid > 0 && showMoney && <Badge tone="warn">لم يتم السداد</Badge>}
                    {r.returns.length > 0 && <Badge tone="neutral">{r.returns.length} مرتجع</Badge>}
                  </span>
                </td>
                <td className="tnum hidden px-3 py-2.5 text-muted sm:table-cell" dir="ltr">
                  {r.customer.phone ?? '—'}
                </td>
                <td className="hidden px-3 py-2.5 md:table-cell">
                  <Badge tone={TYPE_TONES[r.customer.type]}>{TYPE_LABELS[r.customer.type]}</Badge>
                </td>
                <td className="tnum px-3 py-2.5 text-muted">
                  {num(r.boxes)}
                  {r.freeBoxes > 0 && <span className="text-accent"> +{num(r.freeBoxes)}</span>}
                </td>
                {showMoney && (
                  <td className="tnum whitespace-nowrap px-3 py-2.5 font-semibold">
                    {money(r.spent)}
                  </td>
                )}
                <td className="tnum hidden px-3 py-2.5 text-muted lg:table-cell">
                  {r.lastAt ? date(r.lastAt) : '—'}
                </td>
                <td className="px-3 py-2.5 text-left">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation()
                      onEdit(r.customer)
                    }}
                    aria-label="تعديل العميل"
                  >
                    <Pencil className="size-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} pages={pages} onChange={setPage} total={rows.length} />
    </>
  )
}

/** بداية الشهر الحالي أو السابق — كشف الحساب يُرسل عادةً أول الشهر عن الشهر الفائت. */
function monthRange(offset: 0 | -1): { from: number; to: number } {
  const d = new Date()
  const from = new Date(d.getFullYear(), d.getMonth() + offset, 1).getTime()
  const to = new Date(d.getFullYear(), d.getMonth() + offset + 1, 0, 23, 59, 59, 999).getTime()
  return { from, to }
}

/** ملفّ العميل: أرقامه، ثم زرّ كشف الحساب، ثم فواتيره ومرتجعاته. */
function CustomerDetail({
  rollup,
  allInvoices,
  allReturns,
  settings,
  onClose,
  showMoney,
  onEdit,
  onDelete,
}: {
  rollup: Rollup | undefined
  allInvoices: Invoice[]
  allReturns: ReturnNote[]
  settings: ReturnType<typeof useApp>['settings']
  onClose: () => void
  showMoney: boolean
  onEdit: (c: Customer) => void
  onDelete: (c: Customer) => void
}) {
  const c = rollup?.customer
  const [month, setMonth] = useState<0 | -1>(0)
  const range = monthRange(month)

  const statement = c
    ? statementMessage({
        customer: c,
        invoices: allInvoices,
        returns: allReturns,
        from: range.from,
        to: range.to,
        settings,
      })
    : ''

  const monthInvoices = rollup
    ? rollup.invoices.filter(
        (i) => i.createdAt >= range.from && i.createdAt <= range.to && i.status !== 'refunded',
      )
    : []
  const monthReturns = rollup
    ? rollup.returns.filter((r) => r.createdAt >= range.from && r.createdAt <= range.to)
    : []
  const monthNet =
    monthInvoices.reduce((n, i) => n + i.total, 0) - monthReturns.reduce((n, r) => n + r.total, 0)

  return (
    <Modal
      open={Boolean(rollup)}
      onClose={onClose}
      size="lg"
      title={c?.name ?? ''}
      subtitle={c && `${TYPE_LABELS[c.type]} · عميل منذ ${date(c.createdAt)}`}
      footer={
        <>
          {c && (
            <Button variant="danger" onClick={() => onDelete(c)}>
              <Trash2 className="size-4" />
              حذف
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            إغلاق
          </Button>
          {c && (
            <Button variant="primary" onClick={() => onEdit(c)}>
              <Pencil className="size-4" />
              تعديل
            </Button>
          )}
        </>
      }
    >
      {rollup && c && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="عدد الفواتير" value={num(rollup.invoices.length)} />
            <Stat
              label="بوكسات"
              value={num(rollup.boxes)}
              sub={rollup.freeBoxes ? `+${num(rollup.freeBoxes)} عينة` : undefined}
            />
            {showMoney && <Stat label="الصافي بعد المرتجع" value={money(rollup.spent)} tone="ok" />}
            {showMoney && rollup.unpaid > 0 ? (
              <Stat label="لم يتم السداد" value={money(rollup.unpaid)} tone="warn" />
            ) : (
              <Stat label="مرتجعات" value={num(rollup.returns.length)} tone="neutral" />
            )}
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-xl border border-border p-3 text-sm">
            <span className="flex items-center gap-1.5 text-muted">
              <Phone className="size-3.5" />
              <span className="tnum" dir="ltr">
                {c.phone ?? '—'}
              </span>
            </span>
            {c.vatNumber && (
              <span className="text-muted">
                الرقم الضريبي: <span className="tnum">{c.vatNumber}</span>
              </span>
            )}
            {c.notes && <span className="w-full text-muted">{c.notes}</span>}
          </div>

          {/* كشف الشهر: سؤال العميل «نهاية الشهر كم بعت على ذا» — زرّ واحد يرسله. */}
          <section className="rounded-xl border border-brand/30 bg-brand-soft/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">كشف حساب {monthLabel(range.from)}</p>
                <p className="tnum mt-0.5 text-[12px] text-muted">
                  {monthInvoices.length} فاتورة · {monthReturns.length} مرتجع
                  {showMoney && ` · الصافي ${money(monthNet)}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={String(month)}
                  onChange={(e) => setMonth(Number(e.target.value) as 0 | -1)}
                  className="w-36"
                >
                  <option value="0">هذا الشهر</option>
                  <option value="-1">الشهر الماضي</option>
                </Select>
                <a href={waLink(c.phone, statement)} target="_blank" rel="noreferrer">
                  <Button variant="primary" size="sm">
                    <MessageCircle className="size-4" />
                    أرسل واتساب
                  </Button>
                </a>
              </div>
            </div>
          </section>

          <section>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <FileText className="size-4 text-faint" />
              الفواتير
            </h3>
            {rollup.invoices.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-3 py-5 text-center text-sm text-muted">
                لا توجد فواتير باسمه بعد.
              </p>
            ) : (
              <div className="max-h-64 overflow-auto rounded-xl border border-border">
                <table className="w-full text-[13px]">
                  <tbody className="divide-y divide-border">
                    {rollup.invoices.map((inv) => {
                      const free = inv.lines.reduce((n, l) => n + l.freeQty, 0)
                      return (
                        <tr key={inv.id}>
                          <td className="tnum whitespace-nowrap px-2 py-2 font-medium text-brand-strong">
                            <span className="flex items-center gap-1.5">
                              {inv.number}
                              {inv.status === 'refunded' && <Badge tone="danger">مسترجعة</Badge>}
                              {inv.status === 'unpaid' && <Badge tone="warn">لم يتم السداد</Badge>}
                            </span>
                          </td>
                          <td className="tnum whitespace-nowrap px-2 py-2 text-muted">
                            {date(inv.createdAt)}
                          </td>
                          <td className="tnum hidden whitespace-nowrap px-2 py-2 text-muted sm:table-cell">
                            {inv.lines.reduce((n, l) => n + l.qty, 0)} بوكس
                            {free > 0 && <span className="text-accent"> +{free}</span>}
                          </td>
                          <td className="tnum whitespace-nowrap px-2 py-2 text-left font-semibold">
                            {money(inv.total)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {rollup.returns.length > 0 && (
            <section>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Undo2 className="size-4 text-faint" />
                المرتجعات
              </h3>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-[13px]">
                  <tbody className="divide-y divide-border">
                    {rollup.returns.map((r) => (
                      <tr key={r.id}>
                        <td className="tnum whitespace-nowrap px-2 py-2 font-medium">{r.number}</td>
                        <td className="tnum whitespace-nowrap px-2 py-2 text-muted">
                          {date(r.createdAt)}
                        </td>
                        <td className="hidden px-2 py-2 sm:table-cell">
                          <Badge tone={r.restock ? 'ok' : 'danger'}>
                            {r.restock ? 'عاد للمخزون' : 'منتهي'}
                          </Badge>
                        </td>
                        <td className="tnum whitespace-nowrap px-2 py-2 text-left font-semibold">
                          - {money(r.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}
    </Modal>
  )
}
