import { useEffect } from 'react'
import { Download, FileText, X } from 'lucide-react'

export type PortfolioPreviewFile = { fileUrl: string; fileName: string; fileType: string }

export function PortfolioFilePreview({ file, onClose }: { file: PortfolioPreviewFile; onClose: () => void }) {
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
        {isImage ? <img src={file.fileUrl} alt={file.fileName || 'ملف إنجاز الطالب'} /> : isPdf ? <iframe src={file.fileUrl} title={file.fileName || 'ملف إنجاز الطالب'} /> : <div><FileText size={52} /><h2>هذا الملف بصيغة Word</h2><p>يمكن تنزيله وفتحه في تطبيق المستندات على جهازك.</p></div>}
      </div>
      <footer><a href={file.fileUrl} download><Download size={17} /> تنزيل الملف</a><button type="button" onClick={onClose}>العودة إلى الموقع</button></footer>
    </section>
  </div>
}
