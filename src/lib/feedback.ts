/**
 * اهتزاز وصوت ناعم عند الضغط على الأزرار والقوائم والبطاقات.
 *
 * يُركَّب مرة واحدة على `document` بالتفويض (`installTapFeedback`) بدل لمس كل زر:
 * أي زر أو رابط أو بطاقة قابلة للضغط يحصل على الأثر تلقائياً، والمكوّنات الجديدة
 * لا تحتاج تذكّره.
 *
 * ⚠️ الاهتزاز على الآيفون ليس واجهة رسمية. Safari لا يدعم `navigator.vibrate`
 * إطلاقاً؛ الطريق الوحيد أثرٌ جانبي لمفتاح `<input type="checkbox" switch>` الذي
 * يهتزّ النظام عند تبديله (iOS 17.4 فما فوق)، وقد تغلقه Apple في أي تحديث. لذلك
 * هو «أفضل محاولة»: إن لم يعمل لا يظهر خطأ ولا يتعطّل شيء. أندرويد يستعمل
 * `navigator.vibrate` الرسمي.
 *
 * الصوت مولَّد بـ Web Audio لا ملف: بلا تحميل ولا طلب شبكة، ويحترم مفتاح الصامت
 * في الآيفون — المحل الذي جواله على الصامت لا يسمع شيئاً، وهذا مقصود.
 */

const PREFS_KEY = 'wedh7.feedback'

export interface FeedbackPrefs {
  haptics: boolean
  sound: boolean
}

const DEFAULTS: FeedbackPrefs = { haptics: true, sound: true }

export function getFeedbackPrefs(): FeedbackPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<FeedbackPrefs>) } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

export function setFeedbackPrefs(next: FeedbackPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next))
  } catch {
    // تخزين محجوب (تصفّح خاص): التفضيل يعود للافتراضي عند الفتح التالي — مقبول
  }
}

/* -------------------------------------------------------------------------- */
/* الاهتزاز                                                                    */
/* -------------------------------------------------------------------------- */

const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

/** يمنع الضغطة المصطنعة على مفتاح الاهتزاز من أن تُحسب ضغطة مستخدم فتتكرّر. */
let firingHaptic = false

export function haptic() {
  if (typeof navigator.vibrate === 'function') {
    navigator.vibrate(10)
    return
  }
  if (!isIOS()) return
  // نفس طريقة مكتبة ios-haptics: عنصر مؤقت مخفي يُضغط ثم يُزال فوراً.
  const label = document.createElement('label')
  label.ariaHidden = 'true'
  label.style.display = 'none'
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.setAttribute('switch', '')
  label.append(input)
  document.head.append(label)
  firingHaptic = true
  try {
    label.click()
  } finally {
    firingHaptic = false
    label.remove()
  }
}

/* -------------------------------------------------------------------------- */
/* الصوت                                                                       */
/* -------------------------------------------------------------------------- */

let audio: AudioContext | null = null

/**
 * «تِك» قصيرة دافئة: موجة جيبية تنزل من ٧٤٠ إلى ٥٢٠ هرتز في ٦٠ مللي ثانية، بمرشّح
 * يقصّ الحدّة، وارتفاع لا يتجاوز ٦٪. ناعمة بما يكفي لتُكرَّر مئة مرة في اليوم
 * خلف الكاونتر دون أن تزعج الزبون.
 */
export function tapSound() {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return
  audio ??= new Ctor()
  // سفاري يُنشئ السياق معلّقاً حتى أول ضغطة — والاستدعاء هنا داخل ضغطة.
  if (audio.state === 'suspended') void audio.resume()

  const t = audio.currentTime
  const osc = audio.createOscillator()
  const filter = audio.createBiquadFilter()
  const gain = audio.createGain()

  osc.type = 'sine'
  osc.frequency.setValueAtTime(740, t)
  osc.frequency.exponentialRampToValueAtTime(520, t + 0.06)
  filter.type = 'lowpass'
  filter.frequency.value = 2200
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(0.06, t + 0.006)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09)

  osc.connect(filter).connect(gain).connect(audio.destination)
  osc.start(t)
  osc.stop(t + 0.1)
}

/* -------------------------------------------------------------------------- */
/* التركيب                                                                     */
/* -------------------------------------------------------------------------- */

/** ما يُعدّ «ضغطة» تستحق أثراً: أزرار، روابط، مفاتيح، بطاقات وأسطر قابلة للضغط. */
const TAPPABLE = [
  'button',
  'a[href]',
  '[role="button"]',
  '[role="radio"]',
  '[role="tab"]',
  '[role="switch"]',
  'select',
  'input[type="checkbox"]',
  'input[type="radio"]',
  'summary',
  '.cursor-pointer',
].join(',')

/** خانات الكتابة لا تهتزّ: الضغط فيها للكتابة لا للفعل، والاهتزاز مع كل نقرة مزعج. */
const TYPING =
  'input:not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]'

let installed = false
let lastAt = 0

export function installTapFeedback() {
  if (installed) return
  installed = true
  // `click` لا `pointerdown`: الأخير يُطلق مع بداية التمرير أيضاً، فيهتزّ الجوال كلما
  // لمس الإصبع القائمة ليسحبها.
  document.addEventListener(
    'click',
    (e) => {
      if (firingHaptic) return
      const target = e.target as Element | null
      if (!target?.closest || target.closest(TYPING)) return
      const el = target.closest(TAPPABLE)
      if (!el || el.closest('[aria-disabled="true"]') || (el as HTMLButtonElement).disabled) return
      // الضغط على label يولّد ضغطة ثانية على حقله — أثر واحد لا اثنان.
      const now = performance.now()
      if (now - lastAt < 60) return
      lastAt = now

      const prefs = getFeedbackPrefs()
      try {
        if (prefs.haptics) haptic()
        if (prefs.sound) tapSound()
      } catch {
        // الأثر تجميلي: فشله لا يجوز أن يوقف الضغطة نفسها
      }
    },
    { capture: true, passive: true },
  )
}
