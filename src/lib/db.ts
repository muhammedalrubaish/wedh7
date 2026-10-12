import Dexie, { type Table } from 'dexie'
import type {
  AuditEntry,
  Category,
  Customer,
  Invoice,
  Part,
  PurchaseOrder,
  ReturnNote,
  Settings,
  StockMovement,
  Supplier,
  User,
} from './types'

/**
 * حدود التخزين الوحيدة.
 *
 * الواجهة لا تلمس Dexie مباشرة — كل شيء يمرّ من هنا ومن `repo.ts`. في الوضع
 * السحابي هذه القاعدة **مرآة قراءة** تُستبدل عند كل إقلاع (انظر `mirror.ts`)،
 * وفي وضع العرض هي القاعدة نفسها.
 */
export class ShopDB extends Dexie {
  users!: Table<User, string>
  categories!: Table<Category, string>
  suppliers!: Table<Supplier, string>
  customers!: Table<Customer, string>
  parts!: Table<Part, string>
  movements!: Table<StockMovement, string>
  purchaseOrders!: Table<PurchaseOrder, string>
  invoices!: Table<Invoice, string>
  returns!: Table<ReturnNote, string>
  settings!: Table<Settings, string>
  audit!: Table<AuditEntry, string>

  constructor() {
    // اسم مستقل عن نسخة قطع الجوالات: لو فُتح النظامان على نفس المتصفح لا
    // يقرأ أحدهما مرآة الآخر.
    super('wedh7')
    this.version(1).stores({
      users: 'id, username, role, active',
      categories: 'id, name',
      suppliers: 'id, name',
      customers: 'id, name, phone, type',
      parts: 'id, sku, name, categoryId, supplierId, barcode, qty, archived',
      movements: 'id, partId, type, at, userId',
      purchaseOrders: 'id, code, supplierId, status, createdAt',
      invoices: 'id, number, customerId, createdAt, userId, status',
      returns: 'id, number, invoiceId, customerId, createdAt, userId',
      settings: 'id',
      audit: 'id, at, userId, entity',
    })
  }
}

export const db = new ShopDB()

export function uid(prefix = ''): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `${prefix}${Date.now().toString(36)}${rand}`
}

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  shopName: 'وضح للحلويات',
  shopNameEn: 'Wadhah Sweets',
  vatNumber: '',
  crNumber: '',
  address: 'المملكة العربية السعودية',
  phone: '05xxxxxxxx',
  currency: 'SAR',
  vatRate: 15,
  vatEnabled: true,
  zatcaQr: true,
  invoicePrefix: 'INV-',
  invoiceCounter: 1,
  poPrefix: 'PO-',
  poCounter: 1,
  returnPrefix: 'RET-',
  returnCounter: 1,
  theme: 'light',
  aiProvider: 'none',
  aiModel: 'deepseek-chat',
  aiApiKey: '',
}

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get('app')
  if (s) return { ...DEFAULT_SETTINGS, ...s }
  await db.settings.put(DEFAULT_SETTINGS)
  return DEFAULT_SETTINGS
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings()
  const next = { ...current, ...patch, id: 'app' as const }
  await db.settings.put(next)
  return next
}

/** يحجز الرقم التالي — يكفي لجهاز واحد في وضع العرض؛ الخادم يحجز في الوضع السحابي. */
export async function nextNumber(kind: 'invoice' | 'po' | 'return'): Promise<string> {
  return db.transaction('rw', db.settings, async () => {
    const s = await getSettings()
    if (kind === 'invoice') {
      const n = s.invoiceCounter
      await db.settings.put({ ...s, invoiceCounter: n + 1 })
      return `${s.invoicePrefix}${String(n).padStart(5, '0')}`
    }
    if (kind === 'return') {
      const n = s.returnCounter
      await db.settings.put({ ...s, returnCounter: n + 1 })
      return `${s.returnPrefix}${String(n).padStart(4, '0')}`
    }
    const n = s.poCounter
    await db.settings.put({ ...s, poCounter: n + 1 })
    return `${s.poPrefix}${String(n).padStart(4, '0')}`
  })
}

export async function logAudit(
  user: { id: string; name: string },
  action: string,
  entity: string,
  entityId?: string,
  details?: string,
): Promise<void> {
  await db.audit.add({
    id: uid('au_'),
    userId: user.id,
    userName: user.name,
    action,
    entity,
    entityId,
    at: Date.now(),
    details,
  })
}

/**
 * يطبّق حركة مخزون ويقيّدها في الدفتر في معاملة واحدة، فيبقى رصيد المنتج قابلاً
 * لإعادة الاشتقاق من حركاته دائماً.
 */
export async function applyMovement(input: {
  partId: string
  qty: number
  type: StockMovement['type']
  userId: string
  unitCost?: number
  ref?: string
  note?: string
  at?: number
}): Promise<void> {
  await db.transaction('rw', db.parts, db.movements, async () => {
    const part = await db.parts.get(input.partId)
    if (!part) throw new Error('المنتج غير موجود')
    if (part.qty + input.qty < 0) {
      throw new Error(`الرصيد غير كافٍ: المتاح ${part.qty} والمطلوب ${Math.abs(input.qty)}`)
    }

    let cost = part.cost
    // المتوسط المرجّح: الحركات الواردة بتكلفة معلومة وحدها تحرّك الرقم.
    if (input.qty > 0 && input.unitCost !== undefined) {
      const totalValue = part.qty * part.cost + input.qty * input.unitCost
      const totalQty = part.qty + input.qty
      cost = totalQty > 0 ? totalValue / totalQty : input.unitCost
    }

    await db.parts.update(input.partId, {
      qty: part.qty + input.qty,
      cost: Math.round(cost * 100) / 100,
      updatedAt: Date.now(),
    })

    await db.movements.add({
      id: uid('mv_'),
      partId: input.partId,
      qty: input.qty,
      type: input.type,
      unitCost: input.unitCost,
      ref: input.ref,
      userId: input.userId,
      at: input.at ?? Date.now(),
      note: input.note,
    })
  })
}

export async function isEmpty(): Promise<boolean> {
  return (await db.parts.count()) === 0
}

export async function wipe(): Promise<void> {
  await db.delete()
  await db.open()
}

const TABLES = [
  'users',
  'categories',
  'suppliers',
  'customers',
  'parts',
  'movements',
  'purchaseOrders',
  'invoices',
  'returns',
  'settings',
  'audit',
] as const

type TableName = (typeof TABLES)[number]

/** لقطة JSON كاملة — النسخة الاحتياطية الوحيدة الممكنة لقاعدة داخل المتصفح. */
export async function exportAll(): Promise<string> {
  const out: Record<string, unknown> = { version: 2, exportedAt: Date.now() }
  for (const t of TABLES) out[t] = await db[t].toArray()
  return JSON.stringify(out, null, 2)
}

export async function importAll(json: string): Promise<void> {
  const data = JSON.parse(json) as Record<string, unknown[]>
  await db.transaction(
    'rw',
    TABLES.map((t) => db[t]),
    async () => {
      await Promise.all(TABLES.map((t) => db[t].clear()))
      await Promise.all(
        TABLES.map((t: TableName) =>
          (db[t] as Table<unknown, string>).bulkAdd((data[t] ?? []) as never[]),
        ),
      )
    },
  )
}
