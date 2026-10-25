import { useEffect } from 'react'
import { Download, FileText, Printer, X } from 'lucide-react'
import type { StudentPortfolioCorrection } from './api'
import { openPrintDocument } from './SchoolFeatures'

export type PortfolioPreviewFile = { fileUrl: string; fileName: string; fileType: string }
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character))

function numericHijriDate(value: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-arab', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Riyadh',
  }).formatToParts(new Date(value)).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  return `${parts.day}/${parts.month}/${parts.year} هـ`
}

function teacherNameParts(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return { shortName: parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]}` : parts[0] || name, initials: parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : parts[0]?.[0] || name[0] || '' }
}

function SignatureDrawing({ initials }: { initials: string }) {
  return <svg className="portfolio-correction-signature" viewBox="0 0 180 56" role="img" aria-label={`أحرف مزخرفة: ${initials}`} preserveAspectRatio="xMinYMid meet">
    <path d="M 17 39 C 36 50, 42 15, 66 18 S 89 52, 107 31 C 120 16, 134 15, 161 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <text x="90" y="43" textAnchor="middle" direction="rtl" unicodeBidi="bidi-override" fontFamily="'Aref Ruqaa', 'Amiri', 'Traditional Arabic', serif" fontSize="36" fontWeight="700" fill="currentColor">{initials}</text>
    <path d="M 30 49 C 72 43, 112 54, 158 44" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
}

function signatureSvg(initials: string) {
  return `<svg class="signature generated" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 56" role="img" aria-label="أحرف مزخرفة" preserveAspectRatio="xMinYMid meet"><path d="M 17 39 C 36 50, 42 15, 66 18 S 89 52, 107 31 C 120 16, 134 15, 161 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><text x="90" y="43" text-anchor="middle" direction="rtl" unicode-bidi="bidi-override" font-family="'Aref Ruqaa','Amiri','Traditional Arabic',serif" font-size="36" font-weight="700" fill="currentColor">${escapeHtml(initials)}</text><path d="M 30 49 C 72 43, 112 54, 158 44" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`
}

function PortfolioCorrectionStamp({ correction, signatureMode, signatureData }: {
  correction: StudentPortfolioCorrection
  signatureMode: 'uploaded' | 'generated'
  signatureData: string
}) {
  const teacher = teacherNameParts(correction.teacherName)
  return <div className="portfolio-correction-stamp" style={{ color: correction.color }} dir="rtl">
    {correction.note && <span>{correction.note}</span>}
    <strong>{teacher.shortName}</strong>
    {signatureMode === 'uploaded' && signatureData
      ? <img src={signatureData} alt={`توقيع ${correction.teacherName}`} />
      : <SignatureDrawing initials={teacher.initials} />}
    <time dir="rtl"><bdi dir="rtl" className="portfolio-correction-date">{numericHijriDate(correction.correctedAt)}</bdi></time>
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
    const teacher = teacherNameParts(correction.teacherName)
    const signature = selectedSignatureMode === 'uploaded' && selectedSignatureData
      ? `<img class="signature" src="${escapeHtml(selectedSignatureData)}" alt="التوقيع">`
      : signatureSvg(teacher.initials)
    const source = isImage
      ? `<div class="source-image-wrap"><img class="source-image" src="${escapeHtml(file.fileUrl)}" alt="${escapeHtml(file.fileName)}"><div class="stamp" style="color:${escapeHtml(correction.color)}">${correction.note ? `<span>${escapeHtml(correction.note)}</span>` : ''}<strong>${escapeHtml(teacher.shortName)}</strong>${signature}<time dir="rtl"><bdi dir="rtl">${escapeHtml(numericHijriDate(correction.correctedAt))}</bdi></time></div></div>`
      : isPdf
        ? `<iframe class="source-pdf" src="${escapeHtml(file.fileUrl)}" title="${escapeHtml(file.fileName)}"></iframe>`
        : `<div class="word-file"><strong>${escapeHtml(file.fileName || 'ملف Word')}</strong><p>الملف الأصلي متاح للتنزيل من شاشة المعاينة.</p></div>`
    const wordStamp = `<div class="stamp" style="color:${escapeHtml(correction.color)}">${correction.note ? `<span>${escapeHtml(correction.note)}</span>` : ''}<strong>${escapeHtml(teacher.shortName)}</strong>${signature}<time dir="rtl"><bdi dir="rtl">${escapeHtml(numericHijriDate(correction.correctedAt))}</bdi></time></div>`
    const contents = `<style>.corrected-sheet{position:relative;min-height:230mm;display:grid;place-items:center}.source-image-wrap{position:relative;display:inline-block;max-width:100%;max-height:265mm;line-height:0}.corrected-sheet .source-image{display:block;max-width:100%;max-height:265mm;object-fit:contain}.corrected-sheet .source-pdf{position:absolute;inset:0;width:100%;height:100%;border:0}.corrected-sheet .word-file{align-self:center;text-align:center;color:#334155}.corrected-sheet .stamp{position:absolute;z-index:2;left:0;bottom:0;display:grid;justify-items:start;gap:1px;max-width:70%;font-size:11px;font-weight:800;line-height:1.3;text-align:left;direction:rtl}.corrected-sheet .stamp strong{font-size:12px;font-weight:900}.corrected-sheet .stamp time{position:relative;z-index:2;margin-top:-8px;direction:rtl;font-size:10px;font-weight:800}.corrected-sheet .signature{display:block;width:76px;height:30px;object-fit:contain;object-position:left center}.corrected-sheet .signature.generated{width:88px;height:32px}.corrected-sheet .stamp img.signature{filter:drop-shadow(0 0 2px #fff)}@media print{.corrected-sheet{min-height:0}}</style><section class="page"><div class="corrected-sheet">${isImage ? source : `${isPdf ? source : `<div class="word-file"><strong>${escapeHtml(file.fileName || 'ملف Word')}</strong><p>الملف الأصلي متاح للتنزيل من شاشة المعاينة.</p></div>`}${wordStamp}`}</div></section>`
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
