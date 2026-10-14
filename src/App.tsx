import { Suspense, lazy } from 'react'
import { Splash } from './components/Splash'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { useApp } from './store/app'
import { Card, EmptyState } from './components/ui'
import { ShieldAlert } from 'lucide-react'
import type { Capability } from './lib/permissions'

import Login from './pages/Login'
import { recoveryActive } from './lib/auth'

const ResetPassword = lazy(() => import('./pages/ResetPassword'))

// الرسوم (recharts) وقارئ الباركود (zxing) أثقل اعتماديتين هنا؛ التحميل الكسول
// يبقيهما خارج أول رسم للصفحة على الجوال.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Inventory = lazy(() => import('./pages/Inventory'))
const PartDetail = lazy(() => import('./pages/PartDetail'))
const Pos = lazy(() => import('./pages/Pos'))
// الماسح مخفيّ بطلب العميل («لا يستفاد منها»): الصفحة باقية في src/pages/Scanner.tsx
// وتعود بسطر الاستيراد ومسار `scan` إن احتيج إليها. الرابط القديم يُحوَّل إلى اللوحة.
const Invoices = lazy(() => import('./pages/Invoices'))
const CustomersPage = lazy(() => import('./pages/Customers'))
const Purchases = lazy(() => import('./pages/Purchases'))
const PurchaseBills = lazy(() => import('./pages/PurchaseBills'))
const Pricing = lazy(() => import('./pages/Pricing'))
const Suppliers = lazy(() => import('./pages/Suppliers'))
const Reports = lazy(() => import('./pages/Reports'))
const Accountant = lazy(() => import('./pages/Accountant'))
const UsersPage = lazy(() => import('./pages/Users'))
const SettingsPage = lazy(() => import('./pages/Settings'))
const Account = lazy(() => import('./pages/Account'))

/** أول تحميل كامل (قبل أن يوجد إطار الصفحة). الانتقال بين الصفحات له حدّه داخل الإطار. */
function RouteFallback() {
  return <Splash />
}

function Guard({ cap, children }: { cap: Capability; children: React.ReactNode }) {
  const { can } = useApp()
  if (can(cap)) return <>{children}</>
  return (
    <Card>
      <EmptyState
        icon={<ShieldAlert className="size-6" />}
        title="لا تملك صلاحية لهذه الصفحة"
        description="تواصل مع المدير إذا كنت تحتاج الوصول إلى هذا القسم."
      />
    </Card>
  )
}

export default function App() {
  const { user } = useApp()

  // مسار الاسترجاع يسبق كل شيء، حتى وإن صارت الجلسة قائمة: جلسة الرابط مؤقتة،
  // وترك المستخدم يتصفّح بها يعني أن تنتهي وهو لا يعرف كلمته بعد.
  if (recoveryActive()) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <ResetPassword />
      </Suspense>
    )
  }

  if (!user) return <Login />

  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route
            path="inventory"
            element={
              <Guard cap="inventory.view">
                <Inventory />
              </Guard>
            }
          />
          <Route
            path="inventory/:id"
            element={
              <Guard cap="inventory.view">
                <PartDetail />
              </Guard>
            }
          />
          <Route
            path="pos"
            element={
              <Guard cap="sales.create">
                <Pos />
              </Guard>
            }
          />
          <Route
            path="invoices"
            element={
              <Guard cap="sales.create">
                <Invoices />
              </Guard>
            }
          />
          <Route
            path="customers"
            element={
              <Guard cap="sales.create">
                <CustomersPage />
              </Guard>
            }
          />
          <Route
            path="purchases"
            element={
              <Guard cap="purchase.view">
                <Purchases />
              </Guard>
            }
          />
          <Route
            path="bills"
            element={
              <Guard cap="purchase.view">
                <PurchaseBills />
              </Guard>
            }
          />
          <Route
            path="pricing"
            element={
              <Guard cap="pricing.view">
                <Pricing />
              </Guard>
            }
          />
          <Route
            path="suppliers"
            element={
              <Guard cap="purchase.view">
                <Suppliers />
              </Guard>
            }
          />
          <Route
            path="reports"
            element={
              <Guard cap="reports.view">
                <Reports />
              </Guard>
            }
          />
          <Route
            path="accountant"
            element={
              <Guard cap="ai.use">
                <Accountant />
              </Guard>
            }
          />
          <Route
            path="users"
            element={
              <Guard cap="users.manage">
                <UsersPage />
              </Guard>
            }
          />
          <Route
            path="settings"
            element={
              <Guard cap="settings.manage">
                <SettingsPage />
              </Guard>
            }
          />
          <Route path="account" element={<Account />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
