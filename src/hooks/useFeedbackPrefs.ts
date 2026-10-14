import { useCallback, useEffect, useState } from 'react'
import {
  FEEDBACK_EVENT,
  getFeedbackPrefs,
  setFeedbackPrefs,
  type FeedbackPrefs,
} from '@/lib/feedback'

/**
 * تفضيلات الاهتزاز والصوت كحالة React مشتركة: تغييرها من الترويسة يظهر فوراً في
 * «حسابي» والعكس، ومن تبويب آخر عبر حدث `storage`.
 */
export function useFeedbackPrefs(): [FeedbackPrefs, (patch: Partial<FeedbackPrefs>) => void] {
  const [prefs, setPrefs] = useState(getFeedbackPrefs)

  useEffect(() => {
    const sync = () => setPrefs(getFeedbackPrefs())
    window.addEventListener(FEEDBACK_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(FEEDBACK_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const update = useCallback((patch: Partial<FeedbackPrefs>) => {
    setFeedbackPrefs({ ...getFeedbackPrefs(), ...patch })
  }, [])

  return [prefs, update]
}
