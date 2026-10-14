import { lazy, Suspense } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Tabs } from '@/components/ui'
import { Splash } from '@/components/Splash'

const Purchases = lazy(() => import('./Purchases'))
const Suppliers = lazy(() => import('./Suppliers'))

type Tab = 'orders' | 'suppliers'

/**
 * طلبات التوريد والموردون في صفحة واحدة بطلب العميل: الطلب يُكتب لمورد، فالتنقّل
 * بينهما كان مدخلَين في القائمة لشيء واحد. التبويب في الرابط (`?tab=suppliers`) لا
 * في الحالة، فزر الرجوع والروابط القديمة إلى `/suppliers` تفتح التبويب الصحيح.
 */
export default function Supply() {
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'suppliers' ? 'suppliers' : 'orders'

  return (
    <div className="space-y-4">
      {/* في المنتصف بطلب العميل: مفتاح بين شاشتين، لا تبويب ضمن محتوى إحداهما. */}
      <div className="flex justify-center">
        <Tabs
          value={tab}
          onChange={(t) => setParams(t === 'orders' ? {} : { tab: t }, { replace: true })}
          items={[
            { value: 'orders', label: 'طلبات التوريد' },
            { value: 'suppliers', label: 'الموردون' },
          ]}
        />
      </div>
      <Suspense fallback={<Splash compact />}>
        {tab === 'orders' ? <Purchases /> : <Suppliers />}
      </Suspense>
    </div>
  )
}
