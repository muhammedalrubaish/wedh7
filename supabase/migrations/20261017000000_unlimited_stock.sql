-- ============================================================================
-- منتج «بدون حد»: يُصنع حسب الطلب فلا رصيد يُعدّ.
--
-- طلب العميل زراً «بدون حد» تحت الرصيد. المعمل يخبز بعض البوكسات عند الطلب، فرصيدها
-- صفر دائماً وكان البيع يُرفض بـ«الرصيد غير كافٍ».
--
-- الحل: عمود `unlimited` على المنتج، و`record_movement` تتخطّى فحص الرصيد ولا
-- تحرّك `qty` لمنتج كهذا، لكنها **تُسجّل الحركة في الدفتر كما هي** — فتبقى التقارير
-- ومعدّل البيع وسجلّ المنتج صحيحة. لا دالة أخرى تفحص الرصيد: البيع والمرتجع
-- والاستلام كلها تمرّ بها.
--
-- العمود الجديد يحتاج الخطوات الثلاث (CLAUDE.md §10-5): العمود، ومنح القراءة عليه،
-- وإعادة بناء `parts_v`. العمود يُلحق آخر المنظر لأن `create or replace view` لا تقبل
-- غير ذلك.
--
-- آمن لإعادة التشغيل.
-- ============================================================================

alter table public.parts add column if not exists unlimited boolean not null default false;

comment on column public.parts.unlimited is
  'يُصنع حسب الطلب: يُباع ولو رصيده صفر، والحركات تُسجَّل في الدفتر دون أن تحرّك qty.';

grant select (unlimited) on public.parts to authenticated;

create or replace view public.parts_v with (security_invoker = false) as
select
  p.id, p.sku, p.name, p.name_en, p.category_id, p.supplier_id, p.tax_rate,
  case when app.has_cap('pricing.view') then p.cost end as cost,
  p.price_retail, p.price_wholesale,
  p.qty, p.reorder_point, p.reorder_qty, p.lead_time_days,
  p.location, p.barcode, p.notes, p.archived,
  p.created_at, p.updated_at,
  p.unlimited
from public.parts p
where app.has_cap('inventory.view');

-- نفس التوقيع والصلاحيات والقفل؛ الفرق فرع `unlimited` وحده.
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

  if v_part.unlimited then
    -- لا رصيد يُعدّ فلا متوسط مرجّح: آخر تكلفة توريد هي التكلفة.
    v_cost := case when p_qty > 0 and p_unit_cost is not null then p_unit_cost else v_part.cost end;
    update public.parts set cost = v_cost, updated_at = now() where id = p_part_id;
  else
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
  end if;

  insert into public.stock_movements (part_id, qty, type, unit_cost, ref, note, user_id)
  values (p_part_id, p_qty, p_type, p_unit_cost, p_ref, p_note, auth.uid())
  returning id into v_id;

  return v_id;
end
$$;
