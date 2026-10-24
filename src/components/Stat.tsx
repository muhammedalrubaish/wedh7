import type { ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { Card, cn, type Tone } from './ui'
import { percent } from '@/lib/display'

const ICON_TONES: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted',
  brand: 'bg-brand-soft text-brand-strong',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  accent: 'bg-accent-soft text-accent',
}

export function Stat({
  label,
  value,
  sub,
  icon,
  tone = 'brand',
  change,
  /** Set when a rising number is bad (costs, dead stock). */
  invertChange,
  className,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  icon?: ReactNode
  tone?: Tone
  change?: number | null
  invertChange?: boolean
  className?: string
}) {
  const good = change == null ? null : invertChange ? change < 0 : change > 0
  const flat = change === 0

  return (
    <Card className={cn('lift p-4', className)}>
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-medium leading-snug text-muted sm:text-[13px]">{label}</p>
          {/* Never truncate a monetary figure: on a two-column phone grid the
              ellipsis lands mid-number and quietly misreports the shop's takings.
              Wrapping is the lesser evil. */}
          <p className="tnum mt-1.5 text-lg font-bold leading-tight tracking-tight break-words sm:text-2xl">
            {value}
          </p>
        </div>
        {icon && (
          <span
            className={cn(
              'grid size-8 shrink-0 place-items-center rounded-xl sm:size-10',
              ICON_TONES[tone],
            )}
          >
            {icon}
          </span>
        )}
      </div>

      {(sub || change != null) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
          {change != null && (
            <span
              className={cn(
                'tnum inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium',
                flat
                  ? 'bg-surface-2 text-muted'
                  : good
                    ? 'bg-ok-soft text-ok'
                    : 'bg-danger-soft text-danger',
              )}
            >
              {flat ? (
                <Minus className="size-3" />
              ) : change > 0 ? (
                <ArrowUpRight className="size-3" />
              ) : (
                <ArrowDownRight className="size-3" />
              )}
              {percent(Math.abs(change))}
            </span>
          )}
          {sub && <span className="min-w-0 text-muted">{sub}</span>}
        </div>
      )}
    </Card>
  )
}
