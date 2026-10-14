import { cn } from './ui'

/**
 * شاشة التحميل: شعار «وضح» في الوسط وتحته دائرة التحميل.
 *
 * `compact` للانتقال بين الصفحات: تُعرض داخل منطقة المحتوى فتبقى الترويسة والشريط
 * السفلي ثابتين — الشاشة لا «تومض» كلها عند كل انتقال.
 *
 * نفس الشكل مكرَّر ثابتاً في `index.html` لما قبل تحميل JavaScript (أطول انتظار على
 * شبكة الجوال)؛ أي تعديل هنا يُعكس هناك.
 */
export function Splash({ compact = false, label }: { compact?: boolean; label?: string }) {
  return (
    <div
      role="status"
      aria-label={label ?? 'جارٍ التحميل'}
      className={cn('grid place-items-center', compact ? 'py-24' : 'min-h-dvh')}
    >
      <div className="flex flex-col items-center gap-6">
        <div className={cn('brand-logo', compact ? 'w-36' : 'w-48')} />
        <div className="size-8 animate-spin rounded-full border-[3px] border-border border-t-brand" />
        {label && <p className="text-sm text-muted">{label}</p>}
      </div>
    </div>
  )
}
