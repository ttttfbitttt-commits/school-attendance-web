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

export function documentationSliceEnd(offset: number, maxHeight: number, totalHeight: number, regions: Array<{ top: number; bottom: number }>) {
  let end = Math.min(offset + maxHeight, totalHeight)
  const crossed = regions.filter(region => region.top > offset && region.top < end && region.bottom > end && region.bottom - region.top <= maxHeight)
  if (crossed.length) end = Math.min(...crossed.map(region => region.top))
  return Math.max(offset + 1, end)
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
    const bounds = element.getBoundingClientRect()
    const scaleY = canvas.height / Math.max(1, element.scrollHeight)
    const protectedImages = Array.from(element.querySelectorAll<HTMLElement>('.documentation-print figure')).map(figure => {
      const rect = figure.getBoundingClientRect()
      return { top: Math.max(0, Math.floor((rect.top - bounds.top) * scaleY)), bottom: Math.ceil((rect.bottom - bounds.top) * scaleY) }
    })
    for (let offsetY = 0; offsetY < canvas.height;) {
      if (pageAdded) pdf.addPage('a4', orientation)
      pageAdded = true
      const endY = documentationSliceEnd(offsetY, sliceHeight, canvas.height, protectedImages)
      const currentHeight = endY - offsetY
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
      offsetY += currentHeight
    }
  }

  if (!pageAdded) throw new Error('لم يتم إنشاء أي صفحة للتقرير.')
  pdf.save(safeFileName(title))
}
