import { useSyncExternalStore } from 'react'
import { numbersHidden, subscribeHidden } from '@/lib/display'

/**
 * حالة إخفاء الأرقام. تُقرأ في جذر التطبيق: إعادة رسمه تعيد بناء عناصر المسارات فتُعاد
 * كل شاشة رسمها بالقيمة الجديدة، دون أن يحتاج كل مكوّن إلى الاشتراك بنفسه.
 */
export function useNumbersHidden(): boolean {
  return useSyncExternalStore(subscribeHidden, numbersHidden)
}
