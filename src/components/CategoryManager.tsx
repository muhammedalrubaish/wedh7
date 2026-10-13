import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button, Field, Input, Modal, useToast } from './ui'
import { audit, createCategory, deleteCategory, updateCategory } from '@/lib/repo'
import { num } from '@/lib/format'
import { useApp } from '@/store/app'
import { useCategories, useParts } from '@/hooks/useShopData'
import type { Category } from '@/lib/types'

/**
 * إدارة التصنيفات: إضافة، وتعديل الاسم ونسبة الربح، وحذف.
 *
 * نسبة الربح هنا هي ما يملأ به زر «تسعير تلقائي» سعرَ المنتج الجديد — لا تغيّر
 * أسعار المنتجات القائمة. تغييرها على منتجات قائمة يمرّ من صفحة «التسعير».
 */
export function CategoryManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useApp()
  const toast = useToast()
  const categories = useCategories()
  const parts = useParts()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of parts) if (p.categoryId) m.set(p.categoryId, (m.get(p.categoryId) ?? 0) + 1)
    return m
  }, [parts])

  const sorted = useMemo(
    () => [...categories].sort((a, b) => a.name.localeCompare(b.name, 'ar')),
    [categories],
  )

  async function add() {
    setBusy(true)
    try {
      const c = await createCategory(name)
      if (user) await audit(user, 'تصنيف جديد', 'category', c.id, c.name)
      setName('')
      toast(`أُضيف تصنيف «${c.name}»`)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'تعذّرت الإضافة', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="التصنيفات"
      subtitle="تجمع المنتجات في التقارير والفلاتر: بوكسات، صواني، حلى بالقطعة…"
      size="sm"
    >
      <div className="space-y-4">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) void add()
          }}
        >
          <Field label="تصنيف جديد" className="flex-1">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: بوكسات"
            />
          </Field>
          <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>
            <Plus className="size-4" />
            إضافة
          </Button>
        </form>

        {sorted.length === 0 ? (
          <p className="rounded-xl border border-warn/30 bg-warn-soft/50 px-3 py-2.5 text-[13px] leading-6">
            لا تصنيفات بعد. أضف تصنيفاً واحداً على الأقل — كل منتج يحتاج تصنيفاً.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {sorted.map((c) => (
              <CategoryRow key={c.id} category={c} products={counts.get(c.id) ?? 0} />
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}

function CategoryRow({ category, products }: { category: Category; products: number }) {
  const { user } = useApp()
  const toast = useToast()
  const [name, setName] = useState(category.name)
  const [markup, setMarkup] = useState(String(category.defaultMarkupPercent))
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const markupNum = Number(markup)
  const dirty =
    name.trim() !== category.name || (markup !== '' && markupNum !== category.defaultMarkupPercent)
  const valid = Boolean(name.trim()) && Number.isFinite(markupNum) && markupNum >= 0

  async function save() {
    setBusy(true)
    try {
      await updateCategory(category.id, { name: name.trim(), defaultMarkupPercent: markupNum })
      if (user) await audit(user, 'تعديل تصنيف', 'category', category.id, name.trim())
      toast('تم حفظ التصنيف')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'تعذّر الحفظ', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await deleteCategory(category.id)
      if (user) await audit(user, 'حذف تصنيف', 'category', category.id, category.name)
      toast(`حُذف تصنيف «${category.name}»`)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'تعذّر الحذف', 'error')
      setBusy(false)
    }
  }

  return (
    <li className="space-y-2 p-3">
      <div className="flex items-center gap-2">
        <Input
          aria-label="اسم التصنيف"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1"
        />
        <div className="relative w-24 shrink-0">
          <Input
            aria-label="نسبة الربح"
            inputMode="decimal"
            value={markup}
            onChange={(e) => setMarkup(e.target.value)}
            className="tnum pl-7"
          />
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-faint">
            ٪
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="tnum text-[12px] text-muted">
          {num(products)} منتج · ربح افتراضي {Number.isFinite(markupNum) ? markupNum : '—'}٪
        </span>
        <div className="flex gap-1.5">
          {confirming ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                تراجع
              </Button>
              <Button size="sm" variant="danger" loading={busy} onClick={remove}>
                {products ? `احذف (${num(products)} منتج يصير بلا تصنيف)` : 'تأكيد الحذف'}
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`حذف ${category.name}`}
                onClick={() => setConfirming(true)}
              >
                <Trash2 className="size-4 text-danger" />
              </Button>
              {dirty && (
                <Button size="sm" variant="primary" loading={busy} disabled={!valid} onClick={save}>
                  حفظ
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </li>
  )
}
