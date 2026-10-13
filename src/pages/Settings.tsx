import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Bot,
  Database,
  Download,
  RefreshCw,
  Save,
  ShieldCheck,
  Store,
  Trash2,
  Upload,
} from 'lucide-react'
import {
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Modal,
  Select,
  Switch,
  useToast,
} from '@/components/ui'
import { exportAll, importAll, wipe } from '@/lib/db'
import { cloudAuth } from '@/lib/auth'
import { fetchBackup } from '@/lib/mirror'
import { seed } from '@/lib/seed'
import { useApp } from '@/store/app'
import type { Settings } from '@/lib/types'

type Provider = Settings['aiProvider']

const MODELS: Record<Exclude<Provider, 'none'>, Array<{ id: string; label: string }>> = {
  deepseek: [
    { id: 'deepseek-chat', label: 'deepseek-chat — سريع ورخيص (مقترح)' },
    { id: 'deepseek-reasoner', label: 'deepseek-reasoner — استدلال أعمق وأبطأ' },
  ],
  anthropic: [
    { id: 'claude-opus-5', label: 'Opus 5 — الأدق والأغلى' },
    { id: 'claude-sonnet-5', label: 'Sonnet 5 — متوازن' },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5 — الأسرع والأرخص' },
  ],
}

const DEFAULT_MODEL: Record<Exclude<Provider, 'none'>, string> = {
  deepseek: 'deepseek-chat',
  anthropic: 'claude-sonnet-5',
}

export default function SettingsPage() {
  const { settings, updateSettings } = useApp()
  const toast = useToast()
  const [draft, setDraft] = useState<Settings>(settings)
  const [saving, setSaving] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [lastBackup, setLastBackup] = useState<Record<string, number> | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => setDraft(settings), [settings])

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  async function save() {
    setSaving(true)
    try {
      await updateSettings(draft)
      toast('تم حفظ الإعدادات')
    } finally {
      setSaving(false)
    }
  }

  async function doExport() {
    setExporting(true)
    try {
      // في الوضع السحابي من الخادم لا من المرآة: المرآة مقصوصة ولا تُعدّ نسخة.
      const { json, counts } = cloudAuth
        ? await fetchBackup()
        : { json: await exportAll(), counts: null }
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `wedh7-backup-${new Date().toISOString().slice(0, 10)}.json`
      document.body.append(a)
      a.click()
      a.remove()
      // الإلغاء الفوري يقطع التنزيل في Safari على الآيفون قبل أن يبدأ.
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      setLastBackup(counts)
      toast('تم تنزيل النسخة الاحتياطية')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'تعذّر تنزيل النسخة', 'error')
    } finally {
      setExporting(false)
    }
  }

  async function doImport(file: File) {
    try {
      await importAll(await file.text())
      toast('تم استيراد البيانات — سيُعاد تحميل الصفحة')
      setTimeout(() => window.location.reload(), 900)
    } catch (err) {
      toast(
        err instanceof Error && !(err instanceof SyntaxError) ? err.message : 'الملف غير صالح',
        'error',
      )
    }
  }

  async function doReset() {
    await wipe()
    await seed()
    setResetOpen(false)
    toast('تمت إعادة ضبط البيانات')
    setTimeout(() => window.location.reload(), 700)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight">الإعدادات</h1>
        <Button variant="primary" onClick={save} loading={saving}>
          <Save className="size-4" />
          حفظ
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="بيانات المحل" icon={<Store className="size-[18px]" />} />
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <Field label="اسم المحل" className="sm:col-span-2">
              <Input value={draft.shopName} onChange={(e) => set('shopName', e.target.value)} />
            </Field>
            <Field label="الاسم بالإنجليزية" className="sm:col-span-2">
              <Input
                dir="ltr"
                value={draft.shopNameEn ?? ''}
                onChange={(e) => set('shopNameEn', e.target.value)}
              />
            </Field>
            <Field label="الرقم الضريبي" hint="١٥ رقماً">
              <Input
                className="tnum"
                dir="ltr"
                value={draft.vatNumber}
                onChange={(e) => set('vatNumber', e.target.value)}
              />
            </Field>
            <Field label="السجل التجاري">
              <Input
                className="tnum"
                dir="ltr"
                value={draft.crNumber}
                onChange={(e) => set('crNumber', e.target.value)}
              />
            </Field>
            <Field label="الجوال">
              <Input
                className="tnum"
                dir="ltr"
                value={draft.phone}
                onChange={(e) => set('phone', e.target.value)}
              />
            </Field>
            <Field label="العملة">
              <Select value={draft.currency} onChange={(e) => set('currency', e.target.value)}>
                <option value="SAR">ريال سعودي (ر.س)</option>
                <option value="AED">درهم إماراتي</option>
                <option value="KWD">دينار كويتي</option>
                <option value="EGP">جنيه مصري</option>
              </Select>
            </Field>
            <Field label="العنوان" className="sm:col-span-2">
              <Input value={draft.address} onChange={(e) => set('address', e.target.value)} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="الفوترة والضريبة" icon={<Database className="size-[18px]" />} />
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Switch
                checked={draft.vatEnabled}
                onChange={(v) => set('vatEnabled', v)}
                label="تفعيل ضريبة القيمة المضافة"
              />
              <p className="mt-1 text-[12px] text-muted">
                إطفاؤها يجعل كل بند صفراً مهما كانت نسبته الخاصة. والنسبة أدناه هي الافتراضية — وأي
                منتج له نسبة خاصة في بطاقته تغلبها.
              </p>
            </div>
            <Field label="نسبة ضريبة القيمة المضافة ٪">
              <Input
                type="number"
                min="0"
                max="100"
                className="tnum"
                disabled={!draft.vatEnabled}
                value={draft.vatRate}
                onChange={(e) => set('vatRate', Number(e.target.value))}
              />
            </Field>
            <Field label="بادئة رقم الفاتورة">
              <Input
                dir="ltr"
                className="tnum"
                value={draft.invoicePrefix}
                onChange={(e) => set('invoicePrefix', e.target.value)}
              />
            </Field>
            <Field label="بادئة طلب التوريد">
              <Input
                dir="ltr"
                className="tnum"
                value={draft.poPrefix}
                onChange={(e) => set('poPrefix', e.target.value)}
              />
            </Field>
            <Field label="بادئة إشعار المرتجع">
              <Input
                dir="ltr"
                className="tnum"
                value={draft.returnPrefix}
                onChange={(e) => set('returnPrefix', e.target.value)}
              />
            </Field>
            {!cloudAuth && (
              <Field label="رقم الفاتورة القادم">
                <Input
                  type="number"
                  min="1"
                  className="tnum"
                  value={draft.invoiceCounter}
                  onChange={(e) => set('invoiceCounter', Number(e.target.value))}
                />
              </Field>
            )}
            <div className="sm:col-span-2 rounded-xl border border-border p-3">
              <Switch
                checked={draft.zatcaQr}
                onChange={(v) => set('zatcaQr', v)}
                label="طباعة رمز QR للفاتورة الضريبية (ZATCA)"
              />
              <p className="mt-1.5 pr-[52px] text-[12px] text-faint">
                يغطي المرحلة الأولى فقط (رمز TLV). المرحلة الثانية تتطلب ختماً إلكترونياً من الهيئة
                عبر خادم — غير متاح في تطبيق متصفح.
              </p>
            </div>
            <div className="sm:col-span-2 rounded-xl border border-border p-3">
              <Switch
                checked={draft.theme === 'dark'}
                onChange={(v) => set('theme', v ? 'dark' : 'light')}
                label="المظهر الداكن"
              />
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="المحاسب الذكي"
          subtitle="ربط نموذج لغوي لتحليل أرقام المعمل والمحل"
          icon={<Bot className="size-[18px]" />}
        />
        <div className="space-y-3 p-4">
          <div className="flex items-start gap-2 rounded-xl border border-ok/30 bg-ok-soft/40 px-3 py-2.5 text-[12px] leading-5">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" />
            <span>
              <strong>الوضع الموصى به:</strong> اترك حقل المفتاح فارغاً. الطلب يمر عبر{' '}
              <span className="tnum">/api/ai</span> على الخادم، والمفتاح يُضبط مرة واحدة في إعدادات
              Vercel باسم <span className="tnum">DEEPSEEK_API_KEY</span> ولا يصل المتصفح إطلاقاً.
            </span>
          </div>

          <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft/40 px-3 py-2.5 text-[12px] leading-5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
            <span>
              <strong className="text-danger">إذا عبّيت المفتاح هنا:</strong> يُخزَّن في متصفح هذا
              الجهاز ويُرسَل من الصفحة مباشرة، فيقدر أي شخص يفتح أدوات المطوّر يقرأه ويصرف على
              حسابك. استخدمه على جهازك للتجربة فقط. ولاحظ أن ديب سيك قد ترفض النداء من المتصفح
              (CORS) — مسار الخادم هو الموثوق معها.
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="المزوّد">
              <Select
                value={draft.aiProvider}
                onChange={(e) => {
                  const next = e.target.value as Provider
                  setDraft((d) => ({
                    ...d,
                    aiProvider: next,
                    aiModel: next === 'none' ? d.aiModel : DEFAULT_MODEL[next],
                  }))
                }}
              >
                <option value="none">معطّل (تحليل محلي فقط)</option>
                <option value="deepseek">DeepSeek</option>
                <option value="anthropic">Anthropic — Claude</option>
              </Select>
            </Field>
            <Field label="النموذج">
              <Select
                value={draft.aiModel}
                disabled={draft.aiProvider === 'none'}
                onChange={(e) => set('aiModel', e.target.value)}
              >
                {(draft.aiProvider === 'none' ? [] : MODELS[draft.aiProvider]).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="مفتاح API (اختياري)"
              hint={
                draft.aiApiKey.trim()
                  ? 'مفعّل — الطلب يخرج من المتصفح والمفتاح مكشوف'
                  : 'فارغ = الطلب يمر عبر الخادم والمفتاح محمي'
              }
            >
              <Input
                type="password"
                dir="ltr"
                className="tnum"
                placeholder="اتركه فارغاً (موصى به)"
                disabled={draft.aiProvider === 'none'}
                value={draft.aiApiKey}
                onChange={(e) => set('aiApiKey', e.target.value)}
              />
            </Field>
          </div>

          <p className="text-[12px] text-muted">
            حتى مع تعطيل المزوّد، صفحة المحاسب تعطيك تحليلاً محلياً كاملاً محسوباً من بياناتك بدون
            إنترنت.
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="البيانات"
          subtitle={
            cloudAuth
              ? // المجانية بلا نسخ يومية قابلة للتنزيل؛ الوعد بغيرها حماية وهمية.
                'على الخطة المجانية لا ينسخ Supabase بياناتك احتياطياً — نزّل نسخة بيدك كل أسبوع'
              : 'النسخ الاحتياطي هو مسؤوليتك — البيانات داخل هذا المتصفح فقط'
          }
          icon={<Database className="size-[18px]" />}
        />
        <div className="flex flex-wrap gap-2 p-4">
          <Button variant="secondary" onClick={doExport} loading={exporting}>
            <Download className="size-4" />
            تنزيل نسخة احتياطية
          </Button>
          {/* في الوضع السحابي كان الاستيراد يكتب في مرآة المتصفح وحدها ويقول «تم»، ثم
          يمحوها أول سحب من الخادم بعد إعادة التحميل — نجاح وهمي. يبقى مخفياً هناك حتى
          تُعتمد دالة استعادة على الخادم نفسه. */}
          {!cloudAuth && (
            <Button variant="secondary" onClick={() => fileRef.current?.click()}>
              <Upload className="size-4" />
              استيراد نسخة
            </Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void doImport(f)
              e.target.value = ''
            }}
          />
          {!cloudAuth && (
            <Button variant="danger" onClick={() => setResetOpen(true)}>
              <Trash2 className="size-4" />
              مسح وإعادة البيانات التجريبية
            </Button>
          )}
        </div>
        {cloudAuth && (
          <div className="space-y-2 border-t border-border px-4 py-3 text-[12px] leading-5 text-muted">
            <p>
              النسخة تُسحب كاملة من قاعدة البيانات: المنتجات والمحلات والفواتير والمرتجعات ودفتر
              الحركة كله وفواتير المشتريات. احفظ الملف في مكان لا يصله غيرك.
            </p>
            <p>
              استعادة الملف إلى قاعدة البيانات غير متاحة من هذه الشاشة بعد. الملف نفسه كامل ومحفوظ
              بيدك.
            </p>
            {lastBackup && (
              <p className="tnum rounded-lg bg-surface-2 px-2.5 py-1.5">
                آخر نسخة: {lastBackup.invoices ?? 0} فاتورة · {lastBackup.invoiceLines ?? 0} بند ·{' '}
                {lastBackup.movements ?? 0} حركة مخزون · {lastBackup.purchaseBills ?? 0} فاتورة
                مشتريات
              </p>
            )}
          </div>
        )}
        {!cloudAuth && (
          <p className="border-t border-border px-4 py-3 text-[12px] text-muted">
            مسح بيانات المتصفح (أو فتح النظام من متصفح/جهاز آخر) يعني بداية من الصفر. نزّل نسخة
            احتياطية بشكل دوري إلى أن يُربط النظام بقاعدة البيانات.
          </p>
        )}
      </Card>

      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        size="sm"
        title="تأكيد المسح"
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetOpen(false)}>
              إلغاء
            </Button>
            <Button variant="danger" onClick={doReset}>
              <RefreshCw className="size-4" />
              امسح وأعد التهيئة
            </Button>
          </>
        }
      >
        <p className="text-sm leading-6">
          سيتم حذف كل المنتجات والفواتير والحركات والمستخدمين، وإعادة تحميل البيانات التجريبية. لا
          يمكن التراجع. نزّل نسخة احتياطية أولاً إذا كانت البيانات مهمة.
        </p>
      </Modal>
    </div>
  )
}
