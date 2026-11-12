import { useEffect, useRef } from 'react'
import html from './resultsAnalyzer/analyzer.html?raw'
import css from './resultsAnalyzer/analyzer.css?raw'
import { openPrintDocument } from './SchoolFeatures'
import { initResultsAnalyzer } from './resultsAnalyzer/analyzer.js'

export function ResultsAnalyzer({ schoolName }: { schoolName: string }) {
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
      const copy = report.cloneNode(true) as HTMLElement
      copy.querySelector('.official-header .header-right')?.remove()
      copy.querySelector('.report-top')?.remove()
      const printCss = css.replace(':root{', 'body{')
      openPrintDocument('تحليل نتائج الطلاب', `<style>${printCss}</style>${copy.innerHTML}`, schoolName)
    }, schoolName)
    return () => { root.replaceChildren() }
  }, [schoolName])
  return <div ref={host} aria-label="محلل نتائج الطلاب" />
}
