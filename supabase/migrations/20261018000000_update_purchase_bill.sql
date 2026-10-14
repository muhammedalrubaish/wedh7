-- ============================================================================
-- تعديل المصروف في معاملة واحدة على الخادم.
--
-- قبل هذا الترحيل كان التعديل مصروفاً جديداً ثم حذف القديم بنداءين منفصلين: انقطاع
-- الاتصال بينهما يُبقي المصروف مكرّراً فيتضاعف في التقارير، ويتغيّر رقمه (id) فيضيع
-- ربطه بسجل التدقيق.
--
-- `update_purchase_bill` تستبدل البنود وتعيد حساب الإجمالي على نفس الفاتورة: كلها
-- أو لا شيء، والرقم وتاريخ الإنشاء ومن سجّلها تبقى كما هي.
--
-- اللقطات (CLAUDE.md §10-7): بند صنفه كان في الفاتورة يحتفظ باسمه وبنده الرئيسي
-- يوم الشراء، ولو أُعيدت تسمية الصنف بعدها. والمورد نفسه يحتفظ باسمه المسجّل. ما
-- أُضيف جديداً في التعديل وحده يُلتقط من حاله اليوم.
--
-- لا سياسة تعديل على `purchase_bills` ولا `purchase_bill_lines`: الدالة
-- SECURITY DEFINER وتشترط `purchase.edit` بنفسها، كما `create_purchase_bill`.
-- إضافي بالكامل ولا يمسّ أي دالة أو سياسة قائمة. آمن لإعادة التشغيل.
-- ============================================================================

create or replace function public.update_purchase_bill(
  p_id           text,
  p_supplier_id  text,
  p_purchased_at timestamptz,
  p_ref          text,
  p_notes        text,
  p_lines        jsonb
) returns public.purchase_bills
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_bill     public.purchase_bills%rowtype;
  v_old      jsonb;
  v_snap     jsonb;
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
    raise exception 'المصروف بلا بنود.' using errcode = '22023';
  end if;

  -- القفل يمنع جهازين يعدّلان المصروف نفسه في آنٍ واحد فيختلط بنداهما.
  select * into v_bill from public.purchase_bills where id = p_id for update;
  if not found then
    raise exception 'المصروف غير موجود — ربما حُذف من جهاز آخر.' using errcode = 'P0002';
  end if;

  if p_supplier_id is not null then
    if p_supplier_id is not distinct from v_bill.supplier_id and v_bill.supplier_name is not null then
      v_supplier := v_bill.supplier_name;
    else
      select name into v_supplier from public.suppliers where id = p_supplier_id;
      if not found then
        raise exception 'المورد غير موجود.' using errcode = '23503';
      end if;
    end if;
  end if;

  -- لقطات البنود القديمة قبل حذفها، مفهرسة بالصنف.
  select coalesce(jsonb_object_agg(item_id, jsonb_build_object('name', name, 'kind', kind)), '{}')
    into v_old
    from public.purchase_bill_lines
   where bill_id = p_id and item_id is not null;

  delete from public.purchase_bill_lines where bill_id = p_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_item from public.purchase_items where id = v_line->>'item_id';
    if not found then
      raise exception 'أحد الأصناف في المصروف غير موجود.' using errcode = '23503';
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

    v_snap := v_old -> v_item.id;
    v_no := v_no + 1;
    insert into public.purchase_bill_lines (bill_id, line_no, item_id, name, kind, unit, qty, unit_price)
    values (
      p_id, v_no, v_item.id,
      coalesce(v_snap->>'name', v_item.name),
      coalesce(v_snap->>'kind', v_item.kind),
      v_unit, v_qty, v_price
    );
    -- تقريب كل بند قبل الجمع — نفس معادلة `create_purchase_bill`.
    v_total := v_total + round(v_qty * v_price, 2);
  end loop;

  update public.purchase_bills
     set supplier_id   = p_supplier_id,
         supplier_name = v_supplier,
         ref           = nullif(btrim(p_ref), ''),
         purchased_at  = coalesce(p_purchased_at, purchased_at),
         notes         = nullif(btrim(p_notes), ''),
         total         = v_total
   where id = p_id
  returning * into v_bill;

  return v_bill;
end
$$;

revoke all on function public.update_purchase_bill(text, text, timestamptz, text, text, jsonb)
  from public, anon;
grant execute on function public.update_purchase_bill(text, text, timestamptz, text, text, jsonb)
  to authenticated;
