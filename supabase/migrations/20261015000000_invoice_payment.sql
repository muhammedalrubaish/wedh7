-- ============================================================================
-- حالة السداد على فاتورة البيع: «تم السداد» أو «لم يتم السداد».
--
-- المشكلة قبل هذا الترحيل: `create_sale` يكتب كل فاتورة `status = 'paid'` حتى
-- الآجلة، والواجهة تستنتج «الآجل» من طريقة الدفع. فدَين المحل يبقى مسجّلاً عليه إلى
-- الأبد — لا يوجد ما يقول إنه دفع.
--
-- الحل إضافي بالكامل ولا يعدّل `create_sale` ولا أي سياسة قائمة:
--   1. مشغّل قبل الإدراج يجعل الفاتورة الآجلة `unpaid` لحظة إنشائها — داخل نفس
--      معاملة البيع، فلا توجد لحظة تكون فيها الفاتورة «مسدّدة» خطأً.
--   2. دالة `set_invoice_paid` تبدّل الحالة لاحقاً حين يدفع المحل.
--   3. تصحيح الفواتير الآجلة السابقة لتصير «لم يتم السداد».
--
-- آمن لإعادة التشغيل.
-- ============================================================================

create or replace function app.invoice_unpaid_on_credit()
returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  -- طريقة «آجل» تعني أن المال لم يصل بعد — هذا تعريفها لا افتراض.
  if new.payment_method = 'credit' and new.status = 'paid' then
    new.status := 'unpaid';
  end if;
  return new;
end
$$;

drop trigger if exists invoices_unpaid_on_credit on public.invoices;
create trigger invoices_unpaid_on_credit
  before insert on public.invoices
  for each row execute function app.invoice_unpaid_on_credit();

-- ----------------------------------------------------------------------------
-- تبديل السداد لاحقاً. يحتاج `sales.refund` (المالك والمدير) لا `sales.create`:
-- تسجيل أن محلاً دفع دَينه قرار مالي، والموظف لو ملكه لأمكنه محو دَين بضغطة.
-- ----------------------------------------------------------------------------
create or replace function public.set_invoice_paid(p_invoice_id text, p_paid boolean)
returns public.invoices
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_inv public.invoices%rowtype;
begin
  perform app.require_cap('sales.refund');

  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'الفاتورة غير موجودة.' using errcode = '23503';
  end if;
  if v_inv.status = 'refunded' then
    raise exception 'الفاتورة مسترجعة بالكامل — لا تُغيَّر حالة سدادها.' using errcode = '22023';
  end if;

  update public.invoices
     set status = case when p_paid then 'paid' else 'unpaid' end::public.invoice_status,
         -- طريقة الدفع تتبع الحالة: «آجل» لغير المسدّد، والمسدّد يخرج من «آجل».
         payment_method = case
           when not p_paid then 'credit'
           when payment_method = 'credit' then 'transfer'
           else payment_method
         end::public.payment_method
   where id = p_invoice_id
   returning * into v_inv;

  return v_inv;
end
$$;

revoke all on function public.set_invoice_paid(text, boolean) from public, anon;
grant execute on function public.set_invoice_paid(text, boolean) to authenticated;

-- الفواتير الآجلة السابقة كُتبت «مسدّدة» بسبب الخلل أعلاه.
update public.invoices
   set status = 'unpaid'
 where payment_method = 'credit' and status = 'paid';
