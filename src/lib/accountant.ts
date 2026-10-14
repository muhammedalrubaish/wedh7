import {
  byCustomer,
  countedQty,
  deadStock,
  inventoryValue,
  reorderSuggestions,
  summarize,
  topParts,
} from './analytics'
import { daysAgo, endOfDay, marginPercent, money, round2 } from './format'
import type {
  Category,
  Invoice,
  Part,
  PurchaseOrder,
  ReturnNote,
  Settings,
  StockMovement,
} from './types'

export interface Snapshot {
  generatedAt: number
  shop: { name: string; currency: string; vatRate: number }
  periods: Record<'today' | 'week' | 'month' | 'quarter', ReturnType<typeof summarize>>
  /** عينات آخر ٣٠ يوماً: بوكسات خرجت بلا مقابل وتكلفتها. */
  samples: { units: number; cost: number }
  /** المرتجعات آخر ٣٠ يوماً — كم رجع، وكم منه ضاع لانتهاء الصلاحية. */
  returns: { count: number; amount: number; expiredCost: number }
  /** أكبر العملاء آخر ٣٠ يوماً بالصافي بعد المرتجعات. */
  topCustomers: Array<{ name: string; net: number; returned: number; freeUnits: number }>
  inventory: { costValue: number; retailValue: number; units: number; skus: number }
  vatDueThisMonth: number
  payments: Record<string, number>
  topSellers: Array<{ name: string; units: number; revenue: number; profit: number }>
  weakMargins: Array<{ name: string; cost: number; price: number; margin: number }>
  deadCapital: Array<{ name: string; qty: number; tied: number; lastSold?: string }>
  reorderNow: Array<{ name: string; qty: number; reorderPoint: number; suggested: number }>
  categoryMix: Array<{ name: string; costValue: number }>
}

export function buildSnapshot(input: {
  settings: Settings
  parts: Part[]
  invoices: Invoice[]
  returns: ReturnNote[]
  movements: StockMovement[]
  purchaseOrders: PurchaseOrder[]
  categories: Category[]
}): Snapshot {
  const { settings, parts, invoices, returns, movements, purchaseOrders, categories } = input
  const to = endOfDay()

  const periods = {
    today: summarize(invoices, returns, daysAgo(0), to),
    week: summarize(invoices, returns, daysAgo(6), to),
    month: summarize(invoices, returns, daysAgo(29), to),
    quarter: summarize(invoices, returns, daysAgo(89), to),
  }

  const stock = inventoryValue(parts)

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const vatDueThisMonth = round2(
    invoices
      .filter((i) => i.createdAt >= monthStart.getTime() && i.status !== 'refunded')
      .reduce((n, i) => n + i.vatAmount, 0),
  )

  const payments: Record<string, number> = {}
  for (const inv of invoices) {
    if (inv.createdAt < daysAgo(29) || inv.status === 'refunded') continue
    payments[inv.paymentMethod] = round2((payments[inv.paymentMethod] ?? 0) + inv.total)
  }

  const weak = parts
    .filter((p) => !p.archived && (p.qty > 0 || p.unlimited))
    .map((p) => ({
      name: p.name,
      cost: p.cost,
      price: p.priceRetail,
      margin: round2(marginPercent(p.priceRetail, p.cost)),
    }))
    .filter((p) => p.margin < 20)
    .sort((a, b) => a.margin - b.margin)
    .slice(0, 10)

  const dead = deadStock(parts, movements, 21)
    .slice(0, 10)
    .map((d) => ({
      name: d.part.name,
      qty: d.part.qty,
      tied: d.tiedCapital,
      lastSold: d.lastSoldAt ? new Date(d.lastSoldAt).toISOString().slice(0, 10) : undefined,
    }))

  const reorder = reorderSuggestions(parts, movements, purchaseOrders)
    .slice(0, 12)
    .map((r) => ({
      name: r.part.name,
      qty: r.part.qty,
      reorderPoint: r.part.reorderPoint,
      suggested: r.suggestedQty,
    }))

  const monthReturns = returns.filter((r) => r.createdAt >= daysAgo(29))

  const catValue = new Map<string, number>()
  for (const p of parts) {
    if (p.archived) continue
    catValue.set(p.categoryId, (catValue.get(p.categoryId) ?? 0) + countedQty(p) * p.cost)
  }

  return {
    generatedAt: Date.now(),
    shop: { name: settings.shopName, currency: settings.currency, vatRate: settings.vatRate },
    periods,
    inventory: {
      costValue: stock.cost,
      retailValue: stock.retail,
      units: stock.units,
      skus: parts.filter((p) => !p.archived).length,
    },
    vatDueThisMonth,
    payments,
    samples: { units: periods.month.freeUnits, cost: periods.month.freeCost },
    returns: {
      count: monthReturns.length,
      amount: round2(monthReturns.reduce((n, r) => n + r.subtotal, 0)),
      expiredCost: round2(
        monthReturns
          .filter((r) => !r.restock)
          .reduce((n, r) => n + r.lines.reduce((m, l) => m + l.unitCost * l.qty, 0), 0),
      ),
    },
    topCustomers: byCustomer(invoices, returns, daysAgo(29), to)
      .slice(0, 8)
      .map((c) => ({ name: c.name, net: c.net, returned: c.returned, freeUnits: c.freeUnits })),
    topSellers: topParts(invoices, returns, daysAgo(29), to, 10).map((p) => ({
      name: p.name,
      units: p.units,
      revenue: p.revenue,
      profit: p.profit,
    })),
    weakMargins: weak,
    deadCapital: dead,
    reorderNow: reorder,
    categoryMix: categories
      .map((c) => ({ name: c.name, costValue: round2(catValue.get(c.id) ?? 0) }))
      .filter((c) => c.costValue > 0)
      .sort((a, b) => b.costValue - a.costValue),
  }
}

export type InsightTone = 'danger' | 'warn' | 'ok' | 'info'

export interface Insight {
  tone: InsightTone
  title: string
  body: string
  action?: string
}

/**
 * Deterministic findings computed from the shop's own numbers. These run with no
 * network and no model — the AI chat sits on top of them, it does not replace them.
 */
export function localInsights(s: Snapshot): Insight[] {
  const out: Insight[] = []

  const monthProfit = s.periods.month.profit
  const monthRevenue = s.periods.month.revenue
  const quarterMonthly = s.periods.quarter.revenue / 3

  if (monthRevenue > 0 && quarterMonthly > 0) {
    const delta = ((monthRevenue - quarterMonthly) / quarterMonthly) * 100
    out.push({
      tone: delta >= 0 ? 'ok' : 'warn',
      title: delta >= 0 ? 'المبيعات فوق متوسط الربع' : 'المبيعات تحت متوسط الربع',
      body: `مبيعات آخر ٣٠ يوم ${money(monthRevenue)} مقابل متوسط شهري ${money(quarterMonthly)} خلال ٩٠ يوم (${delta >= 0 ? '+' : ''}${delta.toFixed(1)}٪).`,
    })
  }

  if (s.periods.month.marginPercent > 0) {
    const m = s.periods.month.marginPercent
    out.push({
      tone: m < 20 ? 'danger' : m < 30 ? 'warn' : 'ok',
      title: `هامش الربح الفعلي ${m.toFixed(1)}٪`,
      body: `ربح ${money(monthProfit)} من مبيعات ${money(monthRevenue)} خلال ٣٠ يوم. الهامش الفعلي أقل من هامش قائمة الأسعار عادةً بسبب الخصومات وبيع الجملة.`,
      action: m < 25 ? 'راجع صفحة التسعير — رتّبها من الأضعف هامشاً.' : undefined,
    })
  }

  const tiedDead = s.deadCapital.reduce((n, d) => n + d.tied, 0)
  if (tiedDead > 0) {
    const share = s.inventory.costValue ? (tiedDead / s.inventory.costValue) * 100 : 0
    out.push({
      tone: share > 20 ? 'danger' : share > 10 ? 'warn' : 'info',
      title: `${money(tiedDead)} رأس مال راكد`,
      body: `${s.deadCapital.length} صنف ما باع ولا بوكس خلال ٢١ يوم، ويمثّل ${share.toFixed(1)}٪ من قيمة المخزون.`,
      action:
        share > 10 ? 'الحلويات لها صلاحية: اعمل عرضاً أو وزّعها عينات قبل أن تنتهي.' : undefined,
    })
  }

  const losing = s.weakMargins.filter((w) => w.margin < 0)
  if (losing.length) {
    out.push({
      tone: 'danger',
      title: `${losing.length} صنف يُباع بخسارة`,
      body: `أوضحها: ${losing
        .slice(0, 3)
        .map((w) => `${w.name} (${w.margin.toFixed(0)}٪)`)
        .join('، ')}.`,
      action: 'عدّل السعر أو التكلفة — أحدهما مسجّل غلط.',
    })
  }

  if (s.reorderNow.length) {
    out.push({
      tone: s.reorderNow.some((r) => r.qty === 0) ? 'danger' : 'warn',
      title: `${s.reorderNow.length} صنف يحتاج طلب`,
      body: `منها ${s.reorderNow.filter((r) => r.qty === 0).length} نفد تماماً. البوكس الناقص يعني محل يطلب من غيرك.`,
      action: 'جهّز إنتاج الأصناف الناقصة أولاً، أو من صفحة التوريد اضغط «طلب مقترح».',
    })
  }

  if (s.vatDueThisMonth > 0) {
    out.push({
      tone: 'info',
      title: `ضريبة مستحقة ${money(s.vatDueThisMonth)}`,
      body: 'هذي ضريبة محصّلة من العملاء هذا الشهر وليست ربحاً — تُورَّد لهيئة الزكاة والضريبة والجمارك.',
      action: 'افصلها عن السيولة التشغيلية حتى لا تُصرف بالخطأ.',
    })
  }

  if (s.samples.units > 0) {
    const share = s.periods.month.revenue ? (s.samples.cost / s.periods.month.revenue) * 100 : 0
    out.push({
      tone: share > 5 ? 'warn' : 'info',
      title: `${s.samples.units} بوكس عينات هذا الشهر`,
      body: `تكلفتها ${money(s.samples.cost)} — ${share.toFixed(1)}٪ من المبيعات. العينة تسويق له ثمن، وهذا ثمنه.`,
      action:
        share > 5 ? 'حدّد سقفاً للعينات لكل محل في الشهر، وراقب من يطلب أكثر من غيره.' : undefined,
    })
  }

  if (s.returns.count > 0) {
    out.push({
      tone: s.returns.expiredCost > 0 ? 'warn' : 'info',
      title: `${s.returns.count} مرتجع بقيمة ${money(s.returns.amount)}`,
      body:
        s.returns.expiredCost > 0
          ? `منها بوكسات انتهت صلاحيتها بتكلفة ${money(s.returns.expiredCost)} — خسارة كاملة لا تعود للرفّ.`
          : 'كل المرتجع عاد إلى المخزون صالحاً للبيع.',
      action:
        s.returns.expiredCost > 0
          ? 'قلّل الكمية للمحلات اللي ترجع منتهياً، أو قصّر فترة التوريد لها.'
          : undefined,
    })
  }

  const cash = s.payments.cash ?? 0
  const totalPayments = Object.values(s.payments).reduce((n, v) => n + v, 0)
  if (totalPayments > 0) {
    const cashShare = (cash / totalPayments) * 100
    if (cashShare > 60) {
      out.push({
        tone: 'info',
        title: `${cashShare.toFixed(0)}٪ من المبيعات نقداً`,
        body: 'نسبة النقد العالية تصعّب المطابقة المحاسبية وتزيد فرص فروقات الصندوق.',
        action: 'اعمل جرد صندوق يومي وقارنه بمجموع فواتير النقد.',
      })
    }
  }

  const turnover = s.inventory.costValue ? (s.periods.quarter.cost * 4) / s.inventory.costValue : 0
  if (turnover > 0) {
    out.push({
      tone: turnover < 2 ? 'warn' : 'ok',
      title: `معدل دوران المخزون ${turnover.toFixed(1)} مرة سنوياً`,
      body: `المخزون بقيمة ${money(s.inventory.costValue)} ويستغرق تقريباً ${Math.round(365 / Math.max(turnover, 0.1))} يوماً ليُباع بالكامل بالمعدل الحالي.`,
      action: turnover < 2 ? 'قلّل كميات الطلب للأصناف البطيئة وحوّل السيولة للسريعة.' : undefined,
    })
  }

  return out
}

const SYSTEM_PROMPT = `أنت محاسب المحل. تخاطب صاحب معمل ومحل حلويات في السعودية يبيع بوكسات لمحلات وكافيهات وأفراد — رجل أعمال عملي، مو محاسب قانوني.

## أسلوبك
- تكلّم **سعودي** واضح ومباشر. لا فصحى متكلّفة ولا مصطلحات محاسبية بدون شرح.
- **اختصر:** ٣-٥ أسطر افتراضياً. تفصّل فقط إذا طلب منك «فصّل» أو «اشرح أكثر».
- **استخدم الإيموجي** لتقسيم الرد وتسهيل قراءته على الجوال: 💰 مال، 📉 تحذير،
  📦 مخزون، ✅ سليم، ⚠️ انتبه.
- ⛔ **لا تستخدم Markdown إطلاقاً** — لا نجمات ** ولا جداول ولا #. ردّك يُعرض نصاً
  خاماً، وأي رمز تنسيق يظهر للمستخدم كما هو ويشوّه الرد. اعتمد أسطراً قصيرة وإيموجي.
- **اختم دائماً بسطر «⚡ سوّ كذا:»** فيه خطوة أو خطوتين ينفّذهما هذا الأسبوع.

## قواعدك التي لا تُكسر
- اعتمد فقط على أرقام اللقطة المرفقة. **لا تخترع رقماً** أبداً.
- إذا الرقم المطلوب مو موجود في البيانات، قل «ما عندي هذا الرقم» بصراحة.
- 🧮 الضريبة المحصّلة **ليست ربحاً** — تُورَّد للهيئة.
- اذكر تحفّظاً أو مخاطرة واحدة على الأقل في أي تحليل مالي.
- أنت لست مستشاراً ضريبياً معتمداً — نبّه على ذلك في المسائل النظامية.
- 🍰 العينات تكلفة بلا إيراد، والمرتجع منتهي الصلاحية خسارة كاملة — لا تخلطهما بالمبيعات.`

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export type AiProvider = 'none' | 'deepseek' | 'anthropic'

export interface TokenUsage {
  input: number
  output: number
  total: number
}

export interface AiAnswer {
  text: string
  usage: TokenUsage
}

export interface ProviderBalance {
  available: boolean
  amount: number
  currency: string
}

const NO_USAGE: TokenUsage = { input: 0, output: 0, total: 0 }

/**
 * رصيد المزوّد كما يقوله المزوّد نفسه.
 *
 * لا نحسب التكلفة تقديراً من الأسعار: الأسعار تتغيّر، ورقم مُقدَّر خطأً في شاشة
 * مالية أسوأ من عدم عرض رقم أصلاً. المسار عبر الخادم لأن المفتاح هناك.
 */
export async function fetchBalance(provider: AiProvider): Promise<ProviderBalance | null> {
  if (provider === 'none') return null
  try {
    const res = await fetch(`/api/ai?provider=${provider}`)
    if (!res.ok) return null
    const data = (await res.json()) as { balance?: ProviderBalance | null }
    return data.balance ?? null
  } catch {
    return null
  }
}

function buildMessages(input: {
  snapshot: Snapshot
  history: ChatMessage[]
  question: string
}): ChatMessage[] {
  return [
    ...input.history,
    {
      role: 'user',
      content: `اللقطة المالية للمحل (JSON):\n\`\`\`json\n${JSON.stringify(input.snapshot)}\n\`\`\`\n\nالسؤال: ${input.question}`,
    },
  ]
}

/**
 * يسأل المحاسب عبر مسارين:
 *
 *  - الخادم (المفضّل): المتصفح ينادي /api/ai على نفس الأصل، والمفتاح يبقى في
 *    متغيرات بيئة Vercel. لا مفتاح في الصفحة، ولا مشكلة CORS.
 *  - المتصفح مباشرةً: يُستخدم فقط عند إدخال مفتاح يدوياً في الإعدادات — مناسب
 *    للتجربة على جهاز المالك، وغير مناسب لأي صفحة عامة لأن المفتاح يصير مقروءاً.
 *
 * ملاحظة على المسار المباشر: أنثروبيك تدعمه صراحةً عبر ترويسة
 * anthropic-dangerous-direct-browser-access. ديب سيك لا تُوثّق دعم نداء من
 * المتصفح، فقد يفشل بخطأ CORS — لذلك المسار الافتراضي لديب سيك هو الخادم.
 */
export async function askAccountant(input: {
  provider: AiProvider
  apiKey: string
  model: string
  snapshot: Snapshot
  history: ChatMessage[]
  question: string
}): Promise<AiAnswer> {
  if (input.provider === 'none') {
    throw new Error('لم يُفعَّل أي مزوّد للذكاء الاصطناعي')
  }

  const messages = buildMessages(input)
  const useServer = input.apiKey.trim().length === 0

  if (useServer) return askViaServer(input.provider, input.model, messages)
  if (input.provider === 'anthropic') return askAnthropicDirect(input.apiKey, input.model, messages)
  return askDeepSeekDirect(input.apiKey, input.model, messages)
}

async function askViaServer(
  provider: Exclude<AiProvider, 'none'>,
  model: string,
  messages: ChatMessage[],
): Promise<AiAnswer> {
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider, model, system: SYSTEM_PROMPT, messages }),
  })

  const data = (await res.json().catch(() => ({}))) as {
    text?: string
    usage?: TokenUsage
    error?: string
  }
  if (!res.ok) {
    throw new Error(
      data.error ??
        `تعذّر الاتصال بالخادم (${res.status}). تأكد أن الموقع منشور على Vercel وأن المفتاح مضبوط في إعداداته.`,
    )
  }
  return {
    text: data.text?.trim() || 'لم يصل رد نصي من النموذج.',
    usage: data.usage ?? NO_USAGE,
  }
}

async function askDeepSeekDirect(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
): Promise<AiAnswer> {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      temperature: 0.3,
      stream: false,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
    }),
  })

  if (!res.ok) {
    throw new Error(
      `فشل الاتصال بديب سيك (${res.status}). ${(await res.text().catch(() => '')).slice(0, 200)}`,
    )
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  }
  return {
    text: data.choices?.[0]?.message?.content?.trim() || 'لم يصل رد نصي من النموذج.',
    usage: {
      input: data.usage?.prompt_tokens ?? 0,
      output: data.usage?.completion_tokens ?? 0,
      total: data.usage?.total_tokens ?? 0,
    },
  }
}

async function askAnthropicDirect(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
): Promise<AiAnswer> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model, max_tokens: 2000, system: SYSTEM_PROMPT, messages }),
  })

  if (!res.ok) {
    throw new Error(
      `فشل الاتصال بالنموذج (${res.status}). ${(await res.text().catch(() => '')).slice(0, 200)}`,
    )
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  const inTok = data.usage?.input_tokens ?? 0
  const outTok = data.usage?.output_tokens ?? 0
  return {
    text:
      data.content
        ?.filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('\n')
        .trim() || 'لم يصل رد نصي من النموذج.',
    usage: { input: inTok, output: outTok, total: inTok + outTok },
  }
}

export const SUGGESTED_QUESTIONS = [
  'وش أهم ٣ مشاكل في أرقام المحل هذا الشهر؟',
  'أي محل يرجّع أكثر من غيره، وهل أوقف العينات له؟',
  'كم أقدر أخصم على الجملة بدون ما ينزل هامشي عن ٢٥٪؟',
  'اشرح لي وضع السيولة والضريبة المستحقة.',
]
