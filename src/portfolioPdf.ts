import type { StudentPortfolioCorrection, StudentPortfolioSlot } from './api'
import { getReportSchoolBrand } from './SchoolFeatures'

type SignatureMode = 'uploaded' | 'generated'
type PortfolioPdfImage = {
  slot: StudentPortfolioSlot
  correction?: StudentPortfolioCorrection | null
}

export type StudentPdfScheduleItem = {
  weekday: number
  periodNumber: number
  subject: string
  teacherName: string
  startTime: string | null
  endTime: string | null
}

export type StudentPdfProfile = {
  name: string
  identityNumber: string
  grade: string
  classroom: string
  phone: string
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

async function schoolHeaderImage() {
  const school = getReportSchoolBrand()
  const response = await fetch('/moe-school-header.png')
  if (!response.ok) throw new Error('تعذر تحميل ترويسة وزارة التعليم.')
  const headerUrl = URL.createObjectURL(await response.blob())
  let header: ImageBitmap
  try {
    header = await loadImage(headerUrl)
  } finally {
    URL.revokeObjectURL(headerUrl)
  }
  const canvas = document.createElement('canvas')
  canvas.width = header.width
  canvas.height = header.height
  const context = canvas.getContext('2d')
  if (!context) {
    header.close()
    throw new Error('تعذر تجهيز ترويسة التقرير.')
  }
  context.drawImage(header, 0, 0)
  header.close()
  context.direction = 'rtl'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.font = 'bold 47px Arial, Tahoma, sans-serif'
  context.fillStyle = '#ffffff'
  const region = school.generalEducationAdministration.trim().replace(/^الإدارة العامة للتعليم(?:\s+بمنطقة)?\s*/, '') || '................'
  const office = school.educationOffice.trim().replace(/^مكتب التعليم\s*/, '') || '................'
  context.fillText(`الإدارة العامة للتعليم بمنطقة: ${region}`, canvas.width * 0.345, canvas.height * 0.215, canvas.width * 0.55)
  context.fillStyle = '#36e0c6'
  context.fillText(`مكتب التعليم: ${office}`, canvas.width * 0.30, canvas.height * 0.49, canvas.width * 0.42)
  context.fillStyle = '#ffffff'
  context.fillText(`مدرسة: ${school.schoolName || '................'}`, canvas.width * 0.485, canvas.height * 0.80, canvas.width * 0.39)
  return canvas.toDataURL('image/png')
}

async function studentOverviewCanvas(
  student: StudentPdfProfile,
  qrCode: string,
  schedule: StudentPdfScheduleItem[],
  headerImage: string,
) {
  if (!qrCode) throw new Error('تعذر تجهيز باركود الطالب.')
  const width = 1240
  const margin = 52
  const headerHeight = Math.round(width * 112 / 541)
  const profileHeight = 250
  const titleHeight = 74
  const tableHeaderHeight = 58
  const rowHeight = 54
  const rowsHeight = Math.max(rowHeight, schedule.length * rowHeight)
  const height = margin + headerHeight + 34 + profileHeight + titleHeight + tableHeaderHeight + rowsHeight + margin
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('تعذر تجهيز صفحة بيانات الطالب.')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  const headerBitmap = await loadImage(headerImage)
  const qrBitmap = await loadImage(qrCode)
  context.drawImage(headerBitmap, margin, margin, width - margin * 2, headerHeight)
  headerBitmap.close()

  const profileTop = margin + headerHeight + 34
  const profileLeft = margin
  const profileWidth = width - margin * 2
  context.fillStyle = '#f8fafc'
  context.strokeStyle = '#cbd5e1'
  context.lineWidth = 2
  context.fillRect(profileLeft, profileTop, profileWidth, profileHeight)
  context.strokeRect(profileLeft, profileTop, profileWidth, profileHeight)

  context.direction = 'rtl'
  context.textAlign = 'right'
  context.textBaseline = 'middle'
  context.fillStyle = '#0c4277'
  context.font = 'bold 31px Arial, Tahoma, sans-serif'
  context.fillText('ملف إنجاز الطالب', width / 2 + 95, profileTop + 43)
  context.fillStyle = '#153d5d'
  context.font = 'bold 22px Arial, Tahoma, sans-serif'
  const studentValues: Array<[string, string]> = [
    ['اسم الطالب', student.name],
    ['رقم الهوية', student.identityNumber],
    ['الصف والفصل', `${student.grade} · ${student.classroom}`],
    ['رقم الجوال', student.phone || '—'],
  ]
  studentValues.forEach(([label, value], index) => {
    context.fillText(`${label}: ${value}`, width - margin - 222, profileTop + 91 + index * 39, 700)
  })
  const qrSize = 168
  context.drawImage(qrBitmap, profileLeft + 28, profileTop + 24, qrSize, qrSize)
  qrBitmap.close()
  context.textAlign = 'center'
  context.font = 'bold 18px Arial, Tahoma, sans-serif'
  context.fillText('باركود الطالب', profileLeft + 28 + qrSize / 2, profileTop + 218)

  const scheduleTitleTop = profileTop + profileHeight + 40
  context.textAlign = 'right'
  context.font = 'bold 26px Arial, Tahoma, sans-serif'
  context.fillStyle = '#0c4277'
  context.fillText('الجدول الدراسي', width - margin, scheduleTitleTop)
  const tableTop = scheduleTitleTop + 38
  const tableWidth = width - margin * 2
  const columnWidths = [160, 150, 280, 300, tableWidth - 890]
  const headers = ['اليوم', 'الحصة', 'المادة', 'المعلم', 'الوقت']
  const headerLabels = headers.map((label, index) => ({ label, width: columnWidths[index] }))
  const drawCell = (text: string, left: number, top: number, cellWidth: number, cellHeight: number, heading = false) => {
    context.fillStyle = heading ? '#e8f1f8' : '#ffffff'
    context.fillRect(left, top, cellWidth, cellHeight)
    context.strokeStyle = '#94a3b8'
    context.lineWidth = 1
    context.strokeRect(left, top, cellWidth, cellHeight)
    context.fillStyle = '#153d5d'
    context.font = heading ? 'bold 18px Arial, Tahoma, sans-serif' : '17px Arial, Tahoma, sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.direction = 'rtl'
    context.fillText(text, left + cellWidth / 2, top + cellHeight / 2, cellWidth - 10)
  }
  let right = width - margin
  for (const item of headerLabels) {
    right -= item.width
    drawCell(item.label, right, tableTop, item.width, tableHeaderHeight, true)
  }
  const weekdays = ['', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
  const sortedSchedule = [...schedule].sort((a, b) => a.weekday - b.weekday || a.periodNumber - b.periodNumber)
  if (sortedSchedule.length) {
    sortedSchedule.forEach((item, index) => {
      const top = tableTop + tableHeaderHeight + index * rowHeight
      const values = [
        weekdays[item.weekday] || '—',
        `الحصة ${item.periodNumber}`,
        item.subject || '—',
        item.teacherName || '—',
        item.startTime && item.endTime ? `${item.startTime} – ${item.endTime}` : '—',
      ]
      let rowRight = width - margin
      for (const [columnIndex, value] of values.entries()) {
        rowRight -= columnWidths[columnIndex]
        drawCell(value, rowRight, top, columnWidths[columnIndex], rowHeight)
      }
    })
  } else {
    drawCell('لم يُربط جدول دراسي بهذا الفصل بعد.', margin, tableTop + tableHeaderHeight, tableWidth, rowHeight)
  }
  return canvas
}

function addCanvasPages(pdf: InstanceType<typeof import('jspdf').jsPDF>, canvas: HTMLCanvasElement, firstPage: boolean) {
  const pageWidth = 210
  const pageHeight = 297
  const margin = 8
  const contentWidth = pageWidth - margin * 2
  const contentHeight = pageHeight - margin * 2
  const sliceHeight = Math.max(1, Math.floor(canvas.width * contentHeight / contentWidth))
  let addedPages = 0
  for (let offsetY = 0; offsetY < canvas.height; offsetY += sliceHeight) {
    if (!firstPage || addedPages > 0) pdf.addPage('a4', 'portrait')
    const height = Math.min(sliceHeight, canvas.height - offsetY)
    const slice = document.createElement('canvas')
    slice.width = canvas.width
    slice.height = height
    const context = slice.getContext('2d')
    if (!context) throw new Error('تعذر تجهيز صفحة PDF.')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, slice.width, slice.height)
    context.drawImage(canvas, 0, offsetY, canvas.width, height, 0, 0, canvas.width, height)
    pdf.addImage(slice.toDataURL('image/jpeg', 0.94), 'JPEG', margin, margin, contentWidth, height * contentWidth / canvas.width, undefined, 'FAST')
    addedPages += 1
  }
  return addedPages
}

export async function saveStudentPortfolioPdf(
  files: PortfolioPdfImage[],
  fileName: string,
  signatureMode: SignatureMode,
  signatureData: string,
  student: StudentPdfProfile,
  qrCode: string,
  schedule: StudentPdfScheduleItem[],
) {
  const { jsPDF } = await import('jspdf')
  const headerImage = await schoolHeaderImage()
  const overview = await studentOverviewCanvas(student, qrCode, schedule, headerImage)
  const pdf: InstanceType<typeof jsPDF> = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  const overviewPages = addCanvasPages(pdf, overview, true)
  for (const [index, file] of files.entries()) {
    const page = await imageWithCorrection(file.slot, file.correction, signatureMode, signatureData)
    const orientation = page.landscape ? 'landscape' : 'portrait'
    pdf.addPage('a4', orientation)
    const pageWidth = page.landscape ? 297 : 210
    const pageHeight = page.landscape ? 210 : 297
    const margin = 3
    const aspectRatio = page.width / page.height
    const imageWidth = Math.min(pageWidth - margin * 2, (pageHeight - margin * 2) * aspectRatio)
    const imageHeight = imageWidth / aspectRatio
    pdf.addImage(page.data, page.imageType === 'image/png' ? 'PNG' : 'JPEG', (pageWidth - imageWidth) / 2, (pageHeight - imageHeight) / 2, imageWidth, imageHeight, `student-portfolio-${index}`, 'FAST')
  }
  if (pdf.getNumberOfPages() !== overviewPages + files.length) throw new Error('تعذر إنشاء ملف PDF كامل.')
  pdf.save(fileName)
}

export async function savePortfolioImagesPdf(files: PortfolioPdfImage[], fileName: string, signatureMode: SignatureMode, signatureData: string) {
  const { jsPDF } = await import('jspdf')
  if (!files.length) throw new Error('لا توجد صور مرفوعة لتصديرها.')
  const headerImage = await schoolHeaderImage()
  const pdf: InstanceType<typeof jsPDF> = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  pdf.addImage(headerImage, 'PNG', 10, 10, 190, 39.3, 'portfolio-school-header', 'FAST')
  pdf.setFontSize(16)
  pdf.setTextColor(12, 66, 119)
  pdf.text('ملف إنجاز الطلاب', 105, 59, { align: 'center' })
  for (const [index, file] of files.entries()) {
    const page = await imageWithCorrection(file.slot, file.correction, signatureMode, signatureData)
    const orientation = page.landscape ? 'landscape' : 'portrait'
    pdf.addPage('a4', orientation)
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
  if (pdf.getNumberOfPages() !== files.length + 1) throw new Error('تعذر إنشاء ملف PDF كامل.')
  pdf.save(fileName)
}
