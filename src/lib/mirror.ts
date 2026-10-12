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
import { humanError, requireClient } from './supabase'
import {
  toCategory,
  toCustomer,
  toInvoice,
  toMovement,
  toPart,
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

  const [cats, sups, custs, parts, movs, invs, invLines, rets, retLines, pos, settings, profiles] =
    await Promise.all([
      client.from('categories').select('*'),
      client.from('suppliers').select('*'),
      client.from('customers').select('*'),
      client.from('parts_v').select('*'),
      client
        .from('stock_movements_v')
        .select('*')
        .order('at', { ascending: false })
        .limit(MOVEMENT_WINDOW),
      client.from('invoices_v').select('*'),
      client.from('invoice_lines_v').select('*'),
      client.from('returns_v').select('*'),
      client.from('return_lines_v').select('*'),
      client.from('purchase_orders').select('*, purchase_order_lines(*)'),
      client.from('settings_v').select('*').eq('id', 'app').maybeSingle(),
      client.from('profiles').select('*'),
    ])

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
