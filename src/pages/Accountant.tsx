import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Info,
  Lightbulb,
  Send,
  RefreshCw,
  Settings as SettingsIcon,
  Sparkles,
  User,
  Wallet,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Textarea,
  cn,
  useLocalStorage,
} from '@/components/ui'
import {
  SUGGESTED_QUESTIONS,
  askAccountant,
  buildSnapshot,
  fetchBalance,
  localInsights,
  type ChatMessage,
  type Insight,
  type InsightTone,
  type ProviderBalance,
} from '@/lib/accountant'
import { num, relative } from '@/lib/format'
import { maskDigits, money } from '@/lib/display'
import { useApp } from '@/store/app'
import { cloudEnabled } from '@/lib/supabase'
import {
  useActiveParts,
  useCategories,
  useInvoices,
  useMovements,
  usePurchaseOrders,
  useReturns,
} from '@/hooks/useShopData'

/** يظهر بعد كل رد: المحاسب يختصر افتراضياً، وهذي طريقة طلب المزيد بضغطة واحدة. */
const FOLLOW_UPS = ['فصّل أكثر 📋', 'أعطني الأرقام 🔢', 'وش أسوّي أول؟ ⚡']

const TONE_STYLES: Record<InsightTone, { box: string; icon: React.ReactNode }> = {
  danger: {
    box: 'border-danger/40 bg-danger-soft/40',
    icon: <AlertTriangle className="size-4 text-danger" />,
  },
  warn: {
    box: 'border-warn/40 bg-warn-soft/40',
    icon: <AlertTriangle className="size-4 text-warn" />,
  },
  ok: { box: 'border-ok/40 bg-ok-soft/40', icon: <CheckCircle2 className="size-4 text-ok" /> },
  info: { box: 'border-border bg-surface-2', icon: <Info className="size-4 text-brand" /> },
}

export default function Accountant() {
  const { settings } = useApp()
  const parts = useActiveParts()
  const invoices = useInvoices()
  const returns = useReturns()
  const movements = useMovements()
  const purchaseOrders = usePurchaseOrders()
  const categories = useCategories()

  const snapshot = useMemo(
    () =>
      buildSnapshot({ settings, parts, invoices, returns, movements, purchaseOrders, categories }),
    [settings, parts, invoices, returns, movements, purchaseOrders, categories],
  )
  const insights = useMemo(() => localInsights(snapshot), [snapshot])

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  // الاستهلاك التراكمي يعيش في هذا المتصفح؛ الرصيد يأتي من المزوّد نفسه.
  const [usage, setUsage] = useLocalStorage('wedh7.ai.usage', {
    questions: 0,
    tokens: 0,
  })
  const [sessionTokens, setSessionTokens] = useState(0)
  const [balance, setBalance] = useState<ProviderBalance | null>(null)
  const [loadingBalance, setLoadingBalance] = useState(false)

  const connected = settings.aiProvider !== 'none'
  // يطابق `askAccountant`: في وضع المحل الخادم دائماً، ولو بقي مفتاح قديم في المتصفح.
  const viaServer = connected && (cloudEnabled || settings.aiApiKey.trim().length === 0)

  const refreshBalance = useCallback(async () => {
    if (!connected) return
    setLoadingBalance(true)
    setBalance(await fetchBalance(settings.aiProvider))
    setLoadingBalance(false)
  }, [connected, settings.aiProvider])

  useEffect(() => {
    void refreshBalance()
  }, [refreshBalance])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  async function send(question: string) {
    const q = question.trim()
    if (!q || busy) return
    setError(null)
    setInput('')
    const history = messages
    setMessages([...history, { role: 'user', content: q }])
    setBusy(true)
    try {
      const answer = await askAccountant({
        provider: settings.aiProvider,
        apiKey: settings.aiApiKey,
        model: settings.aiModel,
        snapshot,
        history,
        question: q,
      })
      setMessages((cur) => [...cur, { role: 'assistant', content: answer.text }])
      setSessionTokens((n) => n + answer.usage.total)
      setUsage((u) => ({ questions: u.questions + 1, tokens: u.tokens + answer.usage.total }))
      void refreshBalance()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر الاتصال')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">المحاسب الذكي</h1>
          <p className="mt-0.5 text-sm text-muted">
            قراءة مالية لأرقام المحل — محسوبة من بياناتك، محدّثة {relative(snapshot.generatedAt)}
          </p>
        </div>
        <Badge tone={connected ? 'ok' : 'neutral'} dot>
          {connected
            ? `${settings.aiModel} — ${viaServer ? 'عبر الخادم' : 'من المتصفح مباشرة'}`
            : 'التحليل المحلي فقط'}
        </Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
        {/* Chat */}
        <Card className="flex min-h-[32rem] flex-col">
          <CardHeader
            title="اسأل المحاسب"
            subtitle={
              connected
                ? 'يجاوب اعتماداً على لقطة أرقام محلك فقط'
                : 'اختر مزوّداً من الإعدادات لتفعيل المحادثة'
            }
            icon={<Bot className="size-[18px]" />}
          />

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && (
              <div className="space-y-3">
                <div className="rounded-xl border border-border bg-surface-2 p-4 text-[13px] leading-6">
                  <p className="font-medium">قبل ما تسأل — اللقطة اللي بتُرسَل تشمل:</p>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-muted">
                    <li>ملخص المبيعات والتكلفة والربح (يوم/أسبوع/شهر/ربع)</li>
                    <li>قيمة المخزون وتوزيعه على التصنيفات</li>
                    <li>الأصناف الأكثر مبيعاً، والراكدة، وضعيفة الهامش</li>
                    <li>العينات والمرتجعات، وأكبر المحلات، والضريبة المحصّلة هذا الشهر</li>
                  </ul>
                  <p className="mt-2 text-faint">
                    لا تُرسَل أسماء العملاء ولا أرقام جوالاتهم ولا بيانات الموظفين.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {SUGGESTED_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      onClick={() => send(q)}
                      disabled={!connected}
                      className="rounded-xl border border-border px-3 py-1.5 text-[13px] text-muted transition-colors hover:border-brand hover:text-brand-strong disabled:opacity-50 disabled:hover:border-border disabled:hover:text-muted"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div
                key={i}
                className={cn('flex gap-2.5', m.role === 'user' ? 'flex-row-reverse' : 'flex-row')}
              >
                <span
                  className={cn(
                    'grid size-8 shrink-0 place-items-center rounded-full',
                    m.role === 'user'
                      ? 'bg-accent-soft text-accent'
                      : 'bg-brand-soft text-brand-strong',
                  )}
                >
                  {m.role === 'user' ? <User className="size-4" /> : <Bot className="size-4" />}
                </span>
                <div
                  className={cn(
                    'max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[13px] leading-6',
                    m.role === 'user'
                      ? 'rounded-tr-sm bg-accent-soft text-text'
                      : 'rounded-tl-sm bg-surface-2',
                  )}
                >
                  {maskDigits(m.content)}
                </div>
              </div>
            ))}

            {/* المحاسب يردّ مختصراً افتراضياً؛ هذي هي طريقة طلب التفصيل بضغطة. */}
            {!busy && messages.length > 0 && messages[messages.length - 1].role === 'assistant' && (
              <div className="flex flex-wrap gap-2 pr-10">
                {FOLLOW_UPS.map((q) => (
                  <button
                    key={q}
                    onClick={() => send(q)}
                    className="rounded-full border border-border px-3 py-1 text-[12px] text-muted transition-colors hover:border-brand hover:text-brand-strong"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            {busy && (
              <div className="flex gap-2.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-strong">
                  <Bot className="size-4" />
                </span>
                <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm bg-surface-2 px-4 py-3">
                  {[0, 150, 300].map((d) => (
                    <span
                      key={d}
                      className="size-1.5 animate-bounce rounded-full bg-faint"
                      style={{ animationDelay: `${d}ms` }}
                    />
                  ))}
                </div>
              </div>
            )}

            {error && (
              <p className="rounded-xl bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>
            )}

            <div ref={endRef} />
          </div>

          <div className="border-t border-border p-3">
            {connected ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void send(input)
                }}
                className="flex items-end gap-2"
              >
                <Textarea
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void send(input)
                    }
                  }}
                  placeholder="اكتب سؤالك… (Enter للإرسال)"
                  className="max-h-32 min-h-10 flex-1 resize-none"
                />
                <Button
                  type="submit"
                  variant="primary"
                  size="icon"
                  disabled={!input.trim() || busy}
                >
                  <Send className="size-4" />
                </Button>
              </form>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2 px-3 py-2.5">
                <p className="text-[13px] text-muted">
                  اختر مزوّد ذكاء اصطناعي من الإعدادات. التحليل المحلي على اليسار يشتغل بدونه.
                </p>
                <Link to="/settings">
                  <Button size="sm" variant="secondary">
                    <SettingsIcon className="size-3.5" />
                    الإعدادات
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </Card>

        {/* Local insights */}
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="رصيد الاستخدام"
              subtitle={connected ? `المزوّد: ${settings.aiProvider}` : 'ما فيه مزوّد مفعّل'}
              icon={<Wallet className="size-[18px]" />}
              action={
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={refreshBalance}
                  disabled={!connected || loadingBalance}
                  aria-label="تحديث الرصيد"
                >
                  <RefreshCw className={cn('size-4', loadingBalance && 'animate-spin')} />
                </Button>
              }
            />
            <div className="p-4">
              <p className="text-[12px] text-muted">الرصيد المتبقي عند المزوّد</p>
              <p className="tnum mt-1 text-2xl font-bold leading-tight">
                {balance
                  ? `${balance.amount.toFixed(2)} ${balance.currency}`
                  : connected
                    ? '—'
                    : 'غير مفعّل'}
              </p>
              {balance && !balance.available && (
                <p className="mt-1 text-[12px] text-danger">الحساب غير قابل للاستخدام حالياً</p>
              )}
              {!balance && connected && (
                <p className="mt-1 text-[12px] text-faint">
                  المزوّد ما رجّع رصيداً. الأرقام تحت محسوبة من ردوده.
                </p>
              )}

              <dl className="mt-4 divide-y divide-border border-t border-border text-[13px]">
                {[
                  ['أسئلة هذه الجلسة', num(messages.filter((m) => m.role === 'user').length)],
                  ['رموز هذه الجلسة', num(sessionTokens)],
                  ['إجمالي الأسئلة', num(usage.questions)],
                  ['إجمالي الرموز', num(usage.tokens)],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-3 py-2">
                    <dt className="text-muted">{k}</dt>
                    <dd className="tnum font-medium">{v}</dd>
                  </div>
                ))}
              </dl>

              <button
                onClick={() => {
                  setUsage({ questions: 0, tokens: 0 })
                  setSessionTokens(0)
                }}
                className="mt-3 text-[12px] text-faint underline-offset-2 transition-colors hover:text-muted hover:underline"
              >
                تصفير العدّاد
              </button>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="قراءة محلية"
              subtitle="محسوبة بدون إنترنت من بياناتك"
              icon={<Lightbulb className="size-[18px]" />}
            />
            {insights.length === 0 ? (
              <EmptyState
                icon={<Sparkles className="size-6" />}
                title="ما فيه بيانات كافية بعد"
                description="سجّل بعض الفواتير وارجع."
              />
            ) : (
              <div className="space-y-2.5 p-3">
                {insights.map((ins, i) => (
                  <InsightCard key={i} insight={ins} />
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="أرقام سريعة" />
            <dl className="divide-y divide-border text-[13px]">
              {[
                ['مبيعات ٣٠ يوم', money(snapshot.periods.month.revenue)],
                ['ربح ٣٠ يوم', money(snapshot.periods.month.profit)],
                ['قيمة المخزون بالتكلفة', money(snapshot.inventory.costValue)],
                ['قيمة البيع المتوقعة', money(snapshot.inventory.retailValue)],
                ['ضريبة الشهر الجاري', money(snapshot.vatDueThisMonth)],
                ['عدد الأصناف', String(snapshot.inventory.skus)],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <dt className="text-muted">{k}</dt>
                  <dd className="tnum font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </div>
  )
}

function InsightCard({ insight }: { insight: Insight }) {
  const style = TONE_STYLES[insight.tone]
  return (
    <div className={cn('rounded-xl border p-3', style.box)}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0">{style.icon}</span>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold">{maskDigits(insight.title)}</p>
          <p className="mt-1 text-[12px] leading-5 text-muted">{maskDigits(insight.body)}</p>
          {insight.action && (
            <p className="mt-1.5 text-[12px] font-medium text-brand-strong">
              ← {maskDigits(insight.action)}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
