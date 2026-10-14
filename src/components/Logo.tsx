/**
 * شعار «وضح».
 *
 * بوكس حلى مفتوح تبرز منه ثلاث قطع فوق حافته. لا شريطة ولا فيونكة: البوكس منتج
 * يُباع للمحلات لا علبة هدية، والشريطة كانت تُقرأ «هدية» من أول نظرة. ولا غطاء
 * فوق شبكة قطع: صغيراً يُقرأ أيقونة تقويم.
 * أشكال قليلة كي يبقى مقروءاً عند ١٦-٢٤ بكسل (حجم أيقونة التبويب والقائمة
 * الجانبية) — الشكل الذي لا يُقرأ صغيراً ليس شعاراً.
 *
 * أيقونة التبويب والشاشة الرئيسية والقائمة الجانبية صارت من شعار العميل نفسه
 * (`public/brand-mark.png`، انظر `scripts/make-icons.mjs`). هذا الرمز باقٍ لشاشات
 * الدخول والخطأ فقط.
 */
export function Logo({ className = 'size-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <rect
        x="5"
        y="12.5"
        width="22"
        height="13"
        rx="2.6"
        stroke="currentColor"
        strokeWidth="2.4"
      />
      <circle cx="9.8" cy="11" r="3.1" fill="currentColor" />
      <circle cx="16" cy="9.6" r="3.1" fill="currentColor" />
      <circle cx="22.2" cy="11" r="3.1" fill="currentColor" />
    </svg>
  )
}
