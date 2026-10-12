import { useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { cloudEnabled } from '@/lib/supabase'

/**
 * يظهر ما دام التخزين في متصفح الزائر وحده.
 *
 * الشرط `cloudEnabled` لا `VITE_DEMO` وحده: نصّ الشريط يَعِد بأن البيانات
 * «محفوظة في هذا المتصفح فقط وستُمسح عند ربط القاعدة». بعد الربط صار هذا
 * الوعد كذباً — البيانات على الخادم وتُشارَك بين الأجهزة. وشريط يقول غير
 * الحقيقة أسوأ من غيابه، لأن صاحب المحل يقرؤه كل صباح فيظنّ عمله مؤقتاً.
 *
 * و`VITE_DEMO=0` يبقى مخرجاً يدوياً لمن أراد إخفاءه قبل الربط.
 */
export const DEMO_MODE = !cloudEnabled && import.meta.env.VITE_DEMO !== '0'

export function DemoBanner() {
  const [hidden, setHidden] = useState(false)
  if (!DEMO_MODE || hidden) return null

  return (
    <div className="no-print border-b border-warn/40 bg-warn-soft">
      <div className="mx-auto flex max-w-[1400px] items-start gap-2.5 px-4 py-2 sm:px-6">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
        <p className="flex-1 text-[12px] leading-5 text-text">
          <span className="font-semibold">نسخة تجريبية للعرض.</span> البيانات محفوظة داخل هذا
          المتصفح فقط، ولا تُشارَك مع أي جهاز آخر، و<span className="font-semibold">ستُمسح</span>{' '}
          عند ربط النظام بقاعدة البيانات. لا تُدخل مخزوناً أو فواتير حقيقية بعد.
        </p>
        <button
          onClick={() => setHidden(true)}
          aria-label="إخفاء التنبيه"
          className="shrink-0 rounded-lg p-1 text-warn transition-colors hover:bg-warn/15"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
