/**
 * وسيط الذكاء الاصطناعي — دالة Vercel تعمل على حافة الشبكة.
 *
 * سببها الوحيد: المفتاح. أي نداء من المتصفح مباشرةً يعني أن مفتاح المزوّد يُشحن
 * داخل الصفحة ويقرأه أي زائر. هنا يبقى المفتاح في متغيرات بيئة Vercel ولا يغادر
 * الخادم، وتُحلّ معه مشكلة CORS لأن الصفحة تنادي أصلها نفسه.
 *
 * حدّ معروف لم يُعالَج بعد: هذه النقطة عامة. المفتاح لم يعد مكشوفاً، لكن من يعرف
 * عنوان الموقع يقدر يستهلكه. فحص الأصل أدناه يصدّ استدعاءً من صفحة أخرى ولا يصدّ
 * curl. الحارس الصحيح هو التحقق من رمز جلسة Supabase في ترويسة Authorization،
 * ويُضاف فور ربط المصادقة.
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

interface AiRequest {
  provider?: 'deepseek' | 'anthropic'
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
    const key =
      provider === 'deepseek' ? process.env.DEEPSEEK_API_KEY : process.env.ANTHROPIC_API_KEY
    if (!key) return json(200, { balance: null, reason: 'المفتاح غير مضبوط' })
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

  const provider = body.provider ?? 'deepseek'
  const messages = body.messages ?? []
  if (messages.length === 0) {
    return json(400, { error: 'لا توجد رسائل' })
  }

  const key = provider === 'deepseek' ? process.env.DEEPSEEK_API_KEY : process.env.ANTHROPIC_API_KEY

  if (!key) {
    return json(500, {
      error:
        provider === 'deepseek'
          ? 'مفتاح ديب سيك غير مضبوط في Vercel. أضِف متغيراً باسم DEEPSEEK_API_KEY وأعد النشر.'
          : 'مفتاح أنثروبيك غير مضبوط في Vercel. أضِف متغيراً باسم ANTHROPIC_API_KEY وأعد النشر.',
    })
  }

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
