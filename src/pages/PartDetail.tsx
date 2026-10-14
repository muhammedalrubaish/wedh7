import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowRight,
  Boxes,
  Coins,
  Layers,
  Pencil,
  Printer,
  Scale,
  Trash2,
  TrendingUp,
} from 'lucide-react'
import {
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
} from '@/components/ui'
import { Stat } from '@/components/Stat'
import { BarcodeSvg, printLabels } from '@/components/Barcode'
import { PartForm } from '@/components/PartForm'
import { db } from '@/lib/db'
import { applyMovement, audit, deletePart } from '@/lib/repo'
import { marginPercent, money, num, relative } from '@/lib/format'
import { countedQty, velocity } from '@/lib/analytics'
import { useApp } from '@/store/app'
import { useCategories, useSuppliers } from '@/hooks/useShopData'
import type { MovementType } from '@/lib/types'

const MOVEMENT_LABELS: Record<MovementType, string> = {
  purchase: 'إنتاج / استلام',
  sale: 'بيع',
  adjustment: 'تسوية',
  return_in: 'مرتجع من زبون',
  return_out: 'إرجاع للمورد',
  damage: 'تالف / منتهي',
}

type Tab = 'movements' | 'label'

export default function PartDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { user, can } = useApp()
  const toast = useToast()

  const part = useLiveQuery(() => db.parts.get(id), [id])
  const movements = useLiveQuery(
    async () =>
      (await db.movements.where('partId').equals(id).toArray()).sort((a, b) => b.at - a.at),
    [id],
    [],
  )

  const categories = useCategories()
  const suppliers = useSuppliers()

  const [tab, setTab] = useState<Tab>('movements')
  const [editOpen, setEditOpen] = useState(false)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [copies, setCopies] = useState(6)

  const v30 = useMemo(() => (part ? velocity(movements, part.id, 30) : 0), [movements, part])

  if (!part) {
    return (
      <Card>
        <EmptyState
          title="المنتج غير موجود"
          action={
            <Link to="/inventory">
              <Button>رجوع للمنتجات</Button>
            </Link>
          }
        />
      </Card>
    )
  }

  const category = categories.find((c) => c.id === part.categoryId)

  async function removePart() {
    if (!part || !user) return
    setDeleting(true)
    try {
      await deletePart(part.id)
      await audit(user, 'حذف منتج', 'part', part.id, `${part.name} — الرصيد ${part.qty}`)
      toast(`تم حذف «${part.name}»`)
      navigate('/inventory', { replace: true })
    } catch (err) {
      toast(err instanceof Error ? err.message : 'تعذّر الحذف', 'error')
      setDeleting(false)
      setDeleteOpen(false)
    }
  }
  const supplier = suppliers.find((s) => s.id === part.supplierId)
  const margin = marginPercent(part.priceRetail, part.cost)
  const showCost = can('pricing.view')
  const daysOfCover = part.unlimited ? Infinity : v30 > 0 ? part.qty / v30 : Infinity

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="رجوع">
            <ArrowRight className="size-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight">{part.name}</h1>
            <p className="tnum mt-0.5 text-[13px] text-muted">
              {part.sku}
              {category && ` · ${category.name}`}
              {part.location && ` · ${part.location}`}
              {supplier && ` · ${supplier.name}`}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {can('inventory.adjust') && (
            <Button variant="secondary" onClick={() => setAdjustOpen(true)}>
              <Scale className="size-4" />
              إنتاج / تسوية
            </Button>
          )}
          {can('inventory.edit') && (
            <Button variant="primary" onClick={() => setEditOpen(true)}>
              <Pencil className="size-4" />
              تعديل
            </Button>
          )}
          {can('inventory.edit') && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDeleteOpen(true)}
              aria-label="حذف المنتج"
              title="حذف المنتج"
            >
              <Trash2 className="size-4 text-danger" />
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="الرصيد الحالي"
          value={part.unlimited ? '∞' : num(part.qty)}
          icon={<Boxes className="size-5" />}
          tone={
            part.unlimited
              ? 'ok'
              : part.qty === 0
                ? 'danger'
                : part.qty <= part.reorderPoint
                  ? 'warn'
                  : 'ok'
          }
          sub={part.unlimited ? 'بدون حد — يُصنع حسب الطلب' : `حدّ التنبيه ${part.reorderPoint}`}
        />
        <Stat
          label="معدل البيع"
          value={`${v30.toFixed(2)}/يوم`}
          icon={<TrendingUp className="size-5" />}
          tone="brand"
          sub={
            part.unlimited
              ? 'يُصنع حسب الطلب'
              : Number.isFinite(daysOfCover)
                ? `يكفي ${Math.floor(daysOfCover)} يوم`
                : 'لا حركة خلال ٣٠ يوم'
          }
        />
        {showCost ? (
          <Stat
            label="قيمة المخزون"
            value={money(countedQty(part) * part.cost, { compact: true })}
            icon={<Coins className="size-5" />}
            tone="accent"
            sub={`التكلفة ${money(part.cost)}`}
          />
        ) : (
          <Stat
            label="سعر البيع"
            value={money(part.priceRetail)}
            icon={<Coins className="size-5" />}
          />
        )}
        {showCost && (
          <Stat
            label="هامش الربح"
            value={`${margin.toFixed(1)}٪`}
            icon={<Scale className="size-5" />}
            tone={margin < 15 ? 'danger' : margin < 30 ? 'warn' : 'ok'}
            sub={`ربح ${money(part.priceRetail - part.cost)} للبوكس`}
          />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="border-b border-border p-3">
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { value: 'movements', label: 'الحركة', count: movements.length },
                { value: 'label', label: 'الباركود' },
              ]}
            />
          </div>

          {tab === 'movements' &&
            (movements.length === 0 ? (
              <EmptyState icon={<Layers className="size-6" />} title="لا توجد حركات مسجلة" />
            ) : (
              <ul className="max-h-[26rem] divide-y divide-border overflow-y-auto">
                {movements.slice(0, 100).map((m) => (
                  <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                    <span
                      className={cn(
                        'tnum grid w-12 shrink-0 place-items-center rounded-lg py-1 text-sm font-bold',
                        m.qty > 0 ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger',
                      )}
                    >
                      {m.qty > 0 ? `+${m.qty}` : m.qty}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{MOVEMENT_LABELS[m.type]}</p>
                      <p className="tnum truncate text-[11px] text-faint">
                        {m.ref ?? '—'}
                        {m.note && ` · ${m.note}`}
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] text-faint">{relative(m.at)}</span>
                  </li>
                ))}
              </ul>
            ))}

          {tab === 'label' && (
            <div className="space-y-4 p-4">
              <div className="grid place-items-center rounded-xl border border-border bg-white p-4">
                <BarcodeSvg value={part.barcode || part.sku} />
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="عدد النسخ" className="w-32">
                  <Input
                    type="number"
                    min="1"
                    max="60"
                    className="tnum"
                    value={copies}
                    onChange={(e) => setCopies(Math.min(60, Math.max(1, Number(e.target.value))))}
                  />
                </Field>
                <Button variant="primary" onClick={() => printLabels(part, copies)}>
                  <Printer className="size-4" />
                  طباعة الملصقات
                </Button>
              </div>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="سياسة المخزون والتسعير" icon={<Scale className="size-[18px]" />} />
          <dl className="divide-y divide-border text-[13px]">
            {[
              ['حدّ التنبيه', num(part.reorderPoint)],
              ['كمية الإنتاج المعتادة', num(part.reorderQty)],
              ['أيام التجهيز', `${part.leadTimeDays} يوم`],
              ...(showCost ? [['التكلفة المرجّحة', money(part.cost)]] : []),
              ['سعر البيع', money(part.priceRetail)],
              ['آخر تحديث', relative(part.updatedAt)],
            ].map(([k, val]) => (
              <div
                key={k as string}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <dt className="text-muted">{k}</dt>
                <dd className="tnum font-medium">{val}</dd>
              </div>
            ))}
          </dl>
          {part.notes && (
            <p className="border-t border-border px-4 py-3 text-[13px] text-muted">{part.notes}</p>
          )}
        </Card>
      </div>

      <PartForm open={editOpen} onClose={() => setEditOpen(false)} part={part} />

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={`حذف «${part.name}» نهائياً؟`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              تراجع
            </Button>
            <Button variant="danger" loading={deleting} onClick={removePart}>
              <Trash2 className="size-4" />
              حذف نهائي
            </Button>
          </>
        }
      >
        <ul className="space-y-2 text-[13px] leading-6 text-muted">
          <li>✅ الفواتير السابقة تبقى كما هي باسمه وسعره، ولا يتغيّر رقم في التقارير.</li>
          <li>
            🗑️ يُحذف رصيده (<span className="tnum font-semibold text-text">{num(part.qty)}</span>{' '}
            بوكس) وسجل حركته كاملاً.
          </li>
          <li>⚠️ لا يمكن التراجع. لمنتج توقّف بيعه فقط، الأرشفة أفضل: يختفي ويبقى سجله.</li>
        </ul>
      </Modal>

      <AdjustModal
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        onSubmit={async (qty, type, note, unitCost) => {
          if (!user) return
          await applyMovement({ partId: part.id, qty, type, userId: user.id, note, unitCost })
          await audit(user, 'حركة مخزون', 'part', part.id, `${qty > 0 ? '+' : ''}${qty} — ${note}`)
          toast('تم تسجيل الحركة')
        }}
        currentQty={part.qty}
        unlimited={Boolean(part.unlimited)}
        currentCost={part.cost}
        showCost={showCost}
      />
    </div>
  )
}

/**
 * الإنتاج والتسوية من نافذة واحدة.
 *
 * للمعمل «الإنتاج» هو الاستلام: دفعة بوكسات جاهزة تدخل المخزون بتكلفتها. والصادر
 * يُفرَّق بين «تالف/منتهي» و«عينات» كي تُقرأ الخسارة من التسويق في التقارير.
 */
function AdjustModal({
  open,
  onClose,
  onSubmit,
  currentQty,
  unlimited,
  currentCost,
  showCost,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (qty: number, type: MovementType, note: string, unitCost?: number) => Promise<void>
  currentQty: number
  /** «بدون حد»: الخادم لا يحرّك الرصيد، فلا «بعد الحركة» ولا منع للخصم. */
  unlimited: boolean
  currentCost: number
  showCost: boolean
}) {
  const [qty, setQty] = useState(1)
  const [direction, setDirection] = useState<'in' | 'out'>('in')
  const [type, setType] = useState<MovementType>('purchase')
  const [note, setNote] = useState('دفعة إنتاج')
  const [unitCost, setUnitCost] = useState<number | ''>('')
  const [busy, setBusy] = useState(false)

  const signed = direction === 'in' ? Math.abs(qty) : -Math.abs(qty)
  const after = currentQty + signed
  const invalid = (!unlimited && after < 0) || qty <= 0 || !note.trim()

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="إنتاج / تسوية"
      subtitle={
        unlimited ? 'بدون حد — تُسجَّل الحركة ولا يتغيّر الرصيد' : `الرصيد الحالي ${currentQty}`
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={invalid}
            onClick={async () => {
              setBusy(true)
              await onSubmit(
                signed,
                type,
                note.trim(),
                direction === 'in' && type === 'purchase' && unitCost !== ''
                  ? Number(unitCost)
                  : undefined,
              )
              setBusy(false)
              setQty(1)
              onClose()
            }}
          >
            تسجيل
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {(['in', 'out'] as const).map((d) => (
            <button
              key={d}
              onClick={() => {
                setDirection(d)
                setType(d === 'in' ? 'purchase' : 'damage')
                setNote(d === 'in' ? 'دفعة إنتاج' : '')
              }}
              className={cn(
                'rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors',
                direction === d
                  ? d === 'in'
                    ? 'border-ok bg-ok-soft text-ok'
                    : 'border-danger bg-danger-soft text-danger'
                  : 'border-border text-muted hover:border-border-strong',
              )}
            >
              {d === 'in' ? 'إضافة للمخزون' : 'خصم من المخزون'}
            </button>
          ))}
        </div>

        <Field label="الكمية">
          <Input
            type="number"
            min="1"
            className="tnum"
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
          />
        </Field>

        <Field label="نوع الحركة">
          <Select value={type} onChange={(e) => setType(e.target.value as MovementType)}>
            {direction === 'in' ? (
              <>
                <option value="purchase">دفعة إنتاج / استلام</option>
                <option value="return_in">مرتجع من زبون (بلا فاتورة)</option>
                <option value="adjustment">تسوية جرد</option>
              </>
            ) : (
              <>
                <option value="damage">تالف / منتهي الصلاحية</option>
                <option value="adjustment">تسوية جرد / عينات بلا فاتورة</option>
                <option value="return_out">إرجاع للمورد</option>
              </>
            )}
          </Select>
        </Field>

        {direction === 'in' && type === 'purchase' && showCost && (
          <Field
            label="تكلفة البوكس في هذه الدفعة"
            hint={`اتركه فارغاً للإبقاء على ${money(currentCost)}`}
          >
            <Input
              type="number"
              min="0"
              step="0.01"
              className="tnum"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </Field>
        )}

        <Field label="السبب" hint="مطلوب — يظهر في سجل الحركة">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        {!unlimited && (
          <p
            className={cn(
              'tnum rounded-xl px-3 py-2 text-sm',
              after < 0 ? 'bg-danger-soft text-danger' : 'bg-surface-2 text-muted',
            )}
          >
            الرصيد بعد الحركة: <span className="font-bold">{after}</span>
            {after < 0 && ' — لا يمكن أن يكون بالسالب'}
          </p>
        )}
      </div>
    </Modal>
  )
}
