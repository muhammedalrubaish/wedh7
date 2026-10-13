-- ============================================================================
-- فواتير المشتريات — كل ما يُصرف عليه المعمل غير البوكسات نفسها:
--   مكونات (زبدة، قشطة، جبن، كريمة خفق) · تغليف (كرتون، علب) ·
--   أدوات ومعدات (فرن، صينية، ميكسر) · مصاريف (إيجار، كهرباء).
--
-- لماذا جداول مستقلة لا `purchase_orders`: طلبات التوريد تشتري **منتجات** تدخل
-- رصيد البيع (`parts`)، وهذه الأصناف لا تُباع ولا تُعدّ على الرفّ. لو سُجّلت
-- منتجاتٍ لظهرت «قشطة» و«إيجار» في شاشة الفاتورة بجانب البوكسات.
--
-- النوع (`kind`) على الصنف لأن العميل طلب أن «يحدد نوعه»: الفرن يُشترى مرة،
-- والقشطة كل أسبوع، والإيجار كل شهر — جمعها في رقم واحد يضلّل قراءة الشهر.
--
-- ما يحفظه: من أين اشترى، ومتى، وكل بند (الصنف، الكمية، الوحدة، سعر الوحدة).
-- ما لا يفعله: لا رصيد للأصناف ولا حركة مخزون — إجمالي الصرف فقط.
--
-- إضافي بالكامل: لا يمسّ أي جدول أو سياسة أو دالة من الترحيل الأول. وآمن لإعادة
-- التشغيل (`if not exists` و`drop policy if exists`) لأن صاحب المحل يلصقه يدوياً
-- في SQL Editor، والتشغيل المزدوج خطأ وارد لا افتراض نظري.
-- ============================================================================

create table if not exists public.purchase_items (
  id         text primary key,
  name       text not null check (btrim(name) <> ''),
  kind       text not null default 'ingredient'
             check (kind in ('ingredient', 'packaging', 'equipment', 'expense')),
  -- الوحدة الافتراضية للصنف؛ البند يستطيع تجاوزها (قشطة بالعلبة مرة وبالكرتون مرة)
  unit       text not null default 'كيلو',
  notes      text,
  archived   boolean not null default false,
  created_at timestamptz not null default now()
);

-- «قشطة» و«قشطة » صنف واحد: بدونه يتفرّق مجموع الصرف على اسمين لنفس الشيء.
create unique index if not exists purchase_items_name_key on public.purchase_items (lower(btrim(name)));

create table if not exists public.purchase_bills (
  id            text primary key,
  supplier_id   text references public.suppliers (id) on delete set null,
  -- لقطة الاسم: حذف المورد لاحقاً يجب ألّا يمحو من أين اشتُريت البضاعة.
  supplier_name text,
  -- رقم فاتورة المورد الورقية إن وُجد — للمطابقة، لا ترقيم داخلي.
  ref           text,
  purchased_at  timestamptz not null default now(),
  total         numeric(12,2) not null default 0 check (total >= 0),
  notes         text,
  user_id       uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists purchase_bills_at_idx on public.purchase_bills (purchased_at desc);

create table if not exists public.purchase_bill_lines (
  bill_id       text not null references public.purchase_bills (id) on delete cascade,
  line_no       int  not null,
  item_id       text references public.purchase_items (id) on delete set null,
  -- لقطة وقت الشراء: تعديل اسم الصنف أو نوعه لاحقاً لا يعيد كتابة فاتورة قديمة.
  name          text not null,
  kind          text not null,
  unit          text not null,
  qty           numeric(12,3) not null check (qty > 0),
  unit_price    numeric(12,2) not null check (unit_price >= 0),
  primary key (bill_id, line_no)
);

-- ----------------------------------------------------------------------------
-- الإنشاء ذرّي عبر دالة: الإجمالي يُحسب هنا من البنود لا يُرسل من المتصفح،
-- فلا تُحفظ فاتورة مجموعها لا يطابق بنودها.
-- ----------------------------------------------------------------------------
create or replace function public.create_purchase_bill(
  p_supplier_id  text,
  p_purchased_at timestamptz,
  p_ref          text,
  p_notes        text,
  p_lines        jsonb
) returns public.purchase_bills
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id       text := 'pb_' || replace(gen_random_uuid()::text, '-', '');
  v_bill     public.purchase_bills%rowtype;
  v_line     jsonb;
  v_item     public.purchase_items%rowtype;
  v_supplier text;
  v_qty      numeric;
  v_price    numeric;
  v_unit     text;
  v_no       int := 0;
  v_total    numeric(12,2) := 0;
begin
  perform app.require_cap('purchase.edit');

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'فاتورة المشتريات بلا بنود.' using errcode = '22023';
  end if;

  if p_supplier_id is not null then
    select name into v_supplier from public.suppliers where id = p_supplier_id;
    if not found then
      raise exception 'المورد غير موجود.' using errcode = '23503';
    end if;
  end if;

  insert into public.purchase_bills (id, supplier_id, supplier_name, ref, purchased_at, notes, user_id)
  values (
    v_id, p_supplier_id, v_supplier, nullif(btrim(p_ref), ''),
    coalesce(p_purchased_at, now()), nullif(btrim(p_notes), ''), auth.uid()
  );

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_item from public.purchase_items where id = v_line->>'item_id';
    if not found then
      raise exception 'أحد الأصناف في الفاتورة غير موجود.' using errcode = '23503';
    end if;

    v_qty   := (v_line->>'qty')::numeric;
    v_price := (v_line->>'unit_price')::numeric;
    v_unit  := coalesce(nullif(btrim(v_line->>'unit'), ''), v_item.unit);

    if v_qty is null or v_qty <= 0 then
      raise exception 'كمية «%» يجب أن تكون أكبر من صفر.', v_item.name using errcode = '22023';
    end if;
    if v_price is null or v_price < 0 then
      raise exception 'سعر «%» غير صالح.', v_item.name using errcode = '22023';
    end if;

    v_no := v_no + 1;
    insert into public.purchase_bill_lines (bill_id, line_no, item_id, name, kind, unit, qty, unit_price)
    values (v_id, v_no, v_item.id, v_item.name, v_item.kind, v_unit, v_qty, v_price);
    -- تقريب كل بند قبل الجمع: هو ما يراه صاحب المحل مطبوعاً على كل سطر.
    v_total := v_total + round(v_qty * v_price, 2);
  end loop;

  update public.purchase_bills set total = v_total where id = v_id returning * into v_bill;
  return v_bill;
end
$$;

-- ----------------------------------------------------------------------------
-- الأمان: نفس صلاحيات الموردين وطلبات التوريد. الموظف (cashier) لا يملك
-- `purchase.view`، فلا يرى ما يُصرف على المواد — كما لا يرى التكلفة.
-- ----------------------------------------------------------------------------
alter table public.purchase_items      enable row level security;
alter table public.purchase_bills      enable row level security;
alter table public.purchase_bill_lines enable row level security;

drop policy if exists pi_read    on public.purchase_items;
drop policy if exists pi_write   on public.purchase_items;
drop policy if exists pb_read    on public.purchase_bills;
drop policy if exists pb_delete  on public.purchase_bills;
drop policy if exists pbl_read   on public.purchase_bill_lines;

create policy pi_read  on public.purchase_items for select using (app.has_cap('purchase.view'));
create policy pi_write on public.purchase_items for all
  using (app.has_cap('purchase.edit')) with check (app.has_cap('purchase.edit'));

-- لا سياسة إدراج ولا تعديل على الفواتير: الإنشاء عبر الدالة وحدها، والتصحيح
-- حذفٌ ثم إعادة إدخال — فاتورة تتغيّر بنودها بصمت بعد حفظها لا يُوثق بمجموعها.
create policy pb_read   on public.purchase_bills for select using (app.has_cap('purchase.view'));
create policy pb_delete on public.purchase_bills for delete using (app.has_cap('purchase.edit'));
create policy pbl_read  on public.purchase_bill_lines for select using (app.has_cap('purchase.view'));

revoke all on public.purchase_items, public.purchase_bills, public.purchase_bill_lines from anon;
grant select on public.purchase_items, public.purchase_bills, public.purchase_bill_lines to authenticated;
grant insert, update, delete on public.purchase_items to authenticated;
grant delete on public.purchase_bills to authenticated;

revoke all on function public.create_purchase_bill(text, timestamptz, text, text, jsonb) from public, anon;
grant execute on function public.create_purchase_bill(text, timestamptz, text, text, jsonb)
  to authenticated;
