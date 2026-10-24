import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { CameraOff, Keyboard, QrCode, ScanLine, VideoOff } from 'lucide-react'
import { Badge, Button, Card, CardHeader, EmptyState, Input, Meter, cn } from '@/components/ui'
import { db } from '@/lib/db'
import { money } from '@/lib/display'
import { useApp } from '@/store/app'
import type { Part } from '@/lib/types'

type Hit = { kind: 'part'; part: Part } | { kind: 'none'; code: string }

export default function Scanner() {
  const { can } = useApp()
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)

  const [active, setActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [manual, setManual] = useState('')
  const [hit, setHit] = useState<Hit | null>(null)
  const [history, setHistory] = useState<string[]>([])

  const lookup = useCallback(async (raw: string) => {
    const code = raw.trim()
    if (!code) return
    setHistory((h) => [code, ...h.filter((x) => x !== code)].slice(0, 8))

    const byBarcode = await db.parts.where('barcode').equals(code).first()
    if (byBarcode) return setHit({ kind: 'part', part: byBarcode })

    const bySku = await db.parts.where('sku').equals(code).first()
    if (bySku) return setHit({ kind: 'part', part: bySku })

    setHit({ kind: 'none', code })
  }, [])

  const stop = useCallback(() => {
    controlsRef.current?.stop()
    controlsRef.current = null
    setActive(false)
  }, [])

  useEffect(() => () => controlsRef.current?.stop(), [])

  async function start() {
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('المتصفح لا يدعم الكاميرا. استخدم الإدخال اليدوي أو قارئ باركود USB.')
      return
    }
    try {
      const reader = new BrowserMultiFormatReader()
      setActive(true)
      controlsRef.current = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current!,
        (result) => {
          if (!result) return
          void lookup(result.getText())
          // قراءة واحدة لكل ضغطة كي لا يُمسح البوكس نفسه مرتين.
          stop()
        },
      )
    } catch {
      setActive(false)
      setError('تعذّر فتح الكاميرا — تأكد من السماح للموقع، ولاحظ أن الكاميرا تحتاج HTTPS.')
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="مسح الباركود"
          subtitle="كاميرا الجهاز أو قارئ USB"
          icon={<ScanLine className="size-[18px]" />}
        />
        <div className="space-y-3 p-4">
          <div className="relative aspect-video overflow-hidden rounded-xl border border-border bg-black">
            <video
              ref={videoRef}
              className={cn('size-full object-cover', !active && 'opacity-0')}
              muted
              playsInline
            />
            {!active && (
              <div className="absolute inset-0 grid place-items-center text-white/60">
                <div className="flex flex-col items-center gap-2">
                  <VideoOff className="size-8" />
                  <span className="text-[13px]">الكاميرا متوقفة</span>
                </div>
              </div>
            )}
            {active && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="h-24 w-3/4 rounded-lg border-2 border-brand/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
              </div>
            )}
          </div>

          <div className="flex gap-2">
            {active ? (
              <Button variant="danger" className="flex-1" onClick={stop}>
                <CameraOff className="size-4" />
                إيقاف
              </Button>
            ) : (
              <Button variant="primary" className="flex-1" onClick={start}>
                <QrCode className="size-4" />
                تشغيل الكاميرا
              </Button>
            )}
          </div>

          {error && (
            <p className="rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-warn">{error}</p>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault()
              void lookup(manual)
              setManual('')
            }}
            className="flex gap-2"
          >
            <div className="relative flex-1">
              <Keyboard className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
              <Input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="أو أدخل الرمز يدوياً / بقارئ USB"
                className="tnum pr-9"
              />
            </div>
            <Button variant="secondary" type="submit">
              بحث
            </Button>
          </form>

          {history.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {history.map((code) => (
                <button
                  key={code}
                  onClick={() => void lookup(code)}
                  className="tnum rounded-lg bg-surface-2 px-2 py-1 text-[11px] text-muted transition-colors hover:text-text"
                >
                  {code}
                </button>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="النتيجة" icon={<ScanLine className="size-[18px]" />} />
        {!hit ? (
          <EmptyState
            icon={<ScanLine className="size-6" />}
            title="بانتظار المسح"
            description="امسح باركود بوكس لعرض رصيده وسعره."
          />
        ) : hit.kind === 'none' ? (
          <EmptyState
            icon={<QrCode className="size-6" />}
            title="لا يوجد سجل بهذا الرمز"
            description={hit.code}
          />
        ) : (
          <div className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-semibold">{hit.part.name}</h3>
                <p className="tnum mt-0.5 text-[12px] text-faint">
                  {hit.part.sku}
                  {hit.part.location && ` · ${hit.part.location}`}
                </p>
              </div>
              <Badge tone="neutral">{money(hit.part.priceWholesale)} جملة</Badge>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-surface-2 p-3">
                <p className="text-[12px] text-muted">الرصيد</p>
                <p className="tnum mt-0.5 text-xl font-bold">
                  {hit.part.unlimited ? '∞' : hit.part.qty}
                </p>
                <div className="mt-2">
                  <Meter
                    value={hit.part.unlimited ? 1 : hit.part.qty}
                    max={hit.part.unlimited ? 1 : Math.max(hit.part.reorderPoint * 3, 1)}
                    tone={
                      hit.part.unlimited
                        ? 'ok'
                        : hit.part.qty === 0
                          ? 'danger'
                          : hit.part.qty <= hit.part.reorderPoint
                            ? 'warn'
                            : 'ok'
                    }
                  />
                </div>
              </div>
              <div className="rounded-xl bg-surface-2 p-3">
                <p className="text-[12px] text-muted">سعر المحل</p>
                <p className="tnum mt-0.5 text-xl font-bold">{money(hit.part.priceRetail)}</p>
                {can('pricing.view') && (
                  <p className="tnum mt-2 text-[12px] text-faint">التكلفة {money(hit.part.cost)}</p>
                )}
              </div>
            </div>

            <Link to={`/inventory/${hit.part.id}`} className="mt-4 block">
              <Button variant="primary" className="w-full">
                فتح بطاقة المنتج
              </Button>
            </Link>
          </div>
        )}
      </Card>
    </div>
  )
}
