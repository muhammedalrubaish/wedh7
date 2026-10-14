import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  Coins,
  FileText,
  Package,
  Receipt,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { Badge, Button, Card, CardHeader, EmptyState, Meter, Tabs } from '@/components/ui'
import { Stat } from '@/components/Stat'
import {
  changePercent,
  countedQty,
  dailySeries,
  inventoryValue,
  reorderSuggestions,
  summarize,
  topParts,
} from '@/lib/analytics'
import { daysAgo, endOfDay, money, num, shortDay, time } from '@/lib/format'
import {
  useActiveParts,
  useCategories,
  useInvoices,
  useMovements,
  usePurchaseOrders,
  useReturns,
} from '@/hooks/useShopData'
import { useApp } from '@/store/app'

type Range = 'today' | 'week' | 'month'

const RANGE_DAYS: Record<Range, number> = { today: 1, week: 7, month: 30 }
const RANGE_LABEL: Record<Range, string> = { today: 'اليوم', week: 'الأسبوع', month: 'الشهر' }

const PIE_COLORS = [
  'var(--brand)',
  'var(--accent)',
  'var(--ok)',
  'var(--warn)',
  'var(--danger)',
  'oklch(0.65 0.12 320)',
  'oklch(0.68 0.11 40)',
  'oklch(0.6 0.1 240)',
]

export default function Dashboard() {
  const { user, can } = useApp()
  const [range, setRange] = useState<Range>('week')

  const parts = useActiveParts()
  const invoices = useInvoices()
  const returns = useReturns()
  const movements = useMovements()
  const purchaseOrders = usePurchaseOrders()
  const categories = useCategories()

  const days = RANGE_DAYS[range]
  const from = daysAgo(days - 1)
  const to = endOfDay()
  const prevFrom = daysAgo(days * 2 - 1)
  const prevTo = from - 1

  const current = useMemo(
    () => summarize(invoices, returns, from, to),
    [invoices, returns, from, to],
  )
  const previous = useMemo(
    () => summarize(invoices, returns, prevFrom, prevTo),
    [invoices, returns, prevFrom, prevTo],
  )

  const series = useMemo(
    () => dailySeries(invoices, returns, daysAgo(days === 1 ? 13 : days - 1), to),
    [invoices, returns, days, to],
  )

  const best = useMemo(
    () => topParts(invoices, returns, from, to, 6),
    [invoices, returns, from, to],
  )
  const reorder = useMemo(
    () => reorderSuggestions(parts, movements, purchaseOrders),
    [parts, movements, purchaseOrders],
  )
  const stock = useMemo(() => inventoryValue(parts), [parts])

  const byCategory = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of parts)
      map.set(p.categoryId, (map.get(p.categoryId) ?? 0) + countedQty(p) * p.cost)
    return categories
      .map((c) => ({ name: c.name, value: Math.round(map.get(c.id) ?? 0) }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
  }, [parts, categories])

  const recent = useMemo(
    () => [...invoices].sort((a, b) => b.createdAt - a.createdAt).slice(0, 7),
    [invoices],
  )

  const showMoney = can('reports.financial')
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'صباح الخير' : hour < 17 ? 'مساء الخير' : 'مساء الخير'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            {greeting}، {user?.name.split(' ')[0]}
          </h1>
          <p className="mt-1 text-sm text-muted">ملخص حركة المعمل والمحل — {RANGE_LABEL[range]}</p>
        </div>
        <Tabs
          value={range}
          onChange={setRange}
          items={[
            { value: 'today', label: 'اليوم' },
            { value: 'week', label: '٧ أيام' },
            { value: 'month', label: '٣٠ يوم' },
          ]}
        />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="المبيعات (بدون ضريبة)"
          value={money(current.revenue, { compact: true })}
          icon={<Coins className="size-5" />}
          tone="brand"
          change={changePercent(current.revenue, previous.revenue)}
          sub={
            current.returned > 0
              ? `بعد مرتجع ${money(current.returned, { compact: true })}`
              : `مقابل ${money(previous.revenue, { compact: true })}`
          }
        />
        {showMoney ? (
          <Stat
            label="صافي الربح"
            value={money(current.profit, { compact: true })}
            icon={<TrendingUp className="size-5" />}
            tone="ok"
            change={changePercent(current.profit, previous.profit)}
            sub={`هامش ${current.marginPercent.toFixed(1)}٪`}
          />
        ) : (
          <Stat
            label="البوكسات المباعة"
            value={num(current.units)}
            icon={<Boxes className="size-5" />}
            tone="ok"
            change={changePercent(current.units, previous.units)}
          />
        )}
        <Stat
          label="عدد الفواتير"
          value={num(current.invoices)}
          icon={<Receipt className="size-5" />}
          tone="accent"
          change={changePercent(current.invoices, previous.invoices)}
          sub={`متوسط الفاتورة ${money(current.averageTicket, { compact: true })}`}
        />
        <Stat
          label="أصناف تحتاج إنتاج"
          value={num(reorder.length)}
          icon={<AlertTriangle className="size-5" />}
          tone={reorder.length ? 'warn' : 'ok'}
          sub={
            reorder.filter((r) => r.severity === 'out').length
              ? `${reorder.filter((r) => r.severity === 'out').length} صنف نفد تماماً`
              : 'الأرصدة ضمن الحد الآمن'
          }
        />
      </div>

      {/* Trend + category mix */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="حركة المبيعات"
            subtitle={showMoney ? 'الإيراد والربح يومياً' : 'الإيراد اليومي'}
            icon={<TrendingUp className="size-[18px]" />}
          />
          <div dir="ltr" className="h-64 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--brand)" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gProfit" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--ok)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--ok)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="ts"
                  tickFormatter={(v) => shortDay(Number(v))}
                  tick={{ fontSize: 11, fill: 'var(--text-faint)' }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={24}
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
                <Tooltip content={<ChartTooltip showProfit={showMoney} />} />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="var(--brand)"
                  strokeWidth={2}
                  fill="url(#gRev)"
                  name="الإيراد"
                />
                {showMoney && (
                  <Area
                    type="monotone"
                    dataKey="profit"
                    stroke="var(--ok)"
                    strokeWidth={2}
                    fill="url(#gProfit)"
                    name="الربح"
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* رأس المال وتوزيعه على التصنيفات أرقام تكلفة صريحة.
            كانت البطاقة تُعرض للجميع بينما `showMoney` يحرس كل ما حولها — فكان
            الموظف يقرأ قيمة بضاعة المحل بالتكلفة من أول شاشة يفتحها.
            ومع طبقة المناظر تصل `cost` فارغة لمن لا يملك الصلاحية، فتصير
            البطاقة رقماً خاطئاً بدل أن تكون مخفية. الحجب هو الصواب في الحالتين. */}
        {showMoney && (
          <Card>
            <CardHeader
              title="رأس المال في المخزون"
              subtitle={`${num(stock.units)} بوكس — بالتكلفة`}
              icon={<Wallet className="size-[18px]" />}
            />
            <div className="p-4">
              <p className="tnum text-center text-2xl font-bold">{money(stock.cost)}</p>
              <p className="mt-1 text-center text-[13px] text-muted">
                قيمة بيع متوقعة {money(stock.retail, { compact: true })}
              </p>
              <div dir="ltr" className="mt-2 h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={byCategory}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={44}
                      outerRadius={68}
                      paddingAngle={2}
                      stroke="none"
                    >
                      {byCategory.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<PieTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 space-y-1.5">
                {byCategory.slice(0, 4).map((c, i) => (
                  <div key={c.name} className="flex items-center gap-2 text-[13px]">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                    />
                    <span className="flex-1 truncate text-muted">{c.name}</span>
                    <span className="tnum">{money(c.value, { compact: true })}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Reorder + top parts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="يحتاج إنتاج"
            subtitle="مرتّبة حسب أيام التغطية المتبقية"
            icon={<AlertTriangle className="size-[18px]" />}
            action={
              <Link to="/inventory?filter=reorder">
                <Button size="sm" variant="ghost">
                  الكل <ArrowLeft className="size-3.5" />
                </Button>
              </Link>
            }
          />
          {reorder.length === 0 ? (
            <EmptyState
              icon={<Package className="size-6" />}
              title="كل الأصناف فوق حدّ التنبيه"
              description="ما فيه شيء يحتاج إنتاج اليوم."
            />
          ) : (
            <ul className="divide-y divide-border">
              {reorder.slice(0, 6).map((r) => (
                <li key={r.part.id}>
                  <Link
                    to={`/inventory/${r.part.id}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-[13px] font-medium">{r.part.name}</p>
                        <Badge
                          tone={
                            r.severity === 'out'
                              ? 'danger'
                              : r.severity === 'critical'
                                ? 'warn'
                                : 'neutral'
                          }
                          dot
                        >
                          {r.severity === 'out'
                            ? 'نفد'
                            : r.severity === 'critical'
                              ? 'حرج'
                              : 'منخفض'}
                        </Badge>
                      </div>
                      <div className="mt-1.5">
                        <Meter
                          value={r.part.qty}
                          max={Math.max(r.part.reorderPoint * 2, 1)}
                          tone={
                            r.severity === 'out'
                              ? 'danger'
                              : r.severity === 'critical'
                                ? 'warn'
                                : 'brand'
                          }
                        />
                      </div>
                      <p className="tnum mt-1.5 text-[11px] text-faint">
                        الرصيد {r.part.qty} · حدّ التنبيه {r.part.reorderPoint}
                        {r.onOrderQty > 0 && ` · بالطريق ${r.onOrderQty}`}
                        {Number.isFinite(r.daysOfCover) &&
                          ` · تكفي ${Math.floor(r.daysOfCover)} يوم`}
                      </p>
                    </div>
                    <div className="shrink-0 text-left">
                      <p className="text-[11px] text-faint">أنتج</p>
                      <p className="tnum text-lg font-bold text-brand-strong">{r.suggestedQty}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="الأكثر مبيعاً"
            subtitle={RANGE_LABEL[range]}
            icon={<Boxes className="size-[18px]" />}
          />
          {best.length === 0 ? (
            <EmptyState icon={<Boxes className="size-6" />} title="لا توجد مبيعات في هذه الفترة" />
          ) : (
            <div dir="ltr" className="h-[268px] p-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={[...best].reverse()}
                  layout="vertical"
                  margin={{ left: 4, right: 12 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: 'var(--text-faint)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={140}
                    tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: string) => (v.length > 22 ? v.slice(0, 21) + '…' : v)}
                  />
                  <Tooltip
                    content={<BarTooltip showProfit={showMoney} />}
                    cursor={{ fill: 'var(--surface-2)' }}
                  />
                  <Bar
                    dataKey="revenue"
                    fill="var(--brand)"
                    radius={[0, 6, 6, 0]}
                    maxBarSize={18}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      {/* Recent invoices */}
      <Card>
        <CardHeader
          title="آخر الفواتير"
          icon={<FileText className="size-[18px]" />}
          action={
            <Link to="/invoices">
              <Button size="sm" variant="ghost">
                الكل <ArrowLeft className="size-3.5" />
              </Button>
            </Link>
          }
        />
        {recent.length === 0 ? (
          <EmptyState icon={<FileText className="size-6" />} title="لا توجد فواتير بعد" />
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                <span className="tnum w-24 shrink-0 font-medium text-brand-strong">
                  {inv.number}
                </span>
                <span className="min-w-0 flex-1 truncate text-muted">
                  {inv.customerName ?? 'بيع نقدي'} · {inv.lines.reduce((n, l) => n + l.qty, 0)} بوكس
                </span>
                <span className="tnum shrink-0 text-faint">{time(inv.createdAt)}</span>
                <span className="tnum w-24 shrink-0 text-left font-semibold">
                  {money(inv.total)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

interface TooltipPayload {
  active?: boolean
  payload?: Array<{ payload: Record<string, unknown> }>
}

function shell(children: React.ReactNode) {
  return (
    <div
      dir="rtl"
      className="rounded-xl border border-border bg-surface px-3 py-2 text-[12px] shadow-lg"
    >
      {children}
    </div>
  )
}

function ChartTooltip({ active, payload, showProfit }: TooltipPayload & { showProfit: boolean }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload as { ts: number; revenue: number; profit: number; invoices: number }
  return shell(
    <>
      <p className="mb-1 font-medium">{shortDay(p.ts)}</p>
      <p className="tnum text-muted">الإيراد: {money(p.revenue)}</p>
      {showProfit && <p className="tnum text-ok">الربح: {money(p.profit)}</p>}
      <p className="tnum text-faint">{p.invoices} فاتورة</p>
    </>,
  )
}

function BarTooltip({ active, payload, showProfit }: TooltipPayload & { showProfit: boolean }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload as { name: string; units: number; revenue: number; profit: number }
  return shell(
    <>
      <p className="mb-1 max-w-52 font-medium">{p.name}</p>
      <p className="tnum text-muted">
        {p.units} بوكس · {money(p.revenue)}
      </p>
      {showProfit && <p className="tnum text-ok">ربح {money(p.profit)}</p>}
    </>,
  )
}

function PieTooltip({ active, payload }: TooltipPayload) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload as { name: string; value: number }
  return shell(
    <p className="tnum">
      {p.name}: {money(p.value)}
    </p>,
  )
}
