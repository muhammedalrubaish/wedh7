import { useState } from 'react'
import { Button, Field, Input, Modal, Select, useToast } from './ui'
import { audit, createCustomer, updateCustomer } from '@/lib/repo'
import { useApp } from '@/store/app'
import type { Customer, CustomerType } from '@/lib/types'

/**
 * نموذج العميل — مشترك بين شاشة العملاء ونقطة البيع.
 *
 * مكوَّن لا جزء من الشاشة عمداً: المحل الجديد يُضاف في الغالب **وقت أول
 * توريد** لا قبله، وإجبار الموظف على ترك السلة والانتقال إلى شاشة العملاء يعني
 * أن الفاتورة ستُقفل باسم «بيع نقدي» ويضيع الربط — ولا كشف حساب آخر الشهر.
 */
export function CustomerForm({
  open,
  customer,
  onClose,
  onSaved,
}: {
  open: boolean
  customer: Customer | null
  onClose: () => void
  onSaved?: (c: Customer) => void
}) {
  const { user } = useApp()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Omit<Customer, 'id' | 'createdAt'>>({
    name: '',
    phone: '',
    type: 'wholesale',
    vatNumber: '',
    notes: '',
  })

  // إعادة التعبئة عند كل فتح: بقاء نموذج الحالة بين فتحتين يعني أن «عميل جديد»
  // بعد تعديل عميل يفتح ببيانات ذاك العميل، فيُنشأ سجلّ مكرّر بلا أن ينتبه أحد.
  const [key, setKey] = useState('')
  const signature = `${open}:${customer?.id ?? 'new'}`
  if (open && key !== signature) {
    setKey(signature)
    setDraft({
      name: customer?.name ?? '',
      phone: customer?.phone ?? '',
      type: customer?.type ?? 'wholesale',
      vatNumber: customer?.vatNumber ?? '',
      notes: customer?.notes ?? '',
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
        type: draft.type,
        vatNumber: draft.vatNumber?.trim() || undefined,
        notes: draft.notes?.trim() || undefined,
      }
      if (customer) {
        await updateCustomer(customer.id, patch)
        if (user) await audit(user, 'تعديل عميل', 'customer', customer.id, name)
        toast('تم حفظ بيانات العميل')
        onSaved?.({ ...customer, ...patch })
      } else {
        const created = await createCustomer(patch)
        if (user) await audit(user, 'إضافة عميل', 'customer', created.id, name)
        toast(`تمت إضافة ${name}`)
        onSaved?.(created)
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
      title={customer ? 'تعديل عميل' : 'عميل جديد'}
      subtitle={customer ? customer.name : 'محل أو كافيه أو فرد — يُربط بفواتيره وكشف حسابه'}
      footer={
        <>
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
            placeholder="اسم المحل أو الكافيه أو الشخص"
          />
        </Field>
        <Field label="الجوال" hint="تُرسل إليه الفاتورة وكشف الحساب عبر واتساب">
          <Input
            dir="ltr"
            inputMode="tel"
            value={draft.phone ?? ''}
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            placeholder="05xxxxxxxx"
          />
        </Field>
        <Field label="النوع" hint="النوع يحدّد السعر في نقطة البيع">
          <Select
            value={draft.type}
            onChange={(e) => setDraft({ ...draft, type: e.target.value as CustomerType })}
          >
            <option value="wholesale">محل / جملة</option>
            <option value="retail">فرد / قطاعي</option>
          </Select>
        </Field>
        <Field label="الرقم الضريبي" hint="يُطبع على فاتورته الضريبية">
          <Input
            dir="ltr"
            inputMode="numeric"
            value={draft.vatNumber ?? ''}
            onChange={(e) => setDraft({ ...draft, vatNumber: e.target.value })}
          />
        </Field>
        <Field label="ملاحظات">
          <Input
            value={draft.notes ?? ''}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            placeholder="يوم التوريد، شخص التواصل…"
          />
        </Field>
      </div>
    </Modal>
  )
}
