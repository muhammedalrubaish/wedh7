-- ============================================================================
-- بنود المصروفات الرئيسية بأسماء يكتبها صاحب المعمل.
--
-- قبل هذا الترحيل: `purchase_items.kind` واحد من أربعة مفاتيح ثابتة
-- (ingredient, packaging, expense, equipment). طلب العميل أن يسمّي البند الرئيسي
-- بنفسه ويضع تحته بنوداً فرعية: «التشغيلية» ← راتب العامل، الكهرباء…
--
-- الحل: `kind` يصير اسم البند الرئيسي نصاً حرّاً، والأصناف هي البنود الفرعية كما
-- كانت. لا جدول جديد: البند الرئيسي موجود ما دام تحته صنف، فلا يبقى بند فارغ يتيم
-- يحتاج حذفاً ولا سياسات أمان جديدة — سياسات `purchase_items` القائمة تغطيه.
--
-- المفاتيح الأربعة القديمة تتحوّل إلى أسمائها العربية التي كانت تُعرض بها، في
-- الأصناف وفي بنود الفواتير معاً. هذا تغيير تمثيل لا تاريخ: «ingredient» كان يُعرض
-- «مكونات» يوم الشراء وسيبقى «مكونات».
--
-- لا يمسّ أي دالة ولا سياسة. `create_purchase_bill` تنسخ `kind` من الصنف كما هو.
-- آمن لإعادة التشغيل.
-- ============================================================================

alter table public.purchase_items drop constraint if exists purchase_items_kind_check;
alter table public.purchase_items alter column kind drop default;

update public.purchase_items
   set kind = case kind
     when 'ingredient' then 'مكونات'
     when 'packaging'  then 'تغليف'
     when 'expense'    then 'مصاريف'
     when 'equipment'  then 'أخرى'
   end
 where kind in ('ingredient', 'packaging', 'expense', 'equipment');

update public.purchase_bill_lines
   set kind = case kind
     when 'ingredient' then 'مكونات'
     when 'packaging'  then 'تغليف'
     when 'expense'    then 'مصاريف'
     when 'equipment'  then 'أخرى'
   end
 where kind in ('ingredient', 'packaging', 'expense', 'equipment');

-- اسم فارغ أو بمسافات فقط يصنع بنداً رئيسياً لا يُرى ولا يُختار.
alter table public.purchase_items drop constraint if exists purchase_items_kind_named;
alter table public.purchase_items
  add constraint purchase_items_kind_named check (btrim(kind) <> '' and char_length(kind) <= 60);
