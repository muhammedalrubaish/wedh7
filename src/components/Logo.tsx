/**
 * شعار «وضح».
 *
 * بوكس حلى مفتوح تبرز منه ثلاث قطع فوق حافته. لا شريطة ولا فيونكة: البوكس منتج
 * يُباع للمحلات لا علبة هدية، والشريطة كانت تُقرأ «هدية» من أول نظرة. ولا غطاء
 * فوق شبكة قطع: صغيراً يُقرأ أيقونة تقويم.
 * أشكال قليلة كي يبقى مقروءاً عند ١٦-٢٤ بكسل (حجم أيقونة التبويب والقائمة
 * الجانبية) — الشكل الذي لا يُقرأ صغيراً ليس شعاراً.
 *
 * نفس الهندسة تُستعمل في `index.html` (أيقونة التبويب) و`scripts/make-icons.mjs`
 * (أيقونات الشاشة الرئيسية) — مصدر واحد لا ثلاثة.
 */
export function Logo({ className = 'size-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <rect x="5" y="12.5" width="22" height="13" rx="2.6" stroke="currentColor" strokeWidth="2.4" />
      <circle cx="9.8" cy="11" r="3.1" fill="currentColor" />
      <circle cx="16" cy="9.6" r="3.1" fill="currentColor" />
      <circle cx="22.2" cy="11" r="3.1" fill="currentColor" />
    </svg>
  )
}

/** نفس الشكل كـ data URI لأيقونة التبويب — بلا ملف خارجي ولا طلب شبكة. */
export const FAVICON_SVG =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23c2410c'/%3E%3Cg transform='translate(3.2 3.2) scale(0.8)'%3E%3Crect x='5' y='12.5' width='22' height='13' rx='2.6' fill='none' stroke='white' stroke-width='2.6'/%3E%3Ccircle cx='9.8' cy='11' r='3.1' fill='white'/%3E%3Ccircle cx='16' cy='9.6' r='3.1' fill='white'/%3E%3Ccircle cx='22.2' cy='11' r='3.1' fill='white'/%3E%3C/g%3E%3C/svg%3E"
