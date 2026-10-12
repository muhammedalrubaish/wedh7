import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { AppProvider } from './store/app'
import { ToastProvider } from './components/ui'
import { consumeRecoveryLink } from './lib/auth'
import './index.css'

// يُبتلع رمز الاسترجاع من العنوان قبل تركيب الموجّه: Supabase تضعه في `hash`
// و`HashRouter` يقرأ نفس الجزء، فلو تُرك لتنازعا وظهرت شاشة فارغة. التركيب
// داخل `finally` لا بعد `await` علوي: الأخير غير مدعوم في هدف البناء، وفشل
// الابتلاع يجب ألّا يمنع التطبيق من الظهور أصلاً.
void consumeRecoveryLink().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {/* Hash routing keeps deep links working when the build is opened from a
        file:// path or a static host without rewrite rules. */}
      <HashRouter>
        <AppProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AppProvider>
      </HashRouter>
    </StrictMode>,
  )
})
