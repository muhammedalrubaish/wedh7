import type { Role, User } from './types'

export const CAPABILITIES = {
  'inventory.view': 'عرض المنتجات والأرصدة',
  'inventory.edit': 'إضافة وتعديل المنتجات',
  'inventory.adjust': 'تسوية الكميات (إنتاج/تالف)',
  'purchase.view': 'عرض الموردين وطلبات التوريد',
  'purchase.edit': 'إنشاء وتعديل طلبات التوريد',
  'purchase.receive': 'استلام التوريد',
  'sales.create': 'إصدار الفواتير',
  'sales.refund': 'المرتجعات والاسترجاع',
  'pricing.view': 'عرض التسعير والتكلفة',
  'pricing.edit': 'تعديل الأسعار',
  'reports.view': 'عرض التقارير',
  'reports.financial': 'عرض الأرباح والتكاليف',
  'users.manage': 'إدارة المستخدمين',
  'settings.manage': 'إعدادات النظام',
  'ai.use': 'المحاسب الذكي',
} as const

export type Capability = keyof typeof CAPABILITIES

const ALL = Object.keys(CAPABILITIES) as Capability[]

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'المالك',
  manager: 'مدير',
  cashier: 'موظف',
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: 'صلاحية كاملة على النظام بما فيها المستخدمين والإعدادات',
  manager: 'يدير المنتجات والتوريد والتقارير، بدون إعدادات النظام',
  cashier: 'يصدر الفواتير ويشوف الأرصدة فقط — بلا تكلفة ولا أرباح',
}

export const ROLE_MATRIX: Record<Role, Capability[]> = {
  owner: ALL,
  manager: [
    'inventory.view',
    'inventory.edit',
    'inventory.adjust',
    'purchase.view',
    'purchase.edit',
    'purchase.receive',
    'sales.create',
    'sales.refund',
    'pricing.view',
    'pricing.edit',
    'reports.view',
    'reports.financial',
    'ai.use',
  ],
  cashier: ['inventory.view', 'sales.create', 'reports.view'],
}

export function can(role: Role | undefined, cap: Capability): boolean {
  if (!role) return false
  return ROLE_MATRIX[role].includes(cap)
}

// ============================================================================
// استثناءات على مستوى المستخدم
//
// الدور يبقى الأساس؛ الاستثناء يصحّح حالة واحدة بلا اختراع دور جديد. مثال واقعي:
// موظف موثوق يُسمح له بتسجيل المرتجعات وحده، أو موظف تُسحب منه التقارير مؤقتاً.
//
// ثلاث حالات لكل صلاحية عمداً — لا اثنتان:
//   غير موجودة = اتبع الدور  |  true = مُنحت زيادةً  |  false = سُحبت
// لو خزّنّا قائمة صلاحيات نهائية بدل الفروق، لصار تعديل الدور لاحقاً لا يصل إلى
// من عُدّلت صلاحياته، ولانفصلت حساباتهم عن مصفوفة الأدوار للأبد بلا أن ينتبه أحد.
// ============================================================================

export type CapOverrides = Partial<Record<Capability, boolean>>

/** الصلاحيات الفعلية = مصفوفة الدور + الاستثناءات، بترتيب حاسم. */
export function effectiveCaps(user: Pick<User, 'role' | 'capOverrides'> | undefined): Capability[] {
  if (!user) return []
  const base = new Set<Capability>(ROLE_MATRIX[user.role])
  for (const [cap, granted] of Object.entries(user.capOverrides ?? {}) as [Capability, boolean][]) {
    if (granted) base.add(cap)
    else base.delete(cap)
  }
  return ALL.filter((c) => base.has(c))
}

export function userCan(
  user: Pick<User, 'role' | 'capOverrides'> | undefined,
  cap: Capability,
): boolean {
  if (!user) return false
  const override = user.capOverrides?.[cap]
  return override ?? ROLE_MATRIX[user.role].includes(cap)
}

/** هل هذه الصلاحية مخالفة لدور المستخدم؟ تُستخدم لتمييزها بصرياً في الشاشة. */
export function isOverridden(
  user: Pick<User, 'role' | 'capOverrides'> | undefined,
  cap: Capability,
): boolean {
  if (!user) return false
  const override = user.capOverrides?.[cap]
  return override !== undefined && override !== ROLE_MATRIX[user.role].includes(cap)
}

/**
 * حارس القفل الخارج: لو سُحبت «إدارة المستخدمين» من آخر من يملكها، ما بقي في
 * النظام من يعيدها — ولا توجد لوحة تحكم داخل التطبيق تنقذ الموقف.
 * يُستدعى قبل الحفظ ويعيد رسالة الرفض، أو null إذا كان التعديل آمناً.
 */
export function lockoutError(
  users: User[],
  targetId: string,
  nextRole: Role,
  nextOverrides: CapOverrides,
  nextActive: boolean,
): string | null {
  const survives = users.some((u) => {
    const isTarget = u.id === targetId
    const role = isTarget ? nextRole : u.role
    const overrides = isTarget ? nextOverrides : u.capOverrides
    const active = isTarget ? nextActive : u.active
    return active && userCan({ role, capOverrides: overrides }, 'users.manage')
  })
  return survives
    ? null
    : 'لازم يبقى حساب نشط واحد على الأقل يملك «إدارة المستخدمين»، وإلا انقفل النظام ولا أحد يقدر يرجّع الصلاحية.'
}
