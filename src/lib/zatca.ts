/**
 * ZATCA (KSA) Phase-1 simplified tax invoice QR payload.
 *
 * Five TLV fields — seller name, VAT number, ISO-8601 timestamp, total with VAT,
 * VAT amount — concatenated and base64-encoded. Phase 2 adds a cryptographic
 * stamp issued by ZATCA, which a browser-only app cannot produce; this covers
 * the printed-QR requirement only.
 */

function tlv(tag: number, value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value)
  const out = new Uint8Array(2 + bytes.length)
  out[0] = tag
  out[1] = bytes.length
  out.set(bytes, 2)
  return out
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

export function zatcaQrPayload(input: {
  sellerName: string
  vatNumber: string
  timestamp: number
  total: number
  vatAmount: number
}): string {
  const parts = [
    tlv(1, input.sellerName),
    tlv(2, input.vatNumber),
    tlv(3, new Date(input.timestamp).toISOString()),
    tlv(4, input.total.toFixed(2)),
    tlv(5, input.vatAmount.toFixed(2)),
  ]
  const total = parts.reduce((n, p) => n + p.length, 0)
  const buf = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    buf.set(p, offset)
    offset += p.length
  }
  return toBase64(buf)
}
