import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  FileText,
  History,
  LogIn,
  LogOut,
  Package,
  ReceiptText,
  RefreshCw,
  Tags,
  Truck,
  Undo2,
  UserCog,
  Users,
} from 'lucide-react'
import { Button, EmptyState, Modal, Skeleton, Tabs, cn } from './ui'
import { listAudit } from '@/lib/auth'
import { dateTime, relative } from '@/lib/format'
import { useApp } from '@/store/app'
import type { AuditEntry } from '@/lib/types'

type Filter = 'all' | 'sales' | 'session' | 'edits'

/** الفواتير والمرتجعات والسداد معاً: هي ما يسأل عنه صاحب المعمل أولاً. */
const SALES = new Set(['invoice', 'return'])

const matches = (a: AuditEntry, f: Filter) =>
  f === 'all' ||
  (f === 'sales' && SALES.has(a.entity)) ||
  (f === 'session' && a.entity === 'session') ||
  (f === 'edits' && !SALES.has(a.entity) && a.entity !== 'session')

function EntryIcon({ entry }: { entry: AuditEntry }) {
  const cls = 'size-4'
  if (entry.entity === 'session')
    return entry.action === 'خروج' ? <LogOut className={cls} /> : <LogIn className={cls} />
  const icons: Record<string, JSX.Element> = {
    invoice: <FileText className={cls} />,
    return: <Undo2 className={cls} />,
    part: <Package className={cls} />,
    category: <Tags className={cls} />,
    customer: <Users className={cls} />,
    supplier: <Truck className={cls} />,
    purchase_bill: <ReceiptText className={cls} />,
    user: <UserCog className={cls} />,
  }
  return icons[entry.entity] ?? <History className={cls} />
}

const TONE: Record<string, string> = {
  invoice: 'bg-brand-soft text-brand',
  return: 'bg-warn-soft text-warn',
  session: 'bg-surface-2 text-muted',
}

/** قائمة القيود نفسها — تُستعمل في نافذة الترويسة وفي تبويب «السجل» بصفحة المستخدمين. */
export function AuditList({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) return <EmptyState title="لا نشاط هنا بعد" />
  return (
    <ul className="divide-y divide-border">
      {entries.map((a) => (
        <li key={a.id} className="flex items-start gap-3 py-2.5 text-[13px]">
          <span
            className={cn(
              'mt-0.5 grid size-8 shrink-0 place-items-center rounded-full',
              TONE[a.entity] ?? 'bg-surface-2 text-text',
            )}
          >
            <EntryIcon entry={a} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">{a.action}</p>
            {/* التفاصيل تحمل رقم الفاتورة ومبلغها: تُلفّ ولا تُقصّ. */}
            {a.details && <p className="break-words text-muted">{a.details}</p>}
            <p className="mt-0.5 text-[11px] text-faint">
              {a.userName} · <span title={dateTime(a.at)}>{relative(a.at)}</span>
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
}

/**
 * زر السجل في الترويسة بجانب الصوت. يظهر لمن يملك `users.manage` وحده: سياسة
 * `audit_read` في القاعدة لا تُرجع القيود لغيره، فالزر عنده يفتح قائمة فارغة دائماً.
 */
export function AuditButton() {
  const { can } = useApp()
  const [open, setOpen] = useState(false)
  if (!can('users.manage')) return null
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label="سجل النشاط"
        title="سجل النشاط"
      >
        <History className="size-4" />
      </Button>
      <AuditModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}

function AuditModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(false)

  // يُقرأ عند كل فتح لا مرة واحدة: السجل على الخادم لا في المرآة المحلية، وما أضافه
  // جهاز آخر (فاتورة من جوال الموظف) لا يصل إلا بقراءة جديدة.
  const load = useCallback(async () => {
    setLoading(true)
    try {
      setEntries(await listAudit(100))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const shown = useMemo(() => (entries ?? []).filter((a) => matches(a, filter)), [entries, filter])

  return (
    <Modal open={open} onClose={onClose} title="سجل النشاط" subtitle="آخر ١٠٠ عملية" size="sm">
      <div className="mb-3 flex items-center gap-2">
        <Tabs
          value={filter}
          onChange={setFilter}
          items={[
            { value: 'all', label: 'الكل' },
            { value: 'sales', label: 'الفواتير' },
            { value: 'session', label: 'الدخول' },
            { value: 'edits', label: 'التعديلات' },
          ]}
        />
        <Button
          variant="ghost"
          size="icon"
          className="ms-auto shrink-0"
          onClick={() => void load()}
          disabled={loading}
          aria-label="تحديث"
        >
          <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
        </Button>
      </div>
      {entries === null ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : (
        <AuditList entries={shown} />
      )}
    </Modal>
  )
}
