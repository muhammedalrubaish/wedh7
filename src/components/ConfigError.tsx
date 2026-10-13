import { AlertTriangle } from 'lucide-react'
import { Logo } from './Logo'

/**
 * شاشة خطأ الإعداد — تظهر حين تكون متغيّرات Supabase موجودة لكن غير صالحة.
 *
 * مستقلة عن `AppProvider` وبقية الشجرة عمداً: هذه الحالة تعني أن عميل القاعدة لم
 * يُنشأ، وأي مكوّن يقرأ الجلسة أو الإعدادات سيفشل قبلها. الرسالة موجّهة لمن يضبط
 * النشر لا لصاحب المحل، لكنها بالعربية كي يقرأها ويرسلها كما هي.
 */
export function ConfigError({ message }: { message: string }) {
  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-brand text-on-brand shadow-lg">
            <Logo className="size-7" />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">وضح</h1>
        </div>
        <div className="rounded-card border border-danger/40 bg-danger-soft/60 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-danger">
            <AlertTriangle className="size-4 shrink-0" />
            إعداد النشر غير مكتمل
          </p>
          <p className="mt-2 text-[13px] leading-6 text-text">{message}</p>
        </div>
      </div>
    </div>
  )
}
