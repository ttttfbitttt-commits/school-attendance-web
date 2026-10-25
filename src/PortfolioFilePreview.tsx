import { useEffect } from 'react'
import { Download, FileText, Printer, X } from 'lucide-react'
import { formatHijriDateTime } from './dateUtils'
import type { StudentPortfolioCorrection } from './api'
import { openPrintDocument } from './SchoolFeatures'

export type PortfolioPreviewFile = { fileUrl: string; fileName: string; fileType: string }
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character))

function PortfolioCorrectionStamp({ correction, signatureMode, signatureData }: {
  correction: StudentPortfolioCorrection
  signatureMode: 'uploaded' | 'generated'
  signatureData: string
}) {
  return <div className="portfolio-correction-stamp" style={{ color: correction.color }} dir="rtl">
    <strong>{correction.teacherName}</strong>
    {correction.note && <span>{correction.note}</span>}
    <time>التاريخ الهجري: {formatHijriDateTime(correction.correctedAt)}</time>
    {signatureMode === 'uploaded' && signatureData
      ? <img src={signatureData} alt={`توقيع ${correction.teacherName}`} />
      : <span className="portfolio-correction-signature">{correction.teacherName}</span>}
  </div>
}

export function PortfolioFilePreview({ file, correction, signatureMode, signatureData, schoolName = 'المدرسة', onClose }: {
  file: PortfolioPreviewFile
  correction?: StudentPortfolioCorrection | null
  signatureMode?: 'uploaded' | 'generated'
  signatureData?: string
  schoolName?: string
  onClose: () => void
}) {
  const selectedSignatureMode = signatureMode || 'generated'
  const selectedSignatureData = signatureData || ''
  const printCorrection = () => {
    if (!correction) return
    const signature = selectedSignatureMode === 'uploaded' && selectedSignatureData
      ? `<img class="signature" src="${escapeHtml(selectedSignatureData)}" alt="التوقيع">`
      : `<span class="signature generated">${escapeHtml(correction.teacherName)}</span>`
    const source = isImage
      ? `<img class="source-image" src="${escapeHtml(file.fileUrl)}" alt="${escapeHtml(file.fileName)}">`
      : isPdf
        ? `<iframe class="source-pdf" src="${escapeHtml(file.fileUrl)}" title="${escapeHtml(file.fileName)}"></iframe>`
        : `<div class="word-file"><strong>${escapeHtml(file.fileName || 'ملف Word')}</strong><p>الملف الأصلي متاح للتنزيل من شاشة المعاينة.</p></div>`
    const contents = `<style>.corrected-sheet{position:relative;height:230mm;display:grid;place-items:center;overflow:hidden}.corrected-sheet .source-image{max-width:100%;max-height:100%;object-fit:contain}.corrected-sheet .source-pdf{position:absolute;inset:0;width:100%;height:100%;border:0}.corrected-sheet .word-file{align-self:center;text-align:center;color:#334155}.corrected-sheet .stamp{position:absolute;z-index:2;left:0;bottom:0;display:grid;justify-items:start;gap:3px;max-width:65%;padding:8px 11px;border:1px solid currentColor;border-radius:8px;background:rgba(255,255,255,.9);font-size:12px;line-height:1.45}.corrected-sheet .stamp strong,.corrected-sheet .signature.generated{font-family:'Segoe Print','Comic Sans MS','Aref Ruqaa','Amiri','Traditional Arabic',serif;font-size:16px;font-style:italic}.corrected-sheet .stamp time{font-size:10px}.corrected-sheet .signature{display:block;max-width:105px;max-height:42px;object-fit:contain;object-position:right center}.corrected-sheet .signature.generated{font-size:19px}</style><section class="page"><div class="corrected-sheet">${source}<div class="stamp" style="color:${escapeHtml(correction.color)}"><strong>${escapeHtml(correction.teacherName)}</strong>${correction.note ? `<span>${escapeHtml(correction.note)}</span>` : ''}<time>التاريخ الهجري: ${escapeHtml(formatHijriDateTime(correction.correctedAt))}</time>${signature}</div></div></section>`
    openPrintDocument(`تصحيح ${file.fileName || 'ملف الإنجاز'}`, contents, schoolName)
  }
  const isImage = file.fileType.startsWith('image/')
  const isPdf = file.fileType === 'application/pdf'
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return <div className="portfolio-preview-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="portfolio-preview-dialog" role="dialog" aria-modal="true" aria-label={`معاينة ${file.fileName || 'ملف الإنجاز'}`}>
      <header><div><span>معاينة ملف الإنجاز</span><strong>{file.fileName || 'ملف مرفوع'}</strong></div><button type="button" className="portfolio-preview-close" onClick={onClose} aria-label="إغلاق المعاينة"><X size={21} /><span>إغلاق</span></button></header>
      <div className={`portfolio-preview-content ${isImage ? 'image' : isPdf ? 'pdf' : 'download'}`}>
        {isImage ? <div className="portfolio-preview-image-wrap"><img src={file.fileUrl} alt={file.fileName || 'ملف إنجاز الطالب'} />{correction && <PortfolioCorrectionStamp correction={correction} signatureMode={selectedSignatureMode} signatureData={selectedSignatureData} />}</div> : isPdf ? <div className="portfolio-preview-pdf-wrap"><iframe src={file.fileUrl} title={file.fileName || 'ملف إنجاز الطالب'} />{correction && <PortfolioCorrectionStamp correction={correction} signatureMode={selectedSignatureMode} signatureData={selectedSignatureData} />}</div> : <div className="portfolio-preview-download-wrap"><FileText size={52} /><h2>هذا الملف بصيغة Word</h2><p>يمكن تنزيله وفتحه في تطبيق المستندات على جهازك.</p>{correction && <PortfolioCorrectionStamp correction={correction} signatureMode={selectedSignatureMode} signatureData={selectedSignatureData} />}</div>}
      </div>
      <footer><a href={file.fileUrl} download><Download size={17} /> تنزيل الملف الأصلي</a>{correction && <button type="button" onClick={printCorrection}><Printer size={17} /> طباعة مع التصحيح</button>}<button type="button" onClick={onClose}>العودة إلى الموقع</button></footer>
    </section>
  </div>
}
