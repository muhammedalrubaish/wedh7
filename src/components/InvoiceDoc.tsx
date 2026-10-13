import { QrCanvas } from './Barcode'
import { dateTime, money, num } from '@/lib/format'
import { zatcaQrPayload } from '@/lib/zatca'
import type { Invoice, ReturnNote, Settings } from '@/lib/types'

/** ما يهمّ المحل على فاتورته: هل دفع أم لا — لا وسيلة الدفع. */
const paidLabel = (inv: Invoice) => (inv.status === 'unpaid' ? 'لم يتم السداد' : 'تم السداد')

/**
 * الفاتورة الضريبية المبسطة جاهزة للطباعة. تُعرض على الشاشة داخل نافذة وتُطبع
 * عبر `window.print()`.
 */
export function InvoiceDoc({
  invoice,
  settings,
  sellerName,
  returns = [],
}: {
  invoice: Invoice
  settings: Settings
  /** اسم من أصدر الفاتورة. يُمرَّر من الشاشة لأن المستند لا يقرأ من القاعدة. */
  sellerName?: string
  /** المرتجعات على هذه الفاتورة — تُذكر أسفلها كي لا يُطالَب الزبون بالمبلغ الأصلي. */
  returns?: ReturnNote[]
}) {
  // نسب البنود: واحدة ⇒ تُذكر في العنوان، وأكثر ⇒ «حسب البنود». تُهمَل الأصفار.
  const rates = [...new Set(invoice.lines.map((l) => l.taxRate).filter((r) => r > 0))]
  const mixedRates = rates.length > 1
  const lineRate = rates.length === 1 ? rates[0] : undefined

  // «فاتورة ضريبية» إقرار لا عنوان، والحكم من الفاتورة نفسها لا من الإعدادات.
  const taxable = invoice.vatAmount > 0

  const qr =
    settings.zatcaQr && taxable
      ? zatcaQrPayload({
          sellerName: settings.shopName,
          vatNumber: settings.vatNumber,
          timestamp: invoice.createdAt,
          total: invoice.total,
          vatAmount: invoice.vatAmount,
        })
      : null

  const freeTotal = invoice.lines.reduce((n, l) => n + l.freeQty, 0)
  const returnedTotal = returns.reduce((n, r) => n + r.total, 0)

  return (
    <div className="mx-auto max-w-md bg-white p-5 text-[12px] text-black">
      <header className="text-center">
        <h2 className="text-base font-bold">{settings.shopName}</h2>
        {settings.shopNameEn && <p className="text-[11px] text-gray-600">{settings.shopNameEn}</p>}
        <p className="mt-1 text-[11px] text-gray-600">{settings.address}</p>
        <p className="tnum text-[11px] text-gray-600">
          هاتف {settings.phone}
          {taxable && settings.vatNumber && ` · الرقم الضريبي ${settings.vatNumber}`}
        </p>
        <p className="mt-2 inline-block rounded border border-gray-300 px-3 py-1 text-[11px] font-semibold">
          {taxable ? 'فاتورة ضريبية مبسطة' : 'فاتورة'}
        </p>
      </header>

      <div className="tnum mt-3 flex justify-between border-y border-dashed border-gray-300 py-2 text-[11px]">
        <span>رقم الفاتورة: {invoice.number}</span>
        <span>{dateTime(invoice.createdAt)}</span>
      </div>

      {sellerName && <p className="mt-2 text-[11px] text-gray-600">البائع: {sellerName}</p>}

      {invoice.customerName && (
        <p className="mt-2 text-[11px]">
          العميل: {invoice.customerName}
          {invoice.customerVatNumber && ` — الرقم الضريبي ${invoice.customerVatNumber}`}
        </p>
      )}

      <table className="mt-3 w-full border-collapse">
        <thead>
          <tr className="border-b border-gray-400 text-right text-[11px]">
            <th className="py-1 font-semibold">الصنف</th>
            <th className="py-1 font-semibold">كمية</th>
            <th className="py-1 font-semibold">السعر</th>
            <th className="py-1 font-semibold">الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((l, i) => (
            <tr key={i} className="border-b border-dotted border-gray-300 align-top">
              <td className="py-1.5">
                <div className="font-medium">{l.name}</div>
                <div className="tnum text-[10px] text-gray-500">{l.sku}</div>
                {/* العينة تُذكر على الورقة: الزبون يعدّ البوكسات فيجد ١١ والفاتورة
                    على ١٠ — السطر هذا يقطع السؤال. */}
                {l.freeQty > 0 && (
                  <div className="tnum text-[10px] text-gray-600">
                    + {num(l.freeQty)} عينة بلا مقابل
                  </div>
                )}
              </td>
              <td className="tnum py-1.5">{num(l.qty)}</td>
              <td className="tnum py-1.5">{l.unitPrice.toFixed(2)}</td>
              <td className="tnum py-1.5">{(l.unitPrice * l.qty - l.discount).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="tnum mt-3 space-y-1">
        <Row
          label={taxable ? 'المجموع قبل الضريبة' : 'المجموع'}
          value={money(invoice.subtotal - invoice.discount)}
        />
        {invoice.discount > 0 && <Row label="الخصم" value={`- ${money(invoice.discount)}`} />}
        {taxable && (
          <Row
            label={
              mixedRates
                ? 'ضريبة القيمة المضافة (حسب البنود)'
                : `ضريبة القيمة المضافة (${lineRate ?? invoice.vatRate}٪)`
            }
            value={money(invoice.vatAmount)}
          />
        )}
        <div className="flex justify-between border-t border-gray-400 pt-1.5 text-sm font-bold">
          <span>الإجمالي المستحق</span>
          <span>{money(invoice.total)}</span>
        </div>
        <Row label="السداد" value={paidLabel(invoice)} />
        {freeTotal > 0 && <Row label="بوكسات مُسلَّمة بلا مقابل" value={num(freeTotal)} />}
      </div>

      {invoice.notes && (
        <p className="mt-3 whitespace-pre-wrap break-words rounded border border-gray-300 p-2 text-[11px]">
          <span className="font-semibold">ملاحظة: </span>
          {invoice.notes}
        </p>
      )}

      {returns.length > 0 && (
        <div className="tnum mt-3 space-y-1 rounded border border-gray-300 p-2">
          <p className="text-[11px] font-semibold">مرتجعات على هذه الفاتورة</p>
          {returns.map((r) => (
            <Row
              key={r.id}
              label={`${r.number} · ${dateTime(r.createdAt)}`}
              value={`- ${money(r.total)}`}
            />
          ))}
          <div className="flex justify-between border-t border-gray-300 pt-1 font-bold">
            <span>الصافي بعد المرتجع</span>
            <span>{money(invoice.total - returnedTotal)}</span>
          </div>
        </div>
      )}

      {qr && (
        <div className="mt-4 flex flex-col items-center gap-1">
          <QrCanvas value={qr} size={110} />
          <p className="text-[10px] text-gray-500">رمز الفاتورة الضريبية (ZATCA)</p>
        </div>
      )}

      {invoice.status === 'refunded' && (
        <p className="mt-3 rounded border border-red-400 py-1 text-center font-bold text-red-600">
          مسترجعة بالكامل
        </p>
      )}

      <p className="mt-4 text-center text-[10px] text-gray-500">
        يُرجى حفظ الحلويات مبرّدة · المرتجع حسب الاتفاق مع المحل
      </p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-[11px]">
      <span className="text-gray-600">{label}</span>
      <span>{value}</span>
    </div>
  )
}
