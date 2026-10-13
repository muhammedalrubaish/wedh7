import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button, Field, Input, Modal, Select, Textarea, cn, useToast } from './ui'
import { applyMovement, audit, createCategory, createPart, updatePart } from '@/lib/repo'
import { marginPercent, money, round2 } from '@/lib/format'
import { useApp } from '@/store/app'
import { useCategories, useSuppliers } from '@/hooks/useShopData'
import type { Part } from '@/lib/types'

type Draft = Omit<Part, 'id' | 'createdAt' | 'updatedAt' | 'archived'>

const BLANK: Draft = {
  sku: '',
  name: '',
  nameEn: '',
  categoryId: '',
  supplierId: '',
  cost: 0,
  priceRetail: 0,
  priceWholesale: 0,
  qty: 0,
  reorderPoint: 5,
  reorderQty: 20,
  leadTimeDays: 2,
  location: '',
  barcode: '',
  notes: '',
}

/** سعر الجملة الافتراضي نسبةً من القطاعي — المحلات تأخذ بخصم ٢٠٪ عادةً. */
const WHOLESALE_RATIO = 0.8

export function PartForm({
  open,
  onClose,
  part,
}: {
  open: boolean
  onClose: () => void
  part?: Part | null
}) {
  const { user, can, settings } = useApp()
  const toast = useToast()
  const categories = useCategories()
  const suppliers = useSuppliers()

  const [draft, setDraft] = useState<Draft>(BLANK)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  // `null` = القائمة؛ نصّ = خانة «تصنيف جديد» مفتوحة. القاعدة الحقيقية تبدأ بلا تصنيفات،
  // فإنشاؤه من هنا هو ما يجعل أول منتج ممكناً دون البحث عن شاشة أخرى.
  const [newCategory, setNewCategory] = useState<string | null>(null)
  const [addingCategory, setAddingCategory] = useState(false)

  useEffect(() => {
    if (!open) return
    setErrors({})
    setNewCategory(null)
    if (part) {
      const { id: _id, createdAt: _c, updatedAt: _u, archived: _a, ...rest } = part
      setDraft(rest)
    } else {
      setDraft({
        ...BLANK,
        categoryId: categories[0]?.id ?? '',
        supplierId: '',
        sku: `WDH-${Math.floor(Math.random() * 900 + 100)}`,
      })
    }
    // `categories` خارج الاعتماديات عمداً: إضافة تصنيف من داخل النموذج (أو سحب المرآة
    // أثناء الكتابة) كانت تعيد تعبئته من الصفر فتمسح ما كتبه المستخدم.
  }, [open, part])

  // التصنيفات تصل بعد فتح النموذج أحياناً (أول إقلاع): يُختار الأول إن لم يُختر شيء.
  useEffect(() => {
    if (open && !part && categories[0]) {
      setDraft((d) => (d.categoryId ? d : { ...d, categoryId: categories[0].id }))
    }
  }, [open, part, categories])

  async function addCategory() {
    if (newCategory === null) return
    setAddingCategory(true)
    try {
      const c = await createCategory(newCategory)
      if (user) await audit(user, 'تصنيف جديد', 'category', c.id, c.name)
      setDraft((d) => ({ ...d, categoryId: c.id }))
      setErrors((e) => ({ ...e, categoryId: '' }))
      setNewCategory(null)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'تعذّرت إضافة التصنيف', 'error')
    } finally {
      setAddingCategory(false)
    }
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  const category = categories.find((c) => c.id === draft.categoryId)

  /** يعبّي السعرين من نسبة ربح التصنيف. */
  function autoPrice() {
    const markup = category?.defaultMarkupPercent ?? 50
    const retail = round2(draft.cost * (1 + markup / 100))
    setDraft((d) => ({
      ...d,
      priceRetail: retail,
      priceWholesale: round2(retail * WHOLESALE_RATIO),
    }))
  }

  function validate(): boolean {
    const e: Record<string, string> = {}
    if (!draft.name.trim()) e.name = 'اسم المنتج مطلوب'
    if (!draft.sku.trim()) e.sku = 'رمز المنتج مطلوب'
    if (!draft.categoryId) e.categoryId = 'اختر التصنيف'
    if (draft.cost < 0) e.cost = 'التكلفة لا تكون سالبة'
    if (draft.priceRetail <= 0) e.priceRetail = 'حدد سعر البيع'
    if (draft.priceRetail < draft.cost) e.priceRetail = 'سعر البيع أقل من التكلفة'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function save() {
    if (!user || !validate()) return
    setSaving(true)
    try {
      if (part) {
        const qtyDelta = draft.qty - part.qty
        // `qty` لا يُرسل أبداً: `updatePart` يُسقطه، والفرق يدخل كحركة تسوية.
        await updatePart(part.id, { ...draft, qty: part.qty })
        if (qtyDelta !== 0) {
          await applyMovement({
            partId: part.id,
            qty: qtyDelta,
            type: 'adjustment',
            userId: user.id,
            note: 'تعديل يدوي من بطاقة المنتج',
          })
        }
        await audit(user, 'تعديل منتج', 'part', part.id, draft.name)
        toast('تم حفظ التعديلات')
      } else {
        const id = await createPart({ ...draft, qty: 0, archived: false })
        if (draft.qty > 0) {
          await applyMovement({
            partId: id,
            qty: draft.qty,
            type: 'purchase',
            unitCost: draft.cost,
            userId: user.id,
            ref: 'رصيد افتتاحي',
          })
        }
        await audit(user, 'إضافة منتج', 'part', id, draft.name)
        toast('تمت إضافة المنتج')
      }
      onClose()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'تعذّر الحفظ', 'error')
    } finally {
      setSaving(false)
    }
  }

  const margin = marginPercent(draft.priceRetail, draft.cost)
  const canPrice = can('pricing.edit')

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={part ? 'تعديل منتج' : 'منتج جديد'}
      subtitle={part ? part.sku : 'بوكس أو صنف يُباع'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
          <Button variant="primary" onClick={save} loading={saving}>
            {part ? 'حفظ التعديلات' : 'إضافة المنتج'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <section className="grid gap-3 sm:grid-cols-2">
          <Field label="اسم المنتج" error={errors.name} className="sm:col-span-2">
            <Input
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="مثال: بوكس وضح — الكلاسيك"
            />
          </Field>
          <Field label="الاسم بالإنجليزية" hint="اختياري — يظهر على الفاتورة">
            <Input
              dir="ltr"
              value={draft.nameEn ?? ''}
              onChange={(e) => set('nameEn', e.target.value)}
            />
          </Field>
          <Field label="رمز المنتج (SKU)" error={errors.sku}>
            <Input
              value={draft.sku}
              onChange={(e) => set('sku', e.target.value)}
              className="tnum"
              dir="ltr"
            />
          </Field>
          <Field label="الباركود" hint="اتركه فارغاً ليُولَّد عند الطباعة">
            <Input
              value={draft.barcode ?? ''}
              onChange={(e) => set('barcode', e.target.value)}
              className="tnum"
              inputMode="numeric"
              dir="ltr"
            />
          </Field>
          <Field
            label="التصنيف"
            error={errors.categoryId}
            hint={categories.length === 0 ? 'لا تصنيفات بعد — أضف أولها هنا' : undefined}
          >
            {newCategory === null && categories.length > 0 ? (
              <Select
                value={draft.categoryId}
                onChange={(e) =>
                  e.target.value === '__new'
                    ? setNewCategory('')
                    : set('categoryId', e.target.value)
                }
              >
                <option value="">— اختر —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value="__new">＋ تصنيف جديد…</option>
              </Select>
            ) : (
              <div className="flex gap-2">
                <Input
                  autoFocus={newCategory !== null}
                  value={newCategory ?? ''}
                  onChange={(e) => setNewCategory(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter هنا يضيف التصنيف لا يحفظ المنتج كله بنصف بيانات.
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if ((newCategory ?? '').trim()) void addCategory()
                    }
                  }}
                  placeholder="اسم التصنيف: بوكسات"
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="secondary"
                  loading={addingCategory}
                  disabled={!(newCategory ?? '').trim()}
                  onClick={addCategory}
                >
                  إضافة
                </Button>
                {categories.length > 0 && (
                  <Button type="button" variant="ghost" onClick={() => setNewCategory(null)}>
                    إلغاء
                  </Button>
                )}
              </div>
            )}
          </Field>
          <Field label="المورد" hint="مورد التغليف أو المواد — اختياري">
            <Select
              value={draft.supplierId ?? ''}
              onChange={(e) => set('supplierId', e.target.value)}
            >
              <option value="">— بدون —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="نسبة الضريبة ٪">
            {/* فارغ = اتبع نسبة المحل، وهو الغالب. الصفر قيمة صريحة تعني إعفاءً
                — والفرق بينهما جوهري: «لم يُحدَّد» يتبع تغيير نسبة المحل، و«صفر»
                يبقى صفراً مهما تغيّرت. */}
            <Input
              type="number"
              min="0"
              max="100"
              className="tnum"
              placeholder={`اتركه فارغاً لنسبة المحل (${settings?.vatRate ?? 15}٪)`}
              value={draft.taxRate ?? ''}
              onChange={(e) =>
                set('taxRate', e.target.value === '' ? undefined : Number(e.target.value))
              }
            />
          </Field>
          <Field label="مكان التخزين" hint="ثلاجة العرض / المعمل / المستودع">
            <Input
              value={draft.location ?? ''}
              onChange={(e) => set('location', e.target.value)}
              placeholder="ثلاجة العرض"
            />
          </Field>
        </section>

        {/* التسعير */}
        <section className="rounded-xl border border-border bg-surface-2 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">التسعير</h4>
            {canPrice && (
              <Button size="sm" variant="soft" onClick={autoPrice} disabled={!draft.cost}>
                <Sparkles className="size-3.5" />
                تسعير تلقائي ({category?.defaultMarkupPercent ?? 50}٪)
              </Button>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="التكلفة" error={errors.cost} hint="تكلفة إنتاج البوكس">
              <Input
                type="number"
                step="0.01"
                min="0"
                disabled={!canPrice}
                className="tnum"
                value={draft.cost || ''}
                onChange={(e) => set('cost', Number(e.target.value))}
              />
            </Field>
            <Field label="سعر المحل (قطاعي)" error={errors.priceRetail}>
              <Input
                type="number"
                step="0.01"
                min="0"
                disabled={!canPrice}
                className="tnum"
                value={draft.priceRetail || ''}
                onChange={(e) => set('priceRetail', Number(e.target.value))}
              />
            </Field>
            <Field label="سعر الجملة" hint="للمحلات والكافيهات">
              <Input
                type="number"
                step="0.01"
                min="0"
                disabled={!canPrice}
                className="tnum"
                value={draft.priceWholesale || ''}
                onChange={(e) => set('priceWholesale', Number(e.target.value))}
              />
            </Field>
          </div>
          {draft.priceRetail > 0 && canPrice && (
            <p className="mt-2 text-[13px] text-muted">
              الربح للبوكس{' '}
              <span className="tnum font-semibold text-text">
                {money(draft.priceRetail - draft.cost)}
              </span>{' '}
              — هامش{' '}
              <span
                className={cn(
                  'tnum font-semibold',
                  margin < 15 ? 'text-danger' : margin < 30 ? 'text-warn' : 'text-ok',
                )}
              >
                {margin.toFixed(1)}٪
              </span>
            </p>
          )}
        </section>

        {/* سياسة المخزون */}
        <section className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          <Field label="الرصيد" hint={part ? 'التعديل يُسجَّل كتسوية' : 'الرصيد الافتتاحي'}>
            <Input
              type="number"
              min="0"
              className="tnum"
              value={draft.qty}
              onChange={(e) => set('qty', Number(e.target.value))}
            />
          </Field>
          <Field label="حدّ التنبيه" hint="ينبّه حين ينزل الرصيد تحته">
            <Input
              type="number"
              min="0"
              className="tnum"
              value={draft.reorderPoint}
              onChange={(e) => set('reorderPoint', Number(e.target.value))}
            />
          </Field>
          <Field label="كمية الإنتاج المعتادة">
            <Input
              type="number"
              min="1"
              className="tnum"
              value={draft.reorderQty}
              onChange={(e) => set('reorderQty', Number(e.target.value))}
            />
          </Field>
          <Field label="أيام التجهيز">
            <Input
              type="number"
              min="0"
              className="tnum"
              value={draft.leadTimeDays}
              onChange={(e) => set('leadTimeDays', Number(e.target.value))}
            />
          </Field>
        </section>

        <Field label="ملاحظات">
          <Textarea
            rows={2}
            value={draft.notes ?? ''}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="المكوّنات، مدة الصلاحية، ملاحظات للفريق…"
          />
        </Field>
      </div>
    </Modal>
  )
}
