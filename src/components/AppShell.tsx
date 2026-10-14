import { Suspense, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Bot,
  ChevronLeft,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Package,
  PieChart,
  Receipt,
  Settings as SettingsIcon,
  ShoppingCart,
  Sun,
  Tags,
  Truck,
  UserRound,
  UserRoundCog,
  Users,
  UsersRound,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { Badge, Button, cn, lockScroll, unlockScroll } from './ui'
import { DemoBanner } from './DemoBanner'
import { BackupReminder } from './BackupReminder'
import { AuditButton } from './AuditLog'
import { Splash } from './Splash'
import { useApp } from '@/store/app'
import { useFeedbackPrefs } from '@/hooks/useFeedbackPrefs'
import { tapSound } from '@/lib/feedback'
import { ROLE_LABELS, type Capability } from '@/lib/permissions'
import { db } from '@/lib/db'
import { reorderSuggestions } from '@/lib/analytics'

interface NavItem {
  to: string
  label: string
  icon: typeof Package
  cap?: Capability
  badge?: 'reorder'
}

const NAV: Array<{ section: string; items: NavItem[] }> = [
  {
    section: 'التشغيل',
    items: [
      { to: '/', label: 'اللوحة', icon: LayoutDashboard },
      { to: '/pos', label: 'فاتورة جديدة', icon: ShoppingCart, cap: 'sales.create' },
    ],
  },
  {
    section: 'المنتجات',
    items: [
      {
        to: '/inventory',
        label: 'المنتجات',
        icon: Package,
        cap: 'inventory.view',
        badge: 'reorder',
      },
      { to: '/pricing', label: 'التسعير', icon: Tags, cap: 'pricing.view' },
      { to: '/bills', label: 'المصروفات', icon: Receipt, cap: 'purchase.view' },
      { to: '/purchases', label: 'الموردون والتوريد', icon: Truck, cap: 'purchase.view' },
    ],
  },
  {
    section: 'المبيعات',
    items: [
      { to: '/invoices', label: 'الفواتير والمرتجعات', icon: FileText, cap: 'sales.create' },
      { to: '/customers', label: 'العملاء', icon: UsersRound, cap: 'sales.create' },
      { to: '/reports', label: 'التقارير', icon: PieChart, cap: 'reports.view' },
      { to: '/accountant', label: 'المحاسب الذكي', icon: Bot, cap: 'ai.use' },
    ],
  },
  {
    section: 'الإدارة',
    items: [
      { to: '/users', label: 'المستخدمون', icon: Users, cap: 'users.manage' },
      { to: '/settings', label: 'الإعدادات', icon: SettingsIcon, cap: 'settings.manage' },
    ],
  },
  {
    // قسم مستقل لا بند تحت «الإدارة»: الموظف لا يرى الإدارة، ويحتاج حسابه مثل المالك.
    // ومن هنا يغيّر صاحب المحل كلمة المرور والبريد يوم التسليم — فيجب أن يُرى بلا بحث.
    section: 'الحساب',
    items: [{ to: '/account', label: 'حسابي', icon: UserRound }],
  },
]

function useReorderCount(): number {
  const rows = useLiveQuery(async () => {
    const [parts, movements, pos] = await Promise.all([
      db.parts.toArray(),
      db.movements.toArray(),
      db.purchaseOrders.toArray(),
    ])
    return reorderSuggestions(parts, movements, pos).length
  }, [])
  return rows ?? 0
}

export function AppShell() {
  const { user, settings, logout, can, toggleTheme } = useApp()
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const reorderCount = useReorderCount()

  useEffect(() => setOpen(false), [location.pathname])

  const sections = NAV.map((s) => ({
    ...s,
    items: s.items.filter((i) => !i.cap || can(i.cap)),
  })).filter((s) => s.items.length > 0)

  const sidebar = (
    <div className="flex h-full flex-col">
      {/* شعار العميل نفسه بدل الأيقونة: الكلمة «وُضح» تغني عن كتابة الاسم بجانبها.
          `brand-logo` يتبع لون الهوية في الفاتح والداكن. */}
      <div className="px-5 py-5">
        <div role="img" aria-label={settings.shopName || 'وضح'} className="brand-logo h-11" />
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {sections.map((section) => (
          <div key={section.section}>
            <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-wide text-faint">
              {section.section}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    cn(
                      'group flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-all',
                      isActive
                        ? 'bg-brand-soft text-brand-strong'
                        : 'text-muted hover:bg-surface-2 hover:text-text',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <item.icon
                        className={cn(
                          'size-[18px] shrink-0 transition-transform',
                          !isActive && 'group-hover:scale-110',
                        )}
                      />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.badge === 'reorder' && reorderCount > 0 && (
                        <Badge tone="warn" className="tnum px-1.5 py-0 text-[11px]">
                          {reorderCount}
                        </Badge>
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2.5 rounded-xl px-2 py-2">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
            {user?.name.charAt(0)}
          </span>
          {/* الاسم رابط إلى شاشة الحساب: كلمة المرور والبريد يغيّرهما صاحبهما من
              هنا، لا من شاشة المستخدمين — فلا يملكهما أحد غيره. */}
          <NavLink to="/account" className="min-w-0 flex-1 rounded-lg hover:bg-surface-2">
            <p className="truncate text-[13px] font-medium">{user?.name}</p>
            <p className="truncate text-[11px] text-faint">{user && ROLE_LABELS[user.role]}</p>
          </NavLink>
          {/* زرّان ينهيان الجلسة نفسها، والفرق في النيّة لا في الأثر: «تبديل»
              لتسليم الجهاز لموظف آخر، و«خروج» لإقفال المحل. */}
          <Button
            variant="ghost"
            size="icon"
            onClick={logout}
            aria-label="تبديل الحساب"
            title="تبديل الحساب"
          >
            <UserRoundCog className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={logout}
            aria-label="خروج"
            title="تسجيل الخروج"
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-dvh">
      <aside className="panel fixed inset-y-0 right-0 z-30 hidden w-64 border-l border-border lg:block">
        {sidebar}
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 animate-fade bg-black/45"
            onClick={() => setOpen(false)}
          />
          <aside className="panel absolute inset-y-0 right-0 w-72 animate-rise border-l border-border pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
            {sidebar}
          </aside>
        </div>
      )}

      <div className="lg:mr-64">
        {/* `viewport-fit=cover` يمدّ الصفحة تحت شريط المتصفح وشريط الحالة في آيفون، فالترويسة
        الملتصقة بـ`top-0` تختفي تحتهما عند التمرير ويظهر المحتوى مقصوصاً. الحشوة بمقدار
        الحافة الآمنة تُنزل الأزرار تحت الشريط، وقيمتها صفر في كل جهاز بلا حافة. ولهذا تبقى
        الترويسة أول عنصر في الصفحة وشريط العرض تحتها: لو سبقها لصارت الحشوة فجوة فارغة. */}
        <header className="sticky top-0 z-20 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center gap-2 border-b border-border glass px-4 pt-[env(safe-area-inset-top)] no-print">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="القائمة"
          >
            <Menu className="size-5" />
          </Button>

          <Breadcrumb />

          <div className="flex-1" />

          <AuditButton />
          <SoundToggle />
          <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="تبديل المظهر">
            {settings.theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
        </header>
        <DemoBanner />
        <BackupReminder />

        {/* الحشوة السفلية تساوي ارتفاع الشريط السفلي وبروز زر اللوحة وحافة الآيفون، وإلا
        اختبأ آخر زر في الصفحة (حفظ، إصدار الفاتورة) تحته. */}
        <main className="mx-auto max-w-[1400px] px-4 pt-5 pb-[calc(7.5rem+env(safe-area-inset-bottom))] sm:px-6 lg:py-7">
          {/* حدّ تعليق داخل الإطار: الصفحة الجديدة تُحمَّل والترويسة والشريط السفلي ثابتان. */}
          <Suspense fallback={<Splash compact />}>
            <Outlet />
          </Suspense>
        </main>
        <BottomNav />
      </div>
    </div>
  )
}

const TITLES: Record<string, string> = {
  '': 'اللوحة',
  pos: 'فاتورة جديدة',
  inventory: 'المنتجات',
  pricing: 'التسعير',
  suppliers: 'الموردون والتوريد',
  purchases: 'الموردون والتوريد',
  bills: 'المصروفات',
  invoices: 'الفواتير والمرتجعات',
  customers: 'العملاء',
  reports: 'التقارير',
  accountant: 'المحاسب الذكي',
  users: 'المستخدمون',
  settings: 'الإعدادات',
  account: 'حسابي',
}

function Breadcrumb() {
  const { pathname } = useLocation()
  const segments = pathname.split('/').filter(Boolean)
  const root = segments[0] ?? ''
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-sm">
      <span className="truncate font-semibold">{TITLES[root] ?? 'وضح'}</span>
      {segments.length > 1 && (
        <>
          <ChevronLeft className="size-3.5 text-faint" />
          <span className="truncate text-muted">تفاصيل</span>
        </>
      )}
    </div>
  )
}

/**
 * الشريط السفلي على الجوال: الوصول بإبهام واحد إلى أكثر الشاشات استعمالاً،
 * بدل فتح القائمة الجانبية في كل مرة. الأسماء مختصرة لتتسع الأزرار في ٣٩٠ بكسل،
 * والاسم الكامل في `aria-label`. ما لا يملك المستخدم صلاحيته لا يظهر — الموظف لا
 * يرى المشتريات ولا التوريد، كما في القائمة الجانبية.
 */
type BottomItem = NavItem & {
  short: string
  /** زر يفتح لوحة اختيارات بدل أن ينتقل — تجميع شاشات متقاربة تحت أيقونة واحدة. */
  group?: Array<NavItem & { hint: string }>
}

const BOTTOM_NAV: BottomItem[] = [
  { to: '/inventory', label: 'المنتجات', short: 'المنتجات', icon: Package, cap: 'inventory.view' },
  // يمين «اللوحة»: المصروفات؛ يسارها: «فاتورة» ثم التقارير — بطلب العميل. العملاء في
  // القائمة الجانبية وحدها. الترتيب هنا من اليمين في RTL.
  {
    to: '/bills',
    label: 'المصروفات',
    short: 'المصروفات',
    icon: Receipt,
    cap: 'purchase.view',
  },
  // كل ما هو «فاتورة» تحت أيقونة واحدة بطلب العميل: البيع والمشتريات. المصروفات لها
  // زرّها في الشريط وفي القائمة الجانبية، فتكرارها هنا بطلب العميل أُزيل.
  {
    to: '/pos',
    label: 'الفواتير',
    short: 'فاتورة',
    icon: ShoppingCart,
    group: [
      {
        to: '/pos',
        label: 'فاتورة بيع جديدة',
        hint: 'لمحل أو زبون',
        icon: ShoppingCart,
        cap: 'sales.create',
      },
      {
        to: '/invoices',
        label: 'فواتير البيع',
        hint: 'والمرتجعات والسداد',
        icon: FileText,
        cap: 'sales.create',
      },
      {
        to: '/purchases',
        label: 'المشتريات',
        hint: 'طلبات التوريد والموردون',
        icon: Truck,
        cap: 'purchase.view',
      },
    ],
  },
  { to: '/reports', label: 'التقارير', short: 'التقارير', icon: PieChart, cap: 'reports.view' },
]

function BottomNav() {
  const { can } = useApp()
  const items = BOTTOM_NAV.map((i) =>
    i.group ? { ...i, group: i.group.filter((g) => !g.cap || can(g.cap)) } : i,
  ).filter((i) => (i.group ? i.group.length > 0 : !i.cap || can(i.cap)))
  // نصفان متساويا العرض واللوحة بينهما: هكذا تقع في المنتصف تماماً مهما كان عدد
  // الأزرار على كل جانب (أربعة للمالك، اثنان للموظف). النصف الأول يمين في RTL.
  const half = Math.ceil(items.length / 2)
  const sides = [items.slice(0, half), items.slice(half)]

  return (
    <nav
      aria-label="التنقل السريع"
      className="glass fixed inset-x-0 bottom-0 z-30 border-t border-border pb-[env(safe-area-inset-bottom)] no-print lg:hidden"
    >
      <div className="mx-auto flex max-w-lg items-stretch">
        <NavSide items={sides[0]} />
        <div className="relative flex w-20 shrink-0 justify-center">
          {/* البروز فوق الشريط: الحلقة بلون الصفحة تجعله يبدو مقطوعاً من الشريط لا ملصقاً
          عليه، والحجم الأكبر يجعل الرجوع للوحة ضغطة إبهام بلا نظر. */}
          <NavLink
            to="/"
            end
            aria-label="اللوحة"
            className="absolute -top-7 flex flex-col items-center gap-1"
          >
            {({ isActive }) => (
              <>
                <span
                  className={cn(
                    'grid size-16 place-items-center rounded-full border-4 border-bg bg-brand text-on-brand shadow-lg transition-transform active:scale-95',
                    isActive && 'ring-2 ring-brand/35 ring-offset-0',
                  )}
                >
                  <LayoutDashboard className="size-7" />
                </span>
                <span
                  className={cn(
                    'text-[11px]',
                    isActive ? 'font-bold text-brand-strong' : 'font-semibold text-muted',
                  )}
                >
                  اللوحة
                </span>
              </>
            )}
          </NavLink>
        </div>
        <NavSide items={sides[1]} />
      </div>
    </nav>
  )
}

function NavSide({ items }: { items: BottomItem[] }) {
  return (
    <ul
      className="grid flex-1"
      style={{ gridTemplateColumns: `repeat(${Math.max(items.length, 1)}, minmax(0, 1fr))` }}
    >
      {items.map(({ to, label, short, icon: Icon, group }) => (
        <li key={to}>
          {group ? (
            <NavGroup label={label} short={short} icon={Icon} items={group} />
          ) : (
            <NavLink
              to={to}
              aria-label={label}
              className={({ isActive }) =>
                cn(
                  'flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors',
                  isActive ? 'text-brand-strong' : 'text-muted hover:text-text',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      'grid h-7 w-11 place-items-center rounded-full transition-colors',
                      isActive && 'bg-brand-soft',
                    )}
                  >
                    <Icon className="size-[19px]" />
                  </span>
                  <span className="max-w-full truncate px-0.5">{short}</span>
                </>
              )}
            </NavLink>
          )}
        </li>
      ))}
    </ul>
  )
}

/**
 * زر في الشريط يفتح شاشاته المجمّعة بطاقاتٍ مكدّسة فوقه، تصعد واحدةً بعد الأخرى
 * بطلب العميل. الأكثر استعمالاً (فاتورة بيع جديدة) أسفلها، أقرب ما يكون للإبهام.
 * يبدو «نشطاً» حين تكون الصفحة الحالية إحدى شاشاته، كي لا يضيع المستخدم.
 */
function NavGroup({
  label,
  short,
  icon: Icon,
  items,
}: {
  label: string
  short: string
  icon: typeof Package
  items: Array<NavItem & { hint: string }>
}) {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  // الإغلاق بحركة عكسية قصيرة قبل الإزالة؛ أما اختيار بطاقة فيُغلق فوراً — الكاشير
  // لا ينتظر حركة كي يصل للبيع.
  const [closing, setClosing] = useState(false)
  const active = items.some((i) => location.pathname.startsWith(i.to))

  useEffect(() => setOpen(false), [location.pathname, location.search])

  const close = () => {
    setClosing(true)
    window.setTimeout(() => {
      setOpen(false)
      setClosing(false)
    }, 150)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('keydown', onKey)
    // العدّاد المشترك مع `Modal` لا حفظ/استرجاع: الأخير أبقى الصفحة مقفلة سابقاً.
    lockScroll()
    return () => {
      document.removeEventListener('keydown', onKey)
      unlockScroll()
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={cn(
          'flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors',
          active ? 'text-brand-strong' : 'text-muted hover:text-text',
        )}
      >
        <span
          className={cn(
            'grid h-7 w-11 place-items-center rounded-full transition-colors',
            active && 'bg-brand-soft',
          )}
        >
          <Icon className="size-[19px]" />
        </span>
        <span className="max-w-full truncate px-0.5">{short}</span>
      </button>

      {/* بوابة لا ابن مباشر: الشريط `glass` بـ`backdrop-filter`، وهذا يجعل أي `fixed`
          داخله يتموضع نسبةً للشريط لا للشاشة. */}
      {open &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={label}
            className="fixed inset-0 z-50 lg:hidden"
          >
            <div
              className={cn(
                'absolute inset-0 bg-black/45 backdrop-blur-[3px]',
                closing ? 'animate-undeal' : 'animate-fade',
              )}
              onClick={close}
            />
            <ul className="absolute inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] mx-auto flex max-w-lg flex-col-reverse gap-2.5 px-4">
              {items.map(({ to, label: name, hint, icon: ItemIcon }, i) => (
                <li
                  key={to}
                  className={closing ? 'animate-undeal' : 'animate-deal'}
                  // الأقرب للشريط يصعد أولاً، فتُقرأ الرزمة من مصدرها إلى أعلاها.
                  style={{ animationDelay: closing ? '0ms' : `${i * 55}ms` }}
                >
                  <NavLink
                    to={to}
                    // الإغلاق عند الضغط لا عند تغيّر الصفحة وحده: اختيار الصفحة المفتوحة
                    // نفسها (فاتورة بيع وأنت في البيع) لا يغيّر المسار فتبقى مفتوحة.
                    onClick={() => setOpen(false)}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 rounded-2xl border p-3 shadow-xl transition-transform active:scale-[0.98]',
                        isActive
                          ? 'border-brand bg-brand-soft text-brand-strong'
                          : 'border-border bg-surface',
                      )
                    }
                  >
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand text-on-brand">
                      <ItemIcon className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold">{name}</span>
                      <span className="block text-[12px] text-muted">{hint}</span>
                    </span>
                    <ChevronLeft className="size-4 shrink-0 text-faint" />
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </>
  )
}

/**
 * زر الصوت بجانب زر المظهر: إطفاؤه لا يحتاج البحث في «حسابي» — زبون واقف عند
 * الكاونتر يكفي سبباً لإسكاته بضغطة. يتحكّم بالصوت وحده؛ الاهتزاز في «حسابي».
 */
function SoundToggle() {
  const [prefs, save] = useFeedbackPrefs()
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={prefs.sound ? 'الصوت مفعّل — اضغط للإسكات' : 'الصوت مُسكت — اضغط للتشغيل'}
      aria-pressed={prefs.sound}
      onClick={() => {
        const next = !prefs.sound
        save({ sound: next })
        // عند الإسكات تُسمع آخر نقرة من المستمع العام (قرأ التفضيل قبل التغيير)؛
        // عند التشغيل لا شيء سمعه، فتُسمع النقرة هنا تأكيداً أن الصوت عاد.
        if (next) tapSound()
      }}
    >
      {prefs.sound ? <Volume2 className="size-4" /> : <VolumeX className="size-4 text-faint" />}
    </Button>
  )
}
