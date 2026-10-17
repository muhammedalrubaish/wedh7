-- ============================================================================
-- مفتاح المحاسب الذكي يُحفظ من داخل الموقع.
--
-- قبل هذا الترحيل كان المفتاح يُضبط في متغيّرات Vercel، وصاحب المعمل لا يدخل Vercel
-- ولا يريد أن يدخله المطوّر نيابةً عنه. والبديل القديم — خانة في الصفحة — كان يحفظ
-- المفتاح في متصفح جهاز واحد ويرسله من الصفحة مباشرة، فترفضه ديب سيك (CORS) ويقرؤه
-- من يفتح أدوات المطوّر.
--
-- الآن: المفتاح في جدول لا يُقرأ ولا يُكتب إلا عبر الدوال أدناه. صاحب صلاحية
-- `settings.manage` يحفظه ويحذفه، و`api/ai.ts` يقرؤه بجلسة المستخدم نفسه عبر
-- `ai_key_get` التي تشترط `ai.use` — فالموظف بلا هذه الصلاحية لا يصل إليه ولا يستهلكه.
--
-- ⚠️ بصراحة: من يملك `ai.use` (المالك والمدير افتراضياً) يستطيع استدعاء `ai_key_get`
-- من أدوات المطوّر وقراءة المفتاح. هو مفتاح المالك على رصيده؛ والبديل الذي يحجبه
-- عنهم يحتاج سرّاً في Vercel، وهذا ما طُلب تجنّبه. ومالك مشروع Supabase يراه من اللوحة.
--
-- لا يدخل المفتاح في النسخة الاحتياطية: `fetchBackup` يسحب جداوله بالاسم.
-- إضافي بالكامل ولا يمسّ أي جدول أو دالة قائمة. آمن لإعادة التشغيل.
-- ============================================================================

create table if not exists public.ai_keys (
  provider   text primary key check (provider in ('deepseek', 'anthropic')),
  api_key    text not null check (btrim(api_key) <> '' and char_length(api_key) <= 400),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

alter table public.ai_keys enable row level security;
-- بلا سياسات وبلا منح: لا قراءة ولا كتابة مباشرة لأي دور، الدوال وحدها.
revoke all on public.ai_keys from public, anon, authenticated;

create or replace function public.ai_key_set(p_provider text, p_key text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.require_cap('settings.manage');
  if p_provider not in ('deepseek', 'anthropic') then
    raise exception 'مزوّد غير معروف: %', p_provider using errcode = '22023';
  end if;
  if p_key is null or btrim(p_key) = '' then
    raise exception 'المفتاح فارغ.' using errcode = '22023';
  end if;

  insert into public.ai_keys (provider, api_key, updated_at, updated_by)
  values (p_provider, btrim(p_key), now(), auth.uid())
  on conflict (provider) do update
    set api_key = excluded.api_key, updated_at = now(), updated_by = auth.uid();
end
$$;

create or replace function public.ai_key_clear(p_provider text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.require_cap('settings.manage');
  delete from public.ai_keys where provider = p_provider;
end
$$;

-- ما تعرضه شاشة الإعدادات: هل يوجد مفتاح، وآخر أربعة أحرف منه للتمييز — لا المفتاح.
create or replace function public.ai_key_status()
returns table (provider text, hint text, updated_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (app.has_cap('settings.manage') or app.has_cap('ai.use')) then
    raise exception 'ليس لديك صلاحية: ai.use' using errcode = '42501';
  end if;
  return query
    select k.provider, '…' || right(k.api_key, 4), k.updated_at from public.ai_keys k;
end
$$;

-- يقرؤها `api/ai.ts` وحده بجلسة المستخدم الذي يسأل المحاسب.
create or replace function public.ai_key_get(p_provider text)
returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_key text;
begin
  perform app.require_cap('ai.use');
  select api_key into v_key from public.ai_keys where provider = p_provider;
  return v_key;
end
$$;

revoke all on function public.ai_key_set(text, text) from public, anon;
revoke all on function public.ai_key_clear(text) from public, anon;
revoke all on function public.ai_key_status() from public, anon;
revoke all on function public.ai_key_get(text) from public, anon;
grant execute on function public.ai_key_set(text, text) to authenticated;
grant execute on function public.ai_key_clear(text) to authenticated;
grant execute on function public.ai_key_status() to authenticated;
grant execute on function public.ai_key_get(text) to authenticated;
