import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowUpDown,
  Barcode,
  Filter,
  MapPin,
  PackagePlus,
  Pencil,
  Search,
  SlidersHorizontal,
  Tags,
} from 'lucide-react'
import {
  Button,
  Card,
  EmptyState,
  Input,
  Meter,
  Field,
  Modal,
  Pager,
  Select,
  cn,
  useToast,
  useDebounced,
  usePagination,
} from '@/components/ui'
import { PartForm } from '@/components/PartForm'
import { CategoryManager } from '@/components/CategoryManager'
import { bulkUpdateParts, type BulkPartPatch } from '@/lib/repo'
import { marginPercent, money, num } from '@/lib/format'
import {
  useActiveParts,
  useCategories,
  useMovements,
  usePurchaseOrders,
  useSuppliers,
} from '@/hooks/useShopData'
import { reorderSuggestions } from '@/lib/analytics'
import { useApp } from '@/store/app'
import type { Part, Supplier } from '@/lib/types'

type StockFilter = 'all' | 'reorder' | 'out' | 'healthy'
type SortKey = 'name' | 'priceDesc' | 'priceAsc' | 'qty' | 'qtyDesc' | 'value' | 'margin' | 'newest'

export default function Inventory() {
  const { can } = useApp()
  const [params, setParams] = useSearchParams()

  const parts = useActiveParts()
  const categories = useCategories()
  const movements = useMovements()
  const purchaseOrders = usePurchaseOrders()

  const [query, setQuery] = useState('')
  const debounced = useDebounced(query)
  const [category, setCategory] = useState('all')
  const [sort, setSort] = useState<SortKey>('name')
  const [showFilters, setShowFilters] = useState(false)
  const [editing, setEditing] = useState<Part | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [categoriesOpen, setCategoriesOpen] = useState(false)

  const stockFilter = (params.get('filter') as StockFilter) ?? 'all'
  const setStockFilter = (f: StockFilter) => {
    const next = new URLSearchParams(params)
    if (f === 'all') next.delete('filter')
    else next.set('filter', f)
    setParams(next, { replace: true })
  }

  const reorderIds = useMemo(
    () => new Set(reorderSuggestions(parts, movements, purchaseOrders).map((r) => r.part.id)),
    [parts, movements, purchaseOrders],
  )

  const categoryNames = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories])

  const rows = useMemo(() => {
    const q = debounced.trim().toLowerCase()
    let out = parts.filter((p) => {
      if (category !== 'all' && p.categoryId !== category) return false
      if (stockFilter === 'out' && p.qty > 0) return false
      if (stockFilter === 'reorder' && !reorderIds.has(p.id)) return false
      if (stockFilter === 'healthy' && reorderIds.has(p.id)) return false
      if (!q) return true
      return `${p.name} ${p.nameEn ?? ''} ${p.sku} ${p.barcode ?? ''} ${p.location ?? ''}`
        .toLowerCase()
        .includes(q)
    })

    out = [...out].sort((a, b) => {
      const byName = () => a.name.localeCompare(b.name, 'ar')
      switch (sort) {
        case 'priceDesc':
          return b.priceRetail - a.priceRetail || byName()
        case 'priceAsc':
          return a.priceRetail - b.priceRetail || byName()
        case 'qty':
          return a.qty - b.qty || byName()
        case 'qtyDesc':
          return b.qty - a.qty || byName()
        case 'value':
          return b.qty * b.cost - a.qty * a.cost
        case 'margin':
          return marginPercent(a.priceRetail, a.cost) - marginPercent(b.priceRetail, b.cost)
        case 'newest':
          return b.createdAt - a.createdAt
        default:
          return byName()
      }
    })
    return out
  }, [parts, debounced, category, stockFilter, sort, reorderIds])

  const { page, pages, slice, setPage } = usePagination(rows, 20)

  const totals = useMemo(
    () => ({
      cost: rows.reduce((n, p) => n + p.qty * p.cost, 0),
      units: rows.reduce((n, p) => n + p.qty, 0),
    }),
    [rows],
  )

  const showCost = can('pricing.view')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">المنتجات</h1>
          <p className="tnum mt-0.5 text-sm text-muted">
            {num(rows.length)} صنف · {num(totals.units)} بوكس
            {showCost && ` · ${money(totals.cost, { compact: true })} بالتكلفة`}
          </p>
        </div>
        {can('inventory.edit') && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setCategoriesOpen(true)}>
              <Tags className="size-4" />
              التصنيفات
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setEditing(null)
                setFormOpen(true)
              }}
            >
              <PackagePlus className="size-4" />
              منتج جديد
            </Button>
          </div>
        )}
      </div>

      <Card className="p-3">
        {/* صف واحد حتى على الجوال (طلب العميل): البحث يأخذ ما يبقى من العرض بعد
        التصفية والفلاتر، فنصّه التوضيحي قصير والكامل في aria-label. */}
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث…"
              aria-label="ابحث بالاسم أو الرمز أو الباركود"
              title="ابحث بالاسم أو الرمز أو الباركود"
              className="pr-9"
            />
          </div>

          <div className="flex shrink-0 items-center gap-0.5 rounded-xl border border-border bg-surface-2 p-1">
            {(
              [
                ['all', 'الكل'],
                ['reorder', 'يحتاج إنتاج'],
                ['out', 'نفد'],
              ] as Array<[StockFilter, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setStockFilter(value)}
                className={cn(
                  'whitespace-nowrap rounded-lg px-2 py-1.5 text-[12px] font-medium transition-all sm:px-3 sm:text-[13px]',
                  stockFilter === value
                    ? 'bg-surface text-text shadow-sm'
                    : 'text-muted hover:text-text',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <Button
            variant="secondary"
            size="icon"
            className="shrink-0"
            onClick={() => setShowFilters((v) => !v)}
            aria-label="فلاتر"
          >
            <SlidersHorizontal className="size-4" />
          </Button>
        </div>

        {showFilters && (
          <div className="mt-3 grid animate-rise gap-2 border-t border-border pt-3 sm:grid-cols-2">
            <label className="text-[13px]">
              <span className="mb-1 block text-muted">التصنيف</span>
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="all">كل التصنيفات</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-[13px]">
              <span className="mb-1 block text-muted">الترتيب</span>
              <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                <option value="name">الاسم (أبجدي)</option>
                <option value="priceDesc">الأعلى سعراً</option>
                <option value="priceAsc">الأقل سعراً</option>
                <option value="qtyDesc">الأعلى رصيداً</option>
                <option value="qty">الأقل رصيداً</option>
                {showCost && <option value="value">الأعلى قيمة</option>}
                {showCost && <option value="margin">الأقل هامشاً</option>}
                <option value="newest">الأحدث إضافةً</option>
              </Select>
            </label>
          </div>
        )}
      </Card>

      {selected.size > 0 && (
        <Card className="animate-rise border-brand/40 bg-brand-soft">
          <div className="flex flex-wrap items-center gap-3 p-3">
            <span className="text-[13px] font-semibold">محدَّد: {num(selected.size)} صنف</span>
            <Button size="sm" onClick={() => setBulkOpen(true)}>
              <Pencil className="size-4" />
              تعديل المحدَّد
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              إلغاء التحديد
            </Button>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={<Filter className="size-6" />}
            title="لا توجد نتائج"
            description="جرّب تغيير البحث أو الفلاتر."
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-surface-2 text-right text-[12px] text-muted">
                    <th className="w-10 px-3 py-2.5">
                      <input
                        type="checkbox"
                        aria-label="تحديد كل المعروض"
                        className="size-4 accent-[var(--brand)]"
                        checked={rows.length > 0 && rows.every((p) => selected.has(p.id))}
                        onChange={(e) =>
                          setSelected(e.target.checked ? new Set(rows.map((p) => p.id)) : new Set())
                        }
                      />
                    </th>
                    <th className="px-4 py-2.5 font-medium">المنتج</th>
                    <th className="px-3 py-2.5 font-medium">التصنيف</th>
                    <th className="px-3 py-2.5 font-medium">المكان</th>
                    <th className="px-3 py-2.5 font-medium">
                      <span className="inline-flex items-center gap-1">
                        الرصيد <ArrowUpDown className="size-3" />
                      </span>
                    </th>
                    {showCost && <th className="px-3 py-2.5 font-medium">التكلفة</th>}
                    <th className="px-3 py-2.5 font-medium">سعر المحل</th>
                    <th className="px-3 py-2.5 font-medium">سعر الجملة</th>
                    {showCost && <th className="px-3 py-2.5 font-medium">الهامش</th>}
                    <th className="w-10 px-2 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {slice.map((p) => {
                    const margin = marginPercent(p.priceRetail, p.cost)
                    const needs = reorderIds.has(p.id)
                    return (
                      <tr
                        key={p.id}
                        className={cn(
                          'group transition-colors hover:bg-surface-2',
                          selected.has(p.id) && 'bg-brand-soft',
                        )}
                      >
                        <td className="px-3 py-2.5">
                          <input
                            type="checkbox"
                            aria-label={`تحديد ${p.name}`}
                            className="size-4 accent-[var(--brand)]"
                            checked={selected.has(p.id)}
                            onChange={(e) =>
                              setSelected((cur) => {
                                const next = new Set(cur)
                                if (e.target.checked) next.add(p.id)
                                else next.delete(p.id)
                                return next
                              })
                            }
                          />
                        </td>
                        <td className="px-4 py-2.5">
                          <Link to={`/inventory/${p.id}`} className="block">
                            <span className="font-medium group-hover:text-brand-strong">
                              {p.name}
                            </span>
                            <span className="tnum mt-0.5 flex items-center gap-2 text-[11px] text-faint">
                              {p.sku}
                              {p.barcode && (
                                <span className="inline-flex items-center gap-1">
                                  <Barcode className="size-3" />
                                  {p.barcode}
                                </span>
                              )}
                            </span>
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 text-muted">
                          {categoryNames.get(p.categoryId) ?? '—'}
                        </td>
                        <td className="px-3 py-2.5">
                          {p.location ? (
                            <span className="inline-flex items-center gap-1 text-muted">
                              <MapPin className="size-3" />
                              {p.location}
                            </span>
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </td>
                        <td className="w-32 px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                'tnum w-8 font-semibold',
                                p.qty === 0 ? 'text-danger' : needs ? 'text-warn' : 'text-text',
                              )}
                            >
                              {p.qty}
                            </span>
                            <div className="flex-1">
                              <Meter
                                value={p.qty}
                                max={Math.max(p.reorderPoint * 3, 1)}
                                tone={p.qty === 0 ? 'danger' : needs ? 'warn' : 'ok'}
                              />
                            </div>
                          </div>
                        </td>
                        {showCost && (
                          <td className="tnum px-3 py-2.5 text-muted">{money(p.cost)}</td>
                        )}
                        <td className="tnum px-3 py-2.5 font-medium">{money(p.priceRetail)}</td>
                        <td className="tnum px-3 py-2.5 text-muted">{money(p.priceWholesale)}</td>
                        {showCost && (
                          <td className="px-3 py-2.5">
                            <span
                              className={cn(
                                'tnum font-medium',
                                margin < 15 ? 'text-danger' : margin < 30 ? 'text-warn' : 'text-ok',
                              )}
                            >
                              {margin.toFixed(0)}٪
                            </span>
                          </td>
                        )}
                        <td className="w-10 px-2 py-2.5">
                          {can('inventory.edit') && (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`تعديل ${p.name}`}
                              title="تعديل"
                              onClick={() => {
                                setEditing(p)
                                setFormOpen(true)
                              }}
                            >
                              <Pencil className="size-4" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* بطاقات الجوال */}
            <ul className="divide-y divide-border md:hidden">
              {slice.map((p) => {
                const needs = reorderIds.has(p.id)
                return (
                  <li key={p.id}>
                    <Link to={`/inventory/${p.id}`} className="block px-4 py-3 active:bg-surface-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[13px] font-medium">{p.name}</span>
                        <span
                          className={cn(
                            'tnum shrink-0 text-sm font-bold',
                            p.qty === 0 ? 'text-danger' : needs ? 'text-warn' : 'text-ok',
                          )}
                        >
                          {p.qty}
                        </span>
                      </div>
                      <div className="tnum mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-faint">
                        <span>{p.sku}</span>
                        <span>·</span>
                        <span>محل {money(p.priceRetail)}</span>
                        <span>·</span>
                        <span>جملة {money(p.priceWholesale)}</span>
                        {p.location && (
                          <>
                            <span>·</span>
                            <span>{p.location}</span>
                          </>
                        )}
                      </div>
                      <div className="mt-2">
                        <Meter
                          value={p.qty}
                          max={Math.max(p.reorderPoint * 3, 1)}
                          tone={p.qty === 0 ? 'danger' : needs ? 'warn' : 'ok'}
                        />
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>

            <Pager page={page} pages={pages} onChange={setPage} total={rows.length} />
          </>
        )}
      </Card>

      <PartForm open={formOpen} onClose={() => setFormOpen(false)} part={editing} />
      <CategoryManager open={categoriesOpen} onClose={() => setCategoriesOpen(false)} />
      <BulkEditModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        ids={[...selected]}
        onDone={() => setSelected(new Set())}
      />
    </div>
  )
}

/**
 * تعديل عدّة أصناف دفعةً واحدة.
 *
 * كل حقل له مفتاح تفعيل مستقلّ، ولا يُرسل إلا ما فُعِّل. البديل — إرسال كل
 * الحقول — يعني أن فتح النافذة لتغيير المكان يمسح المورّد من كل الأصناف بصمت.
 */
function BulkEditModal({
  open,
  onClose,
  ids,
  onDone,
}: {
  open: boolean
  onClose: () => void
  ids: string[]
  onDone: () => void
}) {
  const categories = useCategories()
  const suppliers = useSuppliers()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [on, setOn] = useState<Record<string, boolean>>({})
  const [patch, setPatch] = useState<BulkPartPatch>({})

  const toggle = (key: string) => setOn((c) => ({ ...c, [key]: !c[key] }))
  const enabled = Object.entries(on).filter(([, v]) => v).length

  async function apply() {
    const send: BulkPartPatch = {}
    for (const [k, v] of Object.entries(on)) {
      if (v) (send as Record<string, unknown>)[k] = (patch as Record<string, unknown>)[k] ?? null
    }
    setBusy(true)
    try {
      await bulkUpdateParts(ids, send)
      toast(`تم تعديل ${num(ids.length)} صنف`)
      setOn({})
      setPatch({})
      onDone()
      onClose()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'تعذّر التعديل', 'error')
    } finally {
      setBusy(false)
    }
  }

  const Row = ({ k, label, children }: { k: string; label: string; children: React.ReactNode }) => (
    <div className="flex items-start gap-3 border-b border-border py-2.5 last:border-0">
      <input
        type="checkbox"
        aria-label={`تعديل ${label}`}
        className="mt-2 size-4 shrink-0 accent-[var(--brand)]"
        checked={Boolean(on[k])}
        onChange={() => toggle(k)}
      />
      <div className={cn('flex-1', !on[k] && 'pointer-events-none opacity-40')}>
        <Field label={label}>{children}</Field>
      </div>
    </div>
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`تعديل ${num(ids.length)} صنف دفعةً واحدة`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={apply} disabled={busy || enabled === 0}>
            {busy ? 'جارٍ الحفظ…' : `طبّق على ${num(ids.length)} صنف`}
          </Button>
        </>
      }
    >
      <p className="mb-2 text-[13px] text-muted">
        فعّل الحقل الذي تريد تغييره فقط. ما لا تفعّله يبقى كما هو في كل صنف.
      </p>

      <Row k="categoryId" label="التصنيف">
        <Select
          value={patch.categoryId ?? ''}
          onChange={(e) => setPatch((c) => ({ ...c, categoryId: e.target.value }))}
        >
          <option value="">— اختر —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Row>

      <Row k="supplierId" label="المورّد">
        <Select
          value={patch.supplierId ?? ''}
          onChange={(e) => setPatch((c) => ({ ...c, supplierId: e.target.value }))}
        >
          <option value="">— بلا مورّد —</option>
          {suppliers.map((sp: Supplier) => (
            <option key={sp.id} value={sp.id}>
              {sp.name}
            </option>
          ))}
        </Select>
      </Row>

      <Row k="location" label="مكان التخزين">
        <Input
          value={patch.location ?? ''}
          onChange={(e) => setPatch((c) => ({ ...c, location: e.target.value }))}
          placeholder="ثلاجة العرض"
        />
      </Row>

      <Row k="reorderPoint" label="حدّ التنبيه">
        <Input
          type="number"
          min={0}
          value={patch.reorderPoint ?? 0}
          onChange={(e) => setPatch((c) => ({ ...c, reorderPoint: Number(e.target.value) }))}
        />
      </Row>

      <Row k="archived" label="الأرشفة">
        <Select
          value={patch.archived ? '1' : '0'}
          onChange={(e) => setPatch((c) => ({ ...c, archived: e.target.value === '1' }))}
        >
          <option value="0">نشط</option>
          <option value="1">مؤرشف — يختفي من البيع</option>
        </Select>
      </Row>
    </Modal>
  )
}
