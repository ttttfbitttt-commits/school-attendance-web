import type { StudentPortfolioCorrection, StudentPortfolioSlot } from './api'

type SignatureMode = 'uploaded' | 'generated'
type PortfolioPdfImage = {
  slot: StudentPortfolioSlot
  correction?: StudentPortfolioCorrection | null
}

function teacherNameParts(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]}` : parts[0] || name
}

function hijriDateParts(value: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-arab', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Riyadh',
  }).formatToParts(new Date(value)).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  return [String(parts.day || ''), String(parts.month || ''), String(parts.year || '')]
}

function signatureSvg(color: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="56" viewBox="0 0 180 56"><path d="M 6 33 C 31 30, 47 35, 69 32 C 55 27, 52 15, 64 11 C 77 7, 105 11, 111 19 C 117 28, 99 33, 83 28 C 76 26, 71 20, 74 16 C 79 22, 85 37, 93 38 C 102 39, 108 22, 118 23 C 127 23, 121 34, 132 36 C 143 38, 154 30, 174 32" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/><path d="M 23 43 C 67 39, 111 47, 158 40" fill="none" stroke="${color}" stroke-width="1.1" stroke-linecap="round" opacity="0.9"/></svg>`
}

async function loadImage(source: string) {
  const image = new window.Image()
  image.decoding = 'async'
  image.src = source
  try {
    await image.decode()
    return await createImageBitmap(image)
  } catch {
    throw new Error('تعذر تحميل إحدى صور الإنجاز أو التوقيع.')
  }
}

async function imageWithCorrection(file: StudentPortfolioSlot, correction: StudentPortfolioCorrection | null | undefined, defaultSignatureMode: SignatureMode, defaultSignatureData: string) {
  const image = await loadImage(file.fileUrl)
  try {
    const landscape = image.width > image.height
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('تعذر تجهيز صفحة PDF.')
    context.drawImage(image, 0, 0)

    if (correction) {
      const stampScale = Math.min(image.width * 0.3 / 260, image.height * 0.65 / 82, 1.25)
      const padding = 10 * stampScale
      const stampWidth = 260 * stampScale
      const stampHeight = 82 * stampScale
      const stampX = 12 * stampScale
      const stampY = image.height - stampHeight - 14 * stampScale
      context.save()
      context.strokeStyle = correction.color
      context.globalAlpha = 0.42
      context.lineWidth = Math.max(1, 1.2 * stampScale)
      context.strokeRect(stampX, stampY, stampWidth, stampHeight)
      context.restore()

      context.save()
      context.fillStyle = correction.color
      context.font = `bold ${Math.max(10, 16 * stampScale)}px Tahoma, Arial, sans-serif`
      context.textAlign = 'left'
      context.direction = 'rtl'
      if (correction.note) context.fillText(correction.note, stampX + padding, stampY + 19 * stampScale, stampWidth - padding * 2)
      context.fillText(teacherNameParts(correction.teacherName), stampX + padding, stampY + 38 * stampScale, stampWidth - padding * 2)
      context.restore()

      const signatureMode = correction.signatureMode || defaultSignatureMode
      const signatureData = correction.signatureData || defaultSignatureData
      const signatureImage = signatureMode === 'uploaded' && signatureData
        ? await loadImage(signatureData)
        : await createImageBitmap(new Blob([signatureSvg(correction.color)], { type: 'image/svg+xml' }))
      try {
        const signatureCanvas = document.createElement('canvas')
        signatureCanvas.width = Math.max(1, Math.round(132 * stampScale))
        signatureCanvas.height = Math.max(1, Math.round(34 * stampScale))
        const signatureContext = signatureCanvas.getContext('2d')
        if (!signatureContext) throw new Error('تعذر تجهيز صورة التوقيع.')
        const signatureFit = Math.min(signatureCanvas.width / signatureImage.width, signatureCanvas.height / signatureImage.height)
        const signatureWidth = signatureImage.width * signatureFit
        const signatureHeight = signatureImage.height * signatureFit
        signatureContext.drawImage(signatureImage, (signatureCanvas.width - signatureWidth) / 2, (signatureCanvas.height - signatureHeight) / 2, signatureWidth, signatureHeight)
        if (signatureMode === 'uploaded' && signatureData) {
          signatureContext.globalCompositeOperation = 'source-in'
          signatureContext.fillStyle = correction.color
          signatureContext.fillRect(0, 0, signatureCanvas.width, signatureCanvas.height)
        }
        context.save()
        context.globalAlpha = 0.72
        context.drawImage(signatureCanvas, stampX + padding, stampY + 41 * stampScale)
        context.restore()
      } finally {
        signatureImage.close()
      }

      context.save()
      context.fillStyle = correction.color
      context.textAlign = 'right'
      context.direction = 'ltr'
      context.font = `bold ${Math.max(9, 12 * stampScale)}px Tahoma, Arial, sans-serif`
      let dateX = stampX + stampWidth - padding
      const [day, month, year] = hijriDateParts(correction.correctedAt)
      for (const segment of [day, '/', month, '/', year, 'هـ']) {
        context.fillText(segment, dateX, stampY + stampHeight - 7 * stampScale, stampWidth - padding * 2)
        dateX -= context.measureText(segment).width + 2 * stampScale
      }
      context.restore()
    }

    const imageType = file.fileType === 'image/png' ? 'image/png' : 'image/jpeg'
    const data = imageType === 'image/png' ? canvas.toDataURL(imageType) : canvas.toDataURL(imageType, 0.96)
    return { data, imageType, landscape, width: canvas.width, height: canvas.height }
  } finally {
    image.close()
  }
}

export async function savePortfolioImagesPdf(files: PortfolioPdfImage[], fileName: string, signatureMode: SignatureMode, signatureData: string) {
  const { jsPDF } = await import('jspdf')
  if (!files.length) throw new Error('لا توجد صور مرفوعة لتصديرها.')
  let pdf: InstanceType<typeof jsPDF> | null = null
  for (const [index, file] of files.entries()) {
    const page = await imageWithCorrection(file.slot, file.correction, signatureMode, signatureData)
    const orientation = page.landscape ? 'landscape' : 'portrait'
    if (!pdf) pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4', compress: true })
    else pdf.addPage('a4', orientation)
    const pageWidth = page.landscape ? 297 : 210
    const pageHeight = page.landscape ? 210 : 297
    const margin = 3
    const sourceAspectRatio = page.width / page.height
    const maxWidth = pageWidth - margin * 2
    const maxHeight = pageHeight - margin * 2
    const imageWidth = Math.min(maxWidth, maxHeight * sourceAspectRatio)
    const imageHeight = imageWidth / sourceAspectRatio
    pdf.addImage(page.data, page.imageType === 'image/png' ? 'PNG' : 'JPEG', (pageWidth - imageWidth) / 2, (pageHeight - imageHeight) / 2, imageWidth, imageHeight, `portfolio-page-${index}`, 'FAST')
  }
  if (!pdf || pdf.getNumberOfPages() !== files.length) throw new Error('تعذر إنشاء ملف PDF كامل.')
  pdf.save(fileName)
}
