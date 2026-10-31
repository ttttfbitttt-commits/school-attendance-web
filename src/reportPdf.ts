import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'

export type ReportPdfOrientation = 'portrait' | 'landscape'

const PAGE_SELECTORS = [
  '.page',
  '.sheet',
  '.behavior-official-form',
  '.print-page',
  '.teacher-evidence-print',
  '.teacher-week-print',
  '.student-report-page',
  '.referral-official-sheet',
]

function reportPages(document: Document, root?: HTMLElement) {
  const container = root || document.body
  const pages = Array.from(container.querySelectorAll<HTMLElement>(PAGE_SELECTORS.join(',')))
    .filter(element => !element.parentElement?.closest(PAGE_SELECTORS.join(',')))
  return pages.length ? pages : [container]
}

function safeFileName(title: string) {
  return `${title.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').slice(0, 100) || 'تقرير'}.pdf`
}

export async function downloadReportPdf(
  document: Document,
  title: string,
  orientation: ReportPdfOrientation = 'portrait',
  root?: HTMLElement,
) {
  const pages = reportPages(document, root)
  if (!pages.length) throw new Error('لا يوجد محتوى لتصديره إلى PDF.')
  if (document.fonts?.ready) await document.fonts.ready

  const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4', compress: true })
  const pageWidth = orientation === 'landscape' ? 297 : 210
  const pageHeight = orientation === 'landscape' ? 210 : 297
  const margin = 8
  const contentWidth = pageWidth - margin * 2
  const contentHeight = pageHeight - margin * 2
  let pageAdded = false

  for (const element of pages) {
    const canvas = await html2canvas(element, {
      backgroundColor: '#ffffff',
      scale: Math.min(2, 1800 / Math.max(1, element.scrollWidth)),
      useCORS: true,
      allowTaint: false,
      logging: false,
      onclone: clonedDocument => {
        clonedDocument.querySelectorAll<HTMLElement>(
          '.preview-actions,.print-actions,.actions,.behavior-preview-actions,.teacher-report-actions,.teacher-print-actions,.referral-preview-actions,.no-print-bar,.report-pdf-actions',
        ).forEach(action => { action.style.display = 'none' })
      },
    })

    const sliceHeight = Math.max(1, Math.floor(canvas.width * contentHeight / contentWidth))
    for (let offsetY = 0; offsetY < canvas.height; offsetY += sliceHeight) {
      if (pageAdded) pdf.addPage('a4', orientation)
      pageAdded = true
      const currentHeight = Math.min(sliceHeight, canvas.height - offsetY)
      const slice = document.createElement('canvas')
      slice.width = canvas.width
      slice.height = currentHeight
      const context = slice.getContext('2d')
      if (!context) throw new Error('تعذر تجهيز صفحات التقرير.')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, slice.width, slice.height)
      context.drawImage(canvas, 0, offsetY, canvas.width, currentHeight, 0, 0, canvas.width, currentHeight)
      const image = slice.toDataURL('image/jpeg', 0.94)
      const imageHeight = currentHeight * contentWidth / canvas.width
      pdf.addImage(image, 'JPEG', margin, margin, contentWidth, imageHeight, undefined, 'FAST')
    }
  }

  if (!pageAdded) throw new Error('لم يتم إنشاء أي صفحة للتقرير.')
  pdf.save(safeFileName(title))
}
