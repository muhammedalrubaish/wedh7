/**
 * وسيط الذكاء الاصطناعي — دالة Vercel تعمل على حافة الشبكة.
 *
 * سببها الوحيد: المفتاح. أي نداء من المتصفح مباشرةً يعني أن مفتاح المزوّد يُشحن
 * داخل الصفحة ويقرأه أي زائر. هنا يبقى المفتاح في متغيرات بيئة Vercel ولا يغادر
 * الخادم، وتُحلّ معه مشكلة CORS لأن الصفحة تنادي أصلها نفسه.
 *
 * من أين يأتي المفتاح، بالترتيب:
 *   ١. ما حفظه صاحب المعمل من «الإعدادات ← المحاسب الذكي» في جدول `ai_keys`. يُقرأ
 *      بجلسة المستخدم نفسه (ترويسة Authorization) عبر `ai_key_get` التي تشترط
 *      `ai.use` — فلا يستهلكه زائر ولا موظف بلا الصلاحية، والحكم لـPostgres لا لهذا الملف.
 *   ٢. متغيّر Vercel (`DEEPSEEK_API_KEY`…) للنشرات التي ضُبط فيها، كما كان قبل الجدول.
 *
 * حدّ معروف باقٍ في المسار الثاني وحده: النقطة عامة، ومن يعرف العنوان يستهلك مفتاح
 * المتغيّر. فحص الأصل أدناه يصدّ صفحة أخرى ولا يصدّ curl. المسار الأول لا يعمل بلا جلسة.
 */

export const config = { runtime: 'edge' }

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface TokenUsage {
  input: number
  output: number
  total: number
}

interface AiResult {
  text: string
  usage: TokenUsage
}

interface Balance {
  available: boolean
  amount: number
  currency: string
}

type Provider = 'deepseek' | 'anthropic'

interface AiRequest {
  /** `save_key` يحفظ مفتاح المحاسب بعد التحقق منه عند المزوّد؛ غيابه = سؤال. */
  action?: 'save_key'
  provider?: Provider
  key?: string
  model?: string
  system?: string
  messages?: ChatMessage[]
}

const DEFAULT_MODEL: Record<string, string> = {
  deepseek: 'deepseek-chat',
  anthropic: 'claude-sonnet-5',
}

const MAX_TOKENS = 2000

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

// متغيّرا Supabase العامّان نفسهما اللذان تُبنى بهما الواجهة — Vercel يمرّر كل متغيّرات
// المشروع إلى الدوال، فلا يُضبط شيء جديد. المفتاح العام وحده لا يقرأ `ai_keys`.
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '')
const SUPABASE_ANON = (process.env.VITE_SUPABASE_ANON_KEY ?? '').trim()

const NO_KEY = 'لم يُحفظ مفتاح للمحاسب بعد. المالك يضيفه من الإعدادات ← المحاسب الذكي.'

function bearer(req: Request): string | null {
  const h = req.headers.get('authorization') ?? ''
  return h.startsWith('Bearer ') ? h.slice(7).trim() || null : null
}

/** نداء دالة في Supabase بجلسة المستخدم: الصلاحية تقرّرها Postgres. */
async function rpc(
  name: string,
  args: Record<string, unknown>,
  jwt: string,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: SUPABASE_ANON,
      authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(args),
  })
  const data = await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, data }
}

/** دالة غير موجودة: القاعدة لم يُطبَّق عليها ترحيل `ai_keys` بعد. */
const missingFn = (r: { status: number; data: unknown }) =>
  r.status === 404 || (r.data as { code?: string } | null)?.code === 'PGRST202'

/** المفتاح المحفوظ أولاً ثم متغيّر Vercel. `error` = رفض صريح لا يُتجاوز إلى المتغيّر. */
async function resolveKey(
  req: Request,
  provider: Provider,
): Promise<{ key?: string; error?: string; status?: number }> {
  const jwt = bearer(req)
  if (jwt && SUPABASE_URL && SUPABASE_ANON) {
    const r = await rpc('ai_key_get', { p_provider: provider }, jwt)
    if (r.ok && typeof r.data === 'string' && r.data.trim()) return { key: r.data.trim() }
    if (r.status === 401 || r.status === 403) {
      return { error: 'ما عندك صلاحية المحاسب الذكي.', status: 403 }
    }
    if (!r.ok && !missingFn(r)) {
      return { error: `تعذّر قراءة مفتاح المحاسب (${r.status}).`, status: 502 }
    }
  }
  const env = provider === 'deepseek' ? process.env.DEEPSEEK_API_KEY : process.env.ANTHROPIC_API_KEY
  return env ? { key: env } : {}
}

/**
 * يتحقق من المفتاح عند المزوّد قبل حفظه: مفتاح خاطئ يُكتشف الآن برسالة واضحة، لا
 * عند أول سؤال بعد أيام. نقاط لا تستهلك رموزاً: الرصيد لديب سيك، والنماذج لأنثروبيك.
 */
async function checkKey(provider: Provider, key: string): Promise<string | null> {
  const res =
    provider === 'deepseek'
      ? await fetch('https://api.deepseek.com/user/balance', {
          headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
        })
      : await fetch('https://api.anthropic.com/v1/models', {
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        })
  if (res.ok) return null
  if (res.status === 401 || res.status === 403) {
    return 'المزوّد رفض المفتاح — تأكد أنك نسخته كاملاً وأنه لم يُحذف.'
  }
  return `تعذّر التحقق من المفتاح عند المزوّد (${res.status}). حاول بعد قليل.`
}

async function saveKey(req: Request, body: AiRequest): Promise<Response> {
  const jwt = bearer(req)
  if (!jwt || !SUPABASE_URL || !SUPABASE_ANON) {
    return json(400, { error: 'حفظ المفتاح يحتاج تسجيل دخول وقاعدة بيانات مربوطة.' })
  }
  const provider: Provider = body.provider === 'anthropic' ? 'anthropic' : 'deepseek'
  const key = (body.key ?? '').trim()
  if (!key) return json(400, { error: 'الصق المفتاح أولاً.' })
  if (key.length > 400 || /\s/.test(key)) {
    return json(400, { error: 'هذا لا يشبه مفتاحاً — انسخه من صفحة المزوّد كما هو.' })
  }

  let invalid: string | null
  try {
    invalid = await checkKey(provider, key)
  } catch {
    invalid = 'تعذّر الوصول إلى المزوّد للتحقق من المفتاح.'
  }
  if (invalid) return json(400, { error: invalid })

  const r = await rpc('ai_key_set', { p_provider: provider, p_key: key }, jwt)
  if (r.ok) return json(200, { ok: true, hint: '…' + key.slice(-4) })
  if (missingFn(r)) {
    return json(500, {
      error: 'قاعدة البيانات تحتاج تحديثاً: شغّل الترحيل 20261019000000_ai_key.sql في SQL Editor.',
    })
  }
  if (r.status === 401 || r.status === 403) {
    return json(403, { error: 'حفظ المفتاح للمالك وحده (صلاحية إعدادات النظام).' })
  }
  return json(502, { error: `تعذّر حفظ المفتاح (${r.status}).` })
}

/** يمنع الاستدعاء من مواقع أخرى. ليس بديلاً عن مصادقة حقيقية. */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true // نداءات من نفس الأصل قد لا تُرسل الترويسة
  try {
    return new URL(origin).host === new URL(req.url).host
  } catch {
    return false
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return json(403, { error: 'أصل غير مصرّح به' })
  }

  // GET مخصّص لقراءة الرصيد فقط — لا يستهلك رموزاً ولا يمس المزوّد بطلب توليد.
  if (req.method === 'GET') {
    const provider =
      new URL(req.url).searchParams.get('provider') === 'anthropic' ? 'anthropic' : 'deepseek'
    const { key, error } = await resolveKey(req, provider)
    if (!key) return json(200, { balance: null, reason: error ?? 'المفتاح غير مضبوط' })
    if (provider !== 'deepseek') {
      return json(200, { balance: null, reason: 'أنثروبيك ما توفّر نقطة رصيد' })
    }
    try {
      return json(200, { balance: await deepSeekBalance(key) })
    } catch (err) {
      return json(200, { balance: null, reason: err instanceof Error ? err.message : 'تعذّر' })
    }
  }

  if (req.method !== 'POST') {
    return json(405, { error: 'الطريقة غير مدعومة' })
  }

  let body: AiRequest
  try {
    body = (await req.json()) as AiRequest
  } catch {
    return json(400, { error: 'صيغة الطلب غير صالحة' })
  }

  if (body.action === 'save_key') return saveKey(req, body)

  const provider: Provider = body.provider === 'anthropic' ? 'anthropic' : 'deepseek'
  const messages = body.messages ?? []
  if (messages.length === 0) {
    return json(400, { error: 'لا توجد رسائل' })
  }

  const resolved = await resolveKey(req, provider)
  if (resolved.error) return json(resolved.status ?? 500, { error: resolved.error })
  const key = resolved.key
  if (!key) return json(500, { error: NO_KEY })

  const model = body.model || DEFAULT_MODEL[provider]
  const system = body.system ?? ''

  try {
    const result =
      provider === 'deepseek'
        ? await callDeepSeek(key, model, system, messages)
        : await callAnthropic(key, model, system, messages)
    return json(200, result)
  } catch (err) {
    return json(502, {
      error: err instanceof Error ? err.message : 'تعذّر الاتصال بالمزوّد',
    })
  }
}

/** واجهة ديب سيك متوافقة مع OpenAI: رسالة النظام تُمرَّر داخل messages. */
async function callDeepSeek(
  key: string,
  model: string,
  system: string,
  messages: ChatMessage[],
): Promise<AiResult> {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      temperature: 0.3,
      stream: false,
      messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
    }),
  })

  if (!res.ok) {
    throw new Error(`ديب سيك رفض الطلب (${res.status}): ${(await res.text()).slice(0, 200)}`)
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

/** رصيد ديب سيك — المزوّد وحده يعرف الرقم الصحيح، فلا نقدّره من عندنا. */
async function deepSeekBalance(key: string): Promise<Balance | null> {
  const res = await fetch('https://api.deepseek.com/user/balance', {
    headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`تعذّر قراءة الرصيد (${res.status})`)

  const data = (await res.json()) as {
    is_available?: boolean
    balance_infos?: Array<{ currency?: string; total_balance?: string }>
  }
  const info = data.balance_infos?.[0]
  if (!info?.total_balance) return null
  return {
    available: data.is_available !== false,
    amount: Number(info.total_balance),
    currency: info.currency ?? 'USD',
  }
}

/** واجهة أنثروبيك: رسالة النظام حقل مستقل، والرد مصفوفة كتل محتوى. */
async function callAnthropic(
  key: string,
  model: string,
  system: string,
  messages: ChatMessage[],
): Promise<AiResult> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, max_tokens: MAX_TOKENS, system, messages }),
  })

  if (!res.ok) {
    throw new Error(`أنثروبيك رفض الطلب (${res.status}): ${(await res.text()).slice(0, 200)}`)
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  const input = data.usage?.input_tokens ?? 0
  const output = data.usage?.output_tokens ?? 0
  return {
    text:
      data.content
        ?.filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('\n')
        .trim() || 'لم يصل رد نصي من النموذج.',
    usage: { input, output, total: input + output },
  }
}
