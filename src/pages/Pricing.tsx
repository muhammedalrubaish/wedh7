import { useMemo, useState } from 'react'
import { Calculator, Percent, Save, Search, TrendingDown } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Modal,
  Pager,
  Select,
  cn,
  useDebounced,
  usePagination,
  useToast,
} from '@/components/ui'
import { Stat } from '@/components/Stat'
import { audit, updateCategory, updatePart } from '@/lib/repo'
import { countedQty } from '@/lib/analytics'
import { marginPercent, num, round2 } from '@/lib/format'
import { hide, money } from '@/lib/display'
import { useApp } from '@/store/app'
import { useActiveParts, useCategories } from '@/hooks/useShopData'
import type { Part } from '@/lib/types'

/** Below this, a sale barely covers handling — the row is flagged red. */
const MIN_HEALTHY_MARGIN = 15

export default function Pricing() {
  const { user, can } = useApp()
  const toast = useToast()
  const parts = useActiveParts()
  const categories = useCategories()

  const [query, setQuery] = useState('')
  const debounced = useDebounced(query)
  const [category, setCategory] = useState('all')
  const [onlyWeak, setOnlyWeak] = useState(false)
  const [edits, setEdits] = useState<Record<string, Partial<Part>>>({})
  const [bulkOpen, setBulkOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const editable = can('pricing.edit')

  const rows = useMemo(() => {
    const q = debounced.trim().toLowerCase()
    return parts
      .filter((p) => (category === 'all' ? true : p.categoryId === category))
      .filter((p) => (q ? `${p.name} ${p.sku}`.toLowerCase().includes(q) : true))
      .filter((p) => (onlyWeak ? marginPercent(p.priceRetail, p.cost) < MIN_HEALTHY_MARGIN : true))
      .sort((a, b) => marginPercent(a.priceRetail, a.cost) - marginPercent(b.priceRetail, b.cost))
  }, [parts, debounced, category, onlyWeak])

  const { page, pages, slice, setPage } = usePagination(rows, 20)

  const stats = useMemo(() => {
    const weak = parts.filter((p) => marginPercent(p.priceRetail, p.cost) < MIN_HEALTHY_MARGIN)
    const below = parts.filter((p) => p.priceRetail < p.cost)
    const weighted = parts.reduce(
      (acc, p) => {
        acc.revenue += p.priceRetail * countedQty(p)
        acc.cost += p.cost * countedQty(p)
        return acc
      },
      { revenue: 0, cost: 0 },
    )
    return {
      weak: weak.length,
      below: below.length,
      averageMargin: weighted.revenue
        ? ((weighted.revenue - weighted.cost) / weighted.revenue) * 100
        : 0,
      potentialProfit: round2(weighted.revenue - weighted.cost),
    }
  }, [parts])

  const dirty = Object.keys(edits).length

  function edit(id: string, patch: Partial<Part>) {
    setEdits((cur) => ({ ...cur, [id]: { ...cur[id], ...patch } }))
  }

  const valueOf = (p: Part, key: 'cost' | 'priceRetail' | 'priceWholesale') =>
    (edits[p.id]?.[key] as number | undefined) ?? p[key]

  async function saveAll() {
    if (!user || dirty === 0) return
    setSaving(true)
    try {
      for (const [id, patch] of Object.entries(edits)) {
        await updatePart(id, patch)
      }
      await audit(user, 'تعديل أسعار', 'part', undefined, `${dirty} صنف`)
      setEdits({})
      toast(`تم حفظ ${dirty} صنف`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">التسعير</h1>
          <p className="mt-0.5 text-sm text-muted">
            مرتّبة من الأضعف هامشاً — هذي أول ما تحتاج مراجعة
          </p>
        </div>
        {editable && (
          <div className="flex gap-2">
            <Button variant="soft" onClick={() => setBulkOpen(true)}>
              <Calculator className="size-4" />
              تسعير جماعي
            </Button>
            <Button variant="primary" onClick={saveAll} disabled={dirty === 0} loading={saving}>
              <Save className="size-4" />
              حفظ {dirty > 0 && `(${dirty})`}
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="متوسط الهامش المرجّح"
          value={hide(`${stats.averageMargin.toFixed(1)}٪`)}
          icon={<Percent className="size-5" />}
          tone={stats.averageMargin < 25 ? 'warn' : 'ok'}
        />
        <Stat
          label="أصناف هامشها ضعيف"
          value={num(stats.weak)}
          icon={<TrendingDown className="size-5" />}
          tone={stats.weak ? 'warn' : 'ok'}
          sub={`أقل من ${MIN_HEALTHY_MARGIN}٪`}
        />
        <Stat
          label="تباع بخسارة"
          value={num(stats.below)}
          tone={stats.below ? 'danger' : 'ok'}
          sub="سعر البيع أقل من التكلفة"
        />
        <Stat
          label="ربح متوقع من المخزون"
          value={money(stats.potentialProfit, { compact: true })}
          tone="brand"
        />
      </div>

      <Card className="p-3">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث…"
              aria-label="ابحث عن منتج"
              title="ابحث عن منتج"
              className="pr-9"
            />
          </div>
          {/* صف واحد على الجوال: سهم القائمة الأصلي يحجز مساحته بنفسه فلا حشوة يسرى
              إضافية، و«الكل» تكفي لأن القائمة نفسها قائمة تصنيفات. */}
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="التصنيف"
            className="w-[6.5rem] shrink-0 pr-2.5 pl-1.5 sm:w-44 sm:pr-3 sm:pl-8"
          >
            <option value="all">الكل</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Button
            variant={onlyWeak ? 'primary' : 'secondary'}
            onClick={() => setOnlyWeak((v) => !v)}
            aria-pressed={onlyWeak}
            aria-label="الهامش الضعيف فقط"
            title="الهامش الضعيف فقط"
            className="shrink-0 px-3"
          >
            <TrendingDown className="size-4" />
            <span className="sm:hidden">ضعيف</span>
            <span className="hidden sm:inline">الهامش الضعيف فقط</span>
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={<Percent className="size-6" />} title="لا توجد أصناف مطابقة" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-surface-2 text-right text-[12px] text-muted">
                    <th className="px-4 py-2.5 font-medium">المنتج</th>
                    <th className="px-3 py-2.5 font-medium">التكلفة</th>
                    <th className="px-3 py-2.5 font-medium">سعر البيع</th>
                    <th className="px-3 py-2.5 font-medium">الهامش</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {slice.map((p) => {
                    const cost = valueOf(p, 'cost')
                    const retail = valueOf(p, 'priceRetail')
                    const margin = marginPercent(retail, cost)
                    const changed = Boolean(edits[p.id])
                    return (
                      <tr
                        key={p.id}
                        className={cn('transition-colors', changed && 'bg-brand-soft/40')}
                      >
                        <td className="px-4 py-2">
                          <p className="font-medium">{p.name}</p>
                          <p className="tnum text-[11px] text-faint">
                            {p.sku} · الرصيد {p.qty}
                          </p>
                        </td>
                        {(
                          [
                            ['cost', cost],
                            ['priceRetail', retail],
                          ] as const
                        ).map(([key, val]) => (
                          <td key={key} className="px-3 py-2">
                            <input
                              type="number"
                              min="0"
                              step="0.5"
                              disabled={!editable}
                              value={val}
                              onChange={(e) => {
                                const v = Number(e.target.value)
                                // سعر بيع واحد: يُكتب في العمودين معاً — انظر PartForm.
                                edit(
                                  p.id,
                                  key === 'cost'
                                    ? { cost: v }
                                    : { priceRetail: v, priceWholesale: v },
                                )
                              }}
                              className="tnum h-8 w-24 rounded-lg border border-border bg-surface px-2 focus:border-brand focus:outline-none disabled:border-transparent disabled:bg-transparent"
                            />
                          </td>
                        ))}
                        <td className="px-3 py-2">
                          <Badge
                            tone={
                              margin < 0 ? 'danger' : margin < MIN_HEALTHY_MARGIN ? 'warn' : 'ok'
                            }
                          >
                            {hide(`${margin.toFixed(0)}٪`)}
                          </Badge>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pager page={page} pages={pages} onChange={setPage} total={rows.length} />
          </>
        )}
      </Card>

      <BulkPricing open={bulkOpen} onClose={() => setBulkOpen(false)} />
    </div>
  )
}

function BulkPricing({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useApp()
  const toast = useToast()
  const parts = useActiveParts()
  const categories = useCategories()

  const [categoryId, setCategoryId] = useState('')
  const [markup, setMarkup] = useState(50)
  const [busy, setBusy] = useState(false)

  const affected = useMemo(
    () => (categoryId ? parts.filter((p) => p.categoryId === categoryId) : []),
    [parts, categoryId],
  )

  async function apply() {
    if (!user || !categoryId) return
    setBusy(true)
    try {
      for (const p of affected) {
        const retail = round2(p.cost * (1 + markup / 100))
        await updatePart(p.id, {
          priceRetail: retail,
          priceWholesale: retail,
        })
      }
      await updateCategory(categoryId, { defaultMarkupPercent: markup })
      await audit(
        user,
        'تسعير جماعي',
        'category',
        categoryId,
        `${markup}٪ على ${affected.length} صنف`,
      )
      toast(`تم تسعير ${affected.length} صنف`)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const preview = affected.slice(0, 4)

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="تسعير جماعي"
      subtitle="يطبّق نسبة ربح موحّدة على تصنيف كامل"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
          <Button variant="primary" onClick={apply} loading={busy} disabled={affected.length === 0}>
            طبّق على {affected.length} صنف
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="التصنيف">
          <Select
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value)
              const c = categories.find((x) => x.id === e.target.value)
              if (c) setMarkup(c.defaultMarkupPercent)
            }}
          >
            <option value="">— اختر —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.defaultMarkupPercent}٪)
              </option>
            ))}
          </Select>
        </Field>

        <Field label={`نسبة الربح فوق التكلفة: ${markup}٪`}>
          <input
            type="range"
            min="5"
            max="250"
            step="5"
            value={markup}
            onChange={(e) => setMarkup(Number(e.target.value))}
            className="w-full accent-[var(--brand)]"
          />
        </Field>

        {preview.length > 0 && (
          <div className="rounded-xl border border-border">
            <CardHeader title="معاينة" className="border-b p-3" />
            <ul className="divide-y divide-border text-[13px]">
              {preview.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="truncate">{p.name}</span>
                  <span className="tnum shrink-0">
                    <span className="text-faint line-through">{money(p.priceRetail)}</span>{' '}
                    <span className="font-semibold text-brand-strong">
                      {money(round2(p.cost * (1 + markup / 100)))}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {affected.length > preview.length && (
              <p className="border-t border-border px-3 py-2 text-[12px] text-faint">
                و{affected.length - preview.length} صنف آخر…
              </p>
            )}
          </div>
        )}

        <p className="rounded-xl bg-warn-soft px-3 py-2 text-[12px] text-warn">
          سعر البيع الجديد يُطبَّق على كل العملاء. العملية لا تُلغى.
        </p>
      </div>
    </Modal>
  )
}
