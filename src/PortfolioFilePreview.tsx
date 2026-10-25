import { useEffect } from 'react'
import { Download, FileText, Printer, X } from 'lucide-react'
import type { StudentPortfolioCorrection } from './api'
import { openPrintDocument } from './SchoolFeatures'

export type PortfolioPreviewFile = { fileUrl: string; fileName: string; fileType: string }
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character))

function numericHijriDate(value: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Riyadh',
  }).formatToParts(new Date(value)).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  return `${parts.day}/${parts.month}/${parts.year} هـ`
}

function signaturePath(name: string) {
  let seed = Array.from(name).reduce((value, character) => (Math.imul(value, 31) + (character.codePointAt(0) || 0)) >>> 0, 7)
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x1_0000_0000
  }
  let path = `M 5 ${25 + Math.round(next() * 12)}`
  for (let index = 0; index < 5; index += 1) {
    const x = 18 + index * 34
    path += ` C ${x} ${5 + Math.round(next() * 40)}, ${x + 15} ${5 + Math.round(next() * 40)}, ${x + 30} ${8 + Math.round(next() * 37)}`
  }
  return path
}

function SignatureDrawing({ name }: { name: string }) {
  return <svg className="portfolio-correction-signature" viewBox="0 0 200 54" role="img" aria-label={`رسم توقيع ${name}`} preserveAspectRatio="none">
    <path d={signaturePath(name)} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M 22 46 C 65 40, 115 52, 185 38" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
}

function signatureSvg(name: string) {
  return `<svg class="signature generated" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 54" role="img" aria-label="رسم التوقيع" preserveAspectRatio="none"><path d="${signaturePath(name)}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M 22 46 C 65 40, 115 52, 185 38" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`
}

function PortfolioCorrectionStamp({ correction, signatureMode, signatureData }: {
  correction: StudentPortfolioCorrection
  signatureMode: 'uploaded' | 'generated'
  signatureData: string
}) {
  return <div className="portfolio-correction-stamp" style={{ color: correction.color }} dir="rtl">
    <strong>{correction.teacherName}</strong>
    {correction.note && <span>{correction.note}</span>}
    <time>{numericHijriDate(correction.correctedAt)}</time>
    {signatureMode === 'uploaded' && signatureData
      ? <img src={signatureData} alt={`توقيع ${correction.teacherName}`} />
      : <SignatureDrawing name={correction.teacherName} />}
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
      : signatureSvg(correction.teacherName)
    const source = isImage
      ? `<div class="source-image-wrap"><img class="source-image" src="${escapeHtml(file.fileUrl)}" alt="${escapeHtml(file.fileName)}"><div class="stamp" style="color:${escapeHtml(correction.color)}"><strong>${escapeHtml(correction.teacherName)}</strong>${correction.note ? `<span>${escapeHtml(correction.note)}</span>` : ''}<time>${escapeHtml(numericHijriDate(correction.correctedAt))}</time>${signature}</div></div>`
      : isPdf
        ? `<iframe class="source-pdf" src="${escapeHtml(file.fileUrl)}" title="${escapeHtml(file.fileName)}"></iframe>`
        : `<div class="word-file"><strong>${escapeHtml(file.fileName || 'ملف Word')}</strong><p>الملف الأصلي متاح للتنزيل من شاشة المعاينة.</p></div>`
    const wordStamp = `<div class="stamp" style="color:${escapeHtml(correction.color)}"><strong>${escapeHtml(correction.teacherName)}</strong>${correction.note ? `<span>${escapeHtml(correction.note)}</span>` : ''}<time>${escapeHtml(numericHijriDate(correction.correctedAt))}</time>${signature}</div>`
    const contents = `<style>.corrected-sheet{position:relative;min-height:230mm;display:grid;place-items:center}.source-image-wrap{position:relative;display:inline-block;max-width:100%;max-height:265mm;line-height:0}.corrected-sheet .source-image{display:block;max-width:100%;max-height:265mm;object-fit:contain}.corrected-sheet .source-pdf{position:absolute;inset:0;width:100%;height:100%;border:0}.corrected-sheet .word-file{align-self:center;text-align:center;color:#334155}.corrected-sheet .stamp{position:absolute;z-index:2;left:0;bottom:0;display:grid;justify-items:start;gap:2px;max-width:70%;font-size:10px;line-height:1.3;text-align:left;direction:rtl;text-shadow:0 0 2px #fff,0 0 4px #fff}.corrected-sheet .stamp strong{font-family:'Segoe Print','Comic Sans MS','Aref Ruqaa','Amiri','Traditional Arabic',serif;font-size:12px;font-style:italic}.corrected-sheet .stamp time{font-size:9px}.corrected-sheet .signature{display:block;width:76px;height:28px;object-fit:contain;object-position:left center}.corrected-sheet .signature.generated{width:82px;height:24px}.corrected-sheet .stamp img.signature{filter:drop-shadow(0 0 2px #fff)}@media print{.corrected-sheet{min-height:0}}</style><section class="page"><div class="corrected-sheet">${isImage ? source : `${isPdf ? source : `<div class="word-file"><strong>${escapeHtml(file.fileName || 'ملف Word')}</strong><p>الملف الأصلي متاح للتنزيل من شاشة المعاينة.</p></div>`}${wordStamp}`}</div></section>`
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
