import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
export function initResultsAnalyzer(root, onPrint, defaultSchool) {

const $ = (id) => root.getElementById(id);
const upload = $('pdfFile'), uploadPanel = $('uploadPanel'), reviewPanel = $('reviewPanel'), reportPanel = $('reportPanel'), status = $('status');
let records = [];
let extractedPages = [];
const band = (n) => n >= 90 ? 'excellent' : n >= 80 ? 'very-good' : n >= 70 ? 'good' : n >= 60 ? 'acceptable' : 'review';
const bandLabel = (b) => ({ excellent: 'ممتاز', 'very-good': 'جيد جداً', good: 'جيد', acceptable: 'مقبول', review: 'يتطلب مراجعة' })[b];

function normalizeText(text = '') {
  return String(text)
    .normalize('NFKC')
    .replace(/[\u061C\u200C-\u200F\u0640]/g, '')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[\u06CC\u0649]/g, 'ي')
    .replace(/\u06A9/g, 'ك')
    .replace(/\u06BE/g, 'ه')
    .replace(/[٠-٩]/g, (digit) => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit))
    .replace(/[٬،]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).replace(/[^0-9.,]/g, '').replace(/,/g, '.');
  if (!text || Number.isNaN(Number(text))) return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

function classify(text, filename) {
  const sample = normalizeText(`${text} ${filename}`).toLowerCase();
  if (/(certificate of the .*secondary grade|الثانوية|secondary certificate)/i.test(sample)) return 'secondary';
  if (/(intermediate|المتوسطة|المتوسط)/i.test(sample)) return 'intermediate';
  if (/(literacy|محو\s*أمية|محو_أمية|literacy second grade|literacy third grade)/i.test(sample)) return 'literacy';
  if (/(primary|elementary|الابتدائية|الابتدائي)/i.test(sample)) return 'primary';
  if (/(semester|الفصل|semester degree|notification)/i.test(sample)) return 'semester';
  return 'semester';
}

function pageTextFromContent(content) {
  const rows = new Map();
  for (const item of content.items) {
    if (!item.str) continue;
    const y = Number(item.transform?.[5]);
    const key = Number.isFinite(y) ? Math.round(y * 2) / 2 : 0;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(item);
  }
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, items]) => {
      const rtlCount = items.filter((item) => item.dir === 'rtl').length;
      const direction = rtlCount > items.length / 2 ? 'rtl' : 'ltr';
      const ordered = [...items].sort((a, b) => {
        const xDifference = Number(a.transform?.[4] || 0) - Number(b.transform?.[4] || 0);
        return direction === 'rtl' ? -xDifference : xDifference;
      });
      return ordered.map((item) => item.str).join('');
    })
    .join('\n');
}

function scoreFromText(text) {
  const lines = String(text || '').split(/\r?\n/).map(normalizeText).filter(Boolean);
  if (!lines.length) return null;

  const labels = [
    /(?:The\s+)?Grand\s+Point\s+Average/i,
    /(?:المعدل|المتوسط)\s*(?:العام)?/i,
    /\bCGP\b/i,
    /\bGPA\b/i
  ];

  for (const label of labels) {
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      const match = label.exec(line);
      if (!match) continue;

      const candidates = [
        ...line.slice(match.index + match[0].length).matchAll(/(?:%|٪)?\s*(\d{1,3}(?:[.,]\d+)?)/g)
      ];
      for (const candidate of candidates) {
        const score = cleanNumber(candidate[1]);
        if (score !== null && score >= 0 && score <= 100) return score;
      }

      if (/\b(?:CGP|GPA)\b/i.test(match[0])) {
        for (let distance = 1; distance <= 3; distance += 1) {
          const previousLine = lines[lineIndex - distance] || '';
          const previousValues = [...previousLine.matchAll(/(\d{1,3}[.,]\d{1,2})/g)];
          for (let index = previousValues.length - 1; index >= 0; index -= 1) {
            const score = cleanNumber(previousValues[index][1]);
            if (score !== null && score >= 0 && score <= 100) return score;
          }
        }
      }

      if (/\bCGP\b/i.test(match[0]) && /^Term$/i.test(lines[lineIndex - 1] || '')) {
        const score = cleanNumber(lines[lineIndex - 2]);
        if (score !== null && score >= 0 && score <= 100) return score;
      }

      for (let distance = 1; distance <= 3; distance += 1) {
        const nextLine = lines[lineIndex + distance] || '';
        const markedScore = nextLine.match(/^(?:%|٪)\s*(\d{1,3}(?:[.,]\d+)?)(?![\d.,])/);
        if (markedScore) {
          const score = cleanNumber(markedScore[1]);
          if (score !== null && score >= 0 && score <= 100) return score;
        }
        if (/^(?:(?:%|٪)\s*\d{1,3}(?:[.,]\d+)?|\s*\d{1,3}[.,]\d{1,2})\s*(?:%|٪)?$/.test(nextLine)) {
          const score = cleanNumber(nextLine);
          if (score !== null && score >= 0 && score <= 100) return score;
        }
      }
    }
  }

  return null;
}

function averageFromPage(text) {
  const score = scoreFromText(text);
  return score ?? null;
}

const glyphArabicMap = {
  787: 'ا', 788: 'أ', 789: 'آ', 790: 'إ', 791: 'ب', 792: 'ت', 793: 'ث', 794: 'ج', 795: 'ج',
  796: 'ح', 797: 'ح', 798: 'خ', 799: 'خ', 800: 'س', 801: 'ش', 802: 'ص', 813: 'ض',
  814: 'ع', 815: 'ع', 816: 'ع', 817: 'غ', 818: 'غ', 819: 'غ', 820: 'ف', 821: 'ف',
  823: 'ق', 824: 'ق', 825: 'ك', 826: 'ل', 827: 'م', 828: 'ن', 829: 'ه', 830: 'ه',
  831: 'ه', 832: 'ي', 833: 'ي', 834: 'ة', 835: 'ى', 837: 'ئ', 838: 'لا', 839: 'لا',
  843: 'لأ', 844: 'لأ', 845: 'لآ', 846: 'ئ', 848: 'لآ', 851: 'ء', 852: 'آ', 853: 'أ',
  854: 'ؤ', 855: 'إ', 856: 'ئ', 857: 'ا', 858: 'ب', 859: 'ة', 860: 'ت', 861: 'ث',
  862: 'ج', 863: 'ح', 864: 'خ', 865: 'د', 866: 'ذ', 867: 'ر', 868: 'ز', 869: 'س',
  870: 'ش', 871: 'ص', 872: 'ض', 873: 'ط', 874: 'ظ', 875: 'ع', 876: 'غ', 878: 'ف',
  879: 'ق', 880: 'ك', 881: 'ل', 882: 'م', 883: 'ن', 884: 'ه', 885: 'و', 886: 'ى',
  887: 'ي', 896: 'لإ', 897: 'لإ', 1022: 'ل', 1030: 'ك', 1054: 'ل', 2694: 'الله',
  3035: 'ر', 3036: 'ز', 3050: 'ت', 3051: 'ث', 3052: 'ي'
};

function decodeGlyphs(str) {
  if (!str) return '';
  return Array.from(str).reverse().map((ch) => {
    const code = ch.codePointAt(0);
    return glyphArabicMap[code] ?? (ch === ' ' ? ' ' : '');
  }).join('').replace(/\s+/g, ' ').trim();
}

function decodeGreekShift(str) {
  if (!str) return '';
  let res = '';
  for (const ch of str) {
    const code = ch.codePointAt(0);
    if (code >= 0x380 && code <= 0x3ff) {
      res += String.fromCodePoint(code + 0xfb00);
    } else if (code === 0x0BCC || code === 3020 || code === 0x0BE4 || code === 2694 || code === 0xFDF2) {
      res += ' الله ';
    } else if (ch === '\u0003' || ch === '\u001d' || ch === '\u001c') {
      res += ' ';
    } else {
      res += ch;
    }
  }
  return Array.from(res).reverse().join('').normalize('NFKC').replace(/هللا/g, 'الله').replace(/\s+/g, ' ').trim();
}

function studentName(pageItem, page) {
  const text = typeof pageItem === 'string' ? pageItem : pageItem?.pageText || '';
  const content = typeof pageItem === 'object' ? pageItem?.content : null;
  const opList = typeof pageItem === 'object' ? pageItem?.opList : null;

  // 1. استخراج الاسم العربي لشهادات الثانوية عبر قائمة أوامر العرض (glyph mapping)
  if (opList && opList.fnArray) {
    try {
      const arr = opList.fnArray
        .map((f, i) => ({ f, args: opList.argsArray[i] }))
        .filter((x) => x.f === pdfjsLib.OPS.showText)
        .map((x) => x.args[0].map((g) => (typeof g === 'number' ? '' : g.unicode)).join(''));

      const idx = arr.findIndex((s) => s.includes('͚̺̺͙̓ͩ'));
      if (idx >= 0 && arr[idx + 1]) {
        const arabic = decodeGlyphs(arr[idx + 1]);
        if (arabic && arabic.length >= 3 && !/^(المدرسة|الادارة|وزارة|المستوى)/.test(arabic)) {
          return arabic;
        }
      }
    } catch (e) {
      console.warn('opList name extraction error', e);
    }
  }

  // 2. استخراج الاسم العربي لإشعارات محو الأمية والدرجات عبر فك تشفير المحارف المنقولة
  if (content && content.items) {
    try {
      const studentItem = content.items.find(
        (i) => i.str && (i.str.includes('ΐϟΎτϟ΍') || (i.str.includes('Ϣγ΍') && i.str.includes('ΐϟ')))
      );
      if (studentItem) {
        const decoded = decodeGreekShift(studentItem.str);
        const match = decoded.match(/(?:اسم\s*الطالب|الطالب)[\s\u001d:：\-]*([^\n\r]+)/);
        const nameCandidate = match ? match[1].trim() : decoded.replace(/اسم\s*الطالب/g, '').trim();
        if (nameCandidate && nameCandidate.length >= 3 && !/^(المدرسة|الادارة|وزارة|المستوى)/.test(nameCandidate)) {
          return nameCandidate;
        }
      }
    } catch (e) {
      console.warn('content name extraction error', e);
    }
  }

  // 3. محاولة استخراج الاسم العربي الصريح عبر التعبيرات النمطية
  const cleaned = normalizeText(text);
  const lines = String(text || '').split(/\r?\n/).map(normalizeText).filter(Boolean);
  const arabicPatterns = [
    /اسم\s*الطالب\s*[:：]?\s*([\u0600-\u06FF\s]{4,80}?)(?=\s+(?:الصف|تاريخ|الجنسية|المرحلة|المستوى|رقم|الهوية))/i,
    /الطالب\s*[:：]?\s*([\u0600-\u06FF\s]{4,80}?)(?=\s+(?:الصف|الفصل|التاريخ|الجنسية))/i
  ];

  for (const pattern of arabicPatterns) {
    const match = cleaned.match(pattern);
    const name = match?.[1]?.trim().replace(/\s+/g, ' ');
    if (name && !/^(?:Name|اسم)$/i.test(name)) return name;
  }

  // 4. محاولة استخراج الاسم الإنجليزي كبديل إذا تعذر العربي
  const enPatterns = [
    /Student['’`]?s\s*Name\s*[:：]?\s*([A-Za-z][A-Za-z\s.'’-]{2,80}?)(?=\s+(?:Class|Date|Nationality|Gender)\b)/i,
    /Student\s*Name\s*[:：]?\s*([A-Za-z][A-Za-z\s.'’-]{2,80}?)(?=\s+(?:Class|Date|Nationality|Gender)\b)/i
  ];
  for (const pattern of enPatterns) {
    const match = cleaned.match(pattern);
    const name = match?.[1]?.trim().replace(/\s+/g, ' ');
    if (name && !/^(?:Name|اسم)$/i.test(name)) return name;
  }

  const nameLabelIndex = lines.findIndex((line) => /Student['’`]?s\s*Name|Student\s*Name/i.test(line));
  if (nameLabelIndex >= 0) {
    const nearbyName = lines.slice(nameLabelIndex + 1, nameLabelIndex + 11).find((line) => {
      const words = line.trim().split(/\s+/);
      return /^[A-Z][A-Z\s.'’-]{4,80}$/.test(line) && words.length >= 2 && words.every((word) => word.length > 1);
    });
    if (nearbyName) return nearbyName;
  }

  return `الطالب ${page}`;
}

function buildRecordsFromPages(pages) {
  const records = [];
  pages.forEach((pageItem, index) => {
    const text = typeof pageItem === 'string' ? pageItem : pageItem?.pageText || '';
    const average = averageFromPage(text);
    if (average !== null) {
      records.push({ name: studentName(pageItem, index + 1), average, page: index + 1 });
    }
  });
  return records;
}

function renderDistribution() {
  const total = records.length || 1;
  const bands = [
    { key: 'excellent', label: 'ممتاز', range: '90% - 100%', color: '#128255', badgeClass: 'grade-excellent' },
    { key: 'very-good', label: 'جيد جداً', range: '80% إلى أقل من 90%', color: '#1b75bb', badgeClass: 'grade-very-good' },
    { key: 'good', label: 'جيد', range: '70% إلى أقل من 80%', color: '#b7791f', badgeClass: 'grade-good' },
    { key: 'acceptable', label: 'مقبول', range: '60% إلى أقل من 70%', color: '#c25e00', badgeClass: 'grade-acceptable' },
    { key: 'review', label: 'أقل من 60%', range: 'أقل من 60%', color: '#c5221f', badgeClass: 'grade-review' }
  ];

  const tableRows = [];
  const chartRows = [];

  for (const b of bands) {
    const count = records.filter((item) => band(item.average) === b.key).length;
    const pct = (count * 100) / total;

    tableRows.push(`
      <tr>
        <td><span class="grade-badge ${b.badgeClass}">${b.label}</span></td>
        <td>${b.range}</td>
        <td><strong>${count}</strong></td>
        <td>${pct.toFixed(2)}%</td>
      </tr>
    `);

    chartRows.push(`
      <div class="dist-chart-row">
        <span class="dist-chart-label" style="color: ${b.color};">${b.label}</span>
        <div class="dist-chart-track">
          <div class="dist-chart-fill" style="width: ${Math.max(count ? 4 : 0, pct)}%; background: ${b.color};"></div>
        </div>
        <span class="dist-chart-stat">${count} (${pct.toFixed(1)}%)</span>
      </div>
    `);
  }

  const tbody = $('distributionTableBody');
  if (tbody) tbody.innerHTML = tableRows.join('');
  const chart = $('distributionChartBars');
  if (chart) chart.innerHTML = chartRows.join('');
}

const subjectDefinitions = [
  { key: 'quran', label: 'القرآن والدراسات الإسلامية', patterns: [/The Holy Qur['’]?an\s*&\s*Islamic\s*studies/i, /القرآن(?:\s*الكريم)?(?:\s*و\s*الدراسات\s*الإسلامية)?/] },
  { key: 'arabic', label: 'اللغة العربية', patterns: [/Arabic\s*language/i, /اللغة\s*العربية/] },
  { key: 'english', label: 'اللغة الإنجليزية', patterns: [/English\s*Language/i, /اللغة\s*الإنجليزية/] },
  { key: 'math', label: 'الرياضيات', patterns: [/Mathematics/i, /الرياضيات/, /الحساب/] },
  { key: 'science', label: 'العلوم', patterns: [/Science/i, /العلوم/] },
  { key: 'social', label: 'الدراسات الاجتماعية', patterns: [/Social\s*Studies/i, /الدراسات\s*الاجتماعية/, /الاجتماعيات/] },
  { key: 'islamic', label: 'التربية الإسلامية', patterns: [/Islamic\s*Education/i, /التربية\s*الإسلامية/] },
  { key: 'arts', label: 'التربية الفنية', patterns: [/Art\s*Education/i, /التربية\s*الفنية/] },
  { key: 'pe', label: 'التربية البدنية', patterns: [/Physical\s*Education/i, /التربية\s*البدنية/] },
  { key: 'life', label: 'المهارات الحياتية والأسرية', patterns: [/Life\s*Skills/i, /المهارات\s*الحياتية/, /المهارات\s*الأسرية/] },
  { key: 'computer', label: 'الحاسب وتقنية المعلومات', patterns: [/Computer\s*&?\s*information\s*Technology/i, /الحاسب\s*وتقنية\s*المعلومات/] },
  { key: 'business', label: 'المواد المهنية', patterns: [/Financial\s*Management/i, /Introduction\s*to\s*Business/i, /Business\s*Decision\s*Making/i] },
  { key: 'history', label: 'التاريخ', patterns: [/History/i, /التاريخ/] },
  { key: 'economics', label: 'الاقتصاد', patterns: [/Principles\s*of\s*Economics/i, /الاقتصاد/] },
  { key: 'fitness', label: 'اللياقة والصحة', patterns: [/Fitness\s*&\s*Health\s*Culture/i, /اللياقة\s*والصحة/] }
];

function parseSubjectAverages(pageTexts) {
  const valuesBySubject = new Map();
  for (const pageText of pageTexts) {
    if (averageFromPage(pageText) === null) continue;
    const pageValues = new Map();
    const lines = String(pageText || '').split(/\r?\n/).map(normalizeText).filter(Boolean);
    for (const line of lines) {
      for (const subject of subjectDefinitions) {
        if (pageValues.has(subject.key)) continue;
        for (const pattern of subject.patterns) {
          const match = pattern.exec(line);
          if (!match) continue;

          const values = [
            ...line.slice(match.index + match[0].length).matchAll(/(?:%|٪)?\s*(\d{1,3}(?:[.,]\d+)?)/g),
            ...line.slice(0, match.index).matchAll(/(\d{1,3}(?:[.,]\d+)?)\s*(?:%|٪)?/g)
          ].map((item) => cleanNumber(item[1])).filter((value) => value !== null && value >= 0 && value <= 100);
          if (values.length) {
            pageValues.set(subject.key, values[0]);
            break;
          }
        }
      }
    }
    for (const [key, value] of pageValues) {
      if (!valuesBySubject.has(key)) valuesBySubject.set(key, []);
      valuesBySubject.get(key).push(value);
    }
  }

  return subjectDefinitions
    .filter((subject) => valuesBySubject.has(subject.key))
    .map((subject) => {
      const values = valuesBySubject.get(subject.key);
      return { label: subject.label, key: subject.key, value: values.reduce((sum, item) => sum + item, 0) / values.length, count: values.length };
    })
    .sort((a, b) => b.value - a.value);
}

function renderSubjectSummary(pageTexts) {
  const subjects = parseSubjectAverages(pageTexts);
  const container = $('subjects');
  if (!container) return;

  if (!subjects.length) {
    container.innerHTML = '<div style="color: var(--muted); padding: 12px; text-align: center; font-size: 13px;">تم استخراج النتيجة العامة بنجاح، بينما لا تتوفر درجات تفصيلية لكل مادة في هذا النموذج.</div>';
    return;
  }

  container.innerHTML = subjects.map((item) => {
    const val = item.value;
    const colorClass = val >= 90 ? 'bar-green' : val >= 80 ? 'bar-teal' : val >= 75 ? 'bar-orange' : 'bar-red';
    return `
      <div class="subject-bar-row">
        <span class="subject-bar-label">${escapeHtml(item.label)}</span>
        <div class="subject-bar-track">
          <div class="subject-bar-fill ${colorClass}" style="width: ${Math.min(100, Math.max(5, val))}%;"></div>
        </div>
        <span class="subject-bar-val">${val.toFixed(1)}</span>
      </div>
    `;
  }).join('');
}

function extractSchoolName(allText, pageObjects = [], fileName = '') {
  const normFile = normalizeText(fileName);
  const normText = normalizeText(allText);

  // 1. فحص قائمة أوامر العرض (شهادات الثانوية)
  if (pageObjects[0]?.opList?.fnArray) {
    try {
      const o = pageObjects[0].opList;
      const arr = o.fnArray
        .map((f, i) => ({ f, args: o.argsArray[i] }))
        .filter((x) => x.f === pdfjsLib.OPS.showText)
        .map((x) => x.args[0].map((g) => (typeof g === 'number' ? '' : g.unicode)).join(''));

      for (const s of arr) {
        const decoded = decodeGlyphs(s);
        if (
          decoded &&
          (decoded.includes('مدرسة') || decoded.includes('الثانوية') || decoded.includes('المتوسطة')) &&
          !decoded.includes('مدير') &&
          !decoded.includes('العام للمرحلة')
        ) {
          return decoded.startsWith('مدرسة') ? decoded : `مدرسة ${decoded}`;
        }
      }
    } catch (e) {
      console.warn('opList school name error', e);
    }
  }

  // 2. فحص عناصر الصفحة الأولى (إشعارات المتوسطة ومحو الأمية)
  if (pageObjects[0]?.content?.items) {
    try {
      for (const item of pageObjects[0].content.items) {
        if (!item.str || item.str.length < 5) continue;
        const decoded = decodeGreekShift(item.str);
        if (
          decoded &&
          (decoded.includes('المتوسطة') || decoded.includes('الابتدائية') || decoded.includes('الثانوية') || decoded.includes('مدرسة')) &&
          !decoded.includes('إشعار') &&
          !decoded.includes('الدرجات') &&
          !decoded.includes('التقرير')
        ) {
          return decoded.startsWith('مدرسة') ? decoded : `مدرسة ${decoded}`;
        }
      }
    } catch (e) {
      console.warn('content school name error', e);
    }
  }

  // 3. مطابقة الكلمات المفتاحية الصريحة بالعربية أو الإنجليزية
  if (/Prince\s*Turki\s*bin\s*Abdulaziz/i.test(normText) || /الامير_ترك|تركي_بن_عبدالعزيز/i.test(normFile)) {
    return 'مدرسة الأمير تركي بن عبدالعزيز المتوسطة للتعليم المستمر';
  }
  if (/Hamza\s*bin\s*Abdul[\s-]*Muttalib/i.test(normText) || /حمزة/i.test(normText) || /حمزة/i.test(normFile)) {
    return 'مدرسة حمزة بن عبدالمطلب الثانوية للتعليم المستمر';
  }
  if (/Abu\s*Huraira/i.test(normText) || /ابي_هريرة|أبي_هريرة/i.test(normFile)) {
    return 'مدرسة أبي هريرة الابتدائية للتعليم المستمر';
  }

  // 4. مطابقة التعبيرات النمطية العامة للمدارس
  const arabicMatch = normText.match(/مدرسة\s+(.+?)\s*(?=تاريخ\s+التقرير|العام\s+الدراسي|الصف\s*:|$)/i)?.[1]?.trim();
  if (arabicMatch) return `مدرسة ${arabicMatch}`;

  return '';
}

function extractGradeLevel(allText, fileName = '', pageObjects = []) {
  const normFile = normalizeText(fileName);
  if (/الأول_المتوسط|الأول\s+المتوسط/i.test(normFile)) return 'الصف الأول المتوسط';
  if (/الثاني_المتوسط|الثاني\s+المتوسط/i.test(normFile)) return 'الصف الثاني المتوسط';
  if (/الثالث_المتوسط|الثالث\s+المتوسط/i.test(normFile)) return 'الصف الثالث المتوسط';
  if (/الأول_الابتدائي|الأول\s+الابتدائي|اول_ابتدائي/i.test(normFile)) return 'الصف الأول الابتدائي';
  if (/الثاني_الابتدائي|الثاني\s+الابتدائي|ثاني_ابتدائي/i.test(normFile)) return 'الصف الثاني الابتدائي';
  if (/الثالث_الابتدائي|الثالث\s+الابتدائي|ثالث_ابتدائي/i.test(normFile)) return 'الصف الثالث الابتدائي';
  if (/الرابع_الابتدائي|الرابع\s+الابتدائي|رابع_ابتدائي/i.test(normFile)) return 'الصف الرابع الابتدائي';
  if (/الخامس_الابتدائي|الخامس\s+الابتدائي|خامس_ابتدائي/i.test(normFile)) return 'الصف الخامس الابتدائي';
  if (/السادس_الابتدائي|السادس\s+الابتدائي|سادس_ابتدائي/i.test(normFile)) return 'الصف السادس الابتدائي';

  const normText = normalizeText(allText);

  // فحص النصوص المشفرة في الصفحة الأولى
  if (pageObjects[0]?.content?.items) {
    for (const item of pageObjects[0].content.items) {
      const dec = decodeGreekShift(item.str || '');
      if (dec.includes('الأول المتوسط') || dec.includes('المتوسط الأول') || dec.includes('اول متوسط')) return 'الصف الأول المتوسط';
      if (dec.includes('الثاني المتوسط') || dec.includes('المتوسط الثاني') || dec.includes('ثاني متوسط')) return 'الصف الثاني المتوسط';
      if (dec.includes('الثالث المتوسط') || dec.includes('المتوسط الثالث') || dec.includes('ثالث متوسط')) return 'الصف الثالث المتوسط';
      if (dec.includes('الأول الابتدائي') || dec.includes('الابتدائي الأول')) return 'الصف الأول الابتدائي';
      if (dec.includes('الثاني الابتدائي') || dec.includes('الابتدائي الثاني')) return 'الصف الثاني الابتدائي';
      if (dec.includes('الثالث الابتدائي') || dec.includes('الابتدائي الثالث')) return 'الصف الثالث الابتدائي';
      if (dec.includes('الرابع الابتدائي') || dec.includes('الابتدائي الرابع') || dec.includes('رابع ابتدائي')) return 'الصف الرابع الابتدائي';
      if (dec.includes('الخامس الابتدائي') || dec.includes('الابتدائي الخامس') || dec.includes('خامس ابتدائي')) return 'الصف الخامس الابتدائي';
      if (dec.includes('السادس الابتدائي') || dec.includes('الابتدائي السادس') || dec.includes('سادس ابتدائي')) return 'الصف السادس الابتدائي';
    }
  }

  const arabicGrade = normText.match(/(?:الصف\s*)?(?:الأول|الثاني|الثالث|الرابع|الخامس|السادس)\s+(?:الابتدائي|المتوسط|الثانوي|محو\s*أمية|المحو)/)?.[0];
  if (arabicGrade) return arabicGrade.startsWith('الصف') ? arabicGrade : `الصف ${arabicGrade}`;

  const englishIntermediate = normText.match(/\bintermediate\s+(first|second|third)\s+grade\b/i);
  if (englishIntermediate) {
    const numMap = { first: 'الأول', second: 'الثاني', third: 'الثالث' };
    return `الصف ${numMap[englishIntermediate[1].toLowerCase()] || ''} المتوسط`;
  }

  const englishPrimary = normText.match(/\b(?:primary|elementary)\s+(first|second|third|fourth|fifth|sixth)\s+grade\b/i) ||
                        normText.match(/\b(first|second|third|fourth|fifth|sixth)\s+(?:primary|elementary)\s+grade\b/i);
  if (englishPrimary) {
    const numMap = { first: 'الأول', second: 'الثاني', third: 'الثالث', fourth: 'الرابع', fifth: 'الخامس', sixth: 'السادس' };
    return `الصف ${numMap[englishPrimary[1].toLowerCase()] || ''} الابتدائي`;
  }

  const englishGrade = normText.match(/\b(first|second|third|fourth|fifth|sixth)\s+(grade|secondary|literacy|intermediate|primary|elementary)\b/i);
  if (englishGrade) {
    const gradeTranslation = { first: 'الأول', second: 'الثاني', third: 'الثالث', fourth: 'الرابع', fifth: 'الخامس', sixth: 'السادس' };
    const type = englishGrade[2].toLowerCase();
    const typeTranslation = type === 'secondary' ? 'الثانوي' : type === 'intermediate' ? 'المتوسط' : (type === 'primary' || type === 'elementary') ? 'الابتدائي' : type === 'literacy' ? 'محو الأمية' : '';
    return `الصف ${gradeTranslation[englishGrade[1].toLowerCase()] || ''} ${typeTranslation}`.trim();
  }

  return '';
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

upload.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  status.textContent = 'تجري قراءة جميع صفحات الملف واستخراج المعدلات…';
  try {
    const document = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pageObjects = [];
    const pageTexts = [];
    let allText = '';
    for (let pageNo = 1; pageNo <= document.numPages; pageNo += 1) {
      const page = await document.getPage(pageNo);
      const content = await page.getTextContent();
      const opList = await page.getOperatorList();
      const pageText = pageTextFromContent(content);
      pageObjects.push({ pageNo, pageText, content, opList });
      pageTexts.push(pageText);
      allText += `${pageText}\n`;
    }

    extractedPages = pageTexts;
    const normalizedText = normalizeText(allText);
    if ((/تقرير/i.test(normalizedText) && /تحليل/i.test(normalizedText) && /نتائج/i.test(normalizedText)) || /student\s*results\s*analysis/i.test(normalizedText)) {
      status.textContent = 'هذا الملف يبدو تقرير تحليل نهائيًا، وليس ملف نتائج أصليًا. ارفع إشعارات الدرجات أو شهادات الطلاب.';
      upload.value = '';
      return;
    }

    records = buildRecordsFromPages(pageObjects);

    $('templateType').value = classify(normalizedText, file.name);
    $('pageCount').value = document.numPages;
    $('studentCount').value = records.length;
    $('schoolYear').value = normalizedText.match(/\d{4}\s*[\/-]\s*\d{4}/)?.[0]?.replace(/\s/g, '') || '';
    $('gradeLevel').value = extractGradeLevel(normalizedText, file.name, pageObjects);
    $('schoolName').value = extractSchoolName(allText, pageObjects, file.name) || defaultSchool || '';
    $('confidence').textContent = records.length
      ? `تم استخراج معدلات من ${records.length} صفحة/سجل`
      : 'لم تُستخرج معدلات موثوقة من الملف';
    uploadPanel.classList.add('hidden'); reviewPanel.classList.remove('hidden');
    status.textContent = `تمت قراءة ${document.numPages} صفحة من «${file.name}».`;
  } catch (error) { status.textContent = 'تعذر قراءة النص من هذا الملف.'; console.error(error); }
});

$('buildReport').addEventListener('click', () => {
  const students = Number($('studentCount').value || 0), grade = $('gradeLevel').value || 'المرحلة غير المحددة';
  const school = $('schoolName').value || 'المدرسة', year = $('schoolYear').value || 'العام الدراسي';
  const avg = records.length ? records.reduce((sum, item) => sum + item.average, 0) / records.length : null;
  const pass = records.length ? records.filter((item) => item.average >= 60).length * 100 / records.length : null;
  const review = records.filter((item) => item.average < 70).length;
  const subjects = parseSubjectAverages(extractedPages);
  const supportSubjects = subjects.filter((item) => item.value < 80);
  const topSubjects = subjects.filter((item) => item.value >= 90).slice(0, 3);

  // تحديث الترويسة والشريط العلوي
  $('reportTitle').textContent = `تحليل نتائج ${grade}`;
  $('reportMeta').textContent = `${school} · ${year}`;
  if ($('headerSchool')) $('headerSchool').textContent = school;
  if ($('headerYear')) $('headerYear').textContent = year || '—';
  if ($('headerGrade')) $('headerGrade').textContent = grade;
  if ($('bannerGradeTitle')) $('bannerGradeTitle').textContent = grade;
  if ($('bannerEnrolledCount')) $('bannerEnrolledCount').textContent = students || records.length;
  if ($('footerSchoolInfo')) $('footerSchoolInfo').textContent = `${school} · العام الدراسي ${year}`;

  const todayStr = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  }).format(new Date());
  if ($('headerDate')) $('headerDate').textContent = todayStr.includes('هـ') ? todayStr : `${todayStr}هـ`;

  // بطاقات المؤشرات الأربعة
  $('mStudents').textContent = records.length || students || '—';
  $('mAverage').textContent = avg === null ? 'غير متاح' : `${avg.toFixed(2)}%`;
  $('mPassRate').textContent = pass === null ? 'غير متاح' : `${pass.toFixed(1)}%`;
  $('mReview').textContent = records.length ? review : '—';

  // أولاً: توزيع التقديرات (جدول ورسم بياني)
  renderDistribution();

  // ثانياً: متوسطات المواد
  renderSubjectSummary(extractedPages);

  // ثالثاً: جدول الطلاب المتفوقين
  const topSorted = [...records].sort((a, b) => b.average - a.average).slice(0, 5);
  const badgeMap = {
    excellent: 'grade-excellent',
    'very-good': 'grade-very-good',
    good: 'grade-good',
    acceptable: 'grade-acceptable',
    review: 'grade-review'
  };

  const topRows = topSorted.length
    ? topSorted.map((item, idx) => {
        const b = band(item.average);
        return `
          <tr>
            <td><strong>${idx + 1}</strong></td>
            <td style="font-weight: 700; text-align: right; padding-right: 18px;">${escapeHtml(item.name)}</td>
            <td>عام</td>
            <td><strong style="color: var(--navy);">${item.average.toFixed(2)}%</strong></td>
            <td><span class="grade-badge ${badgeMap[b]}">${bandLabel(b)}</span></td>
          </tr>
        `;
      }).join('')
    : '<tr><td colspan="5" style="padding: 16px; color: var(--muted);">الملف لا يتضمن سجلات فردية قابلة للترتيب.</td></tr>';

  if ($('topStudentsTableBody')) $('topStudentsTableBody').innerHTML = topRows;

  // رابعاً: التشخيص الأكاديمي والتوصيات التربوية
  const excellentCount = records.filter((item) => band(item.average) === 'excellent').length;
  const excellentPct = records.length ? (excellentCount * 100) / records.length : 0;
  const topSubjectsNames = topSubjects.map((s) => s.label).join('، ');

  const diagnosisHtml = avg === null
    ? '<div class="diagnosis-item">لم تُستخرج معدلات موثوقة من الملف. يرجى مراجعة إشعارات الدرجات والتأكد من وضوح البيانات.</div>'
    : `
      <div class="diagnosis-item">
        <strong>• نقاط القوة والتميز:</strong> ${topSubjectsNames ? `أظهرت البيانات المستخرجة ارتفاع متوسطات بعض المواد (مثل: ${escapeHtml(topSubjectsNames)}).` : 'لا تتوفر بيانات كافية لمقارنة متوسطات المواد.'} وبلغت نسبة الطلاب الحاصلين على تقدير ممتاز <strong>${excellentPct.toFixed(1)}%</strong> (${excellentCount} طالباً) بمتوسط عام للدفعة قدره <strong>${avg.toFixed(2)}%</strong>.
      </div>
      ${supportSubjects.length ? `
      <div class="diagnosis-item">
        <strong>• المواد التي تتطلب دعماً وتحسيناً:</strong> تبرز مادة (${escapeHtml(supportSubjects.map((s) => `${s.label} بمتوسط ${s.value.toFixed(1)}%`).join('، '))}) كأدنى المواد تحصيلاً، مما يستدعي خطة علاجية مستهدفة لرفع المهارات الأساسية.
      </div>` : ''}
      <div class="diagnosis-item">
        <strong>• حالات التعثر والمتابعة:</strong> ${review > 0 ? `تم رصد عدد (${review}) طلاب بمعدلات أقل من 70% وتتطلب حالتهم وضع خطة مساندة وتنسيق مع الإرشاد الطلابي.` : 'لم تُرصد معدلات أقل من 70% في السجلات المستخرجة.'}
      </div>
      <div class="diagnosis-item">
        <strong>• التوصيات التربوية:</strong>
        <ol class="diagnosis-recs">
          <li>تقديم برامج إثرائية للطلاب المتفوقين لتعزيز تفوقهم واستمراريته.</li>
          ${supportSubjects.length ? `<li>تطبيق خطة دعم علاجي مكثفة لمادة (${escapeHtml(supportSubjects[0].label)}) بالتنسيق مع معلم المادة.</li>` : ''}
          <li>تنفيذ تقييمات بنائية أسبوعية وتكريم المتميزين لتعزيز الدافعية التعليمية.</li>
        </ol>
      </div>
    `;

  if ($('academicDiagnosisBox')) $('academicDiagnosisBox').innerHTML = diagnosisHtml;

  if ($('disclaimer')) {
    $('disclaimer').textContent = records.length
      ? `اعتمد هذا التقرير على ${records.length} سجلاً فردياً مستخرجاً من إشعارات الدرجات المرفوعة.`
      : 'لم تستخرج الأداة معدلات موثوقة؛ راجع الملف قبل الاعتماد.';
  }

  reportPanel.classList.remove('hidden');
  reportPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('startOver').addEventListener('click', () => { upload.value = ''; records = []; extractedPages = []; reviewPanel.classList.add('hidden'); reportPanel.classList.add('hidden'); uploadPanel.classList.remove('hidden'); status.textContent = ''; });
$('printReport').addEventListener('click', () => onPrint(reportPanel));
return { scoreFromText, buildRecordsFromPages };
}
