import { useMemo, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Receipt,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Tabs,
  Textarea,
  cn,
  useToast,
  type Tone,
} from '@/components/ui'
import { Stat } from '@/components/Stat'
import { date, money, monthLabel, num, parseNum, round2 } from '@/lib/format'
import { purchasesSummary } from '@/lib/analytics'
import { STARTER_GROUPS, groupHint, groupName, groupsOf } from '@/lib/expenseGroups'
import {
  audit,
  createPurchaseBill,
  createPurchaseItem,
  deletePurchaseBill,
  renamePurchaseGroup,
  updatePurchaseBill,
  updatePurchaseItem,
} from '@/lib/repo'
import { cloudEnabled } from '@/lib/supabase'
import { purchasesSchemaReady } from '@/lib/mirror'
import { useApp } from '@/store/app'
import { usePurchaseBills, usePurchaseItems, useSuppliers } from '@/hooks/useShopData'
import type { PurchaseBill, PurchaseItem, PurchaseKind } from '@/lib/types'

const TONES: Tone[] = ['brand', 'accent', 'warn', 'ok', 'neutral']

/** لون ثابت لكل بند رئيسي من اسمه: نفس البند بنفس اللون في كل شاشة وكل مرة. */
function groupTone(name: string): Tone {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return TONES[h % TONES.length]
}

/**
 * عنوان بطاقة المصروف: المورد إن وُجد، وإلا البند الرئيسي — «رواتب» تقول أين ذهب
 * المال، و«بلا مورد» لا تقول شيئاً. مصروف بأكثر من بند رئيسي يُذكرها كلها.
 */
const billTitle = (bill: PurchaseBill): string =>
  bill.supplierName ??
  ([...new Set(bill.lines.map((l) => groupName(l.kind)))].join(' · ') || 'بلا مورد')

const monthStart = (ts: number) => {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}
const addMonths = (ts: number, n: number) => {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime()
}

/**
 * فواتير المشتريات: كل ما يصرفه المعمل غير البوكسات نفسها.
 *
 * طلب العميل حرفياً: «أحط فواتير مشتريات، أحدد بها نوع المكوّن، وبكم، وعدد».
 * وفي الصوتية أمثلة تتجاوز المكونات: فرن، صينية، ميكسر، كرتون، وإيجار — لذلك
 * لكل صنف «نوع» من أربعة، ومجموع الشهر يُعرض لكل نوع على حدة.
 *
 * لماذا لا تُطرح من «الربح» في التقارير: هذا صرف نقدي، لا تكلفة ما بيع. الفرن
 * يخدم سنوات والكرتون يُستهلك على أسابيع، وطرحهما من ربح شهر واحد يكذب.
 */
export default function PurchaseBills() {
  const { user, can } = useApp()
  const toast = useToast()
  const bills = usePurchaseBills()
  const items = usePurchaseItems()

  const [tab, setTab] = useState<'bills' | 'items'>('bills')
  const [month, setMonth] = useState(() => monthStart(Date.now()))
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState<PurchaseBill | null>(null)
  const [editingItem, setEditingItem] = useState<PurchaseItem | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [editingBill, setEditingBill] = useState<PurchaseBill | null>(null)

  const editable = can('purchase.edit')
  const next = addMonths(month, 1)
  const summary = useMemo(() => purchasesSummary(bills, month, next), [bills, month, next])
  const monthBills = useMemo(
    () =>
      bills
        .filter((b) => b.purchasedAt >= month && b.purchasedAt < next)
        .sort((a, b) => b.purchasedAt - a.purchasedAt || b.createdAt - a.createdAt),
    [bills, month, next],
  )

  async function remove(bill: PurchaseBill) {
    try {
      await deletePurchaseBill(bill.id)
      if (user)
        await audit(
          user,
          'حذف مصروف',
          'purchase_bill',
          bill.id,
          `${date(bill.purchasedAt)} — ${money(bill.total)}`,
        )
      toast('تم حذف الفاتورة')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'تعذّر الحذف', 'error')
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {/* «المصروفات» اسم الصفحة بطلب العميل؛ في الكود والقاعدة بقيت purchase_bills. */}
          <h1 className="text-xl font-bold tracking-tight">المصروفات</h1>
          <p className="mt-0.5 text-sm text-muted">
            كل ما يصرفه المعمل، على بنود رئيسية وتحتها بنودها
          </p>
        </div>
        {editable && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            مصروف جديد
          </Button>
        )}
      </div>

      {cloudEnabled && !purchasesSchemaReady && (
        <p className="flex items-start gap-2 rounded-xl border border-warn/30 bg-warn-soft/50 px-3 py-2.5 text-[13px] leading-6">
          <TriangleAlert className="mt-1 size-4 shrink-0 text-warn" />
          <span>
            قاعدة البيانات لم تُحدَّث لهذه الميزة بعد. شغّل ترحيل
            <span className="mx-1 font-mono text-[12px]" dir="ltr">
              20261014000000_purchase_bills.sql
            </span>
            في Supabase ← SQL Editor، ثم أعد فتح الموقع.
          </span>
        </p>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'bills', label: 'الفواتير' },
          { value: 'items', label: 'البنود', count: items.length },
        ]}
      />

      {tab === 'bills' ? (
        <>
          <Card className="flex items-center justify-between gap-2 p-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label="الشهر السابق"
              onClick={() => setMonth(addMonths(month, -1))}
            >
              <ChevronRight className="size-5" />
            </Button>
            <span className="font-semibold">{monthLabel(month)}</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="الشهر التالي"
              disabled={next > Date.now()}
              onClick={() => setMonth(next)}
            >
              <ChevronLeft className="size-5" />
            </Button>
          </Card>

          <Stat
            label="مصروفات الشهر"
            value={money(summary.total)}
            sub={`${num(summary.bills)} فاتورة`}
            icon={<Receipt className="size-5" />}
          />

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {summary.byKind.map((g) => (
              <Card key={g.kind} className="p-3">
                <Badge tone={groupTone(g.kind)}>{g.kind}</Badge>
                <p className="tnum mt-2 text-base font-bold break-words">{money(g.total)}</p>
              </Card>
            ))}
          </div>

          {monthBills.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Receipt className="size-6" />}
                title="لا مصروفات في هذا الشهر"
                description={
                  editable
                    ? 'سجّل ما اشتريته للمعمل: قشطة، كرتون، فرن، إيجار… ليظهر مجموع الصرف هنا.'
                    : 'لم يُسجَّل شيء بعد.'
                }
                action={
                  editable && (
                    <Button variant="primary" onClick={() => setCreating(true)}>
                      <Plus className="size-4" />
                      مصروف جديد
                    </Button>
                  )
                }
              />
            </Card>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {monthBills.map((b) => (
                <BillCard
                  key={b.id}
                  bill={b}
                  onEdit={editable ? () => setEditingBill(b) : undefined}
                  onDelete={editable ? () => setRemoving(b) : undefined}
                />
              ))}
            </div>
          )}

          {summary.items.length > 0 && (
            <Card>
              <CardHeader
                title="أين ذهب المال هذا الشهر"
                subtitle="الأصناف مرتّبة بما صُرف عليها"
              />
              <ul className="divide-y divide-border">
                {summary.items.slice(0, 10).map((it) => (
                  <li
                    key={`${it.name}-${it.unit}`}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]"
                  >
                    <div className="min-w-0">
                      <p className="font-medium break-words">{it.name}</p>
                      <p className="tnum text-[12px] text-muted">
                        {num(it.qty, 2)} {it.unit} · {it.kind}
                      </p>
                    </div>
                    <span className="tnum shrink-0 font-semibold">{money(it.total)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      ) : (
        <ItemsList
          items={items}
          bills={bills}
          onEdit={editable ? setEditingItem : undefined}
          onRenameGroup={editable ? setRenaming : undefined}
        />
      )}

      {creating && <BillForm onClose={() => setCreating(false)} />}

      {editingBill && <BillForm bill={editingBill} onClose={() => setEditingBill(null)} />}

      {editingItem && <ItemForm item={editingItem} onClose={() => setEditingItem(null)} />}

      {renaming && <GroupRename group={renaming} onClose={() => setRenaming(null)} />}

      <Modal
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title="حذف هذا المصروف؟"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              تراجع
            </Button>
            <Button variant="danger" onClick={() => removing && remove(removing)}>
              <Trash2 className="size-4" />
              حذف
            </Button>
          </>
        }
      >
        {removing && (
          <p className="text-sm leading-6 text-muted">
            فاتورة {billTitle(removing)} بتاريخ {date(removing.purchasedAt)} بمبلغ{' '}
            <span className="tnum font-semibold text-text">{money(removing.total)}</span>. لتصحيح
            خطأ فيها احذفها ثم أدخلها من جديد.
          </p>
        )}
      </Modal>
    </div>
  )
}

function BillCard({
  bill,
  onEdit,
  onDelete,
}: {
  bill: PurchaseBill
  onEdit?: () => void
  onDelete?: () => void
}) {
  // البطاقة كلها تفتح التعديل بضغطة؛ زر الحذف داخلها يوقف الضغطة كي لا يفتح التعديل معه.
  return (
    <Card
      className={cn('p-4', onEdit && 'cursor-pointer transition-colors hover:border-brand')}
      role={onEdit ? 'button' : undefined}
      tabIndex={onEdit ? 0 : undefined}
      aria-label={onEdit ? `تعديل مصروف ${billTitle(bill)}` : undefined}
      onClick={onEdit}
      onKeyDown={(e) => {
        if (onEdit && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onEdit()
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold break-words">{billTitle(bill)}</p>
          <p className="tnum mt-0.5 text-[12px] text-muted">
            {date(bill.purchasedAt)}
            {bill.ref && ` · فاتورة المورد ${bill.ref}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="tnum text-base font-bold">{money(bill.total)}</span>
          {onDelete && (
            <Button
              size="icon"
              variant="ghost"
              aria-label="حذف الفاتورة"
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
            >
              <Trash2 className="size-4 text-danger" />
            </Button>
          )}
        </div>
      </div>
      <ul className="mt-3 space-y-1.5 border-t border-border pt-3 text-[13px]">
        {bill.lines.map((l, i) => (
          <li key={i} className="flex items-start justify-between gap-3">
            <span className="min-w-0 break-words">
              {l.name}
              <span className="tnum text-muted">
                {' '}
                · {num(l.qty, 2)} {l.unit} × {money(l.unitPrice)}
              </span>
            </span>
            <span className="tnum shrink-0">{money(round2(l.qty * l.unitPrice))}</span>
          </li>
        ))}
      </ul>
      {bill.notes && (
        <p className="mt-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[12px] whitespace-pre-wrap text-muted">
          {bill.notes}
        </p>
      )}
    </Card>
  )
}

function ItemsList({
  items,
  bills,
  onEdit,
  onRenameGroup,
}: {
  items: PurchaseItem[]
  bills: PurchaseBill[]
  onEdit?: (item: PurchaseItem) => void
  onRenameGroup?: (group: string) => void
}) {
  const spent = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of bills)
      for (const l of b.lines)
        if (l.itemId) m.set(l.itemId, round2((m.get(l.itemId) ?? 0) + l.qty * l.unitPrice))
    return m
  }, [bills])

  if (items.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Receipt className="size-6" />}
          title="لا بنود بعد"
          description="البنود تُضاف من نافذة «مصروف جديد» نفسها: بند رئيسي (التشغيلية) وتحته بنوده (راتب العامل، الكهرباء…)."
        />
      </Card>
    )
  }

  // البنود الفرعية تحت بنودها الرئيسية، والمؤرشف آخر كل بند.
  const groups = new Map<string, PurchaseItem[]>()
  for (const it of items) {
    const g = groupName(it.kind)
    groups.set(g, [...(groups.get(g) ?? []), it])
  }
  const sections = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'ar'))
    .map(([name, list]) => ({
      name,
      list: list.sort(
        (a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, 'ar'),
      ),
      total: round2(list.reduce((n, it) => n + (spent.get(it.id) ?? 0), 0)),
    }))

  return (
    <div className="space-y-3">
      {sections.map((sec) => (
        <Card key={sec.name}>
          <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <Badge tone={groupTone(sec.name)}>{sec.name}</Badge>
              <span className="text-[12px] text-muted">{num(sec.list.length)} بند</span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <span className="tnum text-[13px] font-bold">{money(sec.total)}</span>
              {onRenameGroup && (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`إعادة تسمية ${sec.name}`}
                  onClick={() => onRenameGroup(sec.name)}
                >
                  <Pencil className="size-4" />
                </Button>
              )}
            </div>
          </div>
          <ul className="divide-y divide-border">
            {sec.list.map((it) => (
              <li
                key={it.id}
                className={cn(
                  'flex items-center justify-between gap-3 px-4 py-2.5',
                  it.archived && 'opacity-60',
                )}
              >
                <div className="min-w-0">
                  <p className="text-[14px] font-medium break-words">
                    {it.name}
                    {it.archived && <span className="text-[12px] text-faint"> · مؤرشف</span>}
                  </p>
                  <p className="mt-0.5 text-[12px] text-muted">بالـ{it.unit}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="tnum text-[13px] font-semibold">
                    {money(spent.get(it.id) ?? 0)}
                  </span>
                  {onEdit && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`تعديل ${it.name}`}
                      onClick={() => onEdit(it)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  )
}

/**
 * اختيار البند الرئيسي أو كتابة اسم جديد. لا قائمة ثابتة: ما يكتبه صاحب المعمل
 * هنا يصير بنداً رئيسياً بأول بند فرعي يُحفظ تحته.
 */
function GroupPicker({
  value,
  onChange,
  groups,
}: {
  value: PurchaseKind
  onChange: (g: PurchaseKind) => void
  groups: string[]
}) {
  const options = groups.length ? groups : STARTER_GROUPS
  const [typing, setTyping] = useState(() => Boolean(value) && !options.includes(value))
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {options.map((g) => (
          <button
            key={g}
            type="button"
            aria-pressed={!typing && value === g}
            onClick={() => {
              setTyping(false)
              onChange(g)
            }}
            className={cn(
              'rounded-lg border px-3 py-2 text-[13px] font-medium break-words transition-colors',
              !typing && value === g
                ? 'border-brand bg-brand-soft text-brand-strong'
                : 'border-border text-muted hover:border-border-strong',
            )}
          >
            {g}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={typing}
          onClick={() => {
            setTyping(true)
            onChange('')
          }}
          className={cn(
            'rounded-lg border border-dashed px-3 py-2 text-[13px] font-medium transition-colors',
            typing
              ? 'border-brand bg-brand-soft text-brand-strong'
              : 'border-border-strong text-muted hover:text-text',
          )}
        >
          ＋ بند رئيسي جديد
        </button>
      </div>
      {typing && (
        <Input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label="اسم البند الرئيسي"
          placeholder="اسم البند الرئيسي: التشغيلية، الرواتب…"
          maxLength={60}
        />
      )}
    </div>
  )
}

/** إعادة تسمية بند رئيسي — تنتقل بها كل بنوده الفرعية معاً. */
function GroupRename({ group, onClose }: { group: string; onClose: () => void }) {
  const toast = useToast()
  const [name, setName] = useState(group)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      await renamePurchaseGroup(group, name)
      toast('تمت إعادة التسمية')
      onClose()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'تعذّرت إعادة التسمية', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="إعادة تسمية البند الرئيسي"
      subtitle="تنتقل معه كل بنوده الفرعية. المصروفات المسجّلة سابقاً تبقى باسمها القديم"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={save}>
            حفظ
          </Button>
        </>
      }
    >
      <Field label="الاسم">
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      </Field>
    </Modal>
  )
}

function ItemForm({ item, onClose }: { item: PurchaseItem; onClose: () => void }) {
  const toast = useToast()
  const [name, setName] = useState(item.name)
  const [kind, setKind] = useState<PurchaseKind>(groupName(item.kind))
  const groups = groupsOf(usePurchaseItems())
  const [unit, setUnit] = useState(item.unit)
  const [busy, setBusy] = useState(false)

  async function save(patch: Partial<PurchaseItem>) {
    setBusy(true)
    try {
      await updatePurchaseItem(item.id, patch)
      toast('تم الحفظ')
      onClose()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'تعذّر الحفظ', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="تعديل بند"
      subtitle="المصروفات القديمة تحتفظ بالاسم والبند الرئيسي كما كانا يوم الشراء"
      size="sm"
      footer={
        <>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => save({ archived: !item.archived })}
          >
            {item.archived ? 'إرجاع للقائمة' : 'أرشفة'}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!name.trim() || !kind.trim()}
            onClick={() => save({ name: name.trim(), kind, unit: unit.trim() || item.unit })}
          >
            حفظ
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="اسم البند الفرعي">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {/* خارج `Field`: الحقل `<label>`، والضغط على نصّه كان يضغط أول زر في المنتقي. */}
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-muted">البند الرئيسي</p>
          <GroupPicker value={kind} onChange={setKind} groups={groups} />
        </div>
        <Field label="الوحدة المعتادة">
          <Input value={unit} onChange={(e) => setUnit(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

interface DraftLine {
  key: number
  itemId: string
  qty: string
  unit: string
  unitPrice: string
}

const todayInput = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** «2026-10-14» ← منتصف ذلك اليوم محلياً: منتصف الليل يقفز ليوم آخر مع فرق التوقيت. */
const fromDateInput = (v: string): number => {
  const [y, m, d] = v.split('-').map(Number)
  return new Date(y, m - 1, d, 12).getTime()
}

let lineKey = 0

/** `yyyy-mm-dd` لخانة التاريخ بالتوقيت المحلي — عكس `fromDateInput`. */
const toDateInput = (ts: number) => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** `bill` = تعديل مصروف قائم: النافذة نفسها معبّأة ببياناته، والحفظ يستبدله. */
function BillForm({ onClose, bill }: { onClose: () => void; bill?: PurchaseBill }) {
  const { user } = useApp()
  const toast = useToast()
  const suppliers = useSuppliers()
  const items = usePurchaseItems()
  // بند مؤرشف في المصروف المعدَّل يبقى في القائمة، وإلا ظهر سطره فارغاً «اختر البند».
  const inBill = useMemo(() => new Set(bill?.lines.map((l) => l.itemId) ?? []), [bill])
  const active = useMemo(
    () =>
      items
        .filter((i) => !i.archived || inBill.has(i.id))
        .sort((a, b) => a.name.localeCompare(b.name, 'ar')),
    [items, inBill],
  )
  const groups = useMemo(() => groupsOf(active.map((i) => ({ ...i, archived: false }))), [active])
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

  const [supplierId, setSupplierId] = useState(bill?.supplierId ?? '')
  const [day, setDay] = useState(() => (bill ? toDateInput(bill.purchasedAt) : todayInput()))
  const [ref, setRef] = useState(bill?.ref ?? '')
  const [notes, setNotes] = useState(bill?.notes ?? '')
  const [lines, setLines] = useState<DraftLine[]>(() =>
    bill?.lines.length
      ? bill.lines.map((l) => ({
          key: ++lineKey,
          itemId: l.itemId ?? '',
          qty: String(l.qty),
          unit: l.unit,
          unitPrice: String(l.unitPrice),
        }))
      : [{ key: ++lineKey, itemId: '', qty: '', unit: '', unitPrice: '' }],
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // صنف جديد من داخل الفاتورة: أول شراء لـ«كريمة خفق» لا يستحق مغادرة النافذة.
  const [newFor, setNewFor] = useState<number | null>(null)
  const [newName, setNewName] = useState('')
  const [newKind, setNewKind] = useState<PurchaseKind>('')
  const [newUnit, setNewUnit] = useState('')

  const patch = (key: number, p: Partial<DraftLine>) =>
    setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...p } : l)))

  const lineTotal = (l: DraftLine) => {
    const q = parseNum(l.qty)
    const p = parseNum(l.unitPrice)
    return Number.isFinite(q) && Number.isFinite(p) ? round2(q * p) : 0
  }
  const total = round2(lines.reduce((n, l) => n + lineTotal(l), 0))

  function pickItem(key: number, value: string) {
    if (value === '__new') {
      // البند الرئيسي الأول مختار مسبقاً: أغلب الإضافات تحت بند موجود.
      const first = groups[0] ?? STARTER_GROUPS[0]
      setNewFor(key)
      setNewName('')
      setNewKind(first)
      setNewUnit(groupHint(first).unit)
      return
    }
    patch(key, { itemId: value, unit: byId.get(value)?.unit ?? '' })
  }

  async function addItem() {
    if (newFor === null) return
    try {
      const item = await createPurchaseItem({ name: newName, kind: newKind, unit: newUnit })
      patch(newFor, { itemId: item.id, unit: item.unit })
      setNewFor(null)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'تعذّر إضافة البند', 'error')
    }
  }

  async function save() {
    setError(null)
    const filled = lines.filter((l) => l.itemId || l.qty || l.unitPrice)
    if (filled.length === 0) return setError('أضف بنداً واحداً على الأقل.')
    for (const l of filled) {
      const name = byId.get(l.itemId)?.name ?? 'بند'
      if (!l.itemId) return setError('اختر البند في كل سطر.')
      if (!(parseNum(l.qty) > 0)) return setError(`اكتب كمية «${name}».`)
      if (!(parseNum(l.unitPrice) >= 0)) return setError(`اكتب سعر «${name}».`)
    }
    if (!day) return setError('اختر تاريخ الشراء.')
    setBusy(true)
    try {
      const input = {
        supplierId: supplierId || undefined,
        purchasedAt: fromDateInput(day),
        ref: ref.trim() || undefined,
        notes: notes.trim() || undefined,
        lines: filled.map((l) => ({
          itemId: l.itemId,
          qty: parseNum(l.qty),
          unitPrice: parseNum(l.unitPrice),
          unit: l.unit.trim() || undefined,
        })),
      }
      let saved: PurchaseBill
      if (bill) {
        const res = await updatePurchaseBill(bill.id, input)
        saved = res.bill
        if (!res.oldRemoved) {
          // التعديل حُفظ؛ النافذة تُغلق كي لا يُضغط الحفظ مرة ثانية فتصير ثلاث نسخ.
          toast('حُفظ التعديل، لكن بقيت النسخة القديمة — احذفها من القائمة.', 'warn')
        }
      } else {
        saved = await createPurchaseBill(input)
      }
      if (user)
        await audit(
          user,
          bill ? 'تعديل مصروف' : 'مصروف جديد',
          'purchase_bill',
          saved.id,
          `${billTitle(saved)} — ${bill ? `${money(bill.total)} ← ` : ''}${money(saved.total)}`,
        )
      toast(`${bill ? 'تم حفظ التعديل' : 'تم حفظ المصروف'} — ${money(saved.total)}`)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر الحفظ')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={bill ? 'تعديل مصروف' : 'مصروف جديد'}
      subtitle="ما صرفته على المعمل: البند والكمية والسعر"
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="tnum text-base font-bold break-words">{money(total)}</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              إلغاء
            </Button>
            <Button variant="primary" loading={busy} onClick={save}>
              {bill ? 'حفظ التعديل' : 'حفظ الفاتورة'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="المورد" hint="اختياري">
            <Select
              value={supplierId}
              onChange={(e) => {
                setSupplierId(e.target.value)
                if (!e.target.value) setRef('')
              }}
            >
              <option value="">بلا مورد</option>
              {[...suppliers]
                .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="تاريخ الشراء">
            <Input
              type="date"
              value={day}
              max={todayInput()}
              onChange={(e) => setDay(e.target.value)}
            />
          </Field>
          {/* بلا مورد لا فاتورة مورد تُطابَق: الخانة تختفي بطلب العميل، وما كُتب فيها
              يُفرَّغ عند اختيار «بلا مورد» كي لا يُحفظ رقم بلا صاحب. */}
          {supplierId && (
            <Field label="رقم فاتورة المورد" hint="اختياري — للمطابقة">
              <Input value={ref} onChange={(e) => setRef(e.target.value)} dir="ltr" />
            </Field>
          )}
        </div>

        <div className="space-y-3">
          {lines.map((l, idx) => (
            <div key={l.key} className="rounded-xl border border-border p-3">
              <div className="flex items-center gap-2">
                <span className="tnum text-[12px] text-faint">{idx + 1}</span>
                <Select
                  aria-label="البند"
                  value={l.itemId}
                  onChange={(e) => pickItem(l.key, e.target.value)}
                  className="flex-1"
                >
                  <option value="">اختر البند…</option>
                  {groups.map((g) => (
                    <optgroup key={g} label={g}>
                      {active
                        .filter((i) => groupName(i.kind) === g)
                        .map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                  <option value="__new">＋ بند جديد…</option>
                </Select>
                {lines.length > 1 && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="حذف البند"
                    onClick={() => setLines((cur) => cur.filter((x) => x.key !== l.key))}
                  >
                    <X className="size-4" />
                  </Button>
                )}
              </div>

              {newFor === l.key && (
                <div className="mt-3 space-y-2.5 rounded-lg bg-surface-2 p-3">
                  {/* البند الرئيسي أولاً ثم الفرعي: مثال الخانة يتغيّر بالرئيسي فيعرف ماذا يكتب. */}
                  <p className="text-[12px] font-medium text-muted">البند الرئيسي</p>
                  <GroupPicker
                    value={newKind}
                    groups={groups}
                    onChange={(g) => {
                      setNewKind(g)
                      setNewUnit(groupHint(g).unit)
                    }}
                  />
                  <p className="pt-1 text-[12px] font-medium text-muted">البند الفرعي</p>
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    aria-label="اسم البند الفرعي"
                    placeholder={groupHint(newKind).name}
                  />
                  <div className="flex items-center gap-2">
                    <Input
                      aria-label="الوحدة"
                      value={newUnit}
                      onChange={(e) => setNewUnit(e.target.value)}
                      placeholder="الوحدة"
                      className="w-28"
                    />
                    <div className="flex-1" />
                    <Button variant="ghost" size="sm" onClick={() => setNewFor(null)}>
                      إلغاء
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={!newName.trim() || !newKind.trim()}
                      onClick={addItem}
                    >
                      إضافة البند
                    </Button>
                  </div>
                </div>
              )}

              <div className="mt-3 grid grid-cols-3 gap-2">
                <Field label="الكمية">
                  <Input
                    inputMode="decimal"
                    value={l.qty}
                    onChange={(e) => patch(l.key, { qty: e.target.value })}
                    placeholder="0"
                    className="tnum"
                  />
                </Field>
                <Field label="الوحدة">
                  <Input
                    value={l.unit}
                    onChange={(e) => patch(l.key, { unit: e.target.value })}
                    placeholder="كيلو"
                  />
                </Field>
                <Field label="سعر الوحدة">
                  <Input
                    inputMode="decimal"
                    value={l.unitPrice}
                    onChange={(e) => patch(l.key, { unitPrice: e.target.value })}
                    placeholder="0.00"
                    className="tnum"
                  />
                </Field>
              </div>
              <p className="tnum mt-2 text-left text-[13px] font-semibold">{money(lineTotal(l))}</p>
            </div>
          ))}

          <Button
            variant="secondary"
            className="w-full"
            onClick={() =>
              setLines((cur) => [
                ...cur,
                { key: ++lineKey, itemId: '', qty: '', unit: '', unitPrice: '' },
              ])
            }
          >
            <Plus className="size-4" />
            بند آخر
          </Button>
        </div>

        <Field label="ملاحظات" hint="اختياري">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {error && (
          <p className="rounded-xl border border-danger/30 bg-danger-soft/50 px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
