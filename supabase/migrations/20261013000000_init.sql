-- ============================================================================
-- وضح — المخطّط الأساسي على Supabase/Postgres (ترحيل واحد لمشروع جديد)
--
-- مشتقّ من مخطّط «فيكس ستوك» لقطع الجوالات بعد نزع ما لا يخصّ معمل الحلويات
-- (الأجهزة، التوافق، السريال، درجات الجودة، شريحة الفنيين، الاستيراد من المتصفح)
-- وإضافة ما طلبه العميل: العينات على بند الفاتورة، والمرتجع الجزئي.
--
-- المبدأ الحاكم: مفتاح anon علني بحكم التصميم، فأي صلاحية تعيش في الواجهة فقط
-- هي صلاحية وهمية. كل قيد هنا مفروض داخل Postgres عبر RLS ودوال SECURITY DEFINER،
-- والواجهة لا تفعل أكثر من إخفاء ما تعرف القاعدة أصلاً أنه ممنوع.
--
-- ثلاث آليات مستخدمة، ولكلٍّ سبب:
--   1. RLS         → من يقرأ/يكتب أي صف.
--   2. مناظر (views) بإخفاء أعمدة → RLS تعمل على مستوى الصف لا العمود، والتكلفة
--                    والربح أعمدة يجب حجبها عن الموظف داخل صفوف يراها.
--   3. دوال SECURITY DEFINER → العمليات الذرّية (ترقيم الفواتير، خصم المخزون،
--                    إصدار فاتورة كاملة، مرتجع) لا يجوز أن تُجزَّأ من المتصفح.
-- ============================================================================

create schema if not exists app;

-- ============================================================================
-- 1) الهوية والصلاحيات
-- ============================================================================

create type public.user_role as enum ('owner', 'manager', 'cashier');

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  name         text not null,
  username     text not null unique,
  role         public.user_role not null default 'cashier',
  phone        text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  last_login_at timestamptz
);

comment on table public.profiles is 'ملف المستخدم — الدور هنا هو مصدر الحقيقة الوحيد للصلاحيات.';

-- مصفوفة الأدوار في القاعدة لا في الكود: تغيير صلاحية دور لا يحتاج إعادة نشر.
-- تطابق `ROLE_MATRIX` في src/lib/permissions.ts — اختلافهما يعني زرّاً يظهر ثم يُرفض.
create table public.role_capabilities (
  role       public.user_role not null,
  capability text not null,
  primary key (role, capability)
);

insert into public.role_capabilities (role, capability) values
  ('owner','inventory.view'),('owner','inventory.edit'),('owner','inventory.adjust'),
  ('owner','purchase.view'),('owner','purchase.edit'),('owner','purchase.receive'),
  ('owner','sales.create'),('owner','sales.refund'),
  ('owner','pricing.view'),('owner','pricing.edit'),
  ('owner','reports.view'),('owner','reports.financial'),
  ('owner','users.manage'),('owner','settings.manage'),('owner','ai.use'),

  ('manager','inventory.view'),('manager','inventory.edit'),('manager','inventory.adjust'),
  ('manager','purchase.view'),('manager','purchase.edit'),('manager','purchase.receive'),
  ('manager','sales.create'),('manager','sales.refund'),
  ('manager','pricing.view'),('manager','pricing.edit'),
  ('manager','reports.view'),('manager','reports.financial'),
  ('manager','ai.use'),

  ('cashier','inventory.view'),('cashier','sales.create'),('cashier','reports.view');

-- استثناءات على مستوى المستخدم: فروق عن مصفوفة الدور (true منح، false سحب).
-- لا صف = اتبع الدور. انظر `capOverrides` في الواجهة بنفس الدلالة الثلاثية.
create table public.user_capabilities (
  user_id    uuid    not null references public.profiles (id) on delete cascade,
  capability text    not null,
  granted    boolean not null,
  note       text,
  granted_by uuid    references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, capability)
);

comment on table public.user_capabilities is
  'فروق عن مصفوفة الدور لمستخدم بعينه. غياب الصف يعني: اتبع الدور.';

-- دوال المساعدة: SECURITY DEFINER حتى تقرأ profiles بغضّ النظر عن RLS، وإلا صار
-- التحقق من الدور يعتمد على سياسة تعتمد على التحقق من الدور (تكرار لا نهائي).
create or replace function app.user_role()
returns public.user_role
language sql stable security definer set search_path = public, pg_temp as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.active
$$;

-- الاستثناء يعلو على الدور: `coalesce` وحده لا يكفي، لا بد من التفريق بين «لا
-- يوجد صف» (اتبع الدور) و«يوجد صف قيمته false» (اسحبها رغم أن الدور يمنحها).
create or replace function app.has_cap(cap text)
returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  r  public.user_role := app.user_role();
  ov boolean;
begin
  if r is null then
    return false;
  end if;

  select uc.granted into ov
  from public.user_capabilities uc
  where uc.user_id = auth.uid() and uc.capability = cap;

  if ov is not null then
    return ov;
  end if;

  return exists (
    select 1 from public.role_capabilities rc
    where rc.role = r and rc.capability = cap
  );
end
$$;

create or replace function app.require_cap(cap text)
returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.has_cap(cap) then
    raise exception 'ليس لديك صلاحية: %', cap using errcode = '42501';
  end if;
end
$$;

-- ============================================================================
-- 2) البيانات المرجعية
-- ============================================================================

create type public.customer_type  as enum ('retail', 'wholesale');
create type public.movement_type  as enum ('purchase','sale','adjustment','return_in','return_out','damage');
create type public.po_status      as enum ('draft','ordered','partial','received','cancelled');
create type public.payment_method as enum ('cash','card','transfer','credit');
create type public.invoice_status as enum ('paid','unpaid','refunded');

-- المفاتيح نصّية لا uuid: تطابق معرّفات الواجهة فتبقى الكتابة من المتصفح بسيطة.
create table public.categories (
  id   text primary key,
  name text not null,
  default_markup_percent numeric(6,2) not null default 50,
  icon text
);

create table public.suppliers (
  id             text primary key,
  name           text not null,
  phone          text,
  city           text,
  lead_time_days int not null default 3 check (lead_time_days >= 0),
  notes          text
);

create table public.customers (
  id         text primary key,
  name       text not null,
  phone      text,
  type       public.customer_type not null default 'wholesale',
  vat_number text,
  notes      text,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 3) المنتجات والمخزون
--
-- الجدول اسمه `parts` كما في الأصل كي يبقى الفرق بين النسختين قابلاً للمقارنة؛
-- في الواجهة يُسمّى «منتج» أو «بوكس».
-- ============================================================================

create table public.parts (
  id                text primary key,
  sku               text not null unique,
  name              text not null,
  name_en           text,
  category_id       text references public.categories (id) on delete set null,
  supplier_id       text references public.suppliers (id) on delete set null,
  cost              numeric(12,2) not null default 0 check (cost >= 0),
  price_retail      numeric(12,2) not null default 0 check (price_retail >= 0),
  price_wholesale   numeric(12,2) not null default 0 check (price_wholesale >= 0),
  -- الرصيد لا يُكتب مباشرة أبداً؛ record_movement() وحدها تحرّكه.
  qty               int not null default 0 check (qty >= 0),
  reorder_point     int not null default 5 check (reorder_point >= 0),
  reorder_qty       int not null default 20 check (reorder_qty >= 1),
  lead_time_days    int not null default 2 check (lead_time_days >= 0),
  location          text,
  barcode           text unique,
  tax_rate          numeric(5,2) check (tax_rate is null or tax_rate between 0 and 100),
  notes             text,
  archived          boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on column public.parts.tax_rate is
  'نسبة ضريبة خاصة بالمنتج. `null` يعني اتبع نسبة المحل — وهو الغالب.';

create index parts_category_idx on public.parts (category_id) where not archived;
create index parts_supplier_idx on public.parts (supplier_id) where not archived;
create index parts_low_stock_idx on public.parts (qty) where not archived;

-- دفتر الحركة: مصدر الحقيقة. parts.qty مجرد نتيجة مُجمّعة قابلة لإعادة الاشتقاق.
create table public.stock_movements (
  id         bigint generated always as identity primary key,
  part_id    text not null references public.parts (id) on delete cascade,
  qty        int not null check (qty <> 0),
  type       public.movement_type not null,
  unit_cost  numeric(12,2),
  ref        text,
  note       text,
  user_id    uuid references public.profiles (id) on delete set null,
  at         timestamptz not null default now()
);

create index stock_movements_part_at_idx on public.stock_movements (part_id, at desc);
create index stock_movements_sale_idx on public.stock_movements (at desc) where type = 'sale';

-- ============================================================================
-- 4) التوريد
-- ============================================================================

create table public.purchase_orders (
  id          text primary key,
  code        text not null unique,
  supplier_id text not null references public.suppliers (id) on delete restrict,
  customer_id text references public.customers (id) on delete set null,
  status      public.po_status not null default 'draft',
  created_at  timestamptz not null default now(),
  expected_at timestamptz,
  received_at timestamptz,
  created_by  uuid references public.profiles (id) on delete set null,
  notes       text
);

create table public.purchase_order_lines (
  po_id        text not null references public.purchase_orders (id) on delete cascade,
  part_id      text not null references public.parts (id) on delete restrict,
  qty          int not null check (qty > 0),
  unit_cost    numeric(12,2) not null check (unit_cost >= 0),
  received_qty int not null default 0 check (received_qty >= 0),
  primary key (po_id, part_id),
  constraint received_not_over_ordered check (received_qty <= qty)
);

create index po_open_idx on public.purchase_orders (status) where status in ('ordered','partial');
create index purchase_orders_customer_idx on public.purchase_orders (customer_id) where customer_id is not null;

-- ============================================================================
-- 5) البيع والمرتجعات
-- ============================================================================

create table public.invoices (
  id            text primary key,
  number        text not null unique,
  customer_id   text references public.customers (id) on delete set null,
  customer_name text,
  customer_vat_number text,
  subtotal      numeric(12,2) not null default 0,
  discount      numeric(12,2) not null default 0 check (discount >= 0),
  vat_rate      numeric(5,2)  not null default 15,
  vat_amount    numeric(12,2) not null default 0,
  total         numeric(12,2) not null default 0,
  payment_method public.payment_method not null default 'transfer',
  status        public.invoice_status not null default 'paid',
  user_id       uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  refunded_at   timestamptz,
  notes         text
);

create index invoices_created_idx on public.invoices (created_at desc);
create index invoices_user_idx on public.invoices (user_id, created_at desc);
create index invoices_customer_idx on public.invoices (customer_id, created_at desc);

create table public.invoice_lines (
  id         bigint generated always as identity primary key,
  invoice_id text not null references public.invoices (id) on delete cascade,
  part_id    text references public.parts (id) on delete set null,
  -- لقطات وقت البيع: تغيير اسم المنتج أو تكلفته لاحقاً يجب ألا يعيد كتابة التاريخ.
  name       text not null,
  sku        text not null,
  -- الكمية المحاسَبة. قد تكون صفراً حين يكون البند هدية خالصة مع فاتورة فيها بنود أخرى.
  qty        int not null check (qty >= 0),
  -- عينات/هدايا تُسلَّم مع البند بلا مقابل: تُخصم من المخزون وتُحسب تكلفتها
  -- ولا تدخل في الإيراد. «يأخذ ١١ والفاتورة على ١٠» = qty 10, free_qty 1.
  free_qty   int not null default 0 check (free_qty >= 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  unit_cost  numeric(12,2) not null default 0,
  discount   numeric(12,2) not null default 0,
  -- لقطة النسبة المطبَّقة لحظة البيع.
  tax_rate   numeric(5,2) not null default 0,
  constraint line_has_units check (qty + free_qty > 0)
);

create index invoice_lines_invoice_idx on public.invoice_lines (invoice_id);
create index invoice_lines_part_idx on public.invoice_lines (part_id);

-- المرتجع الجزئي: إشعار دائن على فاتورة قائمة. الفاتورة الأصل لا تُمسّ؛ التقارير
-- وكشف الحساب يخصمان هذه الورقة منها.
create table public.returns (
  id             text primary key,
  number         text not null unique,
  invoice_id     text not null references public.invoices (id) on delete restrict,
  invoice_number text not null,
  customer_id    text references public.customers (id) on delete set null,
  customer_name  text,
  subtotal       numeric(12,2) not null default 0,
  vat_amount     numeric(12,2) not null default 0,
  total          numeric(12,2) not null default 0,
  -- هل عادت البوكسات إلى الرفّ؟ المنتهي صلاحيته لا يعود — خرج عند البيع ولم يرجع.
  restock        boolean not null default false,
  reason         text,
  user_id        uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);

create index returns_invoice_idx on public.returns (invoice_id);
create index returns_customer_idx on public.returns (customer_id, created_at desc);
create index returns_created_idx on public.returns (created_at desc);

create table public.return_lines (
  id         bigint generated always as identity primary key,
  return_id  text not null references public.returns (id) on delete cascade,
  part_id    text references public.parts (id) on delete set null,
  name       text not null,
  sku        text not null,
  qty        int not null check (qty > 0),
  -- صافي سعر الوحدة بعد حصة البند من خصم الفاتورة — ما يُردّ عن كل وحدة قبل الضريبة.
  unit_price numeric(12,2) not null check (unit_price >= 0),
  unit_cost  numeric(12,2) not null default 0,
  tax_rate   numeric(5,2) not null default 0
);

create index return_lines_return_idx on public.return_lines (return_id);

-- ============================================================================
-- 6) الإعدادات والعدّادات والتدقيق
-- ============================================================================

create table public.settings (
  id             text primary key default 'app' check (id = 'app'),
  shop_name      text not null default 'وضح للحلويات',
  shop_name_en   text,
  vat_number     text not null default '',
  cr_number      text not null default '',
  address        text not null default '',
  phone          text not null default '',
  currency       text not null default 'SAR',
  vat_rate       numeric(5,2) not null default 15 check (vat_rate between 0 and 100),
  -- مفتاح الضريبة العام. إطفاؤه يجعل كل بند صفراً مهما كانت نسبته الخاصة.
  vat_enabled    boolean not null default true,
  zatca_qr       boolean not null default true,
  invoice_prefix text not null default 'INV-',
  po_prefix      text not null default 'PO-',
  return_prefix  text not null default 'RET-',
  ai_provider    text not null default 'none',
  ai_model       text not null default 'deepseek-chat'
);

insert into public.settings (id) values ('app');

-- الترقيم في جدول مستقل تحت قفل صفّي: جهازان يبيعان في نفس اللحظة لا يولّدان نفس الرقم.
create table public.counters (
  kind  text primary key,
  value bigint not null default 1
);
insert into public.counters (kind, value) values ('invoice', 1), ('po', 1), ('return', 1);

create table public.audit_log (
  id        bigint generated always as identity primary key,
  user_id   uuid references public.profiles (id) on delete set null,
  user_name text not null,
  action    text not null,
  entity    text not null,
  entity_id text,
  details   text,
  at        timestamptz not null default now()
);

create index audit_log_at_idx on public.audit_log (at desc);

-- ============================================================================
-- 7) حرّاس الحسابات
-- ============================================================================

-- أول حساب في القاعدة هو المالك. ما بعده موظف حتى يرفعه صاحب الصلاحية.
-- الدور لا يُقرأ من البيانات الواردة إطلاقاً: من يسجّل يتحكم بها، فقراءتها تعني
-- أن أي شخص يفتح صفحة التسجيل يصير مالكاً.
create or replace function app.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare
  meta      jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  uname     text;
  base      text;
  suffix    int := 0;
  is_first  boolean;
begin
  base := lower(coalesce(nullif(meta->>'username', ''), split_part(new.email, '@', 1)));
  base := regexp_replace(base, '[^a-z0-9_]', '', 'g');
  if base = '' then base := 'user'; end if;

  -- اسم المستخدم فريد: نضيف رقماً بدل أن نُفشل التسجيل بخطأ تعارض.
  uname := base;
  while exists (select 1 from public.profiles p where p.username = uname) loop
    suffix := suffix + 1;
    uname := base || suffix::text;
  end loop;

  select not exists (select 1 from public.profiles) into is_first;

  insert into public.profiles (id, name, username, role, phone)
  values (
    new.id,
    coalesce(nullif(meta->>'name', ''), uname),
    uname,
    case when is_first then 'owner'::public.user_role else 'cashier'::public.user_role end,
    nullif(meta->>'phone', '')
  );

  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- تُنادى من الواجهة بعد نجاح الدخول. دالة مستقلة لأن `profiles_update` تشترط
-- `users.manage`، ولا نريد أن يملك كل موظف صلاحية تعديل الملفات لمجرد تسجيل وقت دخوله.
create or replace function public.touch_last_login()
returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.profiles set last_login_at = now() where id = auth.uid()
$$;

-- RLS تعمل على الصفوف لا الأعمدة، فسياسة «عدّل صفّك» وحدها تعني «رقِّ نفسك إلى مالك».
create or replace function app.guard_profile_privileges()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (new.role, new.active, new.username) is distinct from (old.role, old.active, old.username)
     and not app.has_cap('users.manage') then
    raise exception 'تغيير الدور أو الحالة يحتاج صلاحية إدارة المستخدمين'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger profiles_guard_privileges
  before update on public.profiles
  for each row execute function app.guard_profile_privileges();

-- لا يعدّل أحدٌ استثناءات نفسه ولو ملك «إدارة المستخدمين».
create or replace function app.guard_self_capability()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  target uuid := coalesce(new.user_id, old.user_id);
begin
  if target = auth.uid() then
    raise exception 'ما تقدر تعدّل استثناءات صلاحياتك أنت — لازم شخص آخر يملك إدارة المستخدمين'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end
$$;

create trigger guard_self_capability
  before insert or update or delete on public.user_capabilities
  for each row execute function app.guard_self_capability();

-- حارس القفل الخارج: سحب «إدارة المستخدمين» من آخر حساب نشط يملكها يقفل النظام.
create or replace function app.managers_after_change(
  changed_user uuid,
  new_role     public.user_role,
  new_active   boolean,
  new_override boolean  -- null = لا استثناء
) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int
  from public.profiles p
  left join public.user_capabilities uc
    on uc.user_id = p.id and uc.capability = 'users.manage'
  where
    case when p.id = changed_user then new_active else p.active end
    and coalesce(
      case when p.id = changed_user then new_override else uc.granted end,
      exists (
        select 1 from public.role_capabilities rc
        where rc.role = case when p.id = changed_user then new_role else p.role end
          and rc.capability = 'users.manage'
      )
    )
$$;

create or replace function app.guard_last_manager()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  target   uuid;
  n_role   public.user_role;
  n_active boolean;
  n_over   boolean;
begin
  if tg_table_name = 'profiles' then
    target := new.id; n_role := new.role; n_active := new.active;
    select uc.granted into n_over from public.user_capabilities uc
      where uc.user_id = target and uc.capability = 'users.manage';
  else
    target := coalesce(new.user_id, old.user_id);
    select p.role, p.active into n_role, n_active from public.profiles p where p.id = target;
    if tg_op = 'DELETE' or new.capability is distinct from 'users.manage' then
      n_over := null;
    else
      n_over := new.granted;
    end if;
  end if;

  if app.managers_after_change(target, n_role, n_active, n_over) = 0 then
    raise exception 'لازم يبقى حساب نشط واحد على الأقل يملك إدارة المستخدمين'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end
$$;

create trigger guard_last_manager
  after update on public.profiles
  for each row execute function app.guard_last_manager();

create trigger guard_last_manager
  after insert or update or delete on public.user_capabilities
  for each row execute function app.guard_last_manager();

-- ============================================================================
-- 8) العمليات الذرّية
-- ============================================================================

create or replace function app.next_number(p_kind text)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_next   bigint;
  v_prefix text;
  v_width  int;
begin
  update public.counters set value = value + 1
   where kind = p_kind
  returning value - 1 into v_next;

  if v_next is null then
    raise exception 'عدّاد غير معروف: %', p_kind;
  end if;

  select case p_kind
           when 'invoice' then invoice_prefix
           when 'return'  then return_prefix
           else po_prefix
         end
    into v_prefix from public.settings where id = 'app';

  v_width := case p_kind when 'invoice' then 5 else 4 end;
  return v_prefix || lpad(v_next::text, v_width, '0');
end
$$;

-- خصم/إضافة مخزون + تحديث التكلفة بالمتوسط المرجّح + قيد في الدفتر، في معاملة واحدة.
create or replace function public.record_movement(
  p_part_id   text,
  p_qty       int,
  p_type      public.movement_type,
  p_unit_cost numeric default null,
  p_ref       text default null,
  p_note      text default null
) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_part   public.parts%rowtype;
  v_cost   numeric(12,2);
  v_id     bigint;
begin
  if p_qty = 0 then
    raise exception 'الكمية لا تكون صفراً';
  end if;

  perform app.require_cap(
    case
      when p_type = 'sale'     then 'sales.create'
      when p_type = 'purchase' then 'inventory.adjust'
      else 'inventory.adjust'
    end
  );

  -- القفل يمنع سباق بين جهازين يبيعان آخر بوكس في نفس اللحظة.
  select * into v_part from public.parts where id = p_part_id for update;
  if not found then
    raise exception 'المنتج غير موجود: %', p_part_id;
  end if;

  if v_part.qty + p_qty < 0 then
    raise exception 'الرصيد غير كافٍ: المتاح % والمطلوب %', v_part.qty, abs(p_qty)
      using errcode = '23514';
  end if;

  v_cost := v_part.cost;
  if p_qty > 0 and p_unit_cost is not null then
    v_cost := case
      when v_part.qty + p_qty > 0
        then round(((v_part.qty * v_part.cost) + (p_qty * p_unit_cost)) / (v_part.qty + p_qty), 2)
      else p_unit_cost
    end;
  end if;

  update public.parts
     set qty = qty + p_qty, cost = v_cost, updated_at = now()
   where id = p_part_id;

  insert into public.stock_movements (part_id, qty, type, unit_cost, ref, note, user_id)
  values (p_part_id, p_qty, p_type, p_unit_cost, p_ref, p_note, auth.uid())
  returning id into v_id;

  return v_id;
end
$$;

-- إصدار فاتورة كاملة: رقم + رأس + بنود + حركات، كلها أو لا شيء.
-- p_lines: [{"part_id":"…","qty":10,"free_qty":1,"unit_price":57.6,"discount":0}]
-- الضريبة لكل بند بنسبته (مفتاح المحل يغلب، ثم نسبة المنتج، ثم نسبة المحل)، وحصة
-- البند من خصم الفاتورة بالتناسب مع قيمته. العينات تُخصم من الرصيد بلا سعر.
create or replace function public.create_sale(
  p_customer_id    text,
  p_payment_method public.payment_method,
  p_discount       numeric,
  p_lines          jsonb,
  p_notes          text default null
) returns public.invoices
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_line      jsonb;
  v_part      public.parts%rowtype;
  v_invoice   public.invoices%rowtype;
  v_id        text;
  v_number    text;
  v_qty       int;
  v_free      int;
  v_subtotal  numeric(12,2) := 0;
  v_line_disc numeric(12,2) := 0;
  v_discount  numeric(12,2);
  v_net       numeric(12,2);
  v_vat_rate  numeric(5,2);
  v_vat_on    boolean;
  v_vat       numeric(12,2) := 0;
  v_gross     numeric(12,2);
  v_line_net  numeric(12,2);
  v_rate      numeric(5,2);
  v_customer  public.customers%rowtype;
  v_billed    int := 0;
begin
  perform app.require_cap('sales.create');

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'الفاتورة بدون بنود';
  end if;

  select vat_rate, vat_enabled into v_vat_rate, v_vat_on
    from public.settings where id = 'app';
  select * into v_customer from public.customers where id = p_customer_id;

  v_id     := 'inv_' || replace(gen_random_uuid()::text, '-', '');
  v_number := app.next_number('invoice');

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_part from public.parts where id = v_line->>'part_id';
    if not found then
      raise exception 'المنتج غير موجود: %', v_line->>'part_id';
    end if;
    v_qty  := coalesce((v_line->>'qty')::int, 0);
    v_free := coalesce((v_line->>'free_qty')::int, 0);
    if v_qty < 0 or v_free < 0 or v_qty + v_free = 0 then
      raise exception 'كمية غير صالحة للبند %', v_part.name;
    end if;
    v_billed    := v_billed + v_qty;
    v_subtotal  := v_subtotal  + v_qty * (v_line->>'unit_price')::numeric;
    v_line_disc := v_line_disc + coalesce((v_line->>'discount')::numeric, 0);
  end loop;

  -- فاتورة كلها هدايا ليست فاتورة: تُسجَّل تسوية «عينات» من بطاقة المنتج.
  if v_billed = 0 then
    raise exception 'الفاتورة بلا بند محاسَب — سجّل العينات الخالصة كتسوية مخزون';
  end if;

  v_discount := least(v_subtotal, v_line_disc + coalesce(p_discount, 0));
  v_net      := round(v_subtotal - v_discount, 2);

  -- الفاتورة تُدرَج أولاً بضريبة صفر، ثم تُحدَّث بعد جمع ضرائب البنود: نسبة
  -- البند تُقرأ من المنتج ولا تُعرف قبل المرور عليها.
  insert into public.invoices (
    id, number, customer_id, customer_name, customer_vat_number,
    subtotal, discount, vat_rate, vat_amount, total,
    payment_method, status, user_id, notes
  ) values (
    v_id, v_number, p_customer_id, v_customer.name, v_customer.vat_number,
    round(v_subtotal, 2), v_discount,
    case when v_vat_on then v_vat_rate else 0 end, 0, v_net,
    p_payment_method, 'paid', auth.uid(), p_notes
  ) returning * into v_invoice;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_part from public.parts where id = v_line->>'part_id';
    v_qty  := coalesce((v_line->>'qty')::int, 0);
    v_free := coalesce((v_line->>'free_qty')::int, 0);

    v_rate := case when not v_vat_on then 0 else coalesce(v_part.tax_rate, v_vat_rate) end;

    v_gross    := v_qty * (v_line->>'unit_price')::numeric;
    v_line_net := round(
      v_gross - (case when v_subtotal > 0 then v_discount * v_gross / v_subtotal else 0 end), 2);
    v_vat      := v_vat + round(v_line_net * v_rate / 100, 2);

    insert into public.invoice_lines (
      invoice_id, part_id, name, sku, qty, free_qty, unit_price, unit_cost, discount, tax_rate
    ) values (
      v_id, v_part.id, v_part.name, v_part.sku,
      v_qty, v_free, (v_line->>'unit_price')::numeric,
      v_part.cost, coalesce((v_line->>'discount')::numeric, 0), v_rate
    );

    -- المحاسَب والهدايا يخرجان معاً من الرفّ — حركة واحدة بالمجموع، والعينات في الملاحظة.
    perform public.record_movement(
      v_part.id, -(v_qty + v_free), 'sale', null, v_number,
      case when v_free > 0 then 'منها ' || v_free || ' عينة' else null end
    );
  end loop;

  -- جمع ضرائب البنود المدوَّرة قد يخالف تدوير الإجمالي بهللة. هذا مقصود: ما يُطبع
  -- على البنود يجب أن يساوي ما يُطبع في الإجمالي — وإلا شكّ الزبون في الفاتورة.
  update public.invoices
     set vat_amount = v_vat, total = round(v_net + v_vat, 2)
   where id = v_id
  returning * into v_invoice;

  return v_invoice;
end
$$;

-- مرتجع جزئي: إشعار دائن على فاتورة قائمة.
-- p_lines: [{"part_id":"…","qty":5}]  — الكمية من المحاسَب في الفاتورة، لا من الهدايا.
-- صافي سعر الوحدة = سعر البند × (١ − خصم الفاتورة ÷ مجموعها)، وهي نفس معادلة
-- `returnUnitPrice` في الواجهة فيتطابق ما يُعرض قبل التسجيل مع ما يُسجَّل.
create or replace function public.create_return(
  p_invoice_id text,
  p_lines      jsonb,
  p_restock    boolean default false,
  p_reason     text default null
) returns public.returns
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_inv      public.invoices%rowtype;
  v_src      public.invoice_lines%rowtype;
  v_ret      public.returns%rowtype;
  v_line     jsonb;
  v_qty      int;
  v_already  int;
  v_unit     numeric(12,2);
  v_sub      numeric(12,2) := 0;
  v_vat      numeric(12,2) := 0;
  v_id       text;
  v_number   text;
  v_count    int := 0;
begin
  perform app.require_cap('sales.refund');

  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'الفاتورة غير موجودة';
  end if;
  if v_inv.status = 'refunded' then
    raise exception 'الفاتورة مسترجعة بالكامل أصلاً';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'المرتجع بدون بنود';
  end if;

  v_id     := 'ret_' || replace(gen_random_uuid()::text, '-', '');
  v_number := app.next_number('return');

  insert into public.returns (
    id, number, invoice_id, invoice_number, customer_id, customer_name,
    subtotal, vat_amount, total, restock, reason, user_id
  ) values (
    v_id, v_number, v_inv.id, v_inv.number, v_inv.customer_id, v_inv.customer_name,
    0, 0, 0, coalesce(p_restock, false), nullif(trim(p_reason), ''), auth.uid()
  );

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := coalesce((v_line->>'qty')::int, 0);
    continue when v_qty <= 0;

    select * into v_src from public.invoice_lines
     where invoice_id = v_inv.id and part_id = v_line->>'part_id'
     order by id limit 1;
    if not found then
      raise exception 'البند ليس في الفاتورة الأصل: %', v_line->>'part_id';
    end if;

    select coalesce(sum(rl.qty), 0) into v_already
      from public.return_lines rl
      join public.returns r on r.id = rl.return_id
     where r.invoice_id = v_inv.id and rl.part_id = v_src.part_id and r.id <> v_id;

    if v_qty > v_src.qty - v_already then
      raise exception '«%»: المتاح للإرجاع % فقط', v_src.name, v_src.qty - v_already
        using errcode = '23514';
    end if;

    v_unit := case when v_inv.subtotal > 0
                   then round(v_src.unit_price * (1 - v_inv.discount / v_inv.subtotal), 2)
                   else v_src.unit_price end;

    insert into public.return_lines (return_id, part_id, name, sku, qty, unit_price, unit_cost, tax_rate)
    values (v_id, v_src.part_id, v_src.name, v_src.sku, v_qty, v_unit, v_src.unit_cost, v_src.tax_rate);

    v_sub := v_sub + round(v_unit * v_qty, 2);
    v_vat := v_vat + round(v_unit * v_qty * v_src.tax_rate / 100, 2);
    v_count := v_count + 1;

    -- الصالح يعود إلى الرفّ؛ المنتهي صلاحيته خرج عند البيع ولم يرجع — لا حركة له.
    if coalesce(p_restock, false) and v_src.part_id is not null then
      perform public.record_movement(
        v_src.part_id, v_qty, 'return_in', null, v_number, 'مرتجع من ' || v_inv.number
      );
    end if;
  end loop;

  if v_count = 0 then
    raise exception 'حدّد كمية مرتجعة لبند واحد على الأقل';
  end if;

  update public.returns
     set subtotal = v_sub, vat_amount = v_vat, total = round(v_sub + v_vat, 2)
   where id = v_id
  returning * into v_ret;

  return v_ret;
end
$$;

-- استرجاع فاتورة بالكامل: يعيد الكميات (والهدايا) ويعلّم الفاتورة، ولا يحذف شيئاً.
-- يُرفض إن كان عليها مرتجع جزئي — وإلا رُدّ المال مرتين.
create or replace function public.refund_invoice(p_invoice_id text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_inv  public.invoices%rowtype;
  v_line public.invoice_lines%rowtype;
begin
  perform app.require_cap('sales.refund');

  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'الفاتورة غير موجودة';
  end if;
  if v_inv.status = 'refunded' then
    raise exception 'الفاتورة مسترجعة مسبقاً';
  end if;
  if exists (select 1 from public.returns where invoice_id = p_invoice_id) then
    raise exception 'على هذه الفاتورة مرتجع جزئي — لا يمكن استرجاعها بالكامل';
  end if;

  for v_line in select * from public.invoice_lines where invoice_id = p_invoice_id loop
    if v_line.part_id is not null then
      perform public.record_movement(
        v_line.part_id, v_line.qty + v_line.free_qty, 'return_in', null, v_inv.number, 'استرجاع فاتورة'
      );
    end if;
  end loop;

  update public.invoices
     set status = 'refunded', refunded_at = now()
   where id = p_invoice_id;
end
$$;

-- استلام توريد: يحرّك المخزون ويحدّث حالة الطلب.
-- p_lines: [{"part_id":"…","qty":5}]
create or replace function public.receive_purchase(p_po_id text, p_lines jsonb)
returns public.po_status
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_po       public.purchase_orders%rowtype;
  v_line     jsonb;
  v_pol      public.purchase_order_lines%rowtype;
  v_accept   int;
  v_status   public.po_status;
begin
  perform app.require_cap('purchase.receive');

  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if not found then
    raise exception 'طلب التوريد غير موجود: %', p_po_id;
  end if;
  if v_po.status not in ('ordered', 'partial') then
    raise exception 'لا يمكن الاستلام على طلب حالته %', v_po.status;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_pol from public.purchase_order_lines
     where po_id = p_po_id and part_id = v_line->>'part_id' for update;
    continue when not found;

    v_accept := least((v_line->>'qty')::int, v_pol.qty - v_pol.received_qty);
    continue when v_accept <= 0;

    perform public.record_movement(
      v_pol.part_id, v_accept, 'purchase', v_pol.unit_cost, v_po.code, null
    );

    update public.purchase_order_lines
       set received_qty = received_qty + v_accept
     where po_id = p_po_id and part_id = v_pol.part_id;
  end loop;

  select case when bool_and(received_qty >= qty) then 'received' else 'partial' end
    into v_status
    from public.purchase_order_lines where po_id = p_po_id;

  update public.purchase_orders
     set status = v_status,
         received_at = case when v_status = 'received' then now() else null end
   where id = p_po_id;

  return v_status;
end
$$;

-- ============================================================================
-- 9) RLS — كل جدول مقفول افتراضياً
-- ============================================================================

alter table public.profiles             enable row level security;
alter table public.role_capabilities    enable row level security;
alter table public.user_capabilities    enable row level security;
alter table public.categories           enable row level security;
alter table public.suppliers            enable row level security;
alter table public.customers            enable row level security;
alter table public.parts                enable row level security;
alter table public.stock_movements      enable row level security;
alter table public.purchase_orders      enable row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.invoices             enable row level security;
alter table public.invoice_lines        enable row level security;
alter table public.returns              enable row level security;
alter table public.return_lines         enable row level security;
alter table public.settings             enable row level security;
alter table public.counters             enable row level security;
alter table public.audit_log            enable row level security;

create policy profiles_read   on public.profiles for select using (app.user_role() is not null);
create policy profiles_insert on public.profiles for insert with check (app.has_cap('users.manage'));
create policy profiles_update on public.profiles for update using (app.has_cap('users.manage'));
create policy profiles_self   on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy caps_read on public.role_capabilities for select using (app.user_role() is not null);

create policy ucaps_read on public.user_capabilities
  for select using (app.has_cap('users.manage') or user_id = auth.uid());
create policy ucaps_write on public.user_capabilities
  for all using (app.has_cap('users.manage')) with check (app.has_cap('users.manage'));

create policy cats_read  on public.categories for select using (app.has_cap('inventory.view'));
create policy cats_write on public.categories for all    using (app.has_cap('inventory.edit'))  with check (app.has_cap('inventory.edit'));
create policy sup_read   on public.suppliers  for select using (app.has_cap('purchase.view'));
create policy sup_write  on public.suppliers  for all    using (app.has_cap('purchase.edit'))   with check (app.has_cap('purchase.edit'));
create policy cust_read  on public.customers  for select using (app.has_cap('sales.create'));
create policy cust_write on public.customers  for all    using (app.has_cap('sales.create'))    with check (app.has_cap('sales.create'));

-- parts: التكلفة محجوبة على مستوى صلاحية العمود (قسم ١١)، فالقراءة المباشرة من
-- الجدول آمنة ومطلوبة — بدونها يفشل أي UPDATE ... WHERE id = ? لعجزه عن قراءة id.
create policy parts_read   on public.parts for select using (app.has_cap('inventory.view'));
create policy parts_insert on public.parts for insert with check (app.has_cap('inventory.edit'));
create policy parts_update on public.parts for update using (app.has_cap('inventory.edit') or app.has_cap('pricing.edit'));
create policy parts_delete on public.parts for delete using (app.has_cap('inventory.edit'));

-- الحركات تُقرأ فقط؛ الإدخال حصراً عبر record_movement().
create policy movements_read on public.stock_movements for select using (app.has_cap('inventory.view'));

create policy po_read  on public.purchase_orders for select using (app.has_cap('purchase.view'));
create policy po_write on public.purchase_orders for all using (app.has_cap('purchase.edit')) with check (app.has_cap('purchase.edit'));
create policy pol_read  on public.purchase_order_lines for select using (app.has_cap('purchase.view'));
create policy pol_write on public.purchase_order_lines for all using (app.has_cap('purchase.edit')) with check (app.has_cap('purchase.edit'));

-- الفواتير والمرتجعات: لا سياسة قراءة على الجداول لأن SELECT مسحوب منها أصلاً
-- (قسم ١١)؛ القراءة عبر المناظر، والإنشاء عبر الدوال حصراً.

create policy settings_read   on public.settings for select using (app.user_role() is not null);
create policy settings_update on public.settings for update using (app.has_cap('settings.manage')) with check (app.has_cap('settings.manage'));

-- counters: لا سياسة إطلاقاً — لا أحد يلمسها إلا عبر app.next_number().

create policy audit_insert on public.audit_log for insert with check (app.user_role() is not null);
create policy audit_read   on public.audit_log for select using (app.has_cap('users.manage'));

-- ============================================================================
-- 10) المناظر — إخفاء الأعمدة الحسّاسة داخل صفوف مسموح بها
--
-- RLS لا تعرف الأعمدة، وصلاحيات الأعمدة في Postgres لكل دور قاعدة بيانات لا لكل
-- مستخدم — والجميع هنا دورهم authenticated. فالمناظر هي الوسيلة الوحيدة الصحيحة.
-- المناظر SECURITY DEFINER (تتجاوز RLS للجدول)، لذلك شرط الصف مُعاد صراحةً في WHERE.
-- ============================================================================

create view public.parts_v with (security_invoker = false) as
select
  p.id, p.sku, p.name, p.name_en, p.category_id, p.supplier_id, p.tax_rate,
  case when app.has_cap('pricing.view') then p.cost end as cost,
  p.price_retail, p.price_wholesale,
  p.qty, p.reorder_point, p.reorder_qty, p.lead_time_days,
  p.location, p.barcode, p.notes, p.archived,
  p.created_at, p.updated_at
from public.parts p
where app.has_cap('inventory.view');

create view public.invoices_v with (security_invoker = false) as
select
  i.id, i.number, i.customer_id, i.customer_name, i.customer_vat_number,
  i.subtotal, i.discount, i.vat_rate, i.vat_amount, i.total,
  i.payment_method, i.status, i.user_id, i.created_at, i.refunded_at, i.notes
from public.invoices i
where app.has_cap('reports.view') or i.user_id = auth.uid();

create view public.invoice_lines_v with (security_invoker = false) as
select
  l.id, l.invoice_id, l.part_id, l.name, l.sku, l.qty, l.free_qty, l.unit_price,
  case when app.has_cap('reports.financial') then l.unit_cost end as unit_cost,
  l.discount, l.tax_rate
from public.invoice_lines l
join public.invoices i on i.id = l.invoice_id
where app.has_cap('reports.view') or i.user_id = auth.uid();

create view public.returns_v with (security_invoker = false) as
select
  r.id, r.number, r.invoice_id, r.invoice_number, r.customer_id, r.customer_name,
  r.subtotal, r.vat_amount, r.total, r.restock, r.reason, r.user_id, r.created_at
from public.returns r
join public.invoices i on i.id = r.invoice_id
where app.has_cap('reports.view') or i.user_id = auth.uid() or r.user_id = auth.uid();

create view public.return_lines_v with (security_invoker = false) as
select
  l.id, l.return_id, l.part_id, l.name, l.sku, l.qty, l.unit_price,
  case when app.has_cap('reports.financial') then l.unit_cost end as unit_cost,
  l.tax_rate
from public.return_lines l
join public.returns r on r.id = l.return_id
join public.invoices i on i.id = r.invoice_id
where app.has_cap('reports.view') or i.user_id = auth.uid() or r.user_id = auth.uid();

create view public.stock_movements_v with (security_invoker = false) as
select
  m.id, m.part_id, m.qty, m.type,
  case when app.has_cap('pricing.view') then m.unit_cost end as unit_cost,
  m.ref, m.note, m.user_id, m.at
from public.stock_movements m
where app.has_cap('inventory.view');

create view public.settings_v with (security_invoker = false) as
select
  s.id, s.shop_name, s.shop_name_en, s.vat_number, s.cr_number, s.address,
  s.phone, s.currency, s.vat_rate, s.vat_enabled, s.zatca_qr,
  s.invoice_prefix, s.po_prefix, s.return_prefix, s.ai_provider, s.ai_model
from public.settings s
where app.user_role() is not null;

-- ============================================================================
-- 11) الصلاحيات على مستوى Postgres
--
-- سحب SELECT من الجداول الحسّاسة هو ما يجعل حجب الأعمدة حقيقياً: بدونه يستطيع أي
-- عميل تجاوز المنظر والاستعلام من الجدول مباشرة.
-- ملاحظة للواجهة: لا تُلحق .select() بعد insert/update على هذه الجداول، وإلا رفضت
-- القاعدة العملية لغياب صلاحية القراءة.
-- ============================================================================

revoke all on all tables in schema public from anon, authenticated;

grant usage on schema public, app to anon, authenticated;

grant select on
  public.profiles, public.role_capabilities, public.categories,
  public.suppliers, public.customers,
  public.purchase_orders, public.purchase_order_lines, public.settings
to authenticated;

-- كل أعمدة parts ما عدا cost. صلاحية العمود هي الحاجز الحقيقي أمام التكلفة.
-- ⚠️ أي عمود جديد على parts يُضاف هنا وفي parts_v معاً، وإلا لم يُقرأ.
grant select (
  id, sku, name, name_en, category_id, supplier_id,
  price_retail, price_wholesale,
  qty, reorder_point, reorder_qty, lead_time_days,
  location, barcode, tax_rate, notes, archived, created_at, updated_at
) on public.parts to authenticated;

grant insert, update, delete on
  public.categories, public.suppliers, public.customers,
  public.purchase_orders, public.purchase_order_lines, public.parts, public.profiles,
  public.user_capabilities
to authenticated;
grant select on public.user_capabilities to authenticated;

grant insert on public.audit_log to authenticated;
grant select on public.audit_log to authenticated;
grant update on public.settings to authenticated;

-- القراءة الحسّاسة عبر المناظر فقط.
grant select on
  public.parts_v, public.invoices_v, public.invoice_lines_v,
  public.returns_v, public.return_lines_v,
  public.stock_movements_v, public.settings_v
to authenticated;

grant execute on function
  public.record_movement(text, int, public.movement_type, numeric, text, text),
  public.create_sale(text, public.payment_method, numeric, jsonb, text),
  public.create_return(text, jsonb, boolean, text),
  public.receive_purchase(text, jsonb),
  public.refund_invoice(text),
  public.touch_last_login(),
  app.has_cap(text)
to authenticated;

-- الزائر غير المسجّل لا يرى شيئاً.
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public, app from anon;
