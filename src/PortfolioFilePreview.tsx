import { useEffect } from 'react'
import { Download, FileText, Printer, X } from 'lucide-react'
import type { StudentPortfolioCorrection } from './api'
import { openPrintDocument } from './SchoolFeatures'

export type PortfolioPreviewFile = { fileUrl: string; fileName: string; fileType: string }
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character))

function numericHijriDateParts(value: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-arab', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Riyadh',
  }).formatToParts(new Date(value)).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  return { day: String(parts.day), month: String(parts.month), year: String(parts.year) }
}

function hijriDateHtml(value: string) {
  const { day, month, year } = numericHijriDateParts(value)
  return `<time dir="rtl" class="portfolio-correction-date"><bdi dir="ltr">${escapeHtml(day)}</bdi><i>/</i><bdi dir="ltr">${escapeHtml(month)}</bdi><i>/</i><bdi dir="ltr">${escapeHtml(year)}</bdi><span>هـ</span></time>`
}

function HijriDate({ value }: { value: string }) {
  const { day, month, year } = numericHijriDateParts(value)
  return <time dir="rtl" className="portfolio-correction-date"><bdi dir="ltr">{day}</bdi><i>/</i><bdi dir="ltr">{month}</bdi><i>/</i><bdi dir="ltr">{year}</bdi><span>هـ</span></time>
}

function teacherNameParts(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]}` : parts[0] || name
}

function SignatureDrawing() {
  return <svg className="portfolio-correction-signature" viewBox="0 0 180 56" role="img" aria-label="زخرفة توقيع عامة" preserveAspectRatio="xMinYMid meet">
    <path d="M 6 33 C 31 30, 47 35, 69 32 C 55 27, 52 15, 64 11 C 77 7, 105 11, 111 19 C 117 28, 99 33, 83 28 C 76 26, 71 20, 74 16 C 79 22, 85 37, 93 38 C 102 39, 108 22, 118 23 C 127 23, 121 34, 132 36 C 143 38, 154 30, 174 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
    <path d="M 23 43 C 67 39, 111 47, 158 40" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity="0.9" />
  </svg>
}

function signatureSvg() {
  return `<svg class="signature generated" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 56" role="img" aria-label="زخرفة توقيع عامة" preserveAspectRatio="xMinYMid meet"><path d="M 6 33 C 31 30, 47 35, 69 32 C 55 27, 52 15, 64 11 C 77 7, 105 11, 111 19 C 117 28, 99 33, 83 28 C 76 26, 71 20, 74 16 C 79 22, 85 37, 93 38 C 102 39, 108 22, 118 23 C 127 23, 121 34, 132 36 C 143 38, 154 30, 174 32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/><path d="M 23 43 C 67 39, 111 47, 158 40" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" opacity="0.9"/></svg>`
}

function PortfolioCorrectionStamp({ correction, signatureMode, signatureData }: {
  correction: StudentPortfolioCorrection
  signatureMode: 'uploaded' | 'generated'
  signatureData: string
}) {
  return <div className="portfolio-correction-stamp" style={{ color: correction.color }} dir="rtl">
    {correction.note && <span>{correction.note}</span>}
    <strong>{teacherNameParts(correction.teacherName)}</strong>
    {signatureMode === 'uploaded' && signatureData
      ? <span className="portfolio-correction-uploaded-signature" role="img" aria-label={`توقيع ${correction.teacherName}`} style={{ maskImage: `url("${signatureData}")`, WebkitMaskImage: `url("${signatureData}")` }} />
      : <SignatureDrawing />}
    <HijriDate value={correction.correctedAt} />
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
      ? `<span class="signature uploaded" role="img" aria-label="التوقيع" style="-webkit-mask-image:url(&quot;${escapeHtml(selectedSignatureData)}&quot;);mask-image:url(&quot;${escapeHtml(selectedSignatureData)}&quot;)"></span>`
      : signatureSvg()
    const source = isImage
      ? `<div class="source-image-wrap"><img class="source-image" src="${escapeHtml(file.fileUrl)}" alt="${escapeHtml(file.fileName)}"><div class="stamp" style="color:${escapeHtml(correction.color)}">${correction.note ? `<span>${escapeHtml(correction.note)}</span>` : ''}<strong>${escapeHtml(teacher)}</strong>${signature}${hijriDateHtml(correction.correctedAt)}</div></div>`
      : isPdf
        ? `<iframe class="source-pdf" src="${escapeHtml(file.fileUrl)}" title="${escapeHtml(file.fileName)}"></iframe>`
        : `<div class="word-file"><strong>${escapeHtml(file.fileName || 'ملف Word')}</strong><p>الملف الأصلي متاح للتنزيل من شاشة المعاينة.</p></div>`
    const wordStamp = `<div class="stamp" style="color:${escapeHtml(correction.color)}">${correction.note ? `<span>${escapeHtml(correction.note)}</span>` : ''}<strong>${escapeHtml(teacher)}</strong>${signature}${hijriDateHtml(correction.correctedAt)}</div>`
    const contents = `<style>.corrected-sheet{position:relative;min-height:230mm;display:grid;place-items:center}.source-image-wrap{position:relative;display:inline-block;max-width:100%;max-height:265mm;line-height:0}.corrected-sheet .source-image{display:block;max-width:100%;max-height:265mm;object-fit:contain}.corrected-sheet .source-pdf{position:absolute;inset:0;width:100%;height:100%;border:0}.corrected-sheet .word-file{align-self:center;text-align:center;color:#334155}.corrected-sheet .stamp{position:absolute;z-index:2;left:7mm;bottom:11mm;display:grid;justify-items:start;gap:1px;max-width:60%;padding:1.2mm 2.5mm;border:1px solid color-mix(in srgb,currentColor 35%,transparent);border-radius:2mm;background:rgba(255,255,255,0.06);font-size:10px;font-weight:900;line-height:1.2;text-align:left;direction:ltr}.corrected-sheet .stamp>span,.corrected-sheet .stamp>strong,.corrected-sheet .stamp>time{direction:rtl;text-align:left;font-weight:900}.corrected-sheet .stamp strong{font-size:11px}.corrected-sheet .portfolio-correction-date{display:flex;flex-direction:row;gap:1px;direction:rtl;unicode-bidi:isolate}.corrected-sheet .portfolio-correction-date bdi{direction:ltr;unicode-bidi:isolate}.corrected-sheet .stamp time{position:relative;z-index:2;margin-top:-6px;font-size:9px}.corrected-sheet .signature{display:block;width:72px;height:26px;object-fit:contain;object-position:left center}.corrected-sheet .signature.generated{width:78px;height:28px}.corrected-sheet .signature.uploaded{background-color:currentColor;mask-repeat:no-repeat;-webkit-mask-repeat:no-repeat;mask-position:left center;-webkit-mask-position:left center;mask-size:contain;-webkit-mask-size:contain}@media print{.corrected-sheet{min-height:0}}</style><section class="page"><div class="corrected-sheet">${isImage ? source : `${isPdf ? source : `<div class="word-file"><strong>${escapeHtml(file.fileName || 'ملف Word')}</strong><p>الملف الأصلي متاح للتنزيل من شاشة المعاينة.</p></div>`}${wordStamp}`}</div></section>`
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
