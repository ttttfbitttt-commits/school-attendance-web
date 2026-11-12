import { useEffect, useRef } from 'react'
import html from './resultsAnalyzer/analyzer.html?raw'
import css from './resultsAnalyzer/analyzer.css?raw'
import { brandReportFragment } from './SchoolFeatures'
import { initResultsAnalyzer } from './resultsAnalyzer/analyzer.js'

async function downloadAnalysis(report: HTMLElement, schoolName: string, region: string) {
  const copy = report.cloneNode(true) as HTMLElement
  copy.querySelector('.official-header .header-right')?.remove()
  copy.querySelector('.report-top')?.remove()
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.tabIndex = -1
  iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;height:1100px;border:0;pointer-events:none;'
  const loaded = new Promise<void>((resolve, reject) => {
    iframe.onload = () => resolve()
    iframe.onerror = () => reject(new Error('تعذر تجهيز معاينة التقرير.'))
  })
  const sections = Array.from(copy.querySelectorAll<HTMLElement>('.analysis-section'))
  const part = (selector: string) => copy.querySelector<HTMLElement>(selector)?.outerHTML || ''
  const firstPage = part('.official-header') + part('.summary-banner') + part('.kpi-grid') + sections.slice(0, 2).map(section => section.outerHTML).join('')
  const secondPage = sections.slice(2).map(section => section.outerHTML).join('') + part('.signatures-section') + part('.official-footer')
  iframe.srcdoc = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>${css} body{background:#fff;margin:0;padding:0;direction:rtl;font-family:Tahoma,Arial,sans-serif}.print-hide{display:none!important}.report{display:block!important;border:0;box-shadow:none;padding:0}.page{width:100%;padding:8px;box-sizing:border-box}.official-header .header-right{display:none}.official-header{grid-template-columns:1fr 1fr}</style></head><body><section class="page">${brandReportFragment(firstPage, schoolName, region)}</section><section class="page">${brandReportFragment(secondPage, schoolName, region)}</section></body></html>`
  document.body.append(iframe)
  try {
    await loaded
    const target = iframe.contentDocument
    if (!target?.body) throw new Error('تعذر تجهيز التقرير.')
    const { downloadReportPdf } = await import('./reportPdf')
    await downloadReportPdf(target, 'تحليل نتائج الطلاب', 'portrait')
  } finally { iframe.remove() }
}

export function ResultsAnalyzer({ schoolName, region, semester }: { schoolName: string; region: string; semester: string }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!host.current) return
    const root = host.current.shadowRoot || host.current.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = css.replace(':root{', ':host{').replace('body{margin:0;background:var(--bg);font-family:Tajawal,Arial,sans-serif;color:var(--ink)}', ':host{display:block;font-family:Tajawal,Arial,sans-serif;color:var(--ink)}') + '.app-shell{max-width:none;padding:0}.hero{background:linear-gradient(120deg,#0b4978,#176c87)}.official-header .header-right{display:none}.official-header{grid-template-columns:1fr 1fr}'
    const container = document.createElement('div')
    container.innerHTML = html
    root.replaceChildren(style, container)
    initResultsAnalyzer(root, (report: HTMLElement) => {
      const button = root.getElementById('printReport') as HTMLButtonElement | null
      if (!button || button.disabled) return
      const oldText = button.textContent || 'تصدير PDF'
      button.disabled = true
      button.textContent = 'جارٍ تجهيز PDF…'
      const school = root.getElementById('headerSchool')?.textContent?.trim() || schoolName
      void downloadAnalysis(report, school, region).catch(error => {
        console.error('Unable to generate analysis PDF', error)
        window.alert('تعذر تجهيز ملف PDF. أعد المحاولة بعد اكتمال تحميل التقرير.')
      }).finally(() => { button.disabled = false; button.textContent = oldText })
    }, schoolName, semester)
    return () => { root.replaceChildren() }
  }, [schoolName, region, semester])
  return <div ref={host} aria-label="محلل نتائج الطلاب" />
}
