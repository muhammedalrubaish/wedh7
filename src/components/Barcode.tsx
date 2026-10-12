import { useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'
import QRCode from 'qrcode'

const SVG_NS = 'http://www.w3.org/2000/svg'

export function BarcodeSvg({
  value,
  height = 48,
  displayValue = true,
  className,
}: {
  value: string
  height?: number
  displayValue?: boolean
  className?: string
}) {
  const ref = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!ref.current || !value) return
    try {
      JsBarcode(ref.current, value, {
        // CODE128 accepts any SKU-shaped string; EAN-13 would reject most of them.
        format: 'CODE128',
        height,
        width: 1.6,
        margin: 4,
        displayValue,
        fontSize: 12,
        font: 'monospace',
        background: 'transparent',
        lineColor: '#000',
      })
    } catch {
      /* An unencodable value renders nothing rather than crashing the page. */
    }
  }, [value, height, displayValue])

  return <svg ref={ref} className={className} />
}

export function QrCanvas({ value, size = 128 }: { value: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!ref.current || !value) return
    void QRCode.toCanvas(ref.current, value, {
      width: size,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    })
  }, [value, size])

  return <canvas ref={ref} width={size} height={size} />
}

/** Renders a barcode to standalone SVG markup — no network needed at print time. */
function barcodeMarkup(value: string): string {
  const svg = document.createElementNS(SVG_NS, 'svg')
  try {
    JsBarcode(svg, value, {
      format: 'CODE128',
      displayValue: false,
      margin: 0,
      height: 40,
      width: 1.6,
    })
  } catch {
    return ''
  }
  return svg.outerHTML
}

/** Opens a print window with N copies of a shelf label. */
export function printLabels(
  part: { name: string; sku: string; barcode?: string; priceRetail: number },
  copies: number,
) {
  const win = window.open('', '_blank', 'width=800,height=600')
  if (!win) return

  const bc = barcodeMarkup(part.barcode || part.sku)
  const labels = Array.from({ length: copies })
    .map(
      () => `
      <div class="label">
        <div class="name">${escapeHtml(part.name)}</div>
        <div class="bc">${bc}</div>
        <div class="row"><span>${escapeHtml(part.barcode || part.sku)}</span><span>${part.priceRetail.toFixed(2)} ر.س</span></div>
      </div>`,
    )
    .join('')

  win.document.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8">
    <title>ملصقات ${escapeHtml(part.sku)}</title>
    <style>
      @page { margin: 8mm; }
      body { font-family: system-ui, sans-serif; display: flex; flex-wrap: wrap; gap: 4mm; margin: 0; padding: 4mm; }
      .label { width: 50mm; border: 1px dashed #bbb; padding: 2mm; text-align: center; }
      .name { font-size: 9pt; font-weight: 600; height: 2.6em; overflow: hidden; }
      .row { display: flex; justify-content: space-between; font-size: 8pt; font-family: monospace; }
      .bc svg { width: 100%; height: 13mm; }
    </style></head><body>${labels}</body></html>`)
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 300)
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}
