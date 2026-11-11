import {setDialogContent} from '/dialog-content.js?v=1';
import {matchTeacherNames} from '/voice-command.js?v=22';
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const box=document.createElement('dialog');box.id='absenceDialog';document.body.append(box);
let selected=new Set(),date='',query='',view='select',record=null,saving=false,message='',previewRefreshTimer=null;
const bridge=()=>window.standbyBridge,p=()=>bridge().get();
const dayName=value=>!value?'لم يحدد':new Intl.DateTimeFormat('ar-SA',{weekday:'long',timeZone:'Asia/Riyadh'}).format(new Date(value+'T12:00:00+03:00'));
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const normal=value=>value.normalize('NFKD').replace(/[\u064B-\u065F\u0670]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').toLowerCase();
const teachers=()=>p().teachers.filter(t=>selected.has(t.id));
function listTeachers(){const results=p().teachers.filter(t=>normal(t.name).includes(normal(query)));$('#absenceTeachers').innerHTML=results.map(t=>`<label class="absenceChoice"><input type="checkbox" data-absence-teacher="${esc(t.id)}" ${selected.has(t.id)?'checked':''}><span>${esc(t.name)}</span></label>`).join('')||'<p>لا توجد أسماء مطابقة للبحث.</p>';box.querySelectorAll('[data-absence-teacher]').forEach(input=>input.onchange=()=>{if(input.checked)selected.add(input.dataset.absenceTeacher);else selected.delete(input.dataset.absenceTeacher);selection()})}
function selection(){$('#absenceSelected').innerHTML=teachers().map(t=>`<button type="button" class="secondary" data-absence-remove="${esc(t.id)}">${esc(t.name)} ×</button>`).join('')||'<span class="muted">تظهر أسماء المعلمين المختارين هنا.</span>';$('#absenceReview').disabled=!selected.size;$('#absenceCount').textContent=`المحددون: ${selected.size}`;box.querySelectorAll('[data-absence-remove]').forEach(b=>b.onclick=()=>{selected.delete(b.dataset.absenceRemove);selection();listTeachers()})}
function dateWarning(){const text=!date?'اختر تاريخ الغياب.':p().days.some(d=>d.name===dayName(date))?'':`تنبيه: ${dayName(date)} ليس يومًا دراسيًا في جدول المدرسة. اختر تاريخًا يوافق أحد أيام الدوام: ${p().days.map(d=>d.name).join('، ')}.`;$('#absenceDateWarning').textContent=text;}
function draw(){if(view!=='preview'&&previewRefreshTimer){clearInterval(previewRefreshTimer);previewRefreshTimer=null}setDialogContent(box,`<div class="absenceTop"><h2>المعلم الغائب</h2><div class="toolbar">${view!=='select'?'<button id="absenceNew" class="secondary">تحديد غياب</button>':''}<button id="absenceHistory" class="secondary">فتح سجل الغياب</button><button id="absenceClose" class="secondary">إغلاق</button></div></div><p id="absenceMessage" role="status">${esc(message)}</p>${view==='select'?`<div class="card"><label>تاريخ الغياب<input id="absenceDate" type="date" value="${date}"></label><p id="absenceDay">اليوم: ${esc(dayName(date))}</p><p id="absenceDateWarning" role="status"></p><h3>المعلمون المختارون</h3><div id="absenceSelected" class="toolbar"></div><p>ابحث عن المعلم وحدّد اسمه. يمكنك اختيار عدة معلمين قبل التأكيد. يُحفظ الغياب بعد التأكيد النهائي.</p><label>البحث عن المعلم<input id="absenceSearch" type="search" value="${esc(query)}" placeholder="اكتب اسم المعلم أو جزءًا منه" autocomplete="off"></label><p id="absenceCount"></p><div id="absenceTeachers"></div></div><div class="absenceActions"><p id="absenceActionMessage" role="alert" aria-live="assertive"></p><button id="absenceReview">تأكيد الغياب</button></div>`:view==='confirm'?`<div class="card"><h3>تأكيد أسماء المعلمين الغائبين</h3><p>سيتم تسجيل غياب المعلمين الآتية أسماؤهم ليوم <b>${esc(dayName(date))}</b> بتاريخ <b>${esc(date)}</b>، ثم توزيع المعلمين المنتظرين المتاحين على حصصهم حسب ترتيب الانتظار.</p><ul>${teachers().map(t=>`<li>${esc(t.name)}</li>`).join('')}</ul><p>يُستبعد جميع الغائبين من التغطية، ولا يُكلّف المعلم بتغطية حصتين في الوقت نفسه. ستظهر الحصص التي لا يتوفر لها منتظر بوضوح في النموذج.</p><div class="toolbar"><button id="absenceCommit" ${saving?'disabled':''}>${saving?'جارٍ التسجيل والتوزيع…':'تأكيد وتوزيع المنتظرين'}</button><button id="absenceBack" class="secondary" ${saving?'disabled':''}>العودة للتحديد</button></div></div>`:view==='history'?`<div class="card"><h3>سجل غياب المعلمين</h3>${(p().absenceRecords||[]).length?`<table><thead><tr><th>اليوم</th><th>التاريخ</th><th>المعلمون الغائبون</th><th></th></tr></thead><tbody>${[...(p().absenceRecords||[])].sort((a,b)=>b.date.localeCompare(a.date)).map(r=>`<tr><td>${esc(r.day)}</td><td>${esc(r.date)}</td><td>${r.teachers.map(t=>esc(t.name)).join('، ')}</td><td><button data-absence-record="${esc(r.id)}">عرض النموذج</button></td></tr>`).join('')}</tbody></table>`:'<p>لم يُسجّل غياب بعد.</p>'}</div>`:`<div class="toolbar"><h3>سجل توزيع حصص الانتظار — ${esc(record.day)} ${esc(record.date)}</h3><button id="absencePrint">تنزيل النموذج الرسمي PDF</button><button id="absenceCancelTeacher" class="secondary">إلغاء غياب معلم</button></div><p>تُجمع نماذج الغائبين في الصفحة ما دامت المساحة تكفي. ينتقل نموذج المعلم كاملًا للصفحة التالية عند الحاجة، دون تقسيم حقوله.</p><iframe id="absencePreview" title="معاينة سجل توزيع حصص الانتظار"></iframe>`}`);
box.scrollTop=0;
$('#absenceClose').onclick=()=>{if(!saving)box.close()};$('#absenceHistory').onclick=()=>{if(!saving){view='history';message='';draw()}};if($('#absenceNew'))$('#absenceNew').onclick=()=>{view='select';message='';draw()};
if(view==='select'){listTeachers();selection();dateWarning();$('#absenceSearch').oninput=e=>{query=e.target.value;listTeachers()};$('#absenceDate').onchange=e=>{date=e.target.value;$('#absenceDay').textContent='اليوم: '+dayName(date);dateWarning();$('#absenceActionMessage').textContent=''};$('#absenceReview').onclick=()=>{if(!selected.size)return;if(!date||!p().days.some(d=>d.name===dayName(date))){$('#absenceActionMessage').textContent=!date?'اختر تاريخ الغياب أولًا.':`لا يمكن تأكيد الغياب ليوم ${dayName(date)}؛ فهو ليس من أيام الدراسة في جدول المدرسة. غيّر تاريخ الغياب إلى يوم دراسي.`;dateWarning();return}view='confirm';message='';draw()}}
if($('#absenceBack'))$('#absenceBack').onclick=()=>{view='select';draw()};if($('#absenceCommit'))$('#absenceCommit').onclick=async()=>{saving=true;draw();try{const response=await fetch('/api/absence-confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:p(),date,teacherIds:[...selected]})});const data=await response.json();if(!response.ok)throw Error((data.errors||[]).join('، '));bridge().accept(data.project);record=data.record;selected.clear();view='preview';const missing=record.entries.filter(e=>!e.replacementId).length;message=`تم تسجيل غياب ${record.teachers.length} معلمًا وتوزيع المنتظرين.${missing?' توجد '+missing+' حصص تحتاج تكليفًا يدويًا.':''}` }catch(error){message=error.message}finally{saving=false;draw()}};
box.querySelectorAll('[data-absence-record]').forEach(button=>button.onclick=()=>{record=p().absenceRecords.find(r=>r.id===button.dataset.absenceRecord);view='preview';message='';draw()});
if(view==='preview'){const printButton=$('#absencePrint'),taskButton=document.createElement('button');taskButton.id='absenceSignatureTasks';taskButton.className='secondary';taskButton.textContent='تكليفات التوقيع';printButton.after(taskButton);loadPreview();printButton.onclick=printRecord;$('#absenceCancelTeacher').onclick=cancelTeacherAbsence;taskButton.onclick=openSignatureTasks}
}
function phoneFor(id){return p().teachers.find(item=>item.id===id)?.whatsapp||''}
function taskFor(entry){return (p().signatureTasks||[]).find(item=>item.id===entry.signatureTaskId)}
function taskStatus(task){return !task?'لم يُجهّز':task.status==='signed'?'تم التوقيع':task.status==='opened'?'تحت الإجراء':'بانتظار الرد'}
function openSignatureTasks(){
 const existing=box.querySelector('#signatureTaskPanel');if(existing){existing.remove();return}
 const tasks=record.entries.filter(entry=>entry.replacementId);const panel=document.createElement('section');panel.id='signatureTaskPanel';panel.className='card';
 panel.innerHTML=`<div class="toolbar"><h3>تكليفات التوقيع عبر واتساب</h3><button id="signatureTaskClose" class="secondary">إغلاق</button></div><p>أدخل رقم واتساب المدرسة وأرقام المعلمين مرة واحدة. زر واتساب يفتح رسالة خاصة بكل تكليف؛ بعد توقيع المعلم يتحدث النموذج الرسمي تلقائيًا.</p><div class="fields"><label>رقم واتساب المدرسة / المرسل<input id="signatureSender" inputmode="tel" placeholder="05xxxxxxxx" value="${esc(p().signatureSettings?.senderPhone||'')}"></label></div><div class="scroll"><table><thead><tr><th>المعلم المنتظر</th><th>رقم الجوال</th><th>التكليف</th><th>الحالة</th><th>إرسال</th></tr></thead><tbody>${tasks.map(entry=>{const task=taskFor(entry);return `<tr><td>${esc(entry.replacementName)}</td><td><input data-signature-phone="${esc(entry.replacementId)}" inputmode="tel" placeholder="05xxxxxxxx" value="${esc(task?.phone||phoneFor(entry.replacementId))}"></td><td>${esc(entry.absentName)} — ${esc(entry.className)} — الحصة ${entry.period}</td><td>${taskStatus(task)}</td><td>${task?.token&&task?.phone?`<button class="secondary" data-signature-whatsapp="${esc(task.id)}">واتساب</button>`:'—'}</td></tr>`}).join('')}</tbody></table></div><div class="toolbar"><button id="signaturePrepare">تجهيز الروابط والرسائل</button><button id="signatureRefresh" class="secondary">تحديث حالة التوقيعات</button></div><p id="signatureTaskMessage" role="status"></p>`;
 const preview=box.querySelector('#absencePreview');preview.before(panel);box.scrollTop=0;$('#signatureTaskClose').onclick=()=>panel.remove();$('#signatureRefresh').onclick=async()=>{try{const project=await fetch('/api/project').then(response=>response.json());bridge().accept(project);record=project.absenceRecords.find(item=>item.id===record.id)||record;panel.remove();draw();openSignatureTasks()}catch{ $('#signatureTaskMessage').textContent='تعذر تحديث حالة التوقيعات.' }};
 $('#signaturePrepare').onclick=async()=>{const button=$('#signaturePrepare'),phones=Object.fromEntries([...panel.querySelectorAll('[data-signature-phone]')].map(input=>[input.dataset.signaturePhone,input.value]));button.disabled=true;$('#signatureTaskMessage').textContent='جارٍ تجهيز روابط التوقيع…';try{const response=await fetch('/api/signature-tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:p().revision,recordId:record.id,senderPhone:$('#signatureSender').value,phones})}),data=await response.json();if(!response.ok)throw Error((data.errors||[]).join('، '));bridge().accept(data.project);record=data.project.absenceRecords.find(item=>item.id===record.id)||record;$('#signatureTaskMessage').textContent='تم تجهيز روابط التوقيع. استخدم زر واتساب لكل معلم.';panel.remove();draw();openSignatureTasks()}catch(error){$('#signatureTaskMessage').textContent=error.message;button.disabled=false}};
 const openWhatsApp=button=>{const task=(p().signatureTasks||[]).find(item=>item.id===button.dataset.signatureWhatsapp);if(!task?.phone||!task?.token)return;const entry=record.entries.find(item=>item.signatureTaskId===task.id);const slash=String.fromCharCode(47),embedded=location.pathname.split(slash).filter(Boolean)[0]==='voice-table';const link=`${location.origin}${embedded?`${slash}voice-table`:''}${slash}signature.html?token=${encodeURIComponent(task.token)}`;const text=`تكليف انتظار: الحصة ${entry.period}، الفصل ${entry.className}. افتح الرابط للاطلاع والتوقيع: ${link}`;window.open(`https://wa.me/${task.phone}?text=${encodeURIComponent(text)}`,'_blank','noopener')};
 const whatsAppButtons=[...panel.querySelectorAll('[data-signature-whatsapp]')];whatsAppButtons.forEach(button=>button.onclick=()=>openWhatsApp(button));const allButton=document.createElement('button');allButton.id='signatureAll';allButton.className='secondary';allButton.textContent='تجهيز رسائل الجميع';allButton.disabled=!whatsAppButtons.length;$('#signaturePrepare').after(allButton);allButton.onclick=()=>{whatsAppButtons.forEach((button,index)=>setTimeout(()=>openWhatsApp(button),index*350));$('#signatureTaskMessage').textContent='فُتحت رسائل واتساب الجاهزة. راجع كل رسالة ثم اضغط إرسال.'};
}
async function cancelTeacherAbsence(){if(!record||!record.teachers?.length){$('#absenceMessage').textContent='لا يوجد معلم غائب لإلغائه في هذا السجل.';return}const existing=box.querySelector('#absenceCancelPanel');if(existing)existing.remove();const panel=document.createElement('div');panel.id='absenceCancelPanel';panel.className='card';panel.innerHTML=`<h3>إلغاء غياب معلمين</h3><p>حدد المعلمين الذين حضروا إلى المدرسة، ثم أكد الإلغاء. سيُحذف تكليفهم من هذا اليوم أيضًا.</p><div id="absenceCancelTeachers">${record.teachers.map(t=>`<label class="absenceChoice"><input type="checkbox" value="${esc(t.id)}" data-absence-cancel-teacher="${esc(t.id)}"><span>${esc(t.name)}</span></label>`).join('')}</div><div class="toolbar"><button id="absenceCancelConfirm">تأكيد الإلغاء</button><button id="absenceCancelDismiss" class="secondary">إغلاق</button></div>`;const preview=box.querySelector('#absencePreview');if(preview){preview.before(panel);}else{box.prepend(panel);}box.scrollTop=0;const checks=panel.querySelectorAll('[data-absence-cancel-teacher]'),confirm=box.querySelector('#absenceCancelConfirm'),dismiss=box.querySelector('#absenceCancelDismiss');dismiss.onclick=()=>panel.remove();confirm.onclick=async()=>{const teacherIds=[...checks].filter(input=>input.checked).map(input=>input.value);if(!teacherIds.length){$('#absenceMessage').textContent='اختر معلمًا واحدًا على الأقل للإلغاء.';return}confirm.disabled=true;$('#absenceMessage').textContent=teacherIds.length===1?'جارٍ إلغاء غياب المعلم…':'جارٍ إلغاء غياب المعلمين…';try{const response=await fetch('/api/absence-cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:p(),date:record.date,teacherIds})});const data=await response.json();if(!response.ok)throw Error((data.errors||[]).join('، '));bridge().accept(data.project);if(data.record){record=data.record;view='preview';message=teacherIds.length===1?'تم إلغاء غياب المعلم، وتم حذف تكليفه واحتياطيه لهذا اليوم.':'تم إلغاء غياب '+teacherIds.length+' معلمين، وتم حذف تكليفهم واحتياطيهم لهذا اليوم.';}else{record=null;view='history';message=teacherIds.length===1?'تم حذف غياب هذا المعلم، وانتهت سجلات اليوم.':'تم حذف غياب '+teacherIds.length+' معلمين، وانتهت سجلات اليوم.'}panel.remove();draw()}catch(error){$('#absenceMessage').textContent=error.message;confirm.disabled=false}}}
async function loadPreview(){try{const response=await fetch('/api/absence-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recordId:record.id})});if(!response.ok)throw Error('تعذر تحميل النموذج.');const markup=await response.text();const frame=$('#absencePreview');if(frame)frame.srcdoc=markup;if(!previewRefreshTimer)previewRefreshTimer=setInterval(async()=>{if(view!=='preview'||!box.open)return;try{const latest=await fetch('/api/project').then(item=>item.json());if(latest.revision!==p().revision){bridge().accept(latest);record=latest.absenceRecords.find(item=>item.id===record.id)||record;loadPreview()}}catch{}},10000)}catch(error){$('#absenceMessage').textContent=error.message}}
async function printRecord(){const button=$('#absencePrint');button.disabled=true;$('#absenceMessage').textContent='جارٍ تجهيز النموذج الرسمي للطباعة…';try{const response=await fetch('/api/absence-print',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recordId:record.id})});if(!response.ok)throw Error('تعذر تجهيز PDF. أعد المحاولة.');const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download='absence-'+record.date+'.pdf';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);$('#absenceMessage').textContent='تم تنزيل النموذج الرسمي بتوزيع موفّر للورق، مع إبقاء نموذج كل معلم كاملًا.'}catch(error){$('#absenceMessage').textContent=error.message}finally{button.disabled=false}}

function voiceDate(value){
 const digits=String(value||'').replace(/[٠-٩]/g,c=>'٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[۰-۹]/g,c=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(c));
 const now=new Date();
 if(/(?:اليوم|هذا اليوم)/.test(normal(digits)))return today();
 if(/(?:بكره|بكرا|غدا)/.test(normal(digits))){now.setDate(now.getDate()+1);return now.toLocaleDateString('en-CA',{timeZone:'Asia/Riyadh'}).replace(/\//g,'-')}
 let hit=digits.match(/(20\d{2})\D+(\d{1,2})\D+(\d{1,2})/);
 if(hit)return `${hit[1]}-${hit[2].padStart(2,'0')}-${hit[3].padStart(2,'0')}`;
 hit=digits.match(/(\d{1,2})\D+(\d{1,2})\D+(20\d{2})/);
 return hit?`${hit[3]}-${hit[2].padStart(2,'0')}-${hit[1].padStart(2,'0')}`:'';
}
function sayVoice(event,text){event.preventDefault();event.detail.reply(text)}
function selectTeacherByVoice(event,raw,{cancel=false,remove=false}={}){
 const matches=matchTeacherNames(p().teachers,raw);
 if(!matches.length)return sayVoice(event,`لم أجد معلماً مطابقًا لـ «${raw}». قل اسمًا أوضح.`);
 if(matches.length>1)return sayVoice(event,`وجدت أكثر من معلم مطابق: ${matches.slice(0,5).map(t=>t.name).join('، ')}. قل كلمة إضافية من الاسم.`);
 const teacher=matches[0];
 if(cancel){const check=box.querySelector(`[data-absence-cancel-teacher="${CSS.escape(teacher.id)}"]`);if(!check)return sayVoice(event,`${teacher.name} ليس ضمن الغائبين في هذا السجل.`);check.checked=true;return sayVoice(event,`تم اختيار ${teacher.name} لإلغاء غيابه. قل «تأكيد الإلغاء» لإتمام العملية.`)}
 if(remove){selected.delete(teacher.id);selection();listTeachers();return sayVoice(event,`تمت إزالة ${teacher.name} من الغائبين المحددين.`)}
 selected.add(teacher.id);selection();listTeachers();sayVoice(event,`تم تحديد ${teacher.name} ضمن الغائبين.`);
}
function pickSpokenTeacherName(event,ask){
 // Once the absence picker is open, a teacher may simply say a name.  This is
 // deliberately tried only after all explicit screen commands, so phrases such
 // as "افتح سجل الغياب" can never be mistaken for a person's name.
 if(!ask || ask.split(/\s+/).length<2)return false;
 if(/^(?:افتح|فتح|اعرض|ورني|وريني|اغلق|سكر|اقفل|اخرج|خروج|تاريخ|يوم|موعد|تاكيد|اكد|اعتمد|راجع|ثبت|كمل|تابع|الغ|الغي|ازل|شيل|احذف|استبعد)\b/.test(ask))return false;
 const matches=matchTeacherNames(p().teachers,ask);
 if(matches.length!==1)return false;
 selectTeacherByVoice(event,ask);
 return true;
}
function pickCancellationTeacherName(event,ask){
 const panel=box.querySelector('#absenceCancelPanel');
 if(!panel)return false;
 // The cancellation panel is a name picker too.  It must run before the
 // generic "إلغاء غياب" action below; otherwise a spoken name can be
 // misread as a request to close the panel that is already open.
 const explicit=ask.match(/^(?:حدد|اختر|اختار|عل[ّم]?|علم|الغ|الغي|الغاء|الغى|ازل|شيل|احذف|اعتبر)\s+(?:غياب\s+)?(?:المعلم\s+|الاستاذ\s+|المدرس\s+)?(.+?)(?:\s+(?:حضر|حاضر|داوم|راجع|رجع))?$/)
   ||ask.match(/^(?:حضر|حاضر|داوم|راجع|رجع)\s+(?:المعلم\s+|الاستاذ\s+|المدرس\s+)?(.+)$/);
 if(explicit&&explicit[1]&&!/^(?:المعلم|الاستاذ|المدرس)$/.test(explicit[1])){selectTeacherByVoice(event,explicit[1],{cancel:true});return true}
 if(!ask||ask.split(/\s+/).length<2)return false;
 if(/^(?:افتح|فتح|اعرض|ورني|وريني|اغلق|سكر|اقفل|اخرج|خروج|تاكيد|اكد|اعتمد|اطبع|طباعه|تنزيل|نزل|حمل|الغ|الغي|الغاء|الغى|ازل|شيل|احذف)\b/.test(ask))return false;
 const matches=matchTeacherNames(p().teachers,ask);
 if(matches.length!==1)return false;
 selectTeacherByVoice(event,ask,{cancel:true});
 return true;
}
function handleVoiceAbsence(event){
 if(!box.open)return;
 const ask=normal(event.detail.text),reply=event.detail.reply;
 const click=id=>{const button=box.querySelector(id);if(!button)return false;button.click();sayVoice(event,`تم الضغط على «${button.textContent.trim()}».`);return true};
 if(/(?:اغلق|سكر|اقفل|اخرج|خروج)/.test(ask))return click('#absenceClose');
 if(/(?:فتح|افتح|اعرض|ورني|وريني).*(?:سجل|سجلات).*(?:الغياب|غياب)|^(?:سجل|سجلات) الغياب$/.test(ask))return click('#absenceHistory');
 if(/(?:تحديد|سجل|افتح|ابد).*(?:غياب جديد|تحديد غياب)|^(?:غياب جديد)$/.test(ask))return click('#absenceNew');
 if(view==='select'){
  const dated=ask.match(/(?:تاريخ|يوم|موعد)\s*(?:ال)?غياب\s+(.+)$/)||ask.match(/^(?:اليوم|بكره|بكرا|غدا|\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4})$/);
  if(dated){const value=voiceDate(dated[1]||dated[0]);if(!value)return sayVoice(event,'اذكر التاريخ بصيغة 2026-10-28 أو 28-10-2026.');date=value;draw();return sayVoice(event,`تم تحديد تاريخ الغياب: ${value}.`) }
  const remove=ask.match(/^(?:الغ|الغي|ازل|شيل|احذف|استبعد)\s+(?:غياب\s+)?(?:المعلم\s+)?(.+)$/);
  if(remove)return selectTeacherByVoice(event,remove[1],{remove:true});
  const select=ask.match(/^(?:حدد|اختر|اختار|سجل|ضيف|اضف|علّم|علم)\s+(?:غياب\s+)?(?:المعلم\s+|الاستاذ\s+|المدرس\s+)?(.+?)(?:\s+(?:غائب|غايب))?$/);
  if(select)return selectTeacherByVoice(event,select[1]);
  if(/(?:تاكيد|اكد|اعتمد|راجع|ثبت).*(?:الغياب|الغائبين)|^(?:كمل|تابع) الغياب$/.test(ask))return click('#absenceReview');
  if(pickSpokenTeacherName(event,ask))return;
 }
 if(view==='confirm'){
  if(/(?:ارجع|عود|رجوع|العودة).*(?:تحديد|اختيار)|^(?:ارجع|رجوع)$/.test(ask))return click('#absenceBack');
  if(/(?:تاكيد|اكد|اعتمد|سجل|وزع|نفذ).*(?:المنتظرين|الانتظار|التوزيع|الغياب)/.test(ask))return click('#absenceCommit');
 }
 if(view==='history'){
  if(/(?:عرض|افتح|ورني|وريني).*(?:النموذج|السجل|الغياب)/.test(ask)){const records=[...(p().absenceRecords||[])].sort((a,b)=>b.date.localeCompare(a.date));const wanted=voiceDate(ask);const found=wanted&&records.find(item=>item.date===wanted)||records.length===1&&records[0];if(!found)return sayVoice(event,'اذكر تاريخ السجل مثل: «اعرض سجل غياب 2026-10-28».');record=found;view='preview';message='';draw();return sayVoice(event,`فُتح سجل الغياب بتاريخ ${found.date}.`) }
 }
 if(view==='preview'){
  if(/(?:اطبع|طباعه|تنزيل|نزل|حمل|pdf|بي دي اف).*(?:النموذج|السجل|الغياب)|^(?:اطبع|نزل|حمل)(?:\s+pdf)?$/.test(ask))return click('#absencePrint');
  if(pickCancellationTeacherName(event,ask))return;
  if(/(?:الغ|الغي|ازل|شيل).*(?:غياب).*(?:معلم|المعلم)|^(?:الغ|الغي) غياب$/.test(ask))return click('#absenceCancelTeacher');
  if(/(?:تاكيد|اكد|اعتمد).*(?:الالغاء|الالغاء)/.test(ask)){const button=box.querySelector('#absenceCancelConfirm');if(button){button.click();sayVoice(event,'تم تأكيد الإلغاء.');return}}
 }
}
window.addEventListener('voice-absence-command',handleVoiceAbsence);
window.addEventListener('open-absence',()=>{if(!bridge())return;if(!p().placements?.length)return bridge().notice('أنشئ الجدول الدراسي أولًا.');selected=new Set();date=today();query='';message='';view='select';draw();box.showModal()});
window.addEventListener('open-signature-tasks',event=>{if(!bridge())return;record=p().absenceRecords?.find(item=>item.id===event.detail?.recordId);if(!record)return bridge().notice('لم يُعثر على سجل الغياب المطلوب.');view='preview';message='';draw();if(!box.open)box.showModal();openSignatureTasks()});
