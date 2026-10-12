/**
 * شعار «وضح».
 *
 * بوكس حلويات بغطاء وشريطة: الجسم مستطيل بزوايا ناعمة، والغطاء شريط أعلاه،
 * والشريطة خطّ عمودي يقطعهما. ثلاثة أشكال فقط كي يبقى مقروءاً عند ١٦-٢٤ بكسل
 * (حجم أيقونة التبويب والقائمة الجانبية) — الشكل الذي لا يُقرأ صغيراً ليس شعاراً.
 *
 * نفس الهندسة تُستعمل في `index.html` (أيقونة التبويب) و`scripts/make-icons.mjs`
 * (أيقونات الشاشة الرئيسية) — مصدر واحد لا ثلاثة.
 */
export function Logo({ className = 'size-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <rect x="5" y="12" width="22" height="15" rx="2.6" stroke="currentColor" strokeWidth="2.4" />
      <rect x="3.5" y="7" width="25" height="5.5" rx="1.8" fill="currentColor" />
      <rect x="14.2" y="12" width="3.6" height="15" fill="currentColor" />
      <path
        d="M16 7c-2.2-3.4-6.5-3.2-6.2-.6C10 8.4 13.3 7.6 16 7Zm0 0c2.2-3.4 6.5-3.2 6.2-.6C22 8.4 18.7 7.6 16 7Z"
        fill="currentColor"
      />
    </svg>
  )
}

/** نفس الشكل كـ data URI لأيقونة التبويب — بلا ملف خارجي ولا طلب شبكة. */
export const FAVICON_SVG =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23c2410c'/%3E%3Cg transform='translate(3.2 3.2) scale(0.8)'%3E%3Crect x='5' y='12' width='22' height='15' rx='2.6' fill='none' stroke='white' stroke-width='2.6'/%3E%3Crect x='3.5' y='7' width='25' height='5.5' rx='1.8' fill='white'/%3E%3Crect x='14.2' y='12' width='3.6' height='15' fill='white'/%3E%3C/g%3E%3C/svg%3E"
