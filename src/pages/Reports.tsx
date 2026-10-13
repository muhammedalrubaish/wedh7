import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  Download,
  CakeSlice,
  MessageCircle,
  PieChart as PieIcon,
  Snowflake,
  Store,
  Trophy,
  Undo2,
  Users2,
} from 'lucide-react'
import { Badge, Button, Card, CardHeader, EmptyState, Tabs, cn } from '@/components/ui'
import { Stat } from '@/components/Stat'
import { db } from '@/lib/db'
import {
  byCustomer,
  changePercent,
  dailySeries,
  deadStock,
  PURCHASE_KINDS,
  PURCHASE_KIND_LABELS,
  purchasesSummary,
  summarize,
  topParts,
  type PartPerformance,
} from '@/lib/analytics'
import {
  date,
  daysAgo,
  endOfDay,
  money,
  monthLabel,
  num,
  relative,
  round2,
  shortDay,
  startOfDay,
} from '@/lib/format'
import { statementMessage, waLink } from '@/lib/whatsapp'
import { useApp } from '@/store/app'
import {
  useActiveParts,
  useCategories,
  useCustomers,
  useInvoices,
  useMovements,
  usePurchaseBills,
  useReturns,
} from '@/hooks/useShopData'

type Period = 'day' | 'week' | 'month' | 'thisMonth' | 'lastMonth' | 'quarter' | 'custom'

const PERIOD_DAYS: Record<'day' | 'week' | 'month' | 'quarter', number> = {
  day: 1,
  week: 7,
  month: 30,
  quarter: 90,
}
const PERIOD_LABEL: Record<Period, string> = {
  day: 'اليومي',
  week: 'الأسبوعي',
  month: 'آخر ٣٠ يوم',
  thisMonth: 'الشهر الحالي',
  lastMonth: 'الشهر الماضي',
  quarter: 'الربع سنوي',
  custom: 'لمدة مخصّصة',
}

/** `yyyy-mm-dd` لحقل التاريخ في المتصفح — التوقيت المحلي لا UTC. */
const toInputDate = (ts: number): string => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function calendarMonth(offset: number): { from: number; to: number } {
  const d = new Date()
  const from = new Date(d.getFullYear(), d.getMonth() + offset, 1).getTime()
  const to = Math.min(
    new Date(d.getFullYear(), d.getMonth() + offset + 1, 0, 23, 59, 59, 999).getTime(),
    endOfDay(),
  )
  return { from, to }
}

export default function Reports() {
  const { can, settings } = useApp()
  const invoices = useInvoices()
  const returns = useReturns()
  const customers = useCustomers()
  const parts = useActiveParts()
  const movements = useMovements()
  const bills = usePurchaseBills()
  const categories = useCategories()
  const users = useLiveQuery(() => db.users.toArray(), [], [])

  // الافتراضي الشهر الحالي: سؤال العميل شهري («نهاية الشهر كم بعت على كل محل»).
  const [period, setPeriod] = useState<Period>('thisMonth')
  const [customFrom, setCustomFrom] = useState(() => toInputDate(daysAgo(29)))
  const [customTo, setCustomTo] = useState(() => toInputDate(Date.now()))

  const { from, to, days } = useMemo(() => {
    if (period === 'custom') {
      const a = startOfDay(new Date(`${customFrom}T00:00:00`))
      const b = endOfDay(new Date(`${customTo}T00:00:00`))
      const [f, t] = a <= b ? [a, b] : [b, a]
      return { from: f, to: t, days: Math.max(1, Math.round((t - f) / 86_400_000) + 1) }
    }
    if (period === 'thisMonth' || period === 'lastMonth') {
      const r = calendarMonth(period === 'thisMonth' ? 0 : -1)
      return { ...r, days: Math.max(1, Math.round((r.to - r.from) / 86_400_000) + 1) }
    }
    const n = PERIOD_DAYS[period]
    return { from: daysAgo(n - 1), to: endOfDay(), days: n }
  }, [period, customFrom, customTo])

  const current = useMemo(
    () => summarize(invoices, returns, from, to),
    [invoices, returns, from, to],
  )
  const previous = useMemo(
    () => summarize(invoices, returns, from - days * 86_400_000, from - 1),
    [invoices, returns, days, from],
  )

  const series = useMemo(
    () => dailySeries(invoices, returns, Math.min(from, daysAgo(13)), to),
    [invoices, returns, from, to],
  )

  const best = useMemo(
    () => topParts(invoices, returns, from, to, 10),
    [invoices, returns, from, to],
  )
  const dead = useMemo(() => deadStock(parts, movements, 21).slice(0, 10), [parts, movements])
  const perCustomer = useMemo(
    () => byCustomer(invoices, returns, from, to),
    [invoices, returns, from, to],
  )

  const byCategory = useMemo(() => {
    const partCat = new Map(parts.map((p) => [p.id, p.categoryId]))
    const map = new Map<string, { revenue: number; profit: number; units: number }>()
    for (const inv of invoices) {
      if (inv.createdAt < from || inv.createdAt > to || inv.status === 'refunded') continue
      for (const l of inv.lines) {
        const catId = partCat.get(l.partId) ?? 'unknown'
        const row = map.get(catId) ?? { revenue: 0, profit: 0, units: 0 }
        const rev = l.unitPrice * l.qty - l.discount
        row.revenue += rev
        row.profit += rev - l.unitCost * (l.qty + l.freeQty)
        row.units += l.qty
        map.set(catId, row)
      }
    }
    for (const r of returns) {
      if (r.createdAt < from || r.createdAt > to) continue
      for (const l of r.lines) {
        const catId = partCat.get(l.partId) ?? 'unknown'
        const row = map.get(catId) ?? { revenue: 0, profit: 0, units: 0 }
        const rev = l.unitPrice * l.qty
        row.revenue -= rev
        row.profit -= rev - (r.restock ? l.unitCost * l.qty : 0)
        row.units -= l.qty
        map.set(catId, row)
      }
    }
    return [...map.entries()]
      .map(([id, v]) => ({
        name: categories.find((c) => c.id === id)?.name ?? 'غير مصنّف',
        revenue: Math.round(v.revenue),
        profit: Math.round(v.profit),
        units: v.units,
      }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [invoices, returns, parts, categories, from, to])

  const byStaff = useMemo(() => {
    const map = new Map<string, { revenue: number; invoices: number }>()
    for (const inv of invoices) {
      if (inv.createdAt < from || inv.createdAt > to || inv.status === 'refunded') continue
      const row = map.get(inv.userId) ?? { revenue: 0, invoices: 0 }
      row.revenue += inv.subtotal - inv.discount
      row.invoices += 1
      map.set(inv.userId, row)
    }
    return [...map.entries()]
      .map(([id, v]) => ({
        name: users.find((u) => u.id === id)?.name ?? 'مستخدم محذوف',
        revenue: Math.round(v.revenue),
        invoices: v.invoices,
        average: v.invoices ? Math.round(v.revenue / v.invoices) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [invoices, users, from, to])

  const showMoney = can('reports.financial')
  // `to` نهاية اليوم شاملة، والملخّص يأخذ نهاية مفتوحة — فيُزاد ميلي ثانية.
  const spend = useMemo(() => purchasesSummary(bills, from, to + 1), [bills, from, to])
  const showSpend = showMoney && can('purchase.view') && spend.bills > 0

  function exportCsv() {
    const rows: string[][] = [
      ['تقرير', PERIOD_LABEL[period]],
      ['من', date(from)],
      ['إلى', date(to)],
      [],
      ['المؤشر', 'القيمة'],
      ['المبيعات بدون ضريبة (بعد المرتجع)', String(current.revenue)],
      ['المرتجعات بدون ضريبة', String(current.returned)],
      ['الضريبة المحصّلة', String(current.vat)],
      ...(showMoney
        ? [
            ['التكلفة', String(current.cost)],
            ['الربح', String(current.profit)],
            ['تكلفة العينات', String(current.freeCost)],
          ]
        : []),
      ['عدد الفواتير', String(current.invoices)],
      ['البوكسات المباعة', String(current.units)],
      ['بوكسات العينات', String(current.freeUnits)],
      ['بوكسات مرتجعة', String(current.returnedUnits)],
      ['متوسط الفاتورة', String(current.averageTicket)],
      [],
      [
        'حسب العميل',
        'الفواتير',
        'البوكسات',
        'عينات',
        'المبيعات',
        'المرتجع',
        'الصافي بدون ضريبة',
        'الإجمالي بالضريبة',
        ...(showMoney ? ['الربح'] : []),
      ],
      ...perCustomer.map((c) => [
        c.name,
        String(c.invoices),
        String(c.units),
        String(c.freeUnits),
        String(c.gross),
        String(c.returned),
        String(c.net),
        String(c.totalWithVat),
        ...(showMoney ? [String(c.profit)] : []),
      ]),
      [],
      ['الأكثر مبيعاً', 'الكمية', 'عينات', 'الإيراد', ...(showMoney ? ['الربح'] : [])],
      ...best.map((p: PartPerformance) => [
        p.name,
        String(p.units),
        String(p.freeUnits),
        String(p.revenue),
        ...(showMoney ? [String(p.profit)] : []),
      ]),
      [],
      ['حسب التصنيف', 'الإيراد', ...(showMoney ? ['الربح'] : []), 'البوكسات'],
      ...byCategory.map((c) => [
        c.name,
        String(c.revenue),
        ...(showMoney ? [String(c.profit)] : []),
        String(c.units),
      ]),
      [],
      ['حسب الموظف', 'الإيراد', 'الفواتير', 'متوسط الفاتورة'],
      ...byStaff.map((s) => [s.name, String(s.revenue), String(s.invoices), String(s.average)]),
    ]
    // علامة BOM كي يفتح Excel الأعمدة العربية بلا تشويه.
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${c ?? ''}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `تقرير-وضح-${PERIOD_LABEL[period]}-${date(Date.now())}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">التقرير {PERIOD_LABEL[period]}</h1>
          <p className="mt-0.5 text-sm text-muted">
            {date(from)} — {date(to)} · {monthLabel(to)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Tabs
            value={period}
            onChange={setPeriod}
            items={[
              { value: 'thisMonth', label: 'هذا الشهر' },
              { value: 'lastMonth', label: 'الشهر الماضي' },
              { value: 'week', label: '٧ أيام' },
              { value: 'quarter', label: '٩٠ يوم' },
              { value: 'custom', label: 'مخصّص' },
            ]}
          />
          {period === 'custom' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                aria-label="من تاريخ"
                value={customFrom}
                max={customTo}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-9 rounded-xl border border-border bg-surface px-3 text-[13px]"
              />
              <span className="text-muted">—</span>
              <input
                type="date"
                aria-label="إلى تاريخ"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-9 rounded-xl border border-border bg-surface px-3 text-[13px]"
              />
            </div>
          )}
          <Button variant="secondary" onClick={exportCsv}>
            <Download className="size-4" />
            تصدير CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="المبيعات"
          value={money(current.revenue, { compact: true })}
          change={changePercent(current.revenue, previous.revenue)}
          sub={
            current.returned > 0
              ? `بدون ضريبة · بعد مرتجع ${money(current.returned, { compact: true })}`
              : 'بدون ضريبة'
          }
        />
        {showMoney ? (
          <Stat
            label="الربح"
            value={money(current.profit, { compact: true })}
            tone="ok"
            change={changePercent(current.profit, previous.profit)}
            sub={`هامش ${current.marginPercent.toFixed(1)}٪`}
          />
        ) : (
          <Stat
            label="الفواتير"
            value={num(current.invoices)}
            tone="accent"
            change={changePercent(current.invoices, previous.invoices)}
            sub={`${num(current.units)} بوكس`}
          />
        )}
        <Stat
          label="عينات"
          value={num(current.freeUnits)}
          tone="accent"
          icon={<CakeSlice className="size-5" />}
          sub={
            showMoney && current.freeCost > 0
              ? `تكلفتها ${money(current.freeCost, { compact: true })}`
              : 'بوكس بلا مقابل'
          }
        />
        <Stat
          label="مرتجعات"
          value={num(current.returnedUnits)}
          tone={current.returnedUnits ? 'warn' : 'ok'}
          icon={<Undo2 className="size-5" />}
          sub={current.returned > 0 ? money(current.returned, { compact: true }) : 'لا مرتجعات'}
        />
      </div>

      {/* الصرف بجانب الربح لا مطروحاً منه: الربح يحسب تكلفة ما بيع، والمشتريات
      نقدٌ خرج في الفترة — فرن اليوم أو كرتون الشهر القادم لا يخصّان مبيعات هذه الفترة. */}
      {showSpend && (
        <Card className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] text-muted">مشتريات المعمل في الفترة</p>
              <p className="tnum mt-1 text-xl font-bold break-words">{money(spend.total)}</p>
              <p className="tnum mt-0.5 text-[12px] text-muted">
                {num(spend.bills)} فاتورة مشتريات
              </p>
            </div>
            <div className="min-w-0 text-left">
              <p className="text-[13px] text-muted">المبيعات ناقص المشتريات</p>
              <p
                className={cn(
                  'tnum mt-1 text-xl font-bold break-words',
                  current.revenue - spend.total < 0 ? 'text-danger' : 'text-ok',
                )}
              >
                {money(round2(current.revenue - spend.total))}
              </p>
              <p className="mt-0.5 text-[12px] text-muted">نقد داخل ناقص نقد خارج — ليس الربح</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
            {PURCHASE_KINDS.filter((k) => spend.byKind[k] > 0).map((k) => (
              <Badge key={k} tone="neutral">
                {PURCHASE_KIND_LABELS[k]} <span className="tnum">{money(spend.byKind[k])}</span>
              </Badge>
            ))}
          </div>
        </Card>
      )}

      {/* سؤال العميل الأول: «كم بعت على كل محل» — أول جدول في الصفحة. */}
      <Card>
        <CardHeader
          title="حسب العميل"
          subtitle="المبيعات والمرتجعات والعينات لكل محل في الفترة"
          icon={<Store className="size-[18px]" />}
        />
        {perCustomer.length === 0 ? (
          <EmptyState title="لا توجد مبيعات في هذه الفترة" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface-2 text-right text-[12px] text-muted">
                  <th className="px-4 py-2.5 font-medium">العميل</th>
                  <th className="hidden px-3 py-2.5 font-medium sm:table-cell">فواتير</th>
                  <th className="px-3 py-2.5 font-medium">بوكسات</th>
                  <th className="hidden px-3 py-2.5 font-medium md:table-cell">مرتجع</th>
                  <th className="px-3 py-2.5 font-medium">الصافي</th>
                  {showMoney && (
                    <th className="hidden px-3 py-2.5 font-medium lg:table-cell">الربح</th>
                  )}
                  <th className="px-2 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {perCustomer.map((c) => {
                  const customer = customers.find((x) => x.id === c.customerId)
                  return (
                    <tr key={c.customerId} className="transition-colors hover:bg-surface-2">
                      <td className="px-4 py-2.5 font-medium">
                        <span className="flex flex-wrap items-center gap-1.5">
                          {c.name}
                          {c.unpaid > 0 && showMoney && <Badge tone="warn">آجل</Badge>}
                        </span>
                      </td>
                      <td className="tnum hidden px-3 py-2.5 text-muted sm:table-cell">
                        {num(c.invoices)}
                      </td>
                      <td className="tnum px-3 py-2.5">
                        {num(c.units)}
                        {c.freeUnits > 0 && (
                          <span className="text-accent"> +{num(c.freeUnits)}</span>
                        )}
                      </td>
                      <td className="tnum hidden px-3 py-2.5 md:table-cell">
                        {c.returned > 0 ? (
                          <span className="text-warn">
                            - {money(c.returned, { compact: true })}
                            <span className="text-faint"> ({num(c.returnedUnits)})</span>
                          </span>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td className="tnum px-3 py-2.5 font-semibold">
                        {money(c.totalWithVat, { compact: true })}
                        <span className="block text-[11px] font-normal text-faint">بالضريبة</span>
                      </td>
                      {showMoney && (
                        <td
                          className={cn(
                            'tnum hidden px-3 py-2.5 font-medium lg:table-cell',
                            c.profit < 0 ? 'text-danger' : 'text-ok',
                          )}
                        >
                          {money(c.profit, { compact: true })}
                        </td>
                      )}
                      <td className="px-2 py-2.5 text-left">
                        {customer && (
                          <a
                            href={waLink(
                              customer.phone,
                              statementMessage({ customer, invoices, returns, from, to, settings }),
                            )}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`كشف حساب ${customer.name} عبر واتساب`}
                            title="أرسل كشف الحساب واتساب"
                          >
                            <Button size="icon" variant="ghost">
                              <MessageCircle className="size-4" />
                            </Button>
                          </a>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="الاتجاه اليومي" subtitle="آخر ١٤ يوم على الأقل — بعد خصم المرتجعات" />
        <div dir="ltr" className="h-72 p-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="ts"
                tickFormatter={(v) => shortDay(Number(v))}
                tick={{ fontSize: 11, fill: 'var(--text-faint)' }}
                axisLine={false}
                tickLine={false}
                minTickGap={20}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--text-faint)' }}
                axisLine={false}
                tickLine={false}
                width={52}
                tickFormatter={(v) =>
                  new Intl.NumberFormat('en', { notation: 'compact' }).format(Number(v))
                }
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  direction: 'rtl',
                  fontSize: 12,
                }}
                labelFormatter={(v) => shortDay(Number(v))}
                formatter={(v: number, name) => [money(v), name]}
              />
              <Legend wrapperStyle={{ fontSize: 12, direction: 'rtl' }} />
              <Line
                type="monotone"
                dataKey="revenue"
                name="الإيراد"
                stroke="var(--brand)"
                strokeWidth={2}
                dot={false}
              />
              {showMoney && (
                <Line
                  type="monotone"
                  dataKey="profit"
                  name="الربح"
                  stroke="var(--ok)"
                  strokeWidth={2}
                  dot={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="أداء التصنيفات"
            icon={<PieIcon className="size-[18px]" />}
            subtitle={showMoney ? 'الإيراد مقابل الربح' : 'الإيراد'}
          />
          {byCategory.length === 0 ? (
            <EmptyState title="لا توجد مبيعات في هذه الفترة" />
          ) : (
            <div dir="ltr" className="h-72 p-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byCategory} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                    angle={-25}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: 'var(--text-faint)' }}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                    tickFormatter={(v) =>
                      new Intl.NumberFormat('en', { notation: 'compact' }).format(Number(v))
                    }
                  />
                  <Tooltip
                    cursor={{ fill: 'var(--surface-2)' }}
                    contentStyle={{
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 12,
                      direction: 'rtl',
                      fontSize: 12,
                    }}
                    formatter={(v: number, name) => [money(v), name]}
                  />
                  <Bar
                    dataKey="revenue"
                    name="الإيراد"
                    fill="var(--brand)"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={28}
                  />
                  {showMoney && (
                    <Bar
                      dataKey="profit"
                      name="الربح"
                      fill="var(--ok)"
                      radius={[6, 6, 0, 0]}
                      maxBarSize={28}
                    />
                  )}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="أداء الموظفين" icon={<Users2 className="size-[18px]" />} />
          {byStaff.length === 0 ? (
            <EmptyState title="لا توجد مبيعات في هذه الفترة" />
          ) : (
            <ul className="divide-y divide-border">
              {byStaff.map((s, i) => (
                <li key={s.name} className="flex items-center gap-3 px-4 py-3">
                  <span
                    className={cn(
                      'grid size-8 shrink-0 place-items-center rounded-full text-[13px] font-bold',
                      i === 0 ? 'bg-warn-soft text-warn' : 'bg-surface-2 text-muted',
                    )}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{s.name}</p>
                    <p className="tnum text-[11px] text-faint">
                      {s.invoices} فاتورة · متوسط {money(s.average, { compact: true })}
                    </p>
                  </div>
                  <span className="tnum shrink-0 font-semibold">
                    {money(s.revenue, { compact: true })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="الأكثر مبيعاً" icon={<Trophy className="size-[18px]" />} />
          {best.length === 0 ? (
            <EmptyState title="لا توجد مبيعات" />
          ) : (
            <ul className="divide-y divide-border">
              {best.map((p, i) => (
                <li key={p.partId} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="tnum w-5 shrink-0 text-center text-[12px] text-faint">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{p.name}</p>
                    <p className="tnum text-[11px] text-faint">
                      {p.units} بوكس
                      {p.freeUnits > 0 && ` · ${p.freeUnits} عينة`}
                      {showMoney && ` · ربح ${money(p.profit, { compact: true })}`}
                    </p>
                  </div>
                  <span className="tnum shrink-0 text-[13px] font-semibold">
                    {money(p.revenue, { compact: true })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="بضاعة راكدة"
            subtitle="ما بيع منها ولا بوكس خلال ٢١ يوم — انتبه للصلاحية"
            icon={<Snowflake className="size-[18px]" />}
          />
          {dead.length === 0 ? (
            <EmptyState title="ما فيه بضاعة راكدة" description="كل الأصناف تتحرك." />
          ) : (
            <ul className="divide-y divide-border">
              {dead.map((d) => (
                <li key={d.part.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{d.part.name}</p>
                    <p className="tnum text-[11px] text-faint">
                      {d.part.qty} بوكس ·{' '}
                      {d.lastSoldAt ? `آخر بيع ${relative(d.lastSoldAt)}` : 'لم يُبع أبداً'}
                    </p>
                  </div>
                  {showMoney ? (
                    <Badge tone="warn">{money(d.tiedCapital, { compact: true })}</Badge>
                  ) : (
                    <Badge tone="warn">{d.part.qty}</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
