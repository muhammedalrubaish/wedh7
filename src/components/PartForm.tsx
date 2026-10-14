import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button, Field, Input, Modal, Select, Switch, Textarea, cn, useToast } from './ui'
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

/**
 * سعر بيع واحد لكل العملاء بطلب العميل: «سعر البيع» يُكتب في `priceRetail`
 * و`priceWholesale` معاً. العمودان باقيان في القاعدة لأن حذف أحدهما ترحيل يمسّ
 * المنظر والمنح، ولأن تساويهما يُبقي كل حساب قديم صحيحاً كما هو.
 */
const withSellPrice = <T extends { priceRetail: number; priceWholesale: number }>(
  d: T,
  price: number,
): T => ({ ...d, priceRetail: price, priceWholesale: price })

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
  // منتج قديم بسعرين مختلفين: الحفظ يوحّدهما على «سعر البيع»، فيُعرض سعر الجملة السابق
  // صراحةً قبل أن يختفي — المحلات كانت تُحاسَب به.
  const [oldWholesale, setOldWholesale] = useState<number | null>(null)

  useEffect(() => {
    if (!open) return
    setErrors({})
    setNewCategory(null)
    setOldWholesale(null)
    if (part) {
      const { id: _id, createdAt: _c, updatedAt: _u, archived: _a, ...rest } = part
      setDraft(rest)
      setOldWholesale(part.priceWholesale !== part.priceRetail ? part.priceWholesale : null)
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

  /** يعبّي سعر البيع من نسبة ربح التصنيف. */
  function autoPrice() {
    const markup = category?.defaultMarkupPercent ?? 50
    setDraft((d) => withSellPrice(d, round2(draft.cost * (1 + markup / 100))))
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
    // `false` يُرسل فقط لمنتج يعرف الخادمُ عموده: قاعدة بلا ترحيل «بدون حد» ترفض العمود
    // المجهول، فمنتج عادي يجب أن يُحفظ عليها كما كان.
    const unlimited = draft.unlimited ? true : part?.unlimited !== undefined ? false : undefined
    try {
      if (part) {
        // «بدون حد» لا رصيد يُعدّ: الخادم لا يحرّكه، فلا تسوية تُسجَّل من خانة معطّلة.
        const qtyDelta = unlimited ? 0 : draft.qty - part.qty
        // `qty` لا يُرسل أبداً: `updatePart` يُسقطه، والفرق يدخل كحركة تسوية.
        const patch: Partial<Part> = {
          ...withSellPrice(draft, draft.priceRetail),
          qty: part.qty,
          unlimited,
        }
        // التكلفة لا تُرسل ممن لا يسعّر: خانتها معطّلة عنده، وقيمتها في المسودة قد تكون
        // صفراً أو محجوبة، فإرسالها يمحو تكلفة المنتج الحقيقية.
        if (!can('pricing.edit')) delete patch.cost
        await updatePart(part.id, patch)
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
        const id = await createPart({
          ...withSellPrice(draft, draft.priceRetail),
          qty: 0,
          unlimited,
          archived: false,
        })
        if (draft.qty > 0 && !unlimited) {
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
  // الحدّ صفر يعني «بدون حد» — `reorderSuggestions` يتخطّاه، فلا عمود جديد ولا ترحيل.
  const noLimit = draft.reorderPoint <= 0
  // «بدون حد» للرصيد شيء آخر: يُباع ولو نفد. عمود `unlimited` وترحيله 20261017.
  const unlimited = Boolean(draft.unlimited)
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
          <div className="grid grid-cols-2 gap-3">
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
            <Field label="سعر البيع" error={errors.priceRetail} hint="لكل العملاء">
              <Input
                type="number"
                step="0.01"
                min="0"
                disabled={!canPrice}
                className="tnum"
                value={draft.priceRetail || ''}
                onChange={(e) => setDraft((d) => withSellPrice(d, Number(e.target.value)))}
              />
            </Field>
          </div>
          {oldWholesale !== null && canPrice && (
            <p className="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-[12px] text-warn">
              كان للمحلات سعر جملة مختلف{' '}
              <span className="tnum font-semibold">{money(oldWholesale)}</span>. الحفظ يجعل سعر
              البيع أعلاه لكل العملاء.
            </p>
          )}
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
          <div>
            <Field
              label="الرصيد"
              hint={
                unlimited
                  ? 'يُباع دائماً ولو نفد'
                  : part
                    ? 'التعديل يُسجَّل كتسوية'
                    : 'الرصيد الافتتاحي'
              }
            >
              <Input
                type="number"
                min="0"
                className="tnum"
                disabled={unlimited}
                placeholder={unlimited ? '∞' : undefined}
                value={unlimited ? '' : draft.qty}
                onChange={(e) => set('qty', Number(e.target.value))}
              />
            </Field>
            <div className="mt-2">
              <Switch
                checked={unlimited}
                // الإطفاء يعيد الرصيد المسجّل كما هو: لا تسوية خفية من رقم كان معطّلاً.
                onChange={(v) => setDraft((d) => ({ ...d, unlimited: v, qty: part?.qty ?? 0 }))}
                label="بدون حد"
              />
            </div>
          </div>
          <div>
            <Field
              label="حدّ التنبيه"
              hint={
                unlimited
                  ? 'لا تنبيه — يُصنع حسب الطلب'
                  : noLimit
                    ? 'لا تنبيه حتى لو نفد'
                    : 'ينبّه حين ينزل الرصيد تحته'
              }
            >
              <Input
                type="number"
                min="0"
                className="tnum"
                disabled={noLimit || unlimited}
                placeholder={noLimit || unlimited ? 'بدون حد' : undefined}
                value={noLimit || unlimited ? '' : draft.reorderPoint}
                onChange={(e) => set('reorderPoint', Number(e.target.value))}
              />
            </Field>
            {/* خارج `Field` عمداً: الحقل `<label>`، والضغط على نصّه كان سيقلب المفتاح. */}
            <div className="mt-2">
              <Switch
                checked={noLimit || unlimited}
                disabled={unlimited}
                onChange={(v) => set('reorderPoint', v ? 0 : BLANK.reorderPoint)}
                label="بدون حد"
              />
            </div>
          </div>
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
