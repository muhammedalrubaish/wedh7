import { useEffect, useState } from 'react'
import { useToast } from '@/components/ui'
import { invoicePdf } from '@/lib/invoicePdf'
import { invoiceMessage, waLink } from '@/lib/whatsapp'
import type { Invoice, ReturnNote, Settings } from '@/lib/types'

/**
 * ملف الفاتورة PDF وزرّا «واتساب» و«حفظ» — مشترك بين نافذة الفاتورة في القائمة ونافذة
 * «صدرت الفاتورة» في البيع، كي لا يختلف ما يُرسل للمحل باختلاف الشاشة.
 *
 * الملف يُجهَّز لحظة فتح الفاتورة لا عند الضغط: Safari يسمح بنافذة المشاركة داخل
 * الضغطة نفسها فقط، وتجهيز الملف يستغرق لحظة تُفقدها إن جاء بعد الضغط.
 */
export function useInvoicePdf(
  invoice: Invoice | null,
  settings: Settings,
  returns: ReturnNote[] | undefined,
  phone: string | undefined,
) {
  const toast = useToast()
  const [pdf, setPdf] = useState<{ id: string; file: File } | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!invoice) return
    let live = true
    setPdf(null)
    setError(false)
    invoicePdf(invoice, settings, returns)
      .then((file) => live && setPdf({ id: invoice.id, file }))
      .catch((err) => {
        console.error('تعذّر تجهيز ملف الفاتورة:', err)
        if (live) setError(true)
      })
    return () => {
      live = false
    }
    // `returns` و`settings` يتغيّران بكل سحب للمرآة؛ الملف يُعاد عند فتح فاتورة أخرى أو
    // تغيّر حالتها أو مرتجعاتها فقط.
  }, [invoice?.id, invoice?.status, returns?.length])

  const file = pdf && invoice && pdf.id === invoice.id ? pdf.file : null

  /** حفظ في ملفات الجوال: تنزيل الملف — Safari يعرض «تنزيل» ثم يحفظه في «الملفات». */
  function save() {
    if (!file) return
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    // في الصفحة لا معلّقاً: بعض المتصفحات تتجاهل اسم `download` لرابط خارج المستند
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  /**
   * واتساب = نافذة المشاركة بملف الـPDF: يختار المستخدم واتساب والمحل منها. رابط
   * `wa.me` لا يحمل ملفاً، فيبقى بديلاً حين لا يدعم الجهاز مشاركة الملفات (الكمبيوتر):
   * يُحفظ الملف ويُفتح واتساب بنصّ الفاتورة ليُرفق يدوياً.
   */
  async function share() {
    if (!invoice) return
    if (file && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: file.name })
      } catch (err) {
        // إلغاء المستخدم ليس خطأً
        if ((err as Error).name !== 'AbortError') {
          toast('تعذّرت المشاركة — جرّب «حفظ» ثم أرسل الملف من واتساب.', 'warn')
        }
      }
      return
    }
    if (file) save()
    window.open(waLink(phone, invoiceMessage(invoice, settings)), '_blank')
  }

  return { file, error, loading: !file && !error, share, save }
}
