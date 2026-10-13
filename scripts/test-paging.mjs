/**
 * فحص السحب على صفحات (`src/lib/paging.ts`).
 *
 * Supabase يقصّ كل طلب عند ١٠٠٠ صف بصمت. هذا الفحص يحاكي خادماً يفعل ذلك ويتأكد
 * أن المرآة والنسخة الاحتياطية تصلهما كل الصفوف، وأن خطأً في منتصف السحب لا
 * يُرجع نصف بيانات تبدو كاملة.
 *
 * التشغيل: npm run test:rows (يشغّله بعد فحص الأعمدة)
 */
import { mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const OUT = mkdtempSync(join(tmpdir(), 'wedh7-paging-'))
execFileSync(
  'node_modules/.bin/esbuild',
  ['src/lib/paging.ts', '--format=esm', '--platform=node', `--outfile=${OUT}/paging.mjs`],
  { stdio: 'pipe' },
)
const { selectAllWith } = await import(`${OUT}/paging.mjs`)
// خادم وهمي يقصّ عند ١٠٠٠ صف كما يفعل Supabase، ويسجّل كل طلب
const server = (n, maxRows = 1000, failAt = -1) => {
  const rows = Array.from({ length: n }, (_, i) => ({ id: i }))
  const calls = []
  const src = () => ({
    range: async (a, b) => {
      calls.push([a, b])
      if (calls.length === failAt) return { data: null, error: { code: 'X' } }
      return { data: rows.slice(a, Math.min(b + 1, a + maxRows)), error: null }
    },
  })
  return { src, calls }
}
let fail = 0
const ok = (c, m) => {
  console.log(`${c ? '✅' : '❌'} ${m}`)
  if (!c) fail++
}
for (const n of [0, 1, 999, 1000, 1001, 2500]) {
  const s = server(n)
  const r = await selectAllWith(null, s.src)
  const ids = r.data.map((x) => x.id)
  ok(
    r.data.length === n && new Set(ids).size === n,
    `${n} صف ← وصل ${r.data.length} في ${s.calls.length} طلب`,
  )
}
{
  const s = server(12000)
  const r = await selectAllWith(null, s.src, 5000)
  ok(r.data.length === 5000 && s.calls.at(-1)[1] === 4999, `سقف ٥٠٠٠ من ١٢٠٠٠ ← ${r.data.length}`)
}
{
  const s = server(2500, 1000, 2)
  const r = await selectAllWith(null, s.src)
  ok(r.data === null && r.error, 'خطأ في الصفحة الثانية يُرجع خطأً لا نصف بيانات')
}
process.exit(fail ? 1 : 0)
