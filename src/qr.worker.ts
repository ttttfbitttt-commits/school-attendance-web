import jsQRNs from 'jsqr'
const jsQR = (jsQRNs as any).default || jsQRNs

self.onmessage = (e: MessageEvent<{ data: Uint8ClampedArray; width: number; height: number }>) => {
  const { data, width, height } = e.data
  const code = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' })
  self.postMessage({ result: code?.data?.trim() ?? null })
}
