/**
 * سحب القاعدة إلى المرآة المحلية.
 *
 * Supabase مصدر الحقيقة، و`IndexedDB` **مرآة قراءة** لا مخزناً مستقلاً. لماذا
 * مرآة بدل قراءة مباشرة من الشاشات:
 *
 *   • كل شاشة تستعمل `useLiveQuery` من Dexie فتتحدّث تلقائياً عند أي كتابة.
 *     ولا مقابل لذلك في Supabase، فالقراءة المباشرة تعني إعادة كتابة كل شاشة.
 *   • التصفّح يبقى يعمل بلا إنترنت — البيع وحده هو ما يتوقّف.
 *   • جولة شبكة واحدة عند الإقلاع بدل واحدة لكل شاشة.
 *
 * ⚠️ ولأن المرآة تُستبدل بالكامل عند كل سحب، **لا يجوز أن تبقى أي كتابة محلية
 * بلا مقابل على الخادم**: ما يُكتب في Dexie وحده يُمحى عند أول إقلاع. كل مسار
 * كتابة يمرّ بالخادم أولاً ثم يحدّث المرآة — انظر `repo.ts`.
 */
import { db, getSettings } from './db'
import type { SupabaseClient } from '@supabase/supabase-js'
import { humanError, isMissingSchema, requireClient } from './supabase'
import { selectAllWith, type Source } from './paging'
import {
  toCategory,
  toCustomer,
  toInvoice,
  toMovement,
  toPart,
  toPurchaseBill,
  toPurchaseItem,
  toPurchaseOrder,
  toReturnNote,
  toSettings,
  toSupplier,
  toUser,
  type Row,
} from './rows'

/**
 * سقف دفتر الحركة المسحوب.
 *
 * الرصيد لا يُشتق من هذه الصفوف — الخادم يحسبه في `record_movement` ويرسله في
 * `parts.qty`. فالسقف يقصّ عرض التاريخ القديم فقط، ولا يُفسد رقماً.
 */
const MOVEMENT_WINDOW = 5000

/**
 * هل جداول المشتريات موجودة على الخادم؟ تُضبط مع كل سحب.
 *
 * ترحيلها لاحق للأول ويطبّقه صاحب المحل يدوياً، فقد تعمل نسخة الواجهة الجديدة
 * على قاعدة لم تُحدَّث بعد. غيابها لا يُوقف السحب كله — باقي النظام سليم — لكن
 * شاشة المشتريات تحتاج أن تعرف لتقول السبب بدل قائمة فارغة توحي بأن لا شيء مسجّل.
 */
export let purchasesSchemaReady = true

const rows = <T>(data: unknown, map: (r: Row) => T): T[] =>
  Array.isArray(data) ? (data as Row[]).map(map) : []

/** يجمع الصفوف التابعة (بنود) تحت معرّف الأب. */
function groupBy(data: unknown, key: string): Map<string, Row[]> {
  const out = new Map<string, Row[]>()
  for (const r of (data ?? []) as Row[]) {
    const id = String(r[key])
    const list = out.get(id) ?? []
    list.push(r)
    out.set(id, list)
  }
  return out
}

/**
 * مصادر القراءة — مصدر واحد للمرآة وللنسخة الاحتياطية، فلا يُضاف جدول إلى
 * أحدهما وينسى الآخر (هذا ما حدث فعلاً لجداول المشتريات في التصدير القديم).
 */
export const selectAll = (source: Source<SupabaseClient>, cap?: number) =>
  selectAllWith(requireClient(), source, cap)

export const SOURCES = {
  categories: (c) => c.from('categories').select('*').order('id'),
  suppliers: (c) => c.from('suppliers').select('*').order('id'),
  customers: (c) => c.from('customers').select('*').order('id'),
  parts: (c) => c.from('parts_v').select('*').order('id'),
  movements: (c) =>
    c
      .from('stock_movements_v')
      .select('*')
      .order('at', { ascending: false })
      .order('id', { ascending: false }),
  invoices: (c) => c.from('invoices_v').select('*').order('id'),
  invoiceLines: (c) => c.from('invoice_lines_v').select('*').order('id'),
  returns: (c) => c.from('returns_v').select('*').order('id'),
  returnLines: (c) => c.from('return_lines_v').select('*').order('id'),
  purchaseOrders: (c) => c.from('purchase_orders').select('*, purchase_order_lines(*)').order('id'),
  profiles: (c) => c.from('profiles').select('*').order('id'),
  purchaseItems: (c) => c.from('purchase_items').select('*').order('id'),
  purchaseBills: (c) => c.from('purchase_bills').select('*, purchase_bill_lines(*)').order('id'),
} satisfies Record<string, Source<SupabaseClient>>

/**
 * القراءة تمرّ بالمناظر لا بالجداول — وهذا شرط لا تفضيل.
 *
 * `parts` ممنوحة بالأعمدة: كل عمود عدا `cost`. فطلب `select *` عليها يُرفض
 * بـ 42501. و`invoices` و`returns` و`stock_movements` بلا منح قراءة أصلاً.
 * المناظر `_v` هي المنفذ المقصود: تخفي `cost` و`unit_cost` عمّن لا يملك
 * `pricing.view`، وتصل `null` فيترجمها `rows.ts` إلى `undefined`.
 */
export async function pullAll(): Promise<void> {
  const client = requireClient()
  const local = await getSettings()

  const [
    cats,
    sups,
    custs,
    parts,
    movs,
    invs,
    invLines,
    rets,
    retLines,
    pos,
    settings,
    profiles,
    items,
    bills,
  ] = await Promise.all([
    selectAll(SOURCES.categories),
    selectAll(SOURCES.suppliers),
    selectAll(SOURCES.customers),
    selectAll(SOURCES.parts),
    // الأحدث أولاً حتى السقف: القديم جداً لا يُعرض إلا في سجل المنتج، والرصيد لا يُشتق منه.
    selectAll(SOURCES.movements, MOVEMENT_WINDOW),
    selectAll(SOURCES.invoices),
    selectAll(SOURCES.invoiceLines),
    selectAll(SOURCES.returns),
    selectAll(SOURCES.returnLines),
    selectAll(SOURCES.purchaseOrders),
    client.from('settings_v').select('*').eq('id', 'app').maybeSingle(),
    selectAll(SOURCES.profiles),
    selectAll(SOURCES.purchaseItems),
    selectAll(SOURCES.purchaseBills),
  ])

  purchasesSchemaReady = !isMissingSchema(items.error) && !isMissingSchema(bills.error)
  for (const r of [items, bills]) {
    if (r.error && !isMissingSchema(r.error)) throw new Error(humanError(r.error))
  }

  // أول خطأ يُرمى ويُوقف السحب: مرآة نصف ممتلئة أسوأ من مرآة قديمة، لأنها
  // تبدو صحيحة. الشاشات تُبقي ما كان معروضاً حتى ينجح سحب كامل.
  for (const r of [
    cats,
    sups,
    custs,
    parts,
    movs,
    invs,
    invLines,
    rets,
    retLines,
    pos,
    settings,
    profiles,
  ]) {
    if (r.error) throw new Error(humanError(r.error))
  }

  // المناظر لا تحمل مفاتيح أجنبية، فالتضمين (`select=*,invoice_lines(…)`) لا
  // يعمل عليها. الضمّ يدوي هنا بدل جولة شبكة لكل فاتورة.
  const linesByInvoice = groupBy(invLines.data, 'invoice_id')
  const linesByReturn = groupBy(retLines.data, 'return_id')

  await db.transaction(
    'rw',
    [
      db.categories,
      db.suppliers,
      db.customers,
      db.parts,
      db.movements,
      db.invoices,
      db.returns,
      db.purchaseOrders,
      db.purchaseItems,
      db.purchaseBills,
      db.settings,
      db.users,
    ],
    async () => {
      await Promise.all([
        db.categories.clear(),
        db.suppliers.clear(),
        db.customers.clear(),
        db.parts.clear(),
        db.movements.clear(),
        db.invoices.clear(),
        db.returns.clear(),
        db.purchaseOrders.clear(),
        db.purchaseItems.clear(),
        db.purchaseBills.clear(),
        db.users.clear(),
      ])
      await Promise.all([
        db.categories.bulkPut(rows(cats.data, toCategory)),
        db.suppliers.bulkPut(rows(sups.data, toSupplier)),
        db.customers.bulkPut(rows(custs.data, toCustomer)),
        db.parts.bulkPut(rows(parts.data, toPart)),
        db.movements.bulkPut(rows(movs.data, toMovement)),
        db.invoices.bulkPut(
          rows(invs.data, (r) =>
            toInvoice({ ...r, invoice_lines: linesByInvoice.get(String(r.id)) ?? [] }),
          ),
        ),
        db.returns.bulkPut(
          rows(rets.data, (r) =>
            toReturnNote({ ...r, return_lines: linesByReturn.get(String(r.id)) ?? [] }),
          ),
        ),
        db.purchaseOrders.bulkPut(rows(pos.data, (r) => toPurchaseOrder(r))),
        db.purchaseItems.bulkPut(rows(items.data, toPurchaseItem)),
        db.purchaseBills.bulkPut(rows(bills.data, toPurchaseBill)),
        // الحسابات في Supabase Auth، لكن **أسماءها** تحتاجها الشاشات: عمود
        // البائع في الفواتير وأداء الموظفين في التقارير يربطان `userId` باسم.
        // الاستثناءات لا تُسحب: هذه نسخة عرض لا مصدر صلاحية — الصلاحية تُقرَّر
        // في Postgres عند كل عملية، لا من هذا الجدول.
        db.users.bulkPut(rows(profiles.data, (r) => toUser(r))),
      ])
      // الإعدادات تُدمج لا تُستبدل: المظهر والمفتاح والعدّادات محلية — انظر `toSettings`.
      if (settings.data) await db.settings.put(toSettings(settings.data as Row, local))
    },
  )
}

/**
 * يعيد سحب مجموعة منتجات في استعلام واحد — لا استعلام لكل منتج.
 *
 * دفتر الحركة لا يُسحب: التعديل الجماعي لا يمسّ الأرصدة أصلاً (`qty` و`cost`
 * لا يُكتبان من الواجهة إطلاقاً).
 */
export async function refreshParts(ids: string[]): Promise<void> {
  if (!ids.length) return
  const parts = await requireClient().from('parts_v').select('*').in('id', ids)
  if (parts.error) throw new Error(humanError(parts.error))
  await db.parts.bulkPut(rows(parts.data, toPart))
}

/**
 * يعيد سحب منتج واحد وحركاته بعد كتابة.
 *
 * أرخص من `pullAll` بكثير، والفرق محسوس خلف الكاونتر: بيعة واحدة لا يصح أن
 * تعيد تحميل الكتالوج كله. و`qty` يأتي من الخادم لا يُحسب هنا — القاعدة ١.
 */
export async function refreshPart(partId: string): Promise<void> {
  const client = requireClient()
  const [part, movs] = await Promise.all([
    client.from('parts_v').select('*').eq('id', partId).maybeSingle(),
    client
      .from('stock_movements_v')
      .select('*')
      .eq('part_id', partId)
      .order('at', { ascending: false })
      .limit(200),
  ])
  if (part.error) throw new Error(humanError(part.error))
  if (movs.error) throw new Error(humanError(movs.error))

  await db.transaction('rw', [db.parts, db.movements], async () => {
    if (part.data) await db.parts.put(toPart(part.data as Row))
    else await db.parts.delete(partId)
    await db.movements.where('partId').equals(partId).delete()
    await db.movements.bulkPut(rows(movs.data, toMovement))
  })
}

/** يعيد سحب فاتورة واحدة ببنودها — بعد مرتجع أو استرجاع يغيّر حالتها. */
export async function refreshInvoice(invoiceId: string): Promise<void> {
  const client = requireClient()
  const [inv, lines] = await Promise.all([
    client.from('invoices_v').select('*').eq('id', invoiceId).maybeSingle(),
    client.from('invoice_lines_v').select('*').eq('invoice_id', invoiceId),
  ])
  if (inv.error) throw new Error(humanError(inv.error))
  if (lines.error) throw new Error(humanError(lines.error))
  if (!inv.data) return
  const previous = await db.invoices.get(invoiceId)
  await db.invoices.put(
    toInvoice({ ...(inv.data as Row), invoice_lines: lines.data ?? [] }, previous),
  )
}

/** يسحب مرتجعاً واحداً ببنوده بعد إنشائه على الخادم. */
export async function refreshReturn(returnId: string): Promise<void> {
  const client = requireClient()
  const [ret, lines] = await Promise.all([
    client.from('returns_v').select('*').eq('id', returnId).maybeSingle(),
    client.from('return_lines_v').select('*').eq('return_id', returnId),
  ])
  if (ret.error) throw new Error(humanError(ret.error))
  if (lines.error) throw new Error(humanError(lines.error))
  if (!ret.data) return
  await db.returns.put(toReturnNote({ ...(ret.data as Row), return_lines: lines.data ?? [] }))
}

/**
 * نسخة احتياطية كاملة من **الخادم** لا من المرآة.
 *
 * المرآة ليست نسخة: دفتر الحركة فيها مقصوص عند `MOVEMENT_WINDOW`، وتُستبدل عند كل
 * إقلاع. النسخة هنا تُسحب جدولاً جدولاً على صفحات، والدفتر كاملاً بلا سقف.
 *
 * الصفوف تُحفظ كما هي في القاعدة (`snake_case`) لا بنماذج الواجهة: هكذا تُستعاد
 * إلى Postgres لاحقاً بلا ترجمة عكسية تُخطئ بصمت. والتكلفة تصل `null` لمن لا يملك
 * صلاحيتها — النسخة لا تكشف أكثر مما تكشفه الشاشات لنفس الحساب.
 */
export async function fetchBackup(): Promise<{ json: string; counts: Record<string, number> }> {
  const client = requireClient()
  const entries = await Promise.all(
    Object.entries(SOURCES).map(async ([name, src]) => [name, await selectAll(src)] as const),
  )
  const settings = await client.from('settings_v').select('*').eq('id', 'app').maybeSingle()
  if (settings.error) throw new Error(humanError(settings.error))

  const tables: Record<string, Row[]> = { settings: settings.data ? [settings.data as Row] : [] }
  for (const [name, r] of entries) {
    if (r.error) {
      // جداول المشتريات قد لا تكون طُبّقت بعد — غيابها ليس سبباً لإفشال النسخة كلها.
      if (isMissingSchema(r.error)) {
        tables[name] = []
        continue
      }
      throw new Error(humanError(r.error))
    }
    tables[name] = r.data ?? []
  }

  const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]))
  const json = JSON.stringify(
    { app: 'wedh7', source: 'server', version: 1, exportedAt: new Date().toISOString(), tables },
    null,
    1,
  )
  return { json, counts }
}
