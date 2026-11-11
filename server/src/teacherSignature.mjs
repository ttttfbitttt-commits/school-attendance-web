import sharp from 'sharp'

export async function processTeacherSignature(value) {
  const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(value || ''))
  if (!match || match[1].length > 1_800_000) return null
  try {
    const { data, info } = await sharp(Buffer.from(match[1], 'base64'), { limitInputPixels: 25_000_000 }).rotate().resize({ width: 1600, height: 800, fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const { width, height, channels } = info, count = width * height
    let transparent = 0
    for (let i = 0; i < count; i++) if (data[i * channels + 3] < 32) transparent++
    if (transparent < count * 0.02) {
      const stride = width + 1, integral = new Float64Array((width + 1) * (height + 1))
      for (let y = 0; y < height; y++) {
        let row = 0
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * channels
          row += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
          integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row
        }
      }
      const radius = Math.max(10, Math.min(45, Math.round(Math.min(width, height) * 0.055)))
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = (y * width + x) * channels
        const x1 = Math.max(0, x - radius), x2 = Math.min(width, x + radius + 1), y1 = Math.max(0, y - radius), y2 = Math.min(height, y + radius + 1)
        const mean = (integral[y2 * stride + x2] - integral[y1 * stride + x2] - integral[y2 * stride + x1] + integral[y1 * stride + x1]) / ((x2 - x1) * (y2 - y1))
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
        data[i + 3] = Math.round(data[i + 3] * Math.max(0, Math.min(1, (mean - gray - 12) / 22)))
      }
    }
    let left = width, top = height, right = -1, bottom = -1, ink = 0
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + 3] > 96) { ink++; left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y) }
    }
    if (right < left || bottom < top || ink < 8 || (transparent < count * 0.02 && ink > count * 0.28)) return null
    const signature = await sharp(data, { raw: info }).extract({ left, top, width: right - left + 1, height: bottom - top + 1 }).png({ compressionLevel: 9 }).toBuffer()
    return signature.length <= 1_200_000 ? `data:image/png;base64,${signature.toString('base64')}` : null
  } catch (error) {
    if (error instanceof Error) return null
    throw error
  }
}
