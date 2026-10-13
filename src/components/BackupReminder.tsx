import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { DatabaseBackup } from 'lucide-react'
import { Button } from './ui'
import { db } from '@/lib/db'
import { cloudEnabled } from '@/lib/supabase'
import { useApp } from '@/store/app'
import {
  BACKUP_EVENT,
  backupStatus,
  daysLabel,
  lastBackupAt,
  snoozeBackup,
  snoozedUntil,
} from '@/lib/backupReminder'

/**
 * شريط يظهر لمن يملك تنزيل النسخة (`settings.manage`) حين يمرّ أسبوع بلا نسخة.
 *
 * في الوضع السحابي وحده: وضع العرض بيانات تجريبية، وتنبيه نسخها يعلّم صاحب
 * المحل تجاهل التنبيه قبل أن يبدأ عمله الحقيقي.
 */
export function BackupReminder() {
  const { can } = useApp()
  const navigate = useNavigate()
  const [, rerender] = useState(0)

  useEffect(() => {
    const bump = () => rerender((n) => n + 1)
    window.addEventListener(BACKUP_EVENT, bump)
    // `storage` يصل من التبويبات الأخرى: نسخة أُخذت في تبويب تُسكت الشريط في الباقي.
    window.addEventListener('storage', bump)
    return () => {
      window.removeEventListener(BACKUP_EVENT, bump)
      window.removeEventListener('storage', bump)
    }
  }, [])

  const firstDataAt = useLiveQuery(async () => {
    const [inv, bill] = await Promise.all([
      db.invoices.orderBy('createdAt').first(),
      db.purchaseBills.orderBy('purchasedAt').first(),
    ])
    const times = [inv?.createdAt, bill?.purchasedAt].filter((t): t is number => Boolean(t))
    return times.length ? Math.min(...times) : null
  }, [])

  if (!cloudEnabled || !can('settings.manage') || firstDataAt === undefined) return null

  const status = backupStatus({
    lastAt: lastBackupAt(),
    snoozeUntil: snoozedUntil(),
    firstDataAt,
    now: Date.now(),
  })
  if (!status.due) return null

  return (
    <div className="no-print border-b border-danger/30 bg-danger-soft">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-6">
        <DatabaseBackup className="size-5 shrink-0 text-danger" />
        <p className="min-w-0 flex-1 text-[13px] leading-5 text-text">
          <span className="font-semibold">
            {status.days === null
              ? 'لم تأخذ نسخة احتياطية بعد.'
              : `مرّ ${daysLabel(status.days)} على آخر نسخة احتياطية.`}
          </span>{' '}
          Supabase لا يحفظ نسخاً على الخطة المجانية — نسختك هي الحماية الوحيدة لبيانات المحل.
        </p>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="ghost" onClick={() => snoozeBackup()}>
            لاحقاً
          </Button>
          <Button size="sm" variant="primary" onClick={() => navigate('/settings?backup=1')}>
            خذ نسخة الآن
          </Button>
        </div>
      </div>
    </div>
  )
}
