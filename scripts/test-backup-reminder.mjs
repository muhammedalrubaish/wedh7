/**
 * فحص منطق تذكير النسخ الاحتياطي (`src/lib/backupReminder.ts`): متى يظهر الشريط
 * ومتى يصمت، وصيغة عدد الأيام بالعربية.
 *
 * التشغيل: npm run test:rows (يشغّله بعد فحص الأعمدة والصفحات)
 */
import { mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const OUT = mkdtempSync(join(tmpdir(), 'wedh7-backup-'))
execFileSync(
  'node_modules/.bin/esbuild',
  ['src/lib/backupReminder.ts', '--format=esm', '--platform=node', `--outfile=${OUT}/br.mjs`],
  { stdio: 'pipe' },
)
const { backupStatus, daysLabel } = await import(`${OUT}/br.mjs`)
const D = 86_400_000,
  now = Date.UTC(2026, 9, 20, 12)
let fail = 0
const ok = (c, m) => {
  console.log(`${c ? '✅' : '❌'} ${m}`)
  if (!c) fail++
}
ok(
  !backupStatus({ lastAt: 0, snoozeUntil: 0, firstDataAt: null, now }).due,
  'قاعدة فارغة بلا نسخة: لا تنبيه',
)
ok(
  !backupStatus({ lastAt: 0, snoozeUntil: 0, firstDataAt: now - 6 * D, now }).due,
  'أول فاتورة قبل ٦ أيام بلا نسخة: لا تنبيه بعد',
)
ok(
  backupStatus({ lastAt: 0, snoozeUntil: 0, firstDataAt: now - 7 * D, now }).due,
  'أول فاتورة قبل ٧ أيام بلا نسخة: تنبيه',
)
ok(
  !backupStatus({ lastAt: now - 3 * D, snoozeUntil: 0, firstDataAt: now - 30 * D, now }).due,
  'نسخة قبل ٣ أيام: لا تنبيه',
)
const s = backupStatus({ lastAt: now - 9 * D, snoozeUntil: 0, firstDataAt: now - 30 * D, now })
ok(s.due && s.days === 9, `نسخة قبل ٩ أيام: تنبيه وعدد الأيام ${s.days}`)
ok(
  !backupStatus({ lastAt: now - 9 * D, snoozeUntil: now + D, firstDataAt: 1, now }).due,
  'مؤجَّل إلى الغد: لا تنبيه',
)
ok(
  backupStatus({ lastAt: now - 9 * D, snoozeUntil: now - 1, firstDataAt: 1, now }).due,
  'انتهى التأجيل: يعود التنبيه',
)
ok(
  [1, 2, 3, 10, 11, 25].map(daysLabel).join('،') ===
    'يوم واحد،يومان،3 أيام،10 أيام،11 يوماً،25 يوماً',
  'صيغ العدد: ' + [1, 2, 3, 10, 11, 25].map(daysLabel).join('، '),
)
process.exit(fail ? 1 : 0)
