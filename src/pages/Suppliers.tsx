import { useMemo, useState } from 'react'
import { Contact, MapPin, Pencil, Phone, Plus, Search, Trash2 } from 'lucide-react'
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Textarea,
  useDebounced,
  useToast,
} from '@/components/ui'
import { audit, createSupplier, deleteSupplier, updateSupplier } from '@/lib/repo'
import { waLink } from '@/lib/whatsapp'
import { useApp } from '@/store/app'
import { useActiveParts, usePurchaseOrders, useSuppliers } from '@/hooks/useShopData'
import type { Supplier } from '@/lib/types'

/**
 * دليل الموردين: التغليف والمكسرات والمواد الخام.
 *
 * شاشة صغيرة عمداً — العميل يريد الأسماء والجوالات في مكان واحد ليتصل أو يراسل
 * من الجوال وهو في المعمل. ما يُشترى منهم فعلاً يمرّ من «طلبات التوريد».
 */
export default function Suppliers() {
  const { user, can } = useApp()
  const toast = useToast()
  const suppliers = useSuppliers()
  const parts = useActiveParts()
  const orders = usePurchaseOrders()

  const [query, setQuery] = useState('')
  const debounced = useDebounced(query)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [removing, setRemoving] = useState<Supplier | null>(null)

  const rows = useMemo(() => {
    const q = debounced.trim().toLowerCase()
    return [...suppliers]
      .filter((s) =>
        q ? `${s.name} ${s.phone ?? ''} ${s.city ?? ''}`.toLowerCase().includes(q) : true,
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
  }, [suppliers, debounced])

  const openOrders = useMemo(() => {
    const m = new Map<string, number>()
    for (const o of orders) {
      if (o.status === 'ordered' || o.status === 'partial' || o.status === 'draft')
        m.set(o.supplierId, (m.get(o.supplierId) ?? 0) + 1)
    }
    return m
  }, [orders])

  const productCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of parts) if (p.supplierId) m.set(p.supplierId, (m.get(p.supplierId) ?? 0) + 1)
    return m
  }, [parts])

  const editable = can('purchase.edit')

  async function remove(s: Supplier) {
    try {
      await deleteSupplier(s.id)
      if (user) await audit(user, 'حذف مورد', 'supplier', s.id, s.name)
      toast(`تم حذف ${s.name}`)
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
          <h1 className="text-xl font-bold tracking-tight">الموردون</h1>
          <p className="mt-0.5 text-sm text-muted">من يشتري منهم المعمل — تغليف ومواد خام</p>
        </div>
        {editable && (
          <Button
            variant="primary"
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
          >
            <Plus className="size-4" />
            مورد جديد
          </Button>
        )}
      </div>

      <Card className="p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="الاسم أو الجوال أو المدينة…"
            className="pr-9"
          />
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Contact className="size-6" />}
            title="لا يوجد موردون"
            description="أضف مورد التغليف والمواد ليظهر هنا برقمه."
          />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((s) => (
            <Card key={s.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{s.name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
                    {s.city && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3" />
                        {s.city}
                      </span>
                    )}
                    <span className="tnum">التجهيز {s.leadTimeDays} يوم</span>
                  </p>
                </div>
                {editable && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="تعديل"
                    onClick={() => {
                      setEditing(s)
                      setFormOpen(true)
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                )}
              </div>

              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="tnum text-sm" dir="ltr">
                  {s.phone ?? '—'}
                </span>
                {s.phone && (
                  <div className="flex gap-1.5">
                    <a href={`tel:${s.phone}`}>
                      <Button size="sm" variant="secondary">
                        <Phone className="size-3.5" />
                        اتصال
                      </Button>
                    </a>
                    <a
                      href={waLink(s.phone, `السلام عليكم، معك ${user?.name ?? ''} من وضح.`)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Button size="sm" variant="soft">
                        واتساب
                      </Button>
                    </a>
                  </div>
                )}
              </div>

              <p className="tnum mt-3 border-t border-border pt-2 text-[12px] text-faint">
                {productCount.get(s.id) ?? 0} منتج مرتبط
                {(openOrders.get(s.id) ?? 0) > 0 && ` · ${openOrders.get(s.id)} طلب مفتوح`}
                {s.notes && ` · ${s.notes}`}
              </p>
            </Card>
          ))}
        </div>
      )}

      <SupplierForm
        open={formOpen}
        supplier={editing}
        onClose={() => setFormOpen(false)}
        onDelete={(s) => {
          setFormOpen(false)
          setRemoving(s)
        }}
      />

      <Modal
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        size="sm"
        title="حذف المورد"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              إلغاء
            </Button>
            <Button variant="danger" onClick={() => removing && remove(removing)}>
              تأكيد الحذف
            </Button>
          </>
        }
      >
        <p className="text-sm leading-6">
          سيُحذف <span className="font-semibold">{removing?.name}</span>. المنتجات المرتبطة به تبقى
          بلا مورد، وطلبات التوريد المفتوحة باسمه تمنع الحذف.
        </p>
      </Modal>
    </div>
  )
}

function SupplierForm({
  open,
  supplier,
  onClose,
  onDelete,
}: {
  open: boolean
  supplier: Supplier | null
  onClose: () => void
  onDelete: (s: Supplier) => void
}) {
  const { user } = useApp()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Omit<Supplier, 'id'>>({
    name: '',
    phone: '',
    city: '',
    leadTimeDays: 3,
    notes: '',
  })

  // إعادة التعبئة عند كل فتح — انظر `CustomerForm` للسبب.
  const [key, setKey] = useState('')
  const signature = `${open}:${supplier?.id ?? 'new'}`
  if (open && key !== signature) {
    setKey(signature)
    setDraft({
      name: supplier?.name ?? '',
      phone: supplier?.phone ?? '',
      city: supplier?.city ?? '',
      leadTimeDays: supplier?.leadTimeDays ?? 3,
      notes: supplier?.notes ?? '',
    })
  }

  async function save() {
    const name = draft.name.trim()
    if (!name) return
    setBusy(true)
    try {
      const patch = {
        name,
        phone: draft.phone?.trim() || undefined,
        city: draft.city?.trim() || undefined,
        leadTimeDays: Math.max(0, draft.leadTimeDays),
        notes: draft.notes?.trim() || undefined,
      }
      if (supplier) {
        await updateSupplier(supplier.id, patch)
        if (user) await audit(user, 'تعديل مورد', 'supplier', supplier.id, name)
        toast('تم حفظ بيانات المورد')
      } else {
        const created = await createSupplier(patch)
        if (user) await audit(user, 'إضافة مورد', 'supplier', created.id, name)
        toast(`تمت إضافة ${name}`)
      }
      onClose()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'تعذّر الحفظ', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={supplier ? 'تعديل مورد' : 'مورد جديد'}
      footer={
        <>
          {supplier && (
            <Button variant="danger" onClick={() => onDelete(supplier)}>
              <Trash2 className="size-4" />
              حذف
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
          <Button variant="primary" loading={busy} disabled={!draft.name.trim()} onClick={save}>
            حفظ
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="الاسم" className="sm:col-span-2">
          <Input
            autoFocus
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="مصنع التغليف الحديث"
          />
        </Field>
        <Field label="الجوال">
          <Input
            dir="ltr"
            inputMode="tel"
            value={draft.phone ?? ''}
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            placeholder="05xxxxxxxx"
          />
        </Field>
        <Field label="المدينة">
          <Input
            value={draft.city ?? ''}
            onChange={(e) => setDraft({ ...draft, city: e.target.value })}
          />
        </Field>
        <Field label="أيام التجهيز" hint="من الطلب إلى الوصول">
          <Input
            type="number"
            min="0"
            className="tnum"
            value={draft.leadTimeDays}
            onChange={(e) => setDraft({ ...draft, leadTimeDays: Number(e.target.value) })}
          />
        </Field>
        <Field label="ملاحظات" className="sm:col-span-2">
          <Textarea
            rows={2}
            value={draft.notes ?? ''}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            placeholder="ماذا نشتري منه، شروط الدفع…"
          />
        </Field>
      </div>
    </Modal>
  )
}
