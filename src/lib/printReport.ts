import { date, dateTime, money, num } from './format'
import { esc, getPrintColor, openAndPrint, printLogo } from './print'
import type {
  CustomerPerformance,
  PartPerformance,
  PeriodSummary,
  PurchasesSummary,
} from './analytics'
import type { Invoice, Settings } from './types'

export interface ReportPrintData {
  title: string
  from: number
  to: number
  /** `reports.financial`: بدونها لا تُطبع التكلفة ولا الربح — كما في الشاشة. */
  showMoney: boolean
  summary: PeriodSummary
  customers: CustomerPerformance[]
  parts: PartPerformance[]
  categories: Array<{ name: string; revenue: number; profit: number; units: number }>
  staff: Array<{ name: string; revenue: number; invoices: number; average: number }>
  /** `null` لمن لا يرى المصروفات. */
  spend: PurchasesSummary | null
  invoices: Invoice[]
}

/**
 * صفحة A4 لا ورقة حرارية: التقرير يُقرأ على مكتب أو يُرسل للمحاسب، والطابعة ٨٠مم
 * تقصّ الجداول العريضة. خلية الرقم لا تنكسر (`nowrap`) والنصوص حولها هي التي تلتفّ،
 * فلا يُقصّ رقم ولا ينقسم على سطرين — رقم مقصوص في تقرير قرار خاطئ.
 */
const STYLE = `
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: "IBM Plex Sans Arabic", system-ui, sans-serif; margin: 0; color: #111; font-size: 11px; }
  header { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; border-bottom: 2px solid #631322; padding-bottom: 8px; margin-bottom: 12px; }
  .head { display: flex; align-items: center; gap: 12px; }
  .logo { width: 34mm; height: auto; }
  h1 { font-size: 18px; margin: 0; color: #631322; }
  h2 { font-size: 13px; margin: 16px 0 6px; color: #4c1e21; break-after: avoid; }
  .muted { color: #555; font-size: 10px; margin: 2px 0; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .kpi { border: 1px solid #ddd; border-radius: 6px; padding: 6px 8px; }
  .kpi b { display: block; font-size: 13px; margin-top: 2px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .kpi span { color: #555; font-size: 10px; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th { text-align: right; font-size: 10px; color: #333; background: #f4ece6; border-bottom: 1px solid #bbb; padding: 4px 5px; }
  td { padding: 4px 5px; border-bottom: 1px solid #eee; vertical-align: top; }
  .n { text-align: left; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tfoot td { font-weight: 700; border-top: 1px solid #999; border-bottom: none; }
  .tag { font-size: 9px; padding: 1px 5px; border-radius: 4px; border: 1px solid #bbb; white-space: nowrap; }
  .unpaid { color: #a40000; border-color: #a40000; }
  .note { margin-top: 14px; padding: 6px 8px; border: 1px dashed #bbb; border-radius: 6px; color: #444; font-size: 10px; }
  .empty { color: #777; font-size: 10px; padding: 4px 0; }
`

/** أبيض وأسود: العناوين والحدود بالأسود، وخلفية رأس الجدول رمادي فاتح يُطبع بلا حبر ملوّن. */
const MONO = `
  header { border-bottom-color: #000; }
  h1, h2 { color: #000; }
  th { background: #eee; }
`

const cell = (v: string, n = false) => `<td${n ? ' class="n"' : ''}>${v}</td>`
const head = (cols: Array<[string, boolean?]>) =>
  `<thead><tr>${cols.map(([c, n]) => `<th${n ? ' class="n"' : ''}>${esc(c)}</th>`).join('')}</tr></thead>`

function table(cols: Array<[string, boolean?]>, rows: string[][], foot?: string[]): string {
  if (rows.length === 0) return '<p class="empty">لا بيانات في هذه الفترة.</p>'
  const body = rows
    .map((r) => `<tr>${r.map((v, i) => cell(v, Boolean(cols[i]?.[1]))).join('')}</tr>`)
    .join('')
  const tfoot = foot
    ? `<tfoot><tr>${foot.map((v, i) => cell(v, Boolean(cols[i]?.[1]))).join('')}</tr></tfoot>`
    : ''
  return `<table>${head(cols)}<tbody>${body}</tbody>${tfoot}</table>`
}

const m = (v: number) => esc(money(v))

function statusTag(inv: Invoice): string {
  if (inv.status === 'refunded') return '<span class="tag">مسترجعة</span>'
  if (inv.status === 'unpaid') return '<span class="tag unpaid">لم يتم السداد</span>'
  return '<span class="tag">تم السداد</span>'
}

export function printReport(data: ReportPrintData, settings: Settings): boolean {
  const { summary: s, showMoney } = data
  const unpaid = data.invoices.filter((i) => i.status === 'unpaid')
  const unpaidTotal = unpaid.reduce((n, i) => n + i.total, 0)

  const kpis: Array<[string, string]> = [
    ['المبيعات بدون ضريبة (بعد المرتجع)', m(s.revenue)],
    ['الضريبة المحصّلة', m(s.vat)],
    ...(showMoney
      ? ([
          ['التكلفة', m(s.cost)],
          ['الربح', `${m(s.profit)} · ${s.marginPercent.toFixed(1)}٪`],
        ] as Array<[string, string]>)
      : []),
    ['عدد الفواتير', esc(num(s.invoices))],
    ['البوكسات المباعة', esc(num(s.units))],
    ['العينات', `${esc(num(s.freeUnits))}${showMoney ? ` · تكلفتها ${m(s.freeCost)}` : ''}`],
    ['المرتجعات', `${esc(num(s.returnedUnits))} بوكس · ${m(s.returned)}`],
    ['متوسط الفاتورة', m(s.averageTicket)],
    ['غير المسدّد', `${esc(num(unpaid.length))} فاتورة · ${m(unpaidTotal)}`],
    ...(data.spend
      ? ([['المصروفات', `${m(data.spend.total)} · ${esc(num(data.spend.bills))} مصروف`]] as Array<
          [string, string]
        >)
      : []),
  ]

  const customers = table(
    [
      ['العميل'],
      ['الفواتير', true],
      ['البوكسات', true],
      ['عينات', true],
      ['المرتجع', true],
      ['الصافي بدون ضريبة', true],
      ['بالضريبة', true],
      ['غير مسدّد', true],
      ...(showMoney ? ([['الربح', true]] as Array<[string, boolean]>) : []),
    ],
    data.customers.map((c) => [
      esc(c.name),
      esc(num(c.invoices)),
      esc(num(c.units)),
      esc(num(c.freeUnits)),
      m(c.returned),
      m(c.net),
      m(c.totalWithVat),
      c.unpaid > 0 ? m(c.unpaid) : '—',
      ...(showMoney ? [m(c.profit)] : []),
    ]),
  )

  const parts = table(
    [
      ['المنتج'],
      ['الرمز'],
      ['الكمية', true],
      ['عينات', true],
      ['الإيراد', true],
      ...(showMoney ? ([['الربح', true]] as Array<[string, boolean]>) : []),
    ],
    data.parts.map((p) => [
      esc(p.name),
      esc(p.sku),
      esc(num(p.units)),
      esc(num(p.freeUnits)),
      m(p.revenue),
      ...(showMoney ? [m(p.profit)] : []),
    ]),
  )

  const categories = table(
    [
      ['التصنيف'],
      ['البوكسات', true],
      ['الإيراد', true],
      ...(showMoney ? ([['الربح', true]] as Array<[string, boolean]>) : []),
    ],
    data.categories.map((c) => [
      esc(c.name),
      esc(num(c.units)),
      m(c.revenue),
      ...(showMoney ? [m(c.profit)] : []),
    ]),
  )

  const staff = table(
    [['الموظف'], ['الفواتير', true], ['الإيراد', true], ['متوسط الفاتورة', true]],
    data.staff.map((u) => [esc(u.name), esc(num(u.invoices)), m(u.revenue), m(u.average)]),
  )

  const spend = data.spend
    ? `<h2>المصروفات حسب البند الرئيسي</h2>${table(
        [['البند الرئيسي'], ['المبلغ', true]],
        data.spend.byKind.map((g) => [esc(g.kind), m(g.total)]),
        ['الإجمالي', m(data.spend.total)],
      )}<h2>المصروفات حسب البند الفرعي</h2>${table(
        [['البند الفرعي'], ['البند الرئيسي'], ['الكمية', true], ['المبلغ', true]],
        data.spend.items.map((i) => [
          esc(i.name),
          esc(i.kind),
          `${esc(num(i.qty, 2))} ${esc(i.unit)}`,
          m(i.total),
        ]),
      )}`
    : ''

  const counted = data.invoices.filter((i) => i.status !== 'refunded')
  const invoices = table(
    [
      ['الرقم'],
      ['التاريخ'],
      ['العميل'],
      ['البوكسات', true],
      ['عينات', true],
      ['الإجمالي', true],
      ['السداد'],
    ],
    data.invoices.map((inv) => [
      esc(inv.number),
      esc(dateTime(inv.createdAt)),
      esc(inv.customerName ?? 'بيع نقدي'),
      esc(num(inv.lines.reduce((n, l) => n + l.qty, 0))),
      esc(num(inv.lines.reduce((n, l) => n + l.freeQty, 0))),
      m(inv.total),
      statusTag(inv),
    ]),
    [
      `${esc(num(counted.length))} فاتورة`,
      '',
      '',
      esc(num(counted.reduce((n, i) => n + i.lines.reduce((a, l) => a + l.qty, 0), 0))),
      esc(num(counted.reduce((n, i) => n + i.lines.reduce((a, l) => a + l.freeQty, 0), 0))),
      m(counted.reduce((n, i) => n + i.total, 0)),
      '',
    ],
  )

  const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>${esc(data.title)} — ${esc(settings.shopName)}</title>
<style>${STYLE}${getPrintColor() ? '' : MONO}</style></head><body>
<header>
  <div class="head">
    ${printLogo()}
    <div>
      <h1>${esc(settings.shopName)} — ${esc(data.title)}</h1>
      <p class="muted">من ${esc(date(data.from))} إلى ${esc(date(data.to))}</p>
    </div>
  </div>
  <p class="muted">طُبع ${esc(dateTime(Date.now()))}</p>
</header>
<section class="kpis">${kpis.map(([k, v]) => `<div class="kpi"><span>${esc(k)}</span><b>${v}</b></div>`).join('')}</section>
<h2>حسب العميل</h2>${customers}
<h2>حسب المنتج</h2>${parts}
<h2>حسب التصنيف</h2>${categories}
<h2>حسب الموظف</h2>${staff}
${spend}
<h2>الفواتير في الفترة</h2>${invoices}
<p class="note">الإيراد بدون ضريبة وبعد خصم المرتجعات، والمرتجع يُخصم في فترة حدوثه. الضريبة المحصّلة
أمانة للهيئة وليست ربحاً. العينات تكلفة بلا إيراد. المصروفات نقد خرج في الفترة ولا تُطرح من الربح
لأن بعضها يُستهلك لاحقاً.</p>
</body></html>`

  return openAndPrint(html, 'width=900,height=1000')
}
