import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { AlertCircle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react'

export const cn = (...parts: Array<string | false | null | undefined>) => twMerge(clsx(parts))

/* -------------------------------------------------------------------------- */
/* Button                                                                      */
/* -------------------------------------------------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft'
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand text-on-brand hover:bg-brand-strong shadow-sm active:translate-y-px disabled:bg-brand/50',
  secondary:
    'bg-surface text-text border border-border hover:border-border-strong hover:bg-surface-2 active:translate-y-px',
  soft: 'bg-brand-soft text-brand-strong hover:brightness-95 dark:hover:brightness-110 active:translate-y-px',
  ghost: 'text-muted hover:bg-surface-2 hover:text-text',
  danger: 'bg-danger text-white hover:brightness-110 active:translate-y-px',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-6 text-base gap-2.5 rounded-xl',
  icon: 'h-9 w-9 rounded-lg justify-center',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', size = 'md', loading, disabled, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center font-medium transition-all duration-150',
        'disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  )
})

/* -------------------------------------------------------------------------- */
/* Surfaces                                                                    */
/* -------------------------------------------------------------------------- */

export function Card({
  className,
  children,
  ...rest
}: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('panel rounded-card border border-border card-shadow', className)} {...rest}>
      {children}
    </div>
  )
}

export function CardHeader({
  title,
  subtitle,
  icon,
  action,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn('flex items-start justify-between gap-3 border-b border-border p-4', className)}
    >
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}

export type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'danger' | 'accent'

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted border-border',
  brand: 'bg-brand-soft text-brand-strong border-transparent',
  ok: 'bg-ok-soft text-ok border-transparent',
  warn: 'bg-warn-soft text-warn border-transparent',
  danger: 'bg-danger-soft text-danger border-transparent',
  accent: 'bg-accent-soft text-accent border-transparent',
}

export function Badge({
  tone = 'neutral',
  children,
  className,
  dot,
}: {
  tone?: Tone
  children: ReactNode
  className?: string
  dot?: boolean
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/* Form controls                                                               */
/* -------------------------------------------------------------------------- */

const FIELD =
  'w-full rounded-xl border border-border bg-surface px-3 text-sm text-text placeholder:text-faint ' +
  'transition-colors focus:border-brand focus:outline-none focus:ring-4 focus:ring-[var(--ring)] ' +
  'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-faint'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cn(FIELD, 'h-10', className)} {...rest} />
  },
)

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(FIELD, 'py-2.5 leading-6', className)} {...rest} />
})

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select ref={ref} className={cn(FIELD, 'h-10 cursor-pointer pl-8', className)} {...rest}>
        {children}
      </select>
    )
  },
)

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    // `min-w-0`: الحقل غالباً خلية شبكة، وخلية الشبكة لا تضيق عن أعرض ما فيها؛ خانة
    // تاريخ عرضها الذاتي كبير كانت تمدّ الخلية خارج النافذة على الآيفون.
    <label className={cn('block min-w-0', className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-muted">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-faint">{hint}</span>
      ) : null}
    </label>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: ReactNode
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2.5 disabled:opacity-50"
    >
      <span
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200',
          checked ? 'bg-brand' : 'bg-border-strong',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-5 rounded-full bg-white shadow transition-all duration-200',
            checked ? 'right-0.5' : 'right-[22px]',
          )}
        />
      </span>
      {label && <span className="text-sm">{label}</span>}
    </button>
  )
}

/* -------------------------------------------------------------------------- */
/* Modal                                                                       */
/* -------------------------------------------------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  const widths = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div
        className="absolute inset-0 animate-fade bg-black/45 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          // على الجوال تنبثق النافذة من أسفل الشاشة، فبدون حشوة الحافة الآمنة يجلس زر
          // الحفظ تحت شريط الإيماءات أو شريط المتصفح السفلي ولا يُضغط.
          'panel relative flex max-h-[92dvh] w-full animate-pop flex-col overflow-hidden rounded-t-2xl border border-border pb-[env(safe-area-inset-bottom)] shadow-2xl sm:rounded-2xl sm:pb-0',
          widths[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="إغلاق">
            <X className="size-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-border bg-surface-2 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/* -------------------------------------------------------------------------- */
/* Toasts                                                                      */
/* -------------------------------------------------------------------------- */

type ToastKind = 'success' | 'error' | 'info' | 'warn'
interface ToastItem {
  id: number
  kind: ToastKind
  message: string
}

const ToastCtx = createContext<(message: string, kind?: ToastKind) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

const TOAST_ICON: Record<ToastKind, ReactNode> = {
  success: <CheckCircle2 className="size-4 text-ok" />,
  error: <XCircle className="size-4 text-danger" />,
  warn: <AlertCircle className="size-4 text-warn" />,
  info: <Info className="size-4 text-brand" />,
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const push = useCallback((message: string, kind: ToastKind = 'success') => {
    const id = Date.now() + Math.random()
    setItems((cur) => [...cur, { id, kind, message }])
    setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), 3800)
  }, [])

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-[calc(7.5rem+env(safe-area-inset-bottom))] left-1/2 lg:bottom-[calc(1rem+env(safe-area-inset-bottom))] z-[60] flex w-[min(92vw,26rem)] -translate-x-1/2 flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className="panel pointer-events-auto flex animate-pop items-center gap-2.5 rounded-xl border border-border px-4 py-3 text-sm shadow-lg"
          >
            {TOAST_ICON[t.kind]}
            <span className="flex-1">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

/* -------------------------------------------------------------------------- */
/* Misc                                                                        */
/* -------------------------------------------------------------------------- */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon && (
        <span className="grid size-14 place-items-center rounded-2xl bg-surface-2 text-faint">
          {icon}
        </span>
      )}
      <div>
        <p className="font-medium">{title}</p>
        {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('relative overflow-hidden rounded-lg bg-surface-2', className)}>
      <div className="absolute inset-0 -translate-x-full bg-gradient-to-l from-transparent via-black/5 to-transparent [animation:shimmer_1.6s_infinite] dark:via-white/5" />
    </div>
  )
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  className,
}: {
  value: T
  onChange: (v: T) => void
  items: Array<{ value: T; label: ReactNode; count?: number }>
  className?: string
}) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-xl border border-border bg-surface-2 p-1',
        className,
      )}
    >
      {items.map((it) => (
        <button
          key={it.value}
          onClick={() => onChange(it.value)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all',
            value === it.value ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text',
          )}
        >
          {it.label}
          {it.count !== undefined && (
            <span className="tnum rounded-full bg-border px-1.5 text-[11px]">{it.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}

/** Horizontal bar used inside tables to show stock level at a glance. */
export function Meter({ value, max, tone = 'brand' }: { value: number; max: number; tone?: Tone }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  const bar: Record<Tone, string> = {
    neutral: 'bg-border-strong',
    brand: 'bg-brand',
    ok: 'bg-ok',
    warn: 'bg-warn',
    danger: 'bg-danger',
    accent: 'bg-accent',
  }
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <div
        className={cn('h-full rounded-full transition-[width] duration-500', bar[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export function useDebounced<T>(value: T, delay = 250): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return v
}

export function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* private mode / quota — the app still works, it just forgets. */
    }
  }, [key, value])
  return [value, setValue] as const
}

export function usePagination<T>(rows: T[], pageSize = 25) {
  const [page, setPage] = useState(1)
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  useEffect(() => {
    setPage(1)
  }, [rows.length])
  const slice = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [rows, page, pageSize],
  )
  return { page, pages, slice, setPage }
}

export function Pager({
  page,
  pages,
  onChange,
  total,
}: {
  page: number
  pages: number
  onChange: (p: number) => void
  total: number
}) {
  if (pages <= 1) return null
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-[13px] text-muted">
      <span className="tnum">{total} سجل</span>
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="secondary"
          disabled={page === 1}
          onClick={() => onChange(page - 1)}
        >
          السابق
        </Button>
        <span className="tnum px-2">
          {page} / {pages}
        </span>
        <Button
          size="sm"
          variant="secondary"
          disabled={page === pages}
          onClick={() => onChange(page + 1)}
        >
          التالي
        </Button>
      </div>
    </div>
  )
}
