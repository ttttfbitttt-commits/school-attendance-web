import {setDialogContent} from '/dialog-content.js?v=1';
const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
import {buttonLexicon,tabLexicon,pressVerbs,navVerbs,fillerWords,scrollWords} from '/voice-lexicon.js?v=11';
import {parseSchoolVoiceField} from '/school-voice.js?v=4';
import {canonicalVoiceCommand,cleanVoiceRequest,voiceNumber,parseClassAdditions,matchTeacherNames,findClassReferences,parseClassAssignmentIntent,resolveClassAssignmentTargets,parseAvailabilityIntent} from '/voice-command.js?v=22';
import {parseTimingRequest,planTiming} from '/voice-timing.js?v=3';
let project=await fetch('/api/project').then(r=>r.json()),step=project.setupStep||0,unlocked=project.setupStep||0,teacher=project.teachers[0]?.id,assignmentTeacher=project.teachers[0]?.id,assignmentSubject='',assignmentClass=project.classes[0]?.id,day=0,dragged=null,pending=null,undo=[],busy=false,editMode=false,editTeacher='',voiceScrollTimer=null,voiceConversation=false,voiceWaiting=false,voiceReplies=false,conversationRecognition=null,voiceRestartTimer=null,voiceRestartAttempts=0,timingSaveTimer=null,timingSaveRunning=false,timingSaveDirty=false,contactsPanelOpen=false,contactsOutsideListener=null;
const names=['بيانات المدرسة','الأيام والتوقيت','الفصول والخطة','المعلمون والإسنادات','الإتاحة والقيود','إنشاء الجدول','حصص الانتظار','تكليفات التوقيع'];
const weekNames=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const templateData=await fetch('/api/templates').then(r=>r.json());
const stageDefinitions={ثانوي:{grades:['اول','ثاني','ثالث'],labels:['الأول الثانوي','الثاني الثانوي','الثالث الثانوي']},متوسط:{grades:['اول','ثاني','ثالث'],labels:['الأول المتوسط','الثاني المتوسط','الثالث المتوسط']},ابتدائي:{grades:['اول','ثاني','ثالث','رابع','خامس','سادس'],labels:['الأول الابتدائي','الثاني الابتدائي','الثالث الابتدائي','الرابع الابتدائي','الخامس الابتدائي','السادس الابتدائي']}};
const stageDefinition=(stage=project.school.stage)=>stageDefinitions[stage]||stageDefinitions.ثانوي;
let gradeNames=stageDefinition().grades;
function stageTemplates(stage=project.school.stage){const plan=templateData.plans?.[stage]||{grades:templateData.grades};return Object.fromEntries(stageDefinition(stage).grades.map((g,i)=>[g,Object.entries(plan.grades[i]||{}).map(([subject,count])=>({subject,short:subject,count,pairs:0,room:''}))]));}
const api=async(path,body)=>{const r=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error((d.errors||['تعذر الطلب']).join('\n'));return d};
const notice=t=>{$('#notice').textContent=t};
async function configureLogout(){
 const response=await fetch('/api/auth/session'),session=await response.json();
 if(!response.ok)throw Error((session.errors||['تعذر التحقق من جلسة الحساب.']).join('\n'));
 if(!session.user)return;
 const button=$('#logout');button.hidden=false;
 button.onclick=async()=>{button.disabled=true;try{await api('auth/logout',{});location.replace('/')}catch(error){button.disabled=false;notice(error.message)}};
}
configureLogout().catch(error=>notice(error.message));
const input=(label,key,value,type='text')=>`<label>${label}<input data-school="${key}" type="${type}" value="${esc(value)}"></label>`;
const load=t=>project.courses.filter(c=>c.teacherId===t).reduce((a,c)=>a+c.count,0);
function invalidate(){project.exceptions=[];if(project.placements.length){project.solverHint=structuredClone(project.placements);project.placements=[];notice('تغيرت المدخلات. الجدول السابق لا ينطبق عليها؛ أنشئ نتيجة جديدة. النسخة المحفوظة لم تتغير بعد.')}$('#saveStatus').textContent='تغييرات غير محفوظة'}
function render(){
 gradeNames=stageDefinition().grades;
 $('#title').textContent=names[step];$('#schoolLabel').textContent=project.school.name;$('#steps').innerHTML=names.map((n,i)=>`<button data-step="${i}" class="${i===step?'active':''}" ${(i===6||i===7?!project.placements.length:i>unlocked)?'disabled':''}><b>${i<step?'✓':i+1}</b><span>${n}</span></button>`).join('');
 $('#prev').disabled=step===0;$('#next').hidden=step===7;$('#next').textContent=step===5?'حصص الانتظار ←':step===6?'تكليفات التوقيع ←':'حفظ ومتابعة ←';$('#stepStatus').textContent=`الخطوة ${step+1} من ${names.length}`;
 const views=[schoolView,timeView,classView,teacherView,availabilityView,tableView,standbyView,signatureTasksViewExpanded];$('#content').innerHTML=views[step]();if(step===0)$('#content').insertAdjacentHTML('afterbegin',termManagerView());bind();updateContextGuide();
}
function activeScheduleBadge(){return `<div class="activeScheduleBadge" role="status"><span class="activeScheduleCheck" aria-label="الجدول المحدد">✓</span><span>الجدول الحالي: <strong>${esc(project.activeScheduleName||'جدول 1')}</strong></span></div>`}
function termManagerView(){const terms=project.termWorkspaces||[],active=terms.find(term=>term.id===project.activeTermId),available=[['الثاني','الفصل الثاني'],['الثالث','الفصل الثالث']].filter(([term])=>!terms.some(item=>item.term===term));return `<div class="card intro"><span class="badge">الفصل الدراسي النشط</span><h2 style="margin-top:12px">${esc(active?.label||`الفصل ${project.school.term}`)}</h2><p>كل فصل دراسي يحتفظ بمعلميه وأنصبتهم وإسناداته وجداوله وغيابه وتوقيعاته بصورة مستقلة.</p><div class="toolbar">${terms.map(term=>`<button class="${term.id===project.activeTermId?'':'secondary'}" data-switch-term="${esc(term.id)}" ${term.id===project.activeTermId?'disabled':''}>${esc(term.label)}${term.id===project.activeTermId?' — الحالي':''}</button>`).join('')}</div>${available.length?`<div class="toolbar"><label>فصل جديد<select id="newTermWorkspace">${available.map(([term,label])=>`<option value="${term}">${label}</option>`).join('')}</select></label><button id="createTermWorkspace">إنشاء الفصل من نسخة الفصل الحالي</button></div><p class="muted">ينسخ المعلمين وأرقامهم وأنصبتهم والإسنادات والفصول والمواد والتوقيت، لكنه يبدأ دون جدول أو انتظار أو غياب أو توقيعات.</p>`:''}</div>`}
function standbyView(){return `${activeScheduleBadge()}<div class="card intro"><h2>إدارة حصص الانتظار والغياب</h2><p>اضبط أنصبة الانتظار بعد إنشاء الجدول الدراسي، وراجع المنتظرين ثم سجّل الغياب واطبع التكليفات.</p></div><div class="card"><h2>إعداد حصص الانتظار</h2><p>النصاب المستهدف، استثناء المعلمين، حساب الأنصبة وشروط التوزيع الآلي.</p><button id="openStandby">إعداد حصص الانتظار</button></div><div class="card"><h2>جدول المنتظرين</h2><p>عرض المنتظرين حسب اليوم والحصة، والتبديل والإضافة والحذف وتعديل ترتيب الانتظار والطباعة.</p><button id="openStandbyTable">جدول المنتظرين</button></div><div class="card"><h2>المعلم الغائب</h2><p>البحث وتحديد الغائبين، تأكيد الغياب وتوزيع المنتظرين، وفتح سجل الغياب والنماذج الرسمية.</p><button id="openAbsence">المعلم الغائب</button></div>`}
function signatureTasksView(){const records=[...(project.absenceRecords||[])].sort((a,b)=>b.date.localeCompare(a.date)),withPhone=project.teachers.filter(teacher=>teacher.whatsapp).length,importInfo=project.teacherContactsImport;const signatureLog=records.length?`<div class="card"><h2>سجل التكليفات والرسائل</h2><p class="muted">يبقى كل يوم في السجل للمراجعة والطباعة. عند اكتمال توقيع جميع المكلّفين تصبح حالته «مكتمل» ولا تُرسل أي رسائل تلقائيًا.</p><div class="scroll"><table><thead><tr><th>اليوم والتاريخ</th><th>المعلمون الغائبون</th><th>تكليفات قابلة للتوقيع</th><th>تم التوقيع</th><th>الحالة</th><th></th></tr></thead><tbody>${records.map(record=>{const covered=record.entries.filter(entry=>entry.replacementId).length,signed=record.entries.filter(entry=>entry.signatureStatus==='signed').length,status=!covered?'لا توجد تكليفات':signed===covered?'مكتمل':signed?`بانتظار ${covered-signed} توقيع`:'بانتظار التوقيع';return `<tr><td><b>${esc(record.day)}</b><small dir="ltr">${esc(record.date)}</small></td><td>${record.teachers.map(teacher=>esc(teacher.name)).join('، ')}</td><td>${covered}</td><td>${signed} / ${covered}</td><td>${status}</td><td><button data-signature-record="${esc(record.id)}">فتح التكليفات والرسائل</button></td></tr>`}).join('')}</tbody></table></div></div>`:`<div class="card"><p>لا توجد سجلات غياب بعد. سجّل الغياب أولًا من تبويب «حصص الانتظار».</p></div>`;return `${activeScheduleBadge()}<div class="card intro"><h2>تكليفات التوقيع عبر واتساب</h2><p>اختر سجل الغياب، ثم أدخل أرقام المعلمين وجهّز روابط التوقيع. عند توقيع المعلم من جواله يظهر توقيعه تلقائيًا في نموذج PDF الرسمي.</p></div><div class="card"><h2>استيراد أرقام جوال المعلمين من التقرير الرسمي</h2><p class="muted">ارفع تقرير بيانات المعلمين بصيغة Excel. يبحث النظام عن عمودي «الاسم» و«الجوال»، ويطابق كل اسم مع قائمة معلمي المدرسة قبل حفظ رقم الجوال. الصفوف غير المطابقة أو المتشابهة لا تُحفظ تلقائيًا.</p><label class="fileButton">اختيار تقرير بيانات المعلمين<input id="teacherContactsFile" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label><div id="teacherContactsPreview" role="status"></div></div><div class="card"><h2>أرقام المعلمين المحفوظة</h2><p class="muted">${withPhone} من ${project.teachers.length} معلم لديهم رقم جوال محفوظ.${importInfo?` آخر استيراد: ${esc(importInfo.imported)} رقمًا.`:''} عدّل الرقم هنا عند الحاجة ثم احفظ التغييرات.</p><div class="scroll"><table><thead><tr><th>المعلم</th><th>رقم الجوال</th><th>الحالة</th></tr></thead><tbody>${project.teachers.map(teacher=>`<tr><td>${esc(teacher.name)}</td><td><input dir="ltr" data-saved-contact="${esc(teacher.id)}" inputmode="tel" placeholder="05xxxxxxxx" value="${esc(teacher.whatsapp||'')}"></td><td>${teacher.whatsapp?'محفوظ':'لم يضف'}</td></tr>`).join('')}</tbody></table></div><button id="saveTeacherContacts" class="secondary">حفظ تعديل أرقام الجوال</button></div>${signatureLog}`}
function signatureTasksViewExpanded(){
 const records=[...(project.absenceRecords||[])].sort((a,b)=>b.date.localeCompare(a.date)),withPhone=project.teachers.filter(teacher=>teacher.whatsapp).length,importInfo=project.teacherContactsImport;
 const contactsBody=contactsPanelOpen?`<div class="scroll"><table><thead><tr><th>المعلم</th><th>رقم الجوال</th><th>الحالة</th></tr></thead><tbody>${project.teachers.map(teacher=>`<tr><td>${esc(teacher.name)}</td><td><input dir="ltr" data-saved-contact="${esc(teacher.id)}" inputmode="tel" placeholder="05xxxxxxxx" value="${esc(teacher.whatsapp||'')}"></td><td>${teacher.whatsapp?'محفوظ':'لم يضف'}</td></tr>`).join('')}</tbody></table></div><button id="saveTeacherContacts" class="secondary">حفظ تعديل أرقام الجوال</button>`:'';
 const contacts=`<div class="card" id="savedTeacherContacts"><div class="toolbar"><h2>أرقام المعلمين المحفوظة</h2><button id="toggleTeacherContacts" class="secondary" aria-expanded="${contactsPanelOpen}">${contactsPanelOpen?'إخفاء أرقام المعلمين':'عرض أرقام المعلمين'}</button></div><p class="muted">${withPhone} من ${project.teachers.length} معلم لديهم رقم جوال محفوظ.${importInfo?` آخر استيراد: ${esc(importInfo.imported)} رقمًا.`:''}${contactsPanelOpen?' عدّل الرقم هنا عند الحاجة ثم احفظ التغييرات.':' اضغط «عرض أرقام المعلمين» للمراجعة أو التعديل.'}</p>${contactsBody}</div>`;
 const log=records.length?`<div class="card"><h2>سجل التكليفات والرسائل</h2><p class="muted">يبقى كل يوم في السجل للمراجعة والطباعة. عند اكتمال توقيع جميع المكلّفين تصبح حالته «مكتمل» ولا تُرسل أي رسائل تلقائيًا.</p><div class="scroll"><table><thead><tr><th>اليوم والتاريخ</th><th>المعلمون الغائبون</th><th>تكليفات قابلة للتوقيع</th><th>تم التوقيع</th><th>الحالة</th><th></th></tr></thead><tbody>${records.map(record=>{const covered=record.entries.filter(entry=>entry.replacementId).length,signed=record.entries.filter(entry=>entry.signatureStatus==='signed').length,status=!covered?'لا توجد تكليفات':signed===covered?'مكتمل':signed?`بانتظار ${covered-signed} توقيع`:'بانتظار التوقيع';return `<tr><td><b>${esc(record.day)}</b><small dir="ltr">${esc(record.date)}</small></td><td>${record.teachers.map(teacher=>esc(teacher.name)).join('، ')}</td><td>${covered}</td><td>${signed} / ${covered}</td><td>${status}</td><td><button data-signature-record="${esc(record.id)}">فتح التكليفات والرسائل</button></td></tr>`}).join('')}</tbody></table></div></div>`:`<div class="card"><p>لا توجد سجلات غياب بعد. سجّل الغياب أولًا من تبويب «حصص الانتظار».</p></div>`;
 return `${activeScheduleBadge()}<div class="card intro"><h2>تكليفات التوقيع عبر واتساب</h2><p>اختر سجل الغياب، ثم أدخل أرقام المعلمين وجهّز روابط التوقيع. عند توقيع المعلم من جواله يظهر توقيعه تلقائيًا في نموذج PDF الرسمي.</p></div><div class="card"><h2>استيراد أرقام جوال المعلمين من التقرير الرسمي</h2><p class="muted">ارفع تقرير بيانات المعلمين بصيغة Excel. يبحث النظام عن عمودي «الاسم» و«الجوال»، ويطابق كل اسم مع قائمة معلمي المدرسة قبل حفظ رقم الجوال. الصفوف غير المطابقة أو المتشابهة لا تُحفظ تلقائيًا.</p><label class="fileButton">اختيار تقرير بيانات المعلمين<input id="teacherContactsFile" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label><div id="teacherContactsPreview" role="status"></div></div>${contacts}${log}`;
}
function schoolView(){return `<div class="card intro"><span class="badge">نبدأ بأساس واضح</span><h2 style="margin-top:16px">جدول مدرستك، خطوة بخطوة</h2><p>أدخل البيانات أو اطلب من مساعد الجدول الصوتي تعبئتها. ابدأ ببيانات مدرستك. لن تُضاف فصول أو أسماء معلمين إلا بعد إنشائها أو استيرادها بنفسك.</p></div><div class="card smartTableImportCard"><h2>استيراد جدول كامل من «الجدول الذكي»</h2><p>ارفع ملف Excel الأصلي الذي صدّره «الجدول الذكي». يستورد البرنامج المعلمين والفصول والمواد وتوقيت الحصص والجدول الفعلي، ثم يستورد <strong>جدول المنتظرين بترتيب الأولوية نفسه</strong>. يمكنك بعدها فتح «طباعة الجداول» لطباعة الجدول العام حسب المعلمين مباشرة.</p><p class="muted">هذه العملية تستبدل مسودة المدرسة الحالية بعد ظهور معاينة واعتمادك لها. لا ترفع ملف أسماء المعلمين البسيط هنا؛ استخدمه من تبويب «المعلمون والإسنادات».</p><label class="fileButton">اختيار تصدير الجدول الذكي<input id="smartTableFile" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label><div id="smartTablePreview" role="status"></div></div><div class="card"><h2>البيانات الرئيسية</h2><div class="fields">${input('الإدارة العامة للتعليم بمنطقة','educationAdministration',project.school.educationAdministration||'')}${input('مكتب التعليم','educationOffice',project.school.educationOffice||'')}${input('اسم المدرسة','name',project.school.name)}${input('اسم مدير المدرسة','director',project.school.director)}${input('العام الدراسي','year',project.school.year)}<label>المرحلة<select data-school="stage">${['ابتدائي','متوسط','ثانوي'].map(n=>`<option ${project.school.stage===n?'selected':''}>${n}</option>`).join('')}</select></label><label>الفصل الدراسي<select data-school="term">${['الأول','الثاني','الثالث'].map(n=>`<option ${project.school.term===n?'selected':''}>${n}</option>`).join('')}</select></label></div><p class="muted">تظهر الإدارة ومكتب التعليم واسم المدرسة تلقائيًا في ترويسة سجل توزيع حصص الانتظار الرسمي. عند تغيير المرحلة، انتقل إلى «الفصول والخطة» وأنشئ الفصول لتطبيق قالب التعليم العام المناسب.</p></div>`}
function timeView(){return `<div class="stats"><div class="stat"><strong>${project.days.length}</strong><span>أيام الدوام الفعلية</span></div><div class="stat"><strong>${project.slots.length}</strong><span>حصة أسبوعيًا لكل فصل</span></div><div class="stat"><strong>${[...new Set(project.slots.map(slot=>timeMinutes(slot.end)-timeMinutes(slot.start)))].join(' / ')}</strong><span>مدة الحصة بالدقائق</span></div></div><div class="card"><h2>أيام العمل</h2><p class="muted">التوزيع قابل للتغيير. تغيير السعة يتطلب مراجعة أنصبة المواد والإغلاقات.</p><div class="toolbar">${project.days.map((d,i)=>`<label>${esc(d.name)}<input type="number" min="1" max="12" data-day="${i}" value="${d.count}" style="width:90px"></label>`).join('')}<button id="rebuildTime">تطبيق عدد الحصص</button></div><h3>التوقيت</h3><p class="muted">يمكنك تحديد البداية والمدة بصوتك: «من الحصة الأولى إلى الثالثة، كل حصة خمسين دقيقة، تبدأ الساعة… ومن الرابعة وما بعدها، كل حصة خمسين دقيقة، تبدأ الساعة…». تُفهم الساعة بالأرقام أو بالكلمات، مثل «سبعة ونص» و«عشرة وربع». الحصص التي لا تذكرها تبقى كما هي، ولا تُضاف فسحة تلقائيًا.</p><div class="scroll"><table><thead><tr><th>اليوم</th><th>الحصة</th><th>البداية</th><th>النهاية</th></tr></thead><tbody>${project.slots.map((s,i)=>`<tr><td>${esc(project.days[s.day].name)}</td><td>${s.period+1}</td><td><input type="time" value="${s.start}" data-time="${i}" data-field="start"></td><td><input type="time" value="${s.end}" data-time="${i}" data-field="end"></td></tr>`).join('')}</tbody></table></div></div>`}
function classView(){const label=templateData.plans?.[project.school.stage]?.label||templateData.label;return `<div class="card intro"><h2>${project.classes.length} فصلًا • خطة قابلة للتخصيص</h2><p>${esc(label)}. اختر عدد الشعب ثم اضغط «إنشاء الفصول». يمكنك تغيير اسم المادة واختصارها وعدد حصصها، مع ضرورة تطابق مجموع الفصل مع سعة الأسبوع.</p></div><div class="card"><div class="toolbar"><label>الفصل<select id="classSelect">${project.classes.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label><button id="addCourse" class="secondary">إضافة مادة</button></div><div id="courseTable"></div></div>`}
function coursesTable(cid){if(!cid){$('#courseTable').innerHTML='<p class="muted">لم تُنشأ فصول بعد. أدخل عدد الشعب في النموذج أعلاه ثم اضغط إنشاء الفصول.</p>';return}const courses=project.courses.filter(c=>c.classId===cid);$('#courseTable').innerHTML=`<p class="muted">المجموع ${courses.reduce((a,c)=>a+c.count,0)} / ${project.slots.length} — اختلاف الخطة مسموح، وشرط السعة ملزم.</p><table><thead><tr><th>المادة</th><th>الاختصار</th><th>أسبوعيًا</th><th>جلسات مزدوجة</th><th></th></tr></thead><tbody>${courses.map(c=>`<tr><td><input data-course="${c.id}" data-field="subject" value="${esc(c.subject)}"></td><td><input data-course="${c.id}" data-field="short" value="${esc(c.short)}"></td><td><input type="number" min="0" max="50" data-course="${c.id}" data-field="count" value="${c.count}"></td><td><input type="number" min="0" data-course="${c.id}" data-field="pairs" value="${c.pairs}"></td><td><button data-remove="${c.id}" class="secondary">حذف</button></td></tr>`).join('')}</tbody></table>`;
 $('#courseTable').onchange=e=>{const c=project.courses.find(c=>c.id===e.target.dataset.course);if(!c)return;const k=e.target.dataset.field;c[k]=['count','pairs'].includes(k)?Number(e.target.value):e.target.value;invalidate();coursesTable(cid)};
 $('#courseTable').onclick=e=>{if(e.target.dataset.remove){undo.push(structuredClone(project));project.courses=project.courses.filter(c=>c.id!==e.target.dataset.remove);invalidate();coursesTable(cid);notice('حُذفت المادة من المسودة. راجع مجموع الفصل قبل المتابعة.')}};
}
function teacherView(){
 if(!project.teachers.length)return `<div class="card"><h2>لا يوجد معلمون بعد</h2><p>استورد ملف Excel من البطاقة أعلى هذه الصفحة، ثم أضف المعلمين إلى المسودة.</p></div>`;
 const t=project.teachers.find(x=>x.id===assignmentTeacher)||project.teachers[0];assignmentTeacher=t.id;
 const subjects=[...new Set(project.courses.map(c=>c.subject))].sort((a,b)=>a.localeCompare(b,'ar'));
 if(!subjects.includes(assignmentSubject))assignmentSubject=subjects[0]||'';
 const allChoices=project.courses.filter(c=>c.subject===assignmentSubject);
 const choices=allChoices.filter(c=>!c.teacherId||c.teacherId===t.id);
 const reserved=allChoices.length-choices.length;
 const reservedTeachers=[...allChoices.filter(c=>c.teacherId&&c.teacherId!==t.id).reduce((map,c)=>{map.set(c.teacherId,(map.get(c.teacherId)||0)+1);return map},new Map()).entries()];
 const cl=project.classes.find(c=>c.id===assignmentClass)||project.classes[0];if(cl)assignmentClass=cl.id;
 const used=load(t.id),available=project.slots.length-t.blocked.length,remaining=Math.min(t.max,available)-used;
 const classCourses=cl?project.courses.filter(c=>c.classId===cl.id):[];
 return `<div class="stats"><div class="stat"><strong>${project.teachers.length}</strong><span>معلمًا مستوردًا</span></div><div class="stat"><strong>${project.courses.filter(c=>c.teacherId).length} / ${project.courses.length}</strong><span>مواد الفصول المسندة</span></div><div class="stat"><strong>${project.courses.reduce((a,c)=>a+c.count,0)}</strong><span>حصة أسبوعية للمدرسة</span></div></div>
 <div class="card assignmentStudio"><span class="badge">الخطوة الأساسية</span><h2>ربط المعلم بالمادة والفصول</h2><div class="currentTeacher"><span>المعلم المحدد الآن</span><strong>${esc(t.name)}</strong><small>اختصار الطباعة: ${esc(t.short)}</small></div><p class="muted">اختر المعلم ثم المادة؛ تظهر الفصول غير المسندة، والفصول المسندة لهذا المعلم فقط. عند إسناد فصل يُحجز ولا يظهر في قائمة أي معلم آخر.</p><div class="fields assignmentControls"><label>المعلم<select id="assignmentTeacher">${project.teachers.map(x=>`<option value="${x.id}" ${x.id===t.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label><label>المادة<select id="assignmentSubject">${subjects.map(s=>`<option ${s===assignmentSubject?'selected':''}>${esc(s)}</option>`).join('')}</select></label></div><div class="assignmentStats"><span><b>${used}</b> مسند</span><span><b>${t.max}</b> النصاب</span><span><b>${available}</b> متاح زمنيًا</span><span class="${remaining<0?'warning':''}"><b>${remaining}</b> متبقٍ</span></div>${reserved?`<div class="reservedNote"><strong>${reserved} فصلًا لهذه المادة محجوزًا لمعلمين آخرين.</strong><span>اضغط اسم المعلم للانتقال إليه وإلغاء الإسناد عند الحاجة:</span><div class="reservedTeachers">${reservedTeachers.map(([id,count])=>{const owner=project.teachers.find(x=>x.id===id);return `<button class="secondary" data-open-reserved-teacher="${id}">${esc(owner.short)} <small>${count} فصول</small></button>`}).join('')}</div></div>`:''}<div class="assignmentGrid">${choices.map(c=>`<label class="courseChoice ${c.teacherId===t.id?'assigned':''}"><input type="checkbox" data-teacher-course="${c.id}" ${c.teacherId===t.id?'checked':''}><span><b>${esc(project.classes.find(x=>x.id===c.classId)?.name)}</b><small>${c.count} حصص أسبوعيًا${c.teacherId===t.id?' · مسند لهذا المعلم':''}</small></span></label>`).join('')||'<p class="muted">كل فصول هذه المادة محجوزة لمعلمين آخرين.</p>'}</div></div>
 <div class="card"><h2>مراجعة الفصل</h2><p class="muted">تحقق من أن كل مادة في الفصل لها معلم. الإسناد يتم من البطاقة السابقة حتى تظل العملية واضحة.</p><div class="toolbar"><label>الفصل<select id="assignmentClass">${project.classes.map(x=>`<option value="${x.id}" ${x.id===assignmentClass?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label></div><table><thead><tr><th>المادة</th><th>الحصص</th><th>المعلم المسند</th></tr></thead><tbody>${classCourses.map(c=>`<tr><td>${esc(c.subject)}</td><td>${c.count}</td><td>${esc(project.teachers.find(x=>x.id===c.teacherId)?.name||'غير مسند')}</td></tr>`).join('')}</tbody></table></div>
 <div class="card"><h2>ضبط بيانات المعلمين</h2><div class="scroll"><table><thead><tr><th>الاسم الكامل</th><th>اختصار الطباعة</th><th>الحد الأعلى</th><th>المسند</th></tr></thead><tbody>${project.teachers.map(x=>`<tr><td>${esc(x.name)}</td><td><input data-teacher="${x.id}" data-field="short" value="${esc(x.short)}"></td><td><input type="number" data-teacher="${x.id}" data-field="max" min="0" value="${x.max}"></td><td>${load(x.id)}</td></tr>`).join('')}</tbody></table></div></div>`
}
function availabilityView(){if(!project.teachers.length)return '<div class="card">استورد المعلمين في الخطوة السابقة أولًا.</div>';const t=project.teachers.find(t=>t.id===teacher)||project.teachers[0];teacher=t.id;const max=Math.max(...project.days.map(d=>d.count)),soft=t.softBlocked||[],imported=project.availabilityImport;return `<div class="card"><div class="toolbar"><label>تخصيص المعلم<select id="teacherSelect">${project.teachers.map(t=>`<option value="${t.id}" ${teacher===t.id?'selected':''}>${esc(t.name)}</option>`)}</select></label><span class="badge">المسند ${load(t.id)} / قطعي ${t.blocked.length} / مرن ${soft.length}</span><button id="importAvailability" class="secondary">استيراد إتاحات الجدول الذكي</button></div><p class="muted">✓ متاح. × منع قطعي لا يتجاوزه المولّد. △ قيد مرن مستورد: يتجنبه المولّد، ولا يستخدمه إلا عند تعذر الحل، ثم يعرضه لك قبل الحفظ. اضغط △ لإزالته، أو اضغط ✓ لإضافة منع قطعي.</p>${imported?`<p class="muted">آخر استيراد: ${esc(imported.importedAt)} — ${imported.teachersMatched} معلمًا و${imported.blockedSlots} قيدًا مرنًا.</p>`:''}<table><thead><tr><th>اليوم</th>${Array.from({length:max},(_,p)=>`<th>${p+1}</th>`).join('')}</tr></thead><tbody>${project.days.map((d,di)=>`<tr><td>${esc(d.name)}</td>${Array.from({length:max},(_,p)=>{const s=project.slots.findIndex(s=>s.day===di&&s.period===p),hard=t.blocked.includes(s),flexible=soft.includes(s);return `<td>${s<0?'—':`<button data-block="${s}" class="slotButton ${hard?'blocked':flexible?'softBlocked':''}" aria-label="${esc(d.name)} الحصة ${p+1} ${hard?'منع قطعي':flexible?'قيد مرن':'متاح'}">${hard?'×':flexible?'△':'✓'}</button>`}</td>`}).join('')}</tr>`).join('')}</tbody></table></div>`}
function dayTable(placements,di,teacherId=null,changes=[]){const lookup=new Map(placements.map(p=>[p.courseId+'|'+p.slot,p]));const courses=new Map(project.courses.map(c=>[c.id,c]));const slots=project.slots.map((s,i)=>({...s,i})).filter(s=>s.day===di);const rows=teacherId?[{id:teacherId,name:project.teachers.find(t=>t.id===teacherId).short}]:project.classes;return `<table class="timetable"><thead><tr><th>${teacherId?'المعلم':'الفصل'}</th>${slots.map(s=>`<th>الحصة ${s.period+1}<br><small>${s.start} – ${s.end}</small></th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr><th>${esc(row.name)}</th>${slots.map(s=>{const pos=placements.find(p=>p.slot===s.i&&(teacherId?courses.get(p.courseId)?.teacherId===teacherId:courses.get(p.courseId)?.classId===row.id));const c=pos&&courses.get(pos.courseId),t=c&&project.teachers.find(t=>t.id===c.teacherId);return `<td data-drop="${s.i}" data-class="${teacherId?'':row.id}" class="${c&&changes.includes(c.id+'|'+s.i)?'changed':''}">${c?`<div class="lesson" draggable="false" tabindex="0" role="button" aria-label="اسحب الحصة لتعديل موضعها" data-drag="${c.id}" data-slot="${s.i}" style="--hue:${hash(c.subject)%360}">${esc(c.short||c.subject)}<small>${esc(teacherId?project.classes.find(cl=>cl.id===c.classId).name:t.short)}</small></div>`:'—'}</td>`}).join('')}</tr>`).join('')}</tbody></table>`}
function teacherWeekTable(placements,selectedTeacher=''){const courses=new Map(project.courses.map(c=>[c.id,c])),slots=project.slots.map((s,i)=>({...s,i})),rows=selectedTeacher?[project.teachers.find(t=>t.id===selectedTeacher)].filter(Boolean):project.teachers;return `<div class="scroll weeklyScroll"><table class="teacherWeek"><thead><tr><th rowspan="2">المعلم / النصاب</th>${project.days.map((d,i)=>`<th colspan="${slots.filter(s=>s.day===i).length}">${esc(d.name)}</th>`).join('')}</tr><tr>${slots.map(s=>`<th title="${esc(s.start)} – ${esc(s.end)}">${s.period+1}</th>`).join('')}</tr></thead><tbody>${rows.map(t=>`<tr><th><strong>${esc(t.short)}</strong><small>${load(t.id)} حصة</small></th>${slots.map(s=>{const pos=placements.find(p=>p.slot===s.i&&courses.get(p.courseId)?.teacherId===t.id),c=pos&&courses.get(pos.courseId);return `<td data-drop="${s.i}" data-teacher="${t.id}" class="${simpleDropClass(s.i,t.id)}">${c?`<div class="lesson" draggable="false" tabindex="0" role="button" aria-label="اسحب الحصة لتعديل موضعها" data-drag="${c.id}" data-slot="${s.i}" style="--hue:${hash(c.subject)%360}">${esc(c.short||c.subject)}<small>${esc(project.classes.find(cl=>cl.id===c.classId)?.name)}</small></div>`:'—'}</td>`}).join('')}</tr>`).join('')}</tbody></table></div>`}
function selectedTeacherWeekTable(placements,teacherId){const courses=new Map(project.courses.map(c=>[c.id,c])),maxPeriods=Math.max(...project.days.map((_,day)=>project.slots.filter(s=>s.day===day).length));return `<div class="teacherMatrixWrap"><table class="teacherMatrix"><thead><tr><th>اليوم / الحصة</th>${Array.from({length:maxPeriods},(_,period)=>`<th>الحصة ${period+1}</th>`).join('')}</tr></thead><tbody>${project.days.map((day,dayIndex)=>`<tr><th>${esc(day.name)}</th>${Array.from({length:maxPeriods},(_,period)=>{const slotIndex=project.slots.findIndex(s=>s.day===dayIndex&&s.period===period),pos=slotIndex>=0&&placements.find(p=>p.slot===slotIndex&&courses.get(p.courseId)?.teacherId===teacherId),c=pos&&courses.get(pos.courseId);if(slotIndex<0)return '<td class="notScheduled">—</td>';return `<td data-drop="${slotIndex}" data-teacher="${teacherId}" class="${simpleDropClass(slotIndex,teacherId)}">${c?`<div class="lesson" draggable="false" tabindex="0" role="button" aria-label="اسحب الحصة لتعديل موضعها" data-drag="${c.id}" data-slot="${slotIndex}" style="--hue:${hash(c.subject)%360}">${esc(c.short||c.subject)}<small>${esc(project.classes.find(cl=>cl.id===c.classId)?.name)}</small></div>`:'—'}</td>`}).join('')}</tr>`).join('')}</tbody></table></div>`}
function editTableView(){if(!project.placements.length)return '';const selected=project.teachers.find(t=>t.id===editTeacher)||project.teachers[0];editTeacher=selected.id;return `<section class="card editStudio"><div class="toolbar"><h2>تعديل الجدول</h2><label>المعلم المطلوب<select id="editTeacher">${project.teachers.map(t=>`<option value="${t.id}" ${t.id===selected.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label><span class="badge">وضع يدوي حر</span><button id="closeEditor" class="secondary">إغلاق التعديل</button></div><p class="muted">في هذا الوضع تُلغى الإتاحات والحجوزات والتثبيتات والأزواج وشروط تكرار المادة عند البحث عن البدائل. يبقى فقط منع تعارض المعلم أو الفصل أو المكان في اللحظة نفسها حتى يظل الجدول قابلًا للتنفيذ.</p><h3>جدول المعلم: ${esc(selected.name)}</h3>${selectedTeacherWeekTable(project.placements,selected.id)}<h3>الجدول العام للمعلمين</h3><p class="muted">مرتب حسب قائمة المعلمين. تظهر أيام الأسبوع ثم الحصص، وتظهر حصص كل معلم في صفه.</p>${teacherWeekTable(project.placements)}</section>`}
function hash(s){return [...s].reduce((a,c)=>a+c.charCodeAt(0),0)}
function createClasses(counts){
 if(counts.some(n=>!Number.isInteger(n)||n<0||n>40)||!counts.some(Boolean))return notice('أدخل عددًا بين صفر و40 لكل صف، مع فصل واحد على الأقل.');
 undo.push(structuredClone(project));const keep=[],courses=[];
 const stage=project.school.stage,definition=stageDefinition(stage),templates=stageTemplates(stage);
 // Rebuild only the selected stage; preserve every class/course from other stages.
 const belongsToStage=c=>c.planStage===stage||(!c.planStage&&definition.grades.some(g=>c.name===g+' '+String(c.name).split(' ').at(-1)));
 const preserved=project.classes.filter(c=>!belongsToStage(c));
 const preservedIds=new Set(preserved.map(c=>c.id));
 keep.push(...preserved); courses.push(...project.courses.filter(c=>preservedIds.has(c.classId)));
 definition.grades.forEach((g,i)=>{for(let n=1;n<=counts[i];n++){const name=g+' '+n,old=project.classes.find(c=>c.name===name&&(c.planStage||stage)===stage),cl=old?{...old,planStage:stage}:{id:crypto.randomUUID(),name,planStage:stage};keep.push(cl);courses.push(...(old?project.courses.filter(c=>c.classId===old.id):(templates[g]||[]).map(c=>({...c,id:crypto.randomUUID(),classId:cl.id,teacherId:''}))))}});
 if(keep.length===project.classes.length&&keep.every(c=>project.classes.some(o=>o.id===c.id))){undo.pop();return notice('الفصول المطلوبة موجودة بالفعل. احتُفظ بإسناداتها.');}
 project.classes=keep;project.courses=courses;project.locks=[];invalidate();render();notice(`أُنشئت شعب ${stage} من القالب المعتمد. الفصول الجديدة تحتاج إسناد معلمين.`);
}
function tableView(){const softCount=project.teachers.reduce((n,t)=>n+(t.softBlocked||[]).length,0),exceptions=project.exceptions||[];return `${activeScheduleBadge()}<div class="card intro"><h2>مساحة إنشاء الجدول</h2><p>يبدأ المولّد بالقيود القطعية وكل القيود المرنة. عند تعذر ذلك، يمكنه استخدام أقل عدد ممكن من القيود المرنة ويعرضها للمراجعة قبل الحفظ.</p></div><div class="card"><div class="toolbar"><button id="scheduleLibrary" class="secondary" ${busy?'disabled':''}>الجداول المحفوظة وتغيير الاسم</button><button id="generate" ${busy?'disabled':''}>${busy?'جارٍ البحث…':'✦ إنشاء جدول جديد'}</button><button id="openEditor" class="secondary" ${!project.placements.length?'disabled':''}>✎ تعديل الجدول</button>${project.manualOverrideMode?'<span class="badge">تعديلات يدوية حرّة مفعّلة</span>':''}<label>مدة البحث<select id="seconds"><option value="20">20 ثانية</option><option value="60">دقيقة</option><option value="120">دقيقتان</option></select></label>${softCount?`<label class="exceptionToggle"><input id="allowExceptions" type="checkbox" checked> السماح باستثناء القيود المرنة عند الضرورة (${softCount})</label>`:''}<button id="check" class="secondary">التحقق من الجدول</button><button id="undo" class="secondary" ${!undo.length?'disabled':''}>تراجع</button><button id="print" class="secondary">▣ طباعة الجداول</button><button id="export" class="secondary">نسخة JSON</button></div><div class="toolbar">${project.days.map((d,i)=>`<button data-view-day="${i}" class="${day===i?'':'secondary'}">${esc(d.name)}</button>`).join('')}</div><div class="scroll">${project.placements.length?dayTable(project.placements,day):'<p>بعد اكتمال الإسنادات يمكنك إنشاء الجدول. إذا تعذرت الشروط سنعرض حالة البحث دون اعتبارها أخطاء في أسماء المعلمين.</p>'}</div>${exceptions.length?`<div class="exceptionReport"><h3>استثناءات مقترحة للمراجعة — ${exceptions.length}</h3><p class="muted">هذه الحصص استخدمت قيدًا مرنًا فقط. لا تُحفظ النتيجة إلا بعد مراجعتها.</p><div class="scroll"><table><thead><tr><th>المعلم</th><th>الفصل</th><th>المادة</th><th>اليوم</th><th>الحصة</th></tr></thead><tbody>${exceptions.map(x=>`<tr><td>${esc(x.teacher)}</td><td>${esc(x.className)}</td><td>${esc(x.subject)}</td><td>${esc(x.day)}</td><td>${x.period}</td></tr>`).join('')}</tbody></table></div></div>`:''}<p class="muted">التوليد يفرض المنع القطعي والأنصبة وعدم التعارض والتثبيت والأزواج؛ أما التعديل اليدوي فيفتح جميع الحصص ويتجاوز تلك القيود ويعرض بدائل بسيطة أو مركبة قبل التنفيذ.</p></div>`}
function classPrintCode(name){const n=String(name||''),grade=/^(?:أول|اول)/.test(n)?'1':/^(?:ثاني)/.test(n)?'2':/^(?:ثالث)/.test(n)?'3':/^(?:رابع)/.test(n)?'4':/^(?:خامس)/.test(n)?'5':/^(?:سادس)/.test(n)?'6':'',number=(n.match(/(\d+)\s*$/)||[])[1]||n;return grade?`${grade}-${number}`:number}
function subjectPrintShort(course){const subject=String(course.short||course.subject||'').trim(),source=String(course.subject||'').trim();const known={'التقنية الرقمية':'رقمية','المهارات الرقمية':'رقمية','علوم الأرض والفضاء':'علم الأرض','القرآن الكريم وتفسيره':'قرآن','القرآن الكريم والدراسات الإسلامية':'قرآن','الكفايات اللغوية':'كفايات','التفكير الناقد':'ناقد','التربية الصحية والبدنية':'بدنية','التربية البدنية والدفاع عن النفس':'بدنية','التربية الفنية':'فنية','المهارات الحياتية والأسرية':'حياتية','الدراسات الاجتماعية':'اجتماعيات','اللغة العربية':'عربي','المجال الاختياري':'اختياري','البحث ومصادر المعلومات':'بحث','اللغة الإنجليزية':'إنجليزي','الرياضيات':'رياضيات','العلوم':'علوم','الأحياء':'أحياء','الكيمياء':'كيمياء','الفيزياء':'فيزياء','التاريخ':'تاريخ','النشاط':'نشاط'};return known[source]||known[subject]||subject}
function printContext(){const courses=new Map(project.courses.map(c=>[c.id,c])),classes=new Map(project.classes.map(c=>[c.id,c])),teachers=new Map(project.teachers.map(t=>[t.id,t])),byTeacher=new Map(),byClass=new Map();for(const p of project.placements){const c=courses.get(p.courseId);if(!c)continue;byTeacher.set(c.teacherId+'|'+p.slot,p);byClass.set(c.classId+'|'+p.slot,p)}return {courses,classes,teachers,byTeacher,byClass}}
function printWeekHeader(first){return `<thead><tr><th rowspan="2">${first}</th>${project.days.map((d,i)=>`<th colspan="${project.slots.filter(s=>s.day===i).length}">${esc(d.name)}</th>`).join('')}</tr><tr>${project.slots.map(s=>`<th>${s.period+1}</th>`).join('')}</tr></thead>`}
function printDocumentTitle(title){return `<header class="printHeader"><strong>${esc(project.school.name||'المدرسة')}</strong><h1>${esc(title)}</h1><p>العام الدراسي ${esc(project.school.year||'')} • الفصل ${esc(project.school.term||'')} • ${new Date().toLocaleDateString('ar-SA')}</p></header>`}
function generalPrintTable(kind,ctx){const rows=kind==='teachers-general'?project.teachers:project.classes,first=kind==='teachers-general'?'المعلم / النصاب':'الفصل';return `<table class="printGrid generalGrid">${printWeekHeader(first)}<tbody>${rows.map(row=>`<tr><th>${esc(kind==='teachers-general'?row.short:classPrintCode(row.name))}<small>${kind==='teachers-general'?load(row.id)+' حصة':esc(row.name)}</small></th>${project.slots.map((s,i)=>{const p=(kind==='teachers-general'?ctx.byTeacher:ctx.byClass).get(row.id+'|'+i),c=p&&ctx.courses.get(p.courseId);if(!c)return '<td></td>';const other=kind==='teachers-general'?ctx.classes.get(c.classId):ctx.teachers.get(c.teacherId);return `<td><b>${esc(kind==='teachers-general'?classPrintCode(other.name):subjectPrintShort(c))}</b><small>${esc(kind==='teachers-general'?subjectPrintShort(c):other.short)}</small></td>`}).join('')}</tr>`).join('')}</tbody></table>`}
function individualPrintTable(kind,row,ctx){const isTeacher=kind==='teachers-individual',max=Math.max(...project.days.map(d=>d.count));return `<section class="printPage">${printDocumentTitle(isTeacher?'جدول المعلم '+row.name:'جدول الفصل '+row.name)}<table class="printGrid individualGrid"><thead><tr><th>اليوم / الحصة</th>${Array.from({length:max},(_,i)=>`<th>${i+1}</th>`).join('')}</tr></thead><tbody>${project.days.map((d,di)=>`<tr><th>${esc(d.name)}</th>${Array.from({length:max},(_,period)=>{const slot=project.slots.findIndex(s=>s.day===di&&s.period===period);if(slot<0)return '<td class="unavailable"></td>';const p=(isTeacher?ctx.byTeacher:ctx.byClass).get(row.id+'|'+slot),c=p&&ctx.courses.get(p.courseId);if(!c)return '<td></td>';const other=isTeacher?ctx.classes.get(c.classId):ctx.teachers.get(c.teacherId);return `<td><b>${esc(isTeacher?classPrintCode(other.name):subjectPrintShort(c))}</b><small>${esc(isTeacher?subjectPrintShort(c):other.short)}</small></td>`}).join('')}</tr>`).join('')}</tbody></table></section>`}
function printStyles(kind,paper='a4'){const isA3=paper==='a3',paperWidth=isA3?'420mm':'297mm',paperHeight=isA3?'297mm':'210mm',general=kind.includes('general');return `<style>@page{size:${paperWidth} ${paperHeight};margin:${isA3?'7mm':'5mm'}}html,body{width:${paperWidth};min-height:${paperHeight};margin:0;padding:0}*{box-sizing:border-box}body{font-family:Tahoma,Arial,sans-serif;direction:rtl;color:#102f2c}.printHeader{text-align:center;margin:0 0 ${isA3?'8':'4'}px}.printHeader strong{font-size:${isA3?'11':'9'}px;color:#4b6f67}.printHeader h1{font-size:${isA3?'19':'14'}px;margin:4px}.printHeader p{font-size:${isA3?'10':'8'}px;margin:0;color:#49655f}.printGrid{width:100%;border-collapse:collapse;table-layout:fixed}.printGrid thead{display:table-header-group}.printGrid th,.printGrid td{border:1px solid #758a84;text-align:center;padding:${isA3?'4px 2px':'2px 1px'};vertical-align:middle}.printGrid thead th{background:#e2f0e9}.printGrid tbody th{background:#eff6f2}.printGrid b,.printGrid small{display:block}.printGrid small{font-size:${isA3?'8':'6'}px;margin-top:2px}.generalGrid{font-size:${isA3?'8':'5.5'}px}.generalGrid td{height:${isA3?'28':'19'}px}.generalGrid th:first-child{width:${isA3?'85':'43'}px}.individualGrid{font-size:${isA3?'12':'10'}px}.individualGrid td{height:${isA3?'52':'42'}px}.individualGrid th:first-child{width:${isA3?'90':'70'}px}.individualGrid small{font-size:${isA3?'10':'8'}px}.unavailable{background:repeating-linear-gradient(135deg,#fff,#fff 5px,#edf1ef 5px,#edf1ef 10px)}.printPage{width:${paperWidth};min-height:${paperHeight};break-after:page;page-break-after:always}.printPage:last-child{break-after:auto;page-break-after:auto}@media print{html,body,.printPage{width:${paperWidth};min-height:${paperHeight}}.printPage{break-after:page}}</style>`}
function openPrintDocument(kind,paper='a4'){if(!project.placements.length)return notice('أنشئ الجدول أولًا قبل الطباعة.');const ctx=printContext(),title={"teachers-general":'الجدول العام حسب المعلمين',"classes-general":'الجدول العام حسب الفصول',"teachers-individual":'جداول المعلمين',"classes-individual":'جداول الفصول'}[kind],body=kind.includes('general')?`${printDocumentTitle(title)}${generalPrintTable(kind,ctx)}`:(kind==='teachers-individual'?project.teachers:project.classes).map(row=>individualPrintTable(kind,row,ctx)).join(''),win=window.open('','_blank');if(!win)return notice('تعذر فتح صفحة الطباعة. اسمح بالنوافذ المنبثقة لهذا التطبيق ثم أعد المحاولة.');win.document.open('text/html','replace');win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>${printStyles(kind,paper)}</head><body>${body}</body></html>`);win.document.close();const printWhenReady=()=>{try{if(!win.closed&&win.document.querySelector('.printGrid')){win.focus();win.print()}else if(!win.closed)setTimeout(printWhenReady,80)}catch{}};setTimeout(printWhenReady,250)}
async function save(){try{project=await api('save',project);$('#saveStatus').textContent='حُفظت المسودة';notice('حُفظت النسخة على هذا الجهاز.');return true}catch(e){notice(e.message);return false}}
function saveTimingSoon(){
 timingSaveDirty=true;clearTimeout(timingSaveTimer);$('#saveStatus').textContent='جارٍ حفظ التوقيت…';
 timingSaveTimer=setTimeout(async()=>{
  if(timingSaveRunning)return;
  timingSaveRunning=true;timingSaveDirty=false;const snapshot=structuredClone(project);
  try{const saved=await api('save',snapshot);if(timingSaveDirty){project.revision=saved.revision;saveTimingSoon()}else project=saved;$('#saveStatus').textContent='حُفظ التوقيت تلقائيًا';}
  catch(error){$('#saveStatus').textContent='تعذر حفظ التوقيت';notice(error.message)}
  finally{timingSaveRunning=false}
 },550);
}
$('#resetAllData').onclick=async()=>{
 if(busy)return notice('انتظر حتى تنتهي العملية الحالية قبل مسح البيانات.');
 const confirmedByVoice=window.__voiceConfirmedReset===true;window.__voiceConfirmedReset=false;
 if(!confirmedByVoice&&!window.confirm('تحذير: سيتم مسح كافة بيانات المدرسة والمعلمين والفصول والإسنادات والجداول المحفوظة وحصص الانتظار وسجلات الغياب نهائيًا.\n\nلن تتمكن من التراجع عن هذه العملية، وستفقد جميع البيانات.\n\nهل أنت متأكد من مسح كافة البيانات؟'))return;
 const button=$('#resetAllData');button.disabled=true;
 try{await api('reset-project',{confirm:true,revision:project.revision});window.location.reload()}
 catch(error){const message='لم يتم مسح البيانات. '+error.message+'\nإذا ظهرت رسالة «مسار غير معروف»، أعد تشغيل خادم البرنامج لتفعيل التحديث ثم حاول مجددًا.';notice(message);window.alert(message);button.disabled=false}
};
async function next(){
 notice('');
 if(step===5&&!project.placements.length)return notice('أنشئ الجدول الدراسي أولًا قبل إعداد الانتظار.');
 if(step===0&&(!project.school.name.trim()||!project.school.director.trim()||!project.school.year.trim()))return notice('أكمل اسم المدرسة والمدير والعام الدراسي.');
 if(step===2&&!project.classes.length)return notice('أدخل عدد الشعب واضغط إنشاء الفصول أولًا.');
 if(step>=2){const d=await api('validate',project);if(step===2)d.errors=d.errors.filter(e=>!e.startsWith('إسناد غير مكتمل:')&&e!=='أكمل الأيام والفصول والمعلمين.');if(d.errors.length)return notice(d.errors.slice(0,8).join('\n')+(d.errors.length>8?'\nوتوجد عناصر أخرى تحتاج الإكمال.':''));}
 const previous=project.setupStep||0;project.setupStep=Math.max(previous,step+1);
 if(!await save()){project.setupStep=previous;return}unlocked=project.setupStep;step++;render();window.scrollTo(0,0);
}
async function downloadPrintPdf(kind,paper='a4'){
 if(!project.placements.length)return notice('أنشئ الجدول أولًا قبل الطباعة.');
 notice('يجري تجهيز ملف PDF أفقي…');
 try{
  const response=await fetch('/api/print-pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project,kind,paper})});
  if(!response.ok){const data=await response.json().catch(()=>({}));throw Error((data.errors||['تعذر إنشاء ملف PDF.']).join('\n'))}
  const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=`${kind}-${paper}-landscape.pdf`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
  notice(`تم تنزيل ملف PDF ${paper.toUpperCase()} أفقيًا.`);
 }catch(error){notice(error.message)}
}
function rebuildSchedule(counts){
 if(counts.some(n=>!Number.isInteger(n)||n<1||n>12))return notice('عدد الحصص بين 1 و12.');
 if(counts.every((n,i)=>n===project.days[i].count))return notice('التوزيع لم يتغير.');
 undo.push(structuredClone(project));const old=project.slots;project.days.forEach((d,i)=>d.count=counts[i]);
 project.slots=project.days.flatMap((d,di)=>Array.from({length:d.count},(_,p)=>{const s=old.find(s=>s.day===di&&s.period===p);if(s)return {...s};const mins=420+p*45+(p>=3?15:0),fmt=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');return {day:di,period:p,start:fmt(mins),end:fmt(mins+45)}}));
 project.teachers.forEach(t=>t.blocked=t.blocked.map(i=>project.slots.findIndex(s=>s.day===old[i]?.day&&s.period===old[i]?.period)).filter(i=>i>=0));project.locks=[];invalidate();
}
function bind(){
 if(step===0){bindSmartTableImport();bindTermManager();}
 if(step===3)bindImport();
 document.querySelectorAll('#steps button').forEach((b,i)=>b.setAttribute('aria-label',names[i]));
 document.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>{step=Number(b.dataset.step);notice('');render()});
 document.querySelectorAll('[data-school]').forEach(i=>i.onchange=()=>{project.school[i.dataset.school]=i.value;$('#saveStatus').textContent='تغييرات غير محفوظة'});
 document.querySelectorAll('[data-time]').forEach(i=>i.onchange=()=>{project.slots[Number(i.dataset.time)][i.dataset.field]=i.value;invalidate();saveTimingSoon()});
 if(step===1)$('#rebuildTime').onclick=()=>{const counts=[...document.querySelectorAll('[data-day]')].map(e=>Number(e.value));rebuildSchedule(counts);saveTimingSoon();render();notice('تغير التوقيت؛ حُفظ تلقائيًا بعد لحظة. راجع إتاحة المعلمين والخطة. أزيلت التثبيتات القديمة من المسودة.')};
 if(step===2){const panel=document.createElement('div');panel.className='card';panel.innerHTML=`<h2>إنشاء الشعب تلقائيًا</h2><p class="muted">القالب الحالي للثانوي، الفصل الأول، مستورد من مدرسة الفزاري؛ لا يُمثل قالبًا رسميًا لكل المراحل.</p><div class="toolbar">${gradeNames.map((g,i)=>`<label>${['الأول','الثاني','الثالث'][i]} الثانوي<input id="grade${i}" type="number" min="0" max="40" value="${project.classes.filter(c=>c.name.startsWith(g+' ')).length}" style="width:100px"></label>`).join('')}<button id="createClasses">إنشاء الفصول</button></div>`;$('#content').prepend(panel);$('#createClasses').onclick=()=>createClasses(gradeNames.map((_,i)=>Number($('#grade'+i).value)));coursesTable(project.classes[0]?.id);$('#classSelect').onchange=e=>coursesTable(e.target.value);$('#addCourse').onclick=()=>{if(!project.classes.length)return notice('أنشئ الفصول أولًا.');project.courses.push({id:crypto.randomUUID(),classId:$('#classSelect').value,subject:'مادة جديدة',short:'جديدة',teacherId:'',count:1,pairs:0,room:''});invalidate();coursesTable($('#classSelect').value)}}
 document.querySelectorAll('[data-teacher]').forEach(i=>i.onchange=()=>{const t=project.teachers.find(t=>t.id===i.dataset.teacher);if(i.dataset.field==='max'){const n=Number(i.value);if(!Number.isInteger(n)||n<load(t.id)){i.value=t.max;return notice('لا يقبل حد أعلى أقل من الإسناد الحالي.')}t.max=n}else t.short=i.value;$('#saveStatus').textContent='تغييرات غير محفوظة'});
 if(step===3&&project.teachers.length){
  $('#assignmentTeacher').onchange=e=>{assignmentTeacher=e.target.value;render()};
  $('#assignmentSubject').onchange=e=>{assignmentSubject=e.target.value;render()};
  $('#assignmentClass').onchange=e=>{assignmentClass=e.target.value;render()};
  document.querySelectorAll('[data-open-reserved-teacher]').forEach(b=>b.onclick=()=>{assignmentTeacher=b.dataset.openReservedTeacher;render();notice('انتقلت إلى المعلم المسند له. أزل علامة الفصل لإلغاء الحجز.');});
  document.querySelectorAll('[data-teacher-course]').forEach(box=>box.onchange=()=>{const c=project.courses.find(x=>x.id===box.dataset.teacherCourse),t=project.teachers.find(x=>x.id===assignmentTeacher);if(box.checked){if(c.teacherId===t.id)return;const allowed=Math.min(t.max,project.slots.length-t.blocked.length);if(load(t.id)+c.count>allowed){box.checked=false;return notice(`لا يمكن إسناد ${c.subject} لفصل ${project.classes.find(x=>x.id===c.classId).name}: المتبقي للمعلم ${allowed-load(t.id)} حصص، وهذه المادة ${c.count} حصص.`)}c.teacherId=t.id;notice(`أُسندت ${c.subject} — ${project.classes.find(x=>x.id===c.classId).name} إلى ${t.short}.`)}else if(c.teacherId===t.id){c.teacherId='';notice(`أُلغي إسناد ${c.subject} — ${project.classes.find(x=>x.id===c.classId).name}.`)}invalidate();render()});
 }
 document.querySelectorAll('[data-assignment]').forEach(i=>i.onchange=()=>{const c=project.courses.find(c=>c.id===i.dataset.assignment),t=project.teachers.find(t=>t.id===i.value);if(t&&(load(t.id)+(c.teacherId===t.id?0:c.count)>Math.min(t.max,project.slots.length-t.blocked.length))){i.value=c.teacherId;return notice('الإسناد يتجاوز نصاب المعلم أو أوقاته المتاحة. لم يطبق التغيير.')}c.teacherId=i.value;invalidate()});
 if(step===4&&project.teachers.length){$('#teacherSelect').onchange=e=>{teacher=e.target.value;render()};$('#importAvailability').onclick=async()=>{try{notice('جارٍ استيراد إتاحات المعلمين من ملف الجدول الذكي…');const r=await api('import-availability',{});project=r.project;teacher=project.teachers.find(t=>t.id===teacher)?.id||project.teachers[0]?.id;const s=r.stats;notice(`استوردت ${s.blockedSlots} قيدًا مرنًا لـ${s.teachersMatched} معلمًا. حُفظت نسخة احتياطية: ${s.backup}.`);render()}catch(e){notice(e.message)}};document.querySelectorAll('[data-block]').forEach(b=>b.onclick=()=>{const t=project.teachers.find(t=>t.id===teacher),s=Number(b.dataset.block),soft=t.softBlocked||[];if(t.blocked.includes(s))t.blocked=t.blocked.filter(x=>x!==s);else if(soft.includes(s))t.softBlocked=soft.filter(x=>x!==s);else{if(project.slots.length-t.blocked.length-1<load(t.id))return notice(`لا يقبل الإغلاق: الإسناد ${load(t.id)} والمتاح بعد الإغلاق ${project.slots.length-t.blocked.length-1}.`);t.blocked.push(s)}invalidate();render()})}
 if(step===6){$('#openStandby').onclick=()=>window.dispatchEvent(new Event('open-standby'));$('#openStandbyTable').onclick=()=>window.dispatchEvent(new Event('open-standby-table'));$('#openAbsence').onclick=()=>window.dispatchEvent(new Event('open-absence'));}
 if(step===7){bindTeacherContactsImport();bindSavedTeacherContacts();document.querySelectorAll('[data-signature-record]').forEach(button=>button.onclick=()=>window.dispatchEvent(new CustomEvent('open-signature-tasks',{detail:{recordId:button.dataset.signatureRecord}})));}
 if(step===5){$('#generate').onclick=()=>newScheduleDialog();$('#scheduleLibrary').onclick=async()=>{if(await save()){render();scheduleLibrary()}};$('#openEditor').onclick=()=>{editMode=true;editTeacher=editTeacher||project.teachers[0]?.id;$('#editorBody').innerHTML=editTableView();$('#editor').showModal();bindEditor()};$('#check').onclick=async()=>{const r=await api('validate',{...project,checkSchedule:true});notice(r.errors.length?r.errors.join('\n'):'اجتاز الجدول فحص الأنصبة والإتاحة والتثبيت وعدم التعارض.')};$('#undo').onclick=()=>{const revision=project.revision,savedSchedules=project.savedSchedules,absenceRecords=project.absenceRecords;project=undo.pop();project.revision=revision;project.savedSchedules=savedSchedules;project.absenceRecords=absenceRecords;render();notice('تم التراجع في المسودة. احفظ لاعتماد التراجع.')};$('#print').onclick=()=>$('#printCenter').showModal();$('#export').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(project,null,2)],{type:'application/json'}));a.download='nasq-project.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};document.querySelectorAll('[data-view-day]').forEach(b=>b.onclick=()=>{day=Number(b.dataset.viewDay);render()});bindLessonDrag()}
}
function bindTermManager(){
 document.querySelectorAll('[data-switch-term]').forEach(button=>button.onclick=async()=>{
  button.disabled=true;
  try{
   const result=await api('term-switch',{termId:button.dataset.switchTerm,revision:project.revision});
   project=result.project;step=0;unlocked=project.setupStep||0;teacher=project.teachers[0]?.id;assignmentTeacher=teacher;assignmentClass=project.classes[0]?.id;day=0;undo=[];
   render();notice(`تم فتح ${project.termWorkspaces?.find(item=>item.id===project.activeTermId)?.label||'الفصل الدراسي'} ببياناته المستقلة.`);
  }catch(error){button.disabled=false;notice(error.message)}
 });
 const create=$('#createTermWorkspace');
 if(create)create.onclick=async()=>{
  const term=$('#newTermWorkspace').value;create.disabled=true;
  try{
   const result=await api('term-create',{term,revision:project.revision});
   project=result.project;step=0;unlocked=project.setupStep||0;teacher=project.teachers[0]?.id;assignmentTeacher=teacher;assignmentClass=project.classes[0]?.id;day=0;undo=[];
   render();notice(`تم إنشاء ${project.termWorkspaces?.find(item=>item.id===project.activeTermId)?.label||'الفصل الدراسي'} من نسخة الإعدادات، دون أي جدول أو انتظار أو غياب سابق.`);
  }catch(error){create.disabled=false;notice(error.message)}
 };
}
const scheduleDialog=document.createElement('dialog');scheduleDialog.id='scheduleDialog';scheduleDialog.style.cssText='width:min(760px,94vw);max-height:85vh;overflow:auto';document.body.append(scheduleDialog);
const teacherScheduleDialog=document.createElement('dialog');teacherScheduleDialog.id='teacherScheduleDialog';teacherScheduleDialog.style.cssText='width:min(900px,94vw);max-height:88vh;overflow:auto';document.body.append(teacherScheduleDialog);
function scheduleMessage(text){scheduleDialog.querySelector('[role="status"]').textContent=text}
function nextScheduleName(){const used=new Set((project.savedSchedules||[]).map(v=>v.name));if(project.placements.length)used.add(project.activeScheduleName||'جدول 1');let n=1;while(used.has('جدول '+n))n++;return 'جدول '+n}
function newScheduleDialog(){if(busy)return;const proposed=nextScheduleName();setDialogContent(scheduleDialog,`<h2>إنشاء جدول جديد</h2><p>${project.placements.length?`سيُحفظ الجدول الحالي باسم «${esc(project.activeScheduleName||'جدول 1')}» ضمن الجداول المحفوظة. سيبدأ إنشاء جدول جديد بالاسم التالي، ويمكنك العودة إلى الجدول السابق في أي وقت.`:'سيُنشأ جدول جديد بالاسم التالي مع الاحتفاظ بالجداول المحفوظة.'}</p><label>اسم الجدول الجديد<input id="newScheduleName" maxlength="100" value="${esc(proposed)}"></label><p role="status"></p><div class="toolbar"><button id="confirmNewSchedule">حفظ الحالي وإنشاء جدول جديد</button><button id="cancelNewSchedule" class="secondary">إلغاء</button></div>`);scheduleDialog.showModal();$('#cancelNewSchedule').onclick=()=>scheduleDialog.close();$('#confirmNewSchedule').onclick=async()=>{const name=$('#newScheduleName').value.trim();if(!name)return scheduleMessage('اكتب اسم الجدول الجديد.');if((project.savedSchedules||[]).some(v=>v.name===name)||project.placements.length&&name===(project.activeScheduleName||'جدول 1'))return scheduleMessage('هذا الاسم مستخدم. اختر اسمًا آخر.');$('#confirmNewSchedule').disabled=true;if(!await save()){$('#confirmNewSchedule').disabled=false;return scheduleMessage('تعذر حفظ الجدول الحالي. لم يبدأ إنشاء جدول جديد. راجع رسالة الحفظ.')}scheduleDialog.close();await runSolve(name)}}
function scheduleLibrary(){setDialogContent(scheduleDialog,`<h2>الجداول المحفوظة</h2><p>احفظ التعديلات الحالية قبل فتح جدول آخر. يمكن تغيير أسماء الجداول هنا.</p><p role="status"></p>${(project.savedSchedules||[]).map(v=>`<div class="card"><label>${v.id===project.activeScheduleId?'الجدول الحالي':'اسم الجدول'}<input data-schedule-name="${esc(v.id)}" value="${esc(v.name)}" maxlength="100"></label><div class="toolbar"><button data-schedule-rename="${esc(v.id)}" class="secondary">تغيير الاسم</button><button data-schedule-open="${esc(v.id)}" ${v.id===project.activeScheduleId?'disabled':''}>فتح الجدول</button></div></div>`).join('')||'<p>سيُحفظ الجدول الحالي عند حفظ المسودة أو قبل إنشاء جدول جديد.</p>'}<button id="closeScheduleLibrary" class="secondary">إغلاق</button>`);if(!scheduleDialog.open)scheduleDialog.showModal();$('#closeScheduleLibrary').onclick=()=>scheduleDialog.close();scheduleDialog.querySelectorAll('[data-schedule-rename]').forEach(button=>button.onclick=async()=>{const id=button.dataset.scheduleRename,input=[...scheduleDialog.querySelectorAll('[data-schedule-name]')].find(v=>v.dataset.scheduleName===id),name=input.value.trim();if(!name||project.savedSchedules.some(v=>v.id!==id&&v.name===name))return scheduleMessage('اكتب اسمًا غير مكرر للجدول.');const before=structuredClone(project);project.savedSchedules.find(v=>v.id===id).name=name;if(project.activeScheduleId===id)project.activeScheduleName=name;if(await save()){render();scheduleLibrary();scheduleMessage('تم تغيير اسم الجدول.')}else{project=before;scheduleMessage('تعذر حفظ الاسم.')}});scheduleDialog.querySelectorAll('[data-schedule-open]').forEach(button=>button.onclick=async()=>{button.disabled=true;if(!await save()){button.disabled=false;return scheduleMessage('تعذر حفظ التعديلات الحالية؛ لم يتغير الجدول.')}const item=project.savedSchedules.find(v=>v.id===button.dataset.scheduleOpen),before=structuredClone(project);project={...structuredClone(item.snapshot),savedSchedules:project.savedSchedules,revision:project.revision,absenceRecords:project.absenceRecords||[],activeScheduleId:item.id,activeScheduleName:item.name,setupStep:Math.max(5,item.snapshot.setupStep||0)};if(!await save()){project=before;button.disabled=false;return scheduleMessage('تعذر فتح الجدول.')}step=5;unlocked=project.setupStep;undo=[];teacher=project.teachers[0]?.id;assignmentTeacher=teacher;assignmentClass=project.classes[0]?.id;day=0;scheduleDialog.close();render();notice('تم فتح «'+project.activeScheduleName+'».')})}
async function runSolve(newName){if(busy)return;busy=true;const seconds=Number($('#seconds')?.value||20),allowExceptions=$('#allowExceptions')?.checked||false;notice('جارٍ إنشاء الجدول والتحقق من القيود…');$('#generate').disabled=true;try{const {jobId}=await api('solve',{project,seconds,allowExceptions});let r;do{await new Promise(resolve=>setTimeout(resolve,120));r=await fetch('/api/jobs/'+jobId).then(r=>r.json())}while(r.status==='RUNNING');if(!r.placements){const time=typeof r.elapsed==='number'?` تم الفحص خلال ${r.elapsed} ثانية.`:'';notice(r.status==='INFEASIBLE'?`لا يوجد توزيع يحقق القيود الحالية. لم يتجاوز البرنامج أي شرط صارم.${time}`:(r.errors||['انتهت مهلة البحث دون حسم.']).slice(0,3).join('\n')+time);return}undo.push(structuredClone(project));project.placements=r.placements;if(newName){project.activeScheduleId=crypto.randomUUID();project.activeScheduleName=newName;delete project.standby;}project.exceptions=r.exceptions||[];project.manualOverrideMode=false;$('#saveStatus').textContent='تغييرات غير محفوظة';const stored=await save();notice(`${stored?'':'تعذر حفظ الجدول الجديد؛ احفظ المسودة بعد مراجعة رسالة الخطأ. '}اكتمل إنشاء «${project.activeScheduleName||'جدول 1'}»: ${r.placements.length} حصة في ${r.elapsed} ثانية.${project.exceptions.length?` استُخدم ${project.exceptions.length} استثناءً مرنًا؛ راجعها قبل الحفظ.`:' لم يُستخدم أي استثناء.'}`)}catch(e){notice(e.message)}finally{busy=false;render()}}
let swapChoices=[],swapBefore=[],swapIndex=0,moveRequest=null,swapSearch={elapsed:0,exhaustive:false},simpleSwapPlans=new Map(),simpleSource=null,voiceSwapAutoApply=false;
function simpleDropClass(slot,teacherId){return simpleSource?.teacherId===teacherId&&simpleSwapPlans.has(slot)?'simpleSwap':''}
function planIsCollisionFree(placements){const courses=new Map(project.courses.map(c=>[c.id,c])),teachers=new Set(),classes=new Set(),rooms=new Set();for(const p of placements){const c=courses.get(p.courseId),tk=c.teacherId+'|'+p.slot,ck=c.classId+'|'+p.slot,rk=c.room&&c.room+'|'+p.slot;if(teachers.has(tk)||classes.has(ck)||(rk&&rooms.has(rk)))return false;teachers.add(tk);classes.add(ck);if(rk)rooms.add(rk)}return true}
function findSimpleSwapPlans(source){const courses=new Map(project.courses.map(c=>[c.id,c])),course=courses.get(source.courseId),from=project.placements.find(p=>p.courseId===source.courseId&&p.slot===source.sourceSlot),plans=new Map();if(!course||!from)return plans;for(const other of project.placements){const otherCourse=courses.get(other.courseId);if(other.slot===source.sourceSlot||other.courseId===source.courseId||otherCourse.classId!==course.classId)continue;const positions=project.placements.map(p=>p===from?{...p,slot:other.slot}:p===other?{...p,slot:from.slot}:p);if(!planIsCollisionFree(positions))continue;const changed=positions.filter(p=>p.courseId===from.courseId&&p.slot===other.slot||p.courseId===other.courseId&&p.slot===from.slot),ids=[...new Set(changed.map(p=>courses.get(p.courseId).teacherId))];plans.set(other.slot,{placements:positions,kind:'بسيط',movedLessons:2,affectedTeachers:ids.length,affectedTeacherIds:ids})}return plans}
function showSimpleTargets(source){const course=project.courses.find(c=>c.id===source.courseId);simpleSource={...source,teacherId:course?.teacherId};simpleSwapPlans=findSimpleSwapPlans(source);document.querySelectorAll('[data-drop]').forEach(cell=>{const isSimple=cell.dataset.teacher===simpleSource.teacherId&&simpleSwapPlans.has(Number(cell.dataset.drop));cell.classList.toggle('simpleSwap',isSimple)});if(simpleSwapPlans.size)notice(`توجد ${simpleSwapPlans.size} تبديلات بسيطة جاهزة باللون الأخضر الفاتح. اسحب الحصة إلى أي منها للمعاينة الفورية.`)}
function weekPreview(positions,tid,changed){
 const width=Math.max(...project.days.map(d=>d.count));
 return `<table class="weekPreview"><thead><tr><th>اليوم</th>${Array.from({length:width},(_,i)=>`<th>${i+1}</th>`).join('')}</tr></thead><tbody>${project.days.map((d,di)=>`<tr><th>${esc(d.name)}</th>${Array.from({length:width},(_,i)=>{const slot=project.slots.findIndex(x=>x.day===di&&x.period===i);const p=positions.find(p=>p.slot===slot&&project.courses.find(c=>c.id===p.courseId)?.teacherId===tid);const c=p&&project.courses.find(c=>c.id===p.courseId);return `<td class="${p&&changed.has(p.courseId+'|'+slot)?'changed':''}">${c?`${esc(project.classes.find(cl=>cl.id===c.classId).name)}<small>${esc(c.short||c.subject)}</small>`:slot<0?'—':''}</td>`}).join('')}</tr>`).join('')}</tbody></table>`
}
function drawSwap(){
 const choice=swapChoices[swapIndex];pending=choice.placements;
 const beforeSet=new Set(swapBefore.map(p=>p.courseId+'|'+p.slot)),afterSet=new Set(pending.map(p=>p.courseId+'|'+p.slot));
 const added=new Set(pending.filter(p=>!beforeSet.has(p.courseId+'|'+p.slot)).map(p=>p.courseId+'|'+p.slot));
 const removed=new Set(swapBefore.filter(p=>!afterSet.has(p.courseId+'|'+p.slot)).map(p=>p.courseId+'|'+p.slot));
 const ids=[...new Set(pending.filter(p=>added.has(p.courseId+'|'+p.slot)).map(p=>project.courses.find(c=>c.id===p.courseId).teacherId))];
 $('#previewBody').innerHTML=`<h2>خيارات تعديل الحصة</h2><p>عُثر على ${swapChoices.length} بديلًا سريعًا خلال ${swapSearch.elapsed} ثانية. ${swapSearch.exhaustive?'استُنفدت كل البدائل المحلية الممكنة.':'تظهر البدائل المحلية التي اكتشفها البحث خلال مهلة ثانيتين.'} البديل 1 هو الأفضل تلقائيًا لأنه يقلل عدد الحصص والمعلمين المتأثرين. قل «اختر البديل 3» للمعاينة، أو «نفّذ البديل 3» للتطبيق، أو «نفّذ أفضل تبديل» للخيار الأول.</p><div class="swapChoices">${swapChoices.map((o,i)=>{const teachers=(o.affectedTeacherIds||[]).map(id=>project.teachers.find(t=>t.id===id)?.short).filter(Boolean).join('، ');return `<button data-choice="${i}" class="${i===swapIndex?'selected':'secondary'}">البديل ${i+1}${i===0?' — الأفضل':''}<small>${o.kind} • ${o.movedLessons} حصص • ${o.affectedTeachers} معلمين${teachers?`<br>يشمل: ${esc(teachers)}`:''}</small></button>`}).join('')}</div><div class="swapVoiceBar" aria-label="أمر صوتي للتبديل"><input id="swapVoiceCommand" placeholder="قل: اختر البديل 3 أو نفّذ أفضل تبديل" aria-label="أمر التبديل الصوتي"><button id="swapVoiceMic" type="button" title="التحدث بأمر التبديل">🎙</button><button id="swapVoiceRun" type="button" class="secondary">تنفيذ الأمر</button></div><p class="muted">بسيط: حصتان أو أقل. مركب: 3–4 حصص. مركب مضاعف: 5 حصص فأكثر.</p>${ids.map(t=>`<section class="card"><h3>${esc(project.teachers.find(x=>x.id===t).name)}</h3><div class="pair"><div><h4>قبل التعديل</h4>${weekPreview(swapBefore,t,removed)}</div><div><h4>بعد التعديل — ${choice.kind}</h4>${weekPreview(pending,t,added)}</div></div></section>`).join('')}`;
 document.querySelectorAll('[data-choice]').forEach(b=>b.onclick=()=>{swapIndex=Number(b.dataset.choice);drawSwap()});bindSwapVoice();$('#applySwap').disabled=false;
}
function bindSwapVoice(){const input=$('#swapVoiceCommand');if(!input)return;const submit=()=>{const text=input.value.trim();if(text){command(text);input.value=''}};$('#swapVoiceRun').onclick=submit;input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();submit()}};$('#swapVoiceMic').onclick=()=>listenForVoice(input,submit)}
function showSimpleSwap(plan){swapBefore=structuredClone(project.placements);swapChoices=[plan];swapSearch={elapsed:0,exhaustive:true};swapIndex=0;pending=null;$('#preview').showModal();drawSwap()}
async function requestSwap(move){
 if(busy)return;busy=true;swapBefore=structuredClone(project.placements);moveRequest=move;pending=null;swapChoices=[];
 $('#previewBody').innerHTML='<h2>البحث عن خيارات التعديل…</h2><p>نفحص بدائل النقل المحلية وسلاسلها خلال ثانيتين. لا تُطبق الإتاحات أو الحجوزات أو التثبيتات.</p>';$('#applySwap').disabled=true;$('#preview').showModal();
 try{const {jobId}=await api('swaps',{project,move,seconds:2});let r;do{await new Promise(resolve=>setTimeout(resolve,80));r=await fetch('/api/jobs/'+jobId).then(r=>r.json())}while(r.status==='RUNNING');
 if(!$('#preview').open)return;
 if(!r.options?.length){$('#previewBody').innerHTML=`<h2>${r.status==='INFEASIBLE'?'لا يوجد تبديل يحقق القيود الحالية':'لم يُعثر على بديل خلال مهلة البحث'}</h2><p>${esc((r.errors||[]).join(' '))}</p>`;return}
 swapChoices=r.options;swapSearch={elapsed:r.elapsed||0,exhaustive:!!r.exhaustive};swapIndex=0;drawSwap();
 }catch(e){$('#previewBody').innerHTML=`<p>${esc(e.message)}</p>`}finally{busy=false;if(voiceSwapAutoApply){voiceSwapAutoApply=false;if(swapChoices.length&&$('#preview').open){swapIndex=0;pending=swapChoices[0].placements;applyCurrentSwap()}else notice('لم يُنفّذ النقل الصوتي لأن المحرك لم يجد تبديلًا صالحًا.') }}
}
function applyCurrentSwap(){if(!pending||busy)return false;undo.push(structuredClone(project));project.placements=pending;project.manualOverrideMode=true;pending=null;$('#preview').close();$('#saveStatus').textContent='تغييرات غير محفوظة';render();refreshOpenEditor();notice('طُبق التعديل اليدوي الحر في المسودة. يمكنك التراجع أو حفظه.');return true}
$('#applySwap').onclick=()=>applyCurrentSwap();
$('#cancelSwap').onclick=()=>{pending=null;$('#preview').close()};
$('#preview').addEventListener('cancel',()=>{pending=null});
let pointerMove=null,dragGhost=null,selectedLesson=null,hoverDay=null;
function refreshOpenEditor(){const editor=$('#editor');if(editor?.open){$('#editorBody').innerHTML=editTableView();bindEditor()}}
function bindEditor(){const editor=$('#editor');$('#editTeacher').onchange=e=>{if(editTeacher!==e.target.value){selectedLesson=null;clearDrag()}editTeacher=e.target.value;$('#editorBody').innerHTML=editTableView();bindEditor()};$('#closeEditor').onclick=()=>editor.close();editor.onclose=()=>{editMode=false};bindLessonDrag()}
function clearDrag(keepSimple=false){document.body.classList.remove('draggingLesson');dragGhost?.remove();dragGhost=null;document.querySelectorAll('.dropReady,.dropInvalid,.lessonSelected,.simpleSwap').forEach(x=>x.classList.remove('dropReady','dropInvalid','lessonSelected','simpleSwap'));if(!keepSimple){simpleSwapPlans=new Map();simpleSource=null}}
function dropOn(cell,source,plans=simpleSwapPlans){if(!cell)return;const c=project.courses.find(c=>c.id===source.courseId);if(cell.dataset.class&&cell.dataset.class!==c.classId)return notice('اختر موضعًا داخل الفصل نفسه؛ نقل الحصة لفصل آخر يغير الإسناد.');if(cell.dataset.teacher&&cell.dataset.teacher!==c.teacherId)return notice('في جدول المعلمين اسحب الحصة داخل صف معلمها؛ سيقترح المحرك تبديلات المعلمين المتأثرين تلقائيًا.');const slot=Number(cell.dataset.drop);if(slot===source.sourceSlot)return;if(plans.has(slot)){const plan=plans.get(slot);clearDrag();return showSimpleSwap(plan)}clearDrag();requestSwap({...source,slot});}
function bindLessonDrag(){
 document.querySelectorAll('[data-drag]').forEach(el=>{
 el.onpointerdown=e=>{if(busy||e.button!==0)return;pointerMove={courseId:el.dataset.drag,sourceSlot:Number(el.dataset.slot),x:e.clientX,y:e.clientY,text:el.innerText,active:false};showSimpleTargets(pointerMove);};
 el.onclick=e=>{if(pointerMove?.active)return;if(selectedLesson){const source=selectedLesson,plans=simpleSwapPlans;selectedLesson=null;clearDrag(true);dropOn(el.closest('[data-drop]'),source,plans)}else{selectedLesson={courseId:el.dataset.drag,sourceSlot:Number(el.dataset.slot)};showSimpleTargets(selectedLesson);el.classList.add('lessonSelected');if(!simpleSwapPlans.size)notice('لا يوجد تبديل بسيط لهذه الحصة؛ اسحبها إلى الموضع المطلوب للبحث عن تبديل مركب.')}};
 el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();el.click()}};
 });
}
document.addEventListener('pointermove',e=>{
 if(!pointerMove)return;const m=pointerMove;
 if(!m.active&&Math.hypot(e.clientX-m.x,e.clientY-m.y)<6)return;
 if(!m.active){m.active=true;selectedLesson=null;document.body.classList.add('draggingLesson');dragGhost=document.createElement('div');dragGhost.className='dragGhost';dragGhost.textContent=m.text;document.body.append(dragGhost)}
 if(!dragGhost){dragGhost=document.createElement('div');dragGhost.className='dragGhost';dragGhost.textContent=m.text;document.body.append(dragGhost)}
 e.preventDefault();dragGhost.style.left=(e.clientX+14)+'px';dragGhost.style.top=(e.clientY+14)+'px';
 document.querySelectorAll('.dropReady,.dropInvalid').forEach(x=>x.classList.remove('dropReady','dropInvalid'));
 const hit=document.elementFromPoint(e.clientX,e.clientY),cell=hit?.closest('[data-drop]');
 if(cell){const course=project.courses.find(c=>c.id===m.courseId),allowed=cell.dataset.class?cell.dataset.class===course.classId:cell.dataset.teacher===course.teacherId;cell.classList.add(allowed?'dropReady':'dropInvalid')}
 const tab=hit?.closest('[data-view-day]');if(tab){const d=Number(tab.dataset.viewDay);if(d!==day&&hoverDay!==d){hoverDay=d;setTimeout(()=>{if(pointerMove?.active&&hoverDay===d){day=d;render()}},450)}}else hoverDay=null;
 const sc=hit?.closest('.scroll');if(sc){const r=sc.getBoundingClientRect();if(e.clientY>r.bottom-36)sc.scrollTop+=15;if(e.clientY<r.top+36)sc.scrollTop-=15;}
},{passive:false});
document.addEventListener('pointerup',e=>{if(!pointerMove)return;const m=pointerMove;if(m.active){const cell=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-drop]'),plans=simpleSwapPlans;clearDrag(true);dropOn(cell,m,plans);setTimeout(()=>{pointerMove=null},0)}else pointerMove=null;hoverDay=null;});
document.addEventListener('pointercancel',()=>{pointerMove=null;clearDrag()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){pointerMove=null;selectedLesson=null;clearDrag()}});
$('#next').onclick=()=>next().catch(e=>notice(e.message));$('#prev').onclick=()=>{step--;notice('');render()};$('#save').onclick=save;
$('#printCenter').onclick=e=>{const choice=e.target.closest('[data-print-type]');if(choice){const paper=$('#printPaper').value;$('#printCenter').close();downloadPrintPdf(choice.dataset.printType,paper)}};$('#closePrintCenter').onclick=()=>$('#printCenter').close();
function msg(text,user=false){const p=document.createElement('p');p.className=user?'user':'';p.textContent=text;const messages=$('#messages');messages.append(p);messages.scrollTop=messages.scrollHeight;if(user)guide('فهمت طلبك، لحظة…','thinking');else{guide(text,'ready');if(voiceReplies)speakGuide(text)}}
function arabicNumber(value){return Number(String(value).replace(/[٠-٩]/g,c=>'٠١٢٣٤٥٦٧٨٩'.indexOf(c)))}
function commandValue(value){return value.replace(/^(?:الى|هو|ليصبح)\s+/,'').trim()}
// المساعد الصوتي لا يعتمد على قائمة أوامر جامدة فقط. كل زر ظاهر يمكن تشغيله بقول
// «اضغط اسم الزر»، حتى الأزرار التي تظهر داخل النوافذ مثل الطباعة والغياب والانتظار.
function voiceText(value=''){return String(value).normalize('NFKC').replace(/[\u064B-\u065F\u0670ـ]/g,'').replace(/[إأآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/[٠-٩۰-۹]/g,c=>'٠١٢٣٤٥٦٧٨٩'.includes(c)?'٠١٢٣٤٥٦٧٨٩'.indexOf(c):'۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/[«»"'،.:!؟]/g,' ').replace(/\s+/g,' ').trim().toLowerCase()}
function voiceButtonName(button){return voiceText([button.getAttribute('aria-label'),button.getAttribute('title'),button.textContent].filter(Boolean).join(' '))}
function voiceButtonTerms(button){return [...new Set([voiceButtonName(button),voiceText(button.querySelector('span')?.textContent),voiceText(button.id)].filter(Boolean))]}
function visibleVoiceControls(){return [...document.querySelectorAll('button,[role="button"]')].filter(button=>!button.disabled&&button.getClientRects().length&&voiceButtonName(button))}
const lexNorm=list=>list.map(voiceText).filter(Boolean);
const dialogStack=[];
function topDialog(){return dialogStack.filter(dialog=>dialog.open).at(-1)||[...document.querySelectorAll('dialog[open]')].at(-1)||null}
const lexButtons=buttonLexicon.map(entry=>({...entry,label:voiceText(entry.label),say:lexNorm(entry.say)}));
const lexTabs=tabLexicon.map(entry=>({...entry,say:lexNorm(entry.say)}));
const lexFillers=lexNorm(fillerWords).sort((a,b)=>b.length-a.length);
const lexVerbs=lexNorm(pressVerbs).sort((a,b)=>b.length-a.length);
const lexNavVerbs=new Set(lexNorm(navVerbs));
const lexPlain=text=>voiceText(text).replace(/[^\u0600-\u06ffa-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const lexBoundary=(text,phrase)=>text===phrase||text.startsWith(phrase+' ')||text.endsWith(' '+phrase)||text.includes(' '+phrase+' ');
function stripVoiceFillers(text){let t=voiceText(text),again=true;while(again){again=false;for(const word of lexFillers){if(t===word)return t;if(t.startsWith(word+' ')){t=t.slice(word.length).trim();again=true;break}}}return t}
function splitVoiceVerb(text){for(const verb of lexVerbs){if(text===verb)return{verb,rest:''};if(text.startsWith(verb+' '))return{verb,rest:text.slice(verb.length).trim()}}return{verb:'',rest:text}}
function stripVoiceNoise(text){let t=text;for(let i=0;i<3;i++)t=t.replace(/^(?:على|علي|الى|الي|ل|لل)\s+/,'').replace(/^(?:زر|الزر|تبويب|صفحه|شاشه|نافذه|قسم|خيار|ايقونه|قائمه)\s+/,'');return t.replace(/\s+(?:لو سمحت|من فضلك|الان|الحين|بسرعه|يلا|يا نسق|نسق|يا آمرني|آمرني|آمرني وأنا أنفذ|يا الجدول الصوتي|الجدول الصوتي)$/,'').trim()}
function lexScore(phrase,say,exact){if(phrase===say)return 100;if(exact)return 0;const extra=phrase.split(' ').length-say.split(' ').length;if(say.length>=3&&extra<=2&&lexBoundary(phrase,say))return 60+Math.min(say.length,30);if(phrase.length>=4&&say.length>phrase.length&&lexBoundary(say,phrase))return 30+Math.min(phrase.length,20);return 0}
function voiceScopeControls(topOnly){const top=topDialog(),all=[...document.querySelectorAll('button,[role="button"]')].filter(button=>!button.closest('.assistant')&&button.getClientRects().length&&voiceButtonName(button)&&button.dataset.drag===undefined&&button.dataset.block===undefined);return top?all.filter(button=>top.contains(button)):(topOnly?[]:all)}
function lexControlRank(button,label){const terms=voiceButtonTerms(button).concat(lexPlain(button.textContent));let best=0;for(const raw of terms){const term=lexPlain(raw);if(term===label)best=Math.max(best,3);else if(term.startsWith(label+' ')||term.endsWith(' '+label))best=Math.max(best,2);else if(term.includes(label))best=Math.max(best,1)}return best}
function pickLexControl(controls,label){const plainLabel=lexPlain(label),ranked=controls.map(button=>({button,rank:lexControlRank(button,plainLabel)})).filter(item=>item.rank);if(!ranked.length)return null;const enabled=ranked.filter(item=>!item.button.disabled),pool=enabled.length?enabled:ranked,top=Math.max(...pool.map(item=>item.rank)),best=pool.filter(item=>item.rank===top);return{button:best[0].button,ambiguous:best.length>1?best.map(item=>item.button):null}}
function voicePageControls(){return [...document.querySelectorAll('main button,aside button,.headerButtons button')].filter(button=>!button.closest('dialog')&&!button.closest('.assistant')&&button.getClientRects().length&&voiceButtonName(button)&&button.dataset.drag===undefined&&button.dataset.block===undefined)}
function voiceVariants(list){const out=new Set(list);for(const item of list){if(/^لل/.test(item))out.add('ال'+item.slice(2));else if(/^ل[^ا]/.test(item)&&item.length>3)out.add(item.slice(1));if(/^ال/.test(item))out.add(item.slice(2));else out.add('ال'+item)}return [...out].filter(Boolean)}
function resolveVoiceTarget(raw){const cleaned=stripVoiceFillers(raw),{verb,rest}=splitVoiceVerb(cleaned),phrase=stripVoiceNoise(rest),full=stripVoiceNoise(cleaned),candidates=voiceVariants([phrase,full,rest,cleaned].filter(Boolean)),tabCandidates=voiceVariants([phrase,rest,full].filter(Boolean));if(!candidates.length||/\d/.test(cleaned)||cleaned.split(' ').length>9)return null;const nav=lexNavVerbs.has(verb),hits=[];for(const entry of lexButtons){const exactSay=(entry.exactSay||[]).map(voiceText);let best=0;for(const say of entry.say)for(const candidate of candidates){const score=lexScore(candidate,say,entry.exact||exactSay.includes(say));if(score>best)best=score}if(best)hits.push({entry,score:best+(nav?0:5),tab:false})}for(const tab of lexTabs){let best=0;for(const say of tab.say)for(const candidate of tabCandidates){const score=lexScore(candidate,say,!nav);if(score>best)best=score}if(best)hits.push({tab,score:best+(nav?15:0),entry:null})}hits.sort((a,b)=>b.score-a.score);const dialogOpen=!!document.querySelector('dialog[open]');if(dialogOpen)for(const hit of hits)if(!hit.tab&&hit.entry.dialog)hit.score+=50;hits.sort((a,b)=>b.score-a.score);for(const hit of hits){if(hit.tab){const control=document.querySelector(`aside [data-step="${hit.tab.index}"]`);if(control)return{kind:'tab',index:hit.tab.index,el:control,needsClose:dialogOpen}}else{let found=pickLexControl(voiceScopeControls(),hit.entry.label),closed=false;if(!found&&dialogOpen&&!hit.entry.dialog){found=pickLexControl(voicePageControls(),hit.entry.label);closed=!!found}if(found)return{kind:'button',el:found.button,ambiguous:found.ambiguous,label:hit.entry.label,needsClose:closed}}}return null}
let pendingVoiceConfirmation=null;
function destructiveVoiceControl(el,label){return el?.id==='resetAllData'||/(?:^| )(?:حذف|مسح|تفريغ|اعاده ضبط|إعادة ضبط)(?: |$)/.test(lexPlain(label))}
function clearVoiceConfirmation(message=''){pendingVoiceConfirmation=null;if(message)msg(message)}
function requestVoiceConfirmation(el,label){
 pendingVoiceConfirmation={el,label,expires:Date.now()+30000};
 msg(`هذا الإجراء «${label}» قد يحذف أو يغيّر بيانات لا يمكن استعادتها. للتأكيد قل: «نعم أكّد ${label}». وللإلغاء قل: «إلغاء».`);
 return true;
}
function handleVoiceConfirmation(text){
 if(!pendingVoiceConfirmation)return false;
 if(Date.now()>pendingVoiceConfirmation.expires){clearVoiceConfirmation('انتهت مهلة التأكيد. لم يُنفّذ أي تغيير.');return false}
 const ask=voiceText(text);
 if(/^(?:الغ|الغي|الغاء|إلغاء|لا|لا تنفذ|لا تطبق|تراجع|بلاش|انس)$/ .test(ask)){clearVoiceConfirmation('ألغيت الإجراء المطلوب.');return true}
 const label=voiceText(pendingVoiceConfirmation.label),hasConfirm=/(?:^| )(?:نعم|ايوه|ايه|اكيد|بالتاكيد|أكّد|اكد|تأكيد|تاكيد|نفذ|طبق)(?: |$)/.test(ask),hasLabel=label&&ask.includes(label);
 if(!hasConfirm||!(hasLabel||/(?:اكد|أكد|تأكيد|تاكيد)/.test(ask))){msg(`ما زلت بانتظار تأكيد «${pendingVoiceConfirmation.label}». قل «نعم أكّد ${pendingVoiceConfirmation.label}» أو «إلغاء».`);return true}
 const action=pendingVoiceConfirmation;pendingVoiceConfirmation=null;
 if(action.el?.id==='resetAllData')window.__voiceConfirmedReset=true;
 if(window.__nasqDry){msg('DRY confirmed «'+action.label+'»');return true}
 action.el?.click();msg(`تم تأكيد «${action.label}».`);return true;
}
function pressVoiceControl(el,label){
 if(!el)return false;
 if(el.disabled){msg(`الزر «${label}» غير متاح الآن.`);return true}
 if(destructiveVoiceControl(el,label))return requestVoiceConfirmation(el,label);
 if(window.__nasqDry){msg('DRY «'+label+'»');return true}
 el.click();msg(`تم الضغط على «${label}».`);return true
}
function genericVoiceTokens(value){return voiceText(value).split(' ').map(word=>word.replace(/^ال(?=.{4,}$)/,'')).filter(word=>word.length>1&&!['زر','الزر','شاشه','صفحه','نافذه','قائمه','على','علي','الى','الي','في','من','لي','اللي','هذا','هذه','هذي','ابغى','ابي','ودي','تكفى','لو','سمحت'].includes(word))}
function genericVoiceButtonMatch(raw){
 const cleaned=stripVoiceFillers(raw),{verb,rest}=splitVoiceVerb(cleaned),phrase=stripVoiceNoise(rest||cleaned),requested=genericVoiceTokens(phrase);
 if(!requested.length||requested.length>8)return null;
 const explicit=/^(?:اضغط|انقر|اكبس|دوس|نفذ|شغل|فعل|افتح|اعرض|ورني|وريني|روح|اروح|انتقل|اذهب|ودني|وديني|خذني|دخلني|اختار|اختر|حدد|طبق|سو|سوي)\b/.test(cleaned)||!!verb;
 if(!explicit)return null;
 const controls=voiceScopeControls();
 const ranked=controls.map(button=>{
  const labels=voiceButtonTerms(button).map(genericVoiceTokens).filter(tokens=>tokens.length);
  let score=0;
  for(const label of labels){
   const matched=requested.filter(token=>label.some(word=>word===token||word.includes(token)||token.includes(word))).length;
   if(!matched)continue;
   const exact=label.join(' ')===requested.join(' '),coverage=matched/requested.length;
   if(exact)score=Math.max(score,1000);
   else if(coverage===1&&requested.length>1)score=Math.max(score,700+matched*10);
   else if(requested.length===1&&matched===1&&requested[0].length>=5)score=Math.max(score,350+requested[0].length);
  }
  return {button,score};
 }).filter(item=>item.score>0);
 if(!ranked.length)return null;
 const best=Math.max(...ranked.map(item=>item.score)),matches=ranked.filter(item=>item.score===best);
 return {button:matches[0].button,ambiguous:matches.length>1?matches.map(item=>item.button):null};
}
function handleGenericVoiceButton(raw){
 const found=genericVoiceButtonMatch(raw);if(!found)return false;
 if(found.ambiguous?.length>1){msg(`وجدت أكثر من زر قريب من طلبك: ${[...new Set(found.ambiguous.map(button=>button.textContent.trim().replace(/\s+/g,' ').slice(0,45)))].join('، ')}. قل اسم الزر كاملًا.`);return true}
 return pressVoiceControl(found.button,found.button.textContent.trim().replace(/\s+/g,' ')||found.button.getAttribute('aria-label')||'الزر المطلوب');
}
function answerVoiceContext(text){
 const ask=voiceText(text);
 if(/^(?:وين|اين|وش|ايش|ما هي|ماهو|ما هو)\s*(?:انا|احنا|نحن|مكاني|مكاننا|الشاشه|الشاشة|الصفحه|الصفحة|التبويب|الخطوه|الخطوة)(?:\s+الحين|\s+الان)?$/.test(ask)){
  const bits=[`أنت الآن في «${names[step]}»`];
  if(step===3){const selectedTeacher=project.teachers.find(item=>item.id===assignmentTeacher);if(selectedTeacher)bits.push(`المعلم المختار ${selectedTeacher.name}`);if(assignmentSubject)bits.push(`والمادة ${assignmentSubject}`)}
  if($('#editor')?.open){const selectedTeacher=project.teachers.find(item=>item.id===editTeacher);bits.push(`ومحرر التعديل مفتوح${selectedTeacher?` للمعلم ${selectedTeacher.name}`:''}`)}
  msg(bits.join('، ')+'. قل «مساعدة الأوامر» لمعرفة ما يمكن قوله هنا.');return true;
 }
 if(/^(?:وش|ايش|ما)\s*(?:المختار|المحدد|اخترت|حددته|الخيارات|الازرار|الأزرار)(?:\s+الحين|\s+الان)?$/.test(ask)){
  if(step===3){const selectedTeacher=project.teachers.find(item=>item.id===assignmentTeacher);msg(`المعلم: ${selectedTeacher?.name||'غير محدد'}، المادة: ${assignmentSubject||'غير محددة'}، والفصل: ${project.classes.find(item=>item.id===assignmentClass)?.name||'غير محدد'}.`);return true}
  msg(controlHelp());return true;
 }
 return false;
}
function signatureRecordForVoice(raw){
 const ask=voiceText(raw),records=[...(project.absenceRecords||[])].sort((a,b)=>b.date.localeCompare(a.date));
 if(!records.length)return null;
 if(/(?:اخر|آخر|احدث|أحدث|اليوم الاخير)/.test(ask))return records[0];
 const aliases={الاحد:['الاحد','احد','الحد'],الاثنين:['الاثنين','اثنين','تنين'],الثلاثاء:['الثلاثاء','ثلاثاء','تلات'],الاربعاء:['الاربعاء','اربعاء','اربع'],الخميس:['الخميس','خميس']};
 const byDay=records.filter(record=>(aliases[voiceText(record.day)]||[voiceText(record.day)]).some(day=>ask.includes(day)));
 if(byDay.length===1)return byDay[0];
 const date=ask.match(/\d{4}-\d{1,2}-\d{1,2}/)?.[0];
 if(date){const byDate=records.find(record=>record.date===date);if(byDate)return byDate}
 return byDay.length>1?'ambiguous':null;
}
function openSignatureRecordByVoice(record){
 if(!record)return false;
 if(step!==7){if(!project.placements.length){msg('أنشئ الجدول أولًا قبل فتح تكليفات التوقيع.');return true}step=7;render()}
 window.dispatchEvent(new CustomEvent('open-signature-tasks',{detail:{recordId:record.id}}));
 msg(`فتحت تكليفات ورسائل ${record.day} بتاريخ ${record.date}.`);return true;
}
function handleSignatureTasksVoice(raw){
 const ask=voiceText(raw),mentions=/تكليفات|توقيع|تواقيع|رسائل|واتساب|روابط/.test(ask),records=[...(project.absenceRecords||[])].sort((a,b)=>b.date.localeCompare(a.date));
 if(!mentions)return false;
 if(/(?:كم|وش|ايش|ما).*(?:باقي|متبقي|حاله|حالة|وضع|وقع|توقيع)/.test(ask)){
  const record=signatureRecordForVoice(ask);
  if(record==='ambiguous'){msg('وجدت أكثر من سجل لهذا اليوم. اذكر التاريخ بصيغة 2026-10-31.');return true}
  const targets=record?[record]:records,covered=targets.reduce((sum,item)=>sum+item.entries.filter(entry=>entry.replacementId).length,0),signed=targets.reduce((sum,item)=>sum+item.entries.filter(entry=>entry.signatureStatus==='signed').length,0);
  msg(record?`في سجل ${record.day} ${record.date}: تم توقيع ${signed} من ${covered}، والمتبقي ${covered-signed}.`:`إجمالي السجل: تم توقيع ${signed} من ${covered}، والمتبقي ${covered-signed}.`);return true;
 }
 if(/(?:افتح|اعرض|ورني|وريني|روح|انتقل).*(?:تكليفات|توقيع|رسائل|واتساب|رابط)/.test(ask)){
  const record=signatureRecordForVoice(ask);
  if(record==='ambiguous'){msg('وجدت أكثر من سجل لهذا اليوم. اذكر التاريخ بصيغة 2026-10-31.');return true}
  if(record)return openSignatureRecordByVoice(record);
  if(records.length===1)return openSignatureRecordByVoice(records[0]);
  if(step!==7){step=7;render()}msg('فتحت سجل التكليفات. اذكر اليوم أو التاريخ، مثل: «افتح تكليفات الخميس» أو «افتح تكليفات 2026-10-29».');return true;
 }
 return false;
}
function smartVoiceIntent(raw){const target=resolveVoiceTarget(raw);if(!target)return false;if(target.needsClose&&!window.__nasqDry)document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());if(target.kind==='tab'){if(target.el.disabled){if(target.index===step+1){next().catch(e=>notice(e.message));msg('سأتحقق من اكتمال هذه الخطوة ثم أنتقل إلى «'+names[target.index]+'».');return true}msg(`خطوة «${names[target.index]}» مقفلة حتى تكمل الخطوات السابقة.`);return true}if(window.__nasqDry){msg('DRY tab '+target.index);return true}target.el.click();msg(`انتقلت إلى «${names[target.index]}».`);return true}if(target.ambiguous?.length>1&&!window.__nasqDry){msg(`وجدت أكثر من زر مطابق: ${[...new Set(target.ambiguous.map(button=>button.textContent.trim().replace(/\s+/g,' ').slice(0,40)))].join('، ')}. اذكر اسم الزر كاملًا.`);return true}return pressVoiceControl(target.el,target.el.textContent.trim().replace(/\s+/g,' '))}
if(['127.0.0.1','localhost'].includes(location.hostname))window.__nasqVoice={norm:voiceText,run(text){command(text);return [...document.querySelectorAll('#messages p')].at(-1)?.textContent||''},resolve(text){const target=resolveVoiceTarget(text);return target?{kind:target.kind,tab:target.index,label:target.el?.textContent.trim().replace(/\s+/g,' ').slice(0,60),ambiguous:target.ambiguous?.length>1}:null}};
const buttonKnowledge=[
 {terms:['حفظ المسودة','حفظ'],description:'يحفظ بيانات المدرسة الحالية على الخادم.'},
 {terms:['حفظ ومتابعة','التالي','حصص الانتظار'],description:'يتحقق من اكتمال الخطوة ويحفظها ثم ينتقل للخطوة التالية.'},
 {terms:['الخطوة السابقة','السابق'],description:'يعود إلى خطوة الإعداد السابقة.'},
 {terms:['تطبيق عدد الحصص'],description:'يحدّث سعة أيام الدوام ويعيد بناء الحصص؛ راجع الإسنادات والإتاحات بعد التغيير.'},
 {terms:['إنشاء الفصول'],description:'ينشئ فصول المرحلة وخطط المواد بحسب الأعداد المدخلة.'},
 {terms:['إضافة مادة'],description:'يضيف مادة إلى الفصل المحدد لتعديل اسمها وعدد حصصها وإسنادها.'},
 {terms:['حذف'],description:'يحذف المادة من مسودة الفصل المحدد. راجع مجموع الحصص قبل المتابعة.'},
 {terms:['اختيار ملف excel','استيراد أسماء المعلمين'],description:'يقرأ ملف المعلمين ويعرض معاينة قبل إضافتهم.'},
 {terms:['إضافة معلم يدويًا'],description:'يفتح إدخال اسم معلم جديد إلى المسودة.'},
 {terms:['إضافة المعلمين إلى المسودة'],description:'يعتمد الأسماء الظاهرة في المعاينة ويضيفها إلى قائمة المدرسة.'},
 {terms:['استيراد إتاحات الجدول الذكي'],description:'يستورد قيود الإتاحة المرنة من ملف الجدول الذكي للمراجعة.'},
 {terms:['إنشاء جدول جديد'],description:'يشغّل محرك الجدولة لإنشاء جدول وفق الإسنادات والقيود الحالية.'},
 {terms:['الجداول المحفوظة وتغيير الاسم','الجداول المحفوظة'],description:'يفتح مكتبة الجداول لفتح جدول محفوظ أو تغيير اسمه.'},
 {terms:['تعديل الجدول'],description:'يفتح محرر تعديل الحصص بعد إنشاء جدول.'},
 {terms:['التحقق من الجدول'],description:'يفحص اكتمال الجدول وتعارضاته وأنصبة المعلمين.'},
 {terms:['تراجع'],description:'يعيد آخر تغيير في المسودة؛ احفظ لاعتماد التراجع.'},
 {terms:['طباعة الجداول'],description:'يفتح خيارات تنزيل جداول المعلمين أو الفصول بصيغة PDF.'},
 {terms:['الجدول العام حسب المعلمين'],description:'ينزّل جدولًا أسبوعيًا عامًا؛ صف لكل معلم وخلايا الحصص تعرض الفصل والمادة.'},
 {terms:['الجدول العام حسب الفصول'],description:'ينزّل جدولًا أسبوعيًا عامًا؛ صف لكل فصل وخلايا الحصص تعرض المادة والمعلم.'},
 {terms:['جداول المعلمين المنفردة'],description:'ينزّل صفحة أسبوعية مستقلة لكل معلم.'},
 {terms:['جداول الفصول المنفردة'],description:'ينزّل صفحة أسبوعية مستقلة لكل فصل.'},
 {terms:['نسخة json'],description:'ينزّل نسخة JSON من بيانات المشروع الحالية.'},
 {terms:['إعداد حصص الانتظار'],description:'يفتح إعداد النصاب والاستثناءات وشروط توزيع الانتظار.'},
 {terms:['جدول المنتظرين'],description:'يفتح جدول تكليفات الانتظار لمراجعته وتعديله وحفظه أو طباعته.'},
 {terms:['المعلم الغائب'],description:'يفتح تسجيل غياب المعلمين وتوزيع المنتظرين وسجل الغياب.'},
 {terms:['حساب وتطبيق أنصبة الانتظار'],description:'يحسب المتبقي لكل معلم من النصاب المستهدف بعد استثناءاتك.'},
 {terms:['إنشاء الانتظار','توزيع الانتظار'],description:'ينشئ توزيعًا لحصص الانتظار وفق الإعدادات والقيود المعروضة.'},
 {terms:['حفظ جدول الانتظار','اعتماد'],description:'يحفظ توزيع الانتظار الحالي للجدول.'},
 {terms:['طباعة جدول المنتظرين'],description:'ينزّل جدول الانتظار بصيغة PDF.'},
 {terms:['تأكيد وتوزيع المنتظرين'],description:'يسجل غياب المعلمين المحددين ثم يوزع المنتظرين المتاحين.'},
 {terms:['فتح سجل الغياب'],description:'يعرض سجلات الغياب السابقة والنماذج المرتبطة بها.'},
 {terms:['تأكيد الغياب'],description:'ينقل إلى مراجعة أسماء المعلمين والتاريخ قبل تسجيل الغياب.'},
 {terms:['العودة للتحديد','تحديد غياب'],description:'يعود لاختيار أسماء المعلمين وتاريخ الغياب.'},
 {terms:['تغيير الاسم'],description:'يحفظ الاسم الجديد للجدول المحدد في مكتبة الجداول.'},
 {terms:['فتح الجدول'],description:'يحفظ التعديلات الحالية ثم يحمّل الجدول المحفوظ المحدد.'},
 {terms:['إغلاق'],description:'يغلق النافذة الحالية دون تطبيق إجراء إضافي.'},
 {terms:['ابدأ الحوار الصوتي'],description:'يبدأ الاستماع المستمر للأوامر؛ قل «أوقف المحادثة» لإنهائه.'},
 {terms:['أوقف الحوار الصوتي'],description:'يوقف الاستماع المستمر للأوامر الصوتية.'},
 {terms:['تأكيد التبديل','تنفيذ التبديل'],description:'يعتمد التبديل المعروض في المعاينة ويحدّث مسودة الجدول.'},
 {terms:['إلغاء'],description:'يغلق المعاينة الحالية دون اعتماد التغيير.'},
];
function explainButton(name){const asked=voiceText(name).replace(/[←→]/g,'').replace(/^(?:زر|الزر)\s+/,'').trim(),known=buttonKnowledge.find(item=>item.terms.some(term=>voiceText(term)===asked))||buttonKnowledge.find(item=>item.terms.some(term=>{const normalized=voiceText(term);return asked.includes(normalized)||normalized.includes(asked)}));if(known)return known.description;const actual=visibleVoiceControls().find(button=>voiceButtonTerms(button).some(term=>term===asked||term.includes(asked)||asked.includes(term)));if(!actual)return '';if(actual.id==='resetAllData')return 'يمسح جميع بيانات المدرسة والجداول وسجلات الغياب نهائيًا. لا ينفذ صوتيًا إلا بعد أن تقول تأكيدًا صريحًا.';if(actual.dataset.step!==undefined)return `ينقلك إلى خطوة «${names[Number(actual.dataset.step)]}» من إعداد الجدول.`;if(actual.dataset.viewDay!==undefined)return `يعرض جدول اليوم ${project.days[Number(actual.dataset.viewDay)]?.name||''}.`;if(actual.dataset.block!==undefined)return `يغيّر إتاحة ${actual.getAttribute('aria-label')||'هذه الخانة'} للمعلم المحدد؛ راجع حالة المنع أو الإتاحة قبل الضغط.`;if(actual.dataset.choice!==undefined)return `يختار البديل ${Number(actual.dataset.choice)+1} لمعاينة أثر تبديل الحصة قبل اعتماده.`;if(actual.dataset.openReservedTeacher)return 'ينتقل إلى المعلم المسند إليه هذا الفصل لمراجعة الإسناد أو إلغائه.';if(actual.dataset.scheduleRename)return 'يحفظ الاسم المكتوب للجدول المقابل.';if(actual.dataset.scheduleOpen)return 'يحفظ التعديلات الحالية ثم يفتح الجدول المحفوظ المحدد.';if(actual.dataset.sbPage!==undefined)return `ينقلك إلى قسم «${actual.textContent.trim()}» في إعداد الانتظار.`;if(actual.dataset.sbDelete)return 'يحذف تكليف الانتظار المحدد من المسودة.';if(actual.dataset.sbUp)return 'يرفع تكليف الانتظار درجة واحدة في ترتيب هذه الحصة.';if(actual.dataset.sbAdd)return 'يضيف معلمًا متاحًا إلى تكليف الانتظار لهذه الحصة.';if(actual.dataset.absenceRecord)return 'يفتح تفاصيل سجل الغياب المحدد.';if(actual.dataset.absenceRemove)return 'يزيل هذا المعلم من قائمة الغياب المحددة.';if(actual.dataset.drag)return 'يمثل حصة في الجدول؛ اخترها ثم اختر موضعًا صالحًا لمعاينة التبديل.';return `لم أجد شرحًا تفصيليًا لهذا الزر بعد. اسمه الظاهر «${actual.textContent.trim()||actual.getAttribute('aria-label')}». قل «اضغط ${actual.textContent.trim()}» لتشغيله.`}
function controlHelp(){const controls=[...new Set(visibleVoiceControls().filter(button=>button.dataset.drag===undefined).map(button=>`${button.textContent.trim()||button.getAttribute('aria-label')} — ${explainButton(voiceButtonName(button))}`))].slice(0,32);return `دليل الجدول الصوتي: بيانات المدرسة للاسم والمرحلة، الأيام والتوقيت لسعة الأسبوع، الفصول والخطة للمواد، المعلمون والإسنادات لربط كل مادة بمعلم، الإتاحة والقيود للأوقات الممنوعة، إنشاء الجدول لتوليد الجداول وتعديلها، وحصص الانتظار للانتظار والغياب.\n\nالأزرار الظاهرة ووظائفها: ${controls.join(' | ')}. يمكنك قول «اضغط» ثم الاسم الظاهر لأي زر في الشاشة الحالية، أو «ما وظيفة زر …؟» لشرحه. وفي الجداول اختر الحصة بذكر يومها ورقمها؛ لا يلزم أن يطابق الأمر اسم زر.\n\nفي الإسناد اختر المعلم والمادة أولًا، ثم قل الفصل مباشرةً مثل «ثاني 7» أو «ثاني سابع». لإسناد جميع فصول صف قل «ثالث ثانوي كلهم» أو «جميع فصول ثالث»، ويمكن استثناء فصل بقول «ثالث جميعًا ما عدا ثالث 7». لإلغاء إسناد فصل قل «ألغِ ثالث 7» أو «شيل الفصل ثالث 7»؛ ولإلغاء إسناد الصف كاملًا قل «شيل ثالث ثانوي كلهم».\n\nفي الإتاحة، اختر المعلم بقول اسمه، ثم قل «إلى الرابعة» لمنع ما بعدها أو «بدون سوادس وبدون سوابع» لمنع الحصتين السادسة والسابعة. «فرغه من الأولى» يمنع الأولى، و«المعلم منتدب» يمنع جميع حصصه.\n\nفي محرر تعديل الجدول، قل اسم المعلم أو «اختر المعلم» ثم الاسم؛ إذا تشابهت الأسماء يحاول المساعد تفضيل المعلم المعروض، وإلا يطلب كلمة تميّزه. اختر حصة بقول «اختر الحصة الرابعة يوم الأحد»، ثم انقلها بقول «انقلها إلى الحصة الثانية يوم الأربعاء». تظهر معاينة البدائل، ولا يُعتمد التغيير حتى تختار «تنفيذ التبديل».\n\nيمكن فتح النوافذ من أي تبويب: «افتح إعداد حصص الانتظار»، «افتح جدول المنتظرين»، «افتح المعلم الغائب»، «افتح سجل الغياب»، «افتح الطباعة»، «افتح تعديل الجدول»، «افتح الجداول المحفوظة»، «افتح إنشاء جدول جديد».\n\nللمعلمين: «اعرض أسماء المعلمين»، «ابحث عن المعلم …»، «ما نصاب المعلم …؟»، «ماذا يدرس المعلم …؟»، أو «من معلم الرياضيات في فصل أول 1؟».\n\nأوامر أخرى: «النصاب المستهدف 20»، «عدد المنتظرين 3»، «استبعد المعلم …»، «حدد غياب المعلم …»، «تاريخ الغياب 2026-10-25»، «اسم المدرسة …»، «اسم المدير …»، «أضف معلم … نصابه 24»، «التالي»، «حفظ».\n\nللتبديل قل: «انقل مادة الرياضيات لفصل أول 1 من يوم الأحد الحصة 3 إلى يوم الاثنين الحصة 2». راجع البدائل ثم قل «اختر البديل 3» أو «نفّذ البديل 3».`}
function explainRequestedButton(text){const match=voiceText(text).match(/^(?:ما|وش|ايش)\s+(?:هي\s+)?(?:وظيفه|عمل)\s+(?:زر\s+)?(.+?)[؟?]?$/)||voiceText(text).match(/^اشرح\s+(?:لي\s+)?(?:زر\s+)?(.+?)[؟?]?$/);if(!match)return false;const answer=explainButton(match[1]);msg(answer||`لم أتعرف على هذا الزر. قل «مساعدة الأوامر» لأعرض دليل الشاشة الحالية.`);return true}
function pressVoiceButton(spoken){const requested=voiceText(spoken).replace(/^(?:زر\s*)?(?:ال)?(?:اضغط|انقر|نفذ|شغل|اختار)\s+(?:زر\s*)?/,'').trim();if(!requested)return false;const aliases={
 'حفظ':['حفظ','حفظ المسوده'],'السابق':['السابق','الخطوه السابقه'],'التالي':['التالي','حفظ ومتابعه'],'اغلاق':['اغلاق','الغاء'],'طباعه':['طباعه','تنزيل النموذج الرسمي pdf'],'انشاء جدول':['انشاء جدول جديد','حفظ الحالي وانشاء جدول جديد'],'اعداد الانتظار':['اعداد حصص الانتظار'],'جدول المنتظرين':['جدول المنتظرين'],'المعلم الغائب':['المعلم الغائب']
 };const choices=visibleVoiceControls().filter(button=>{const labels=voiceButtonTerms(button),terms=[requested,...Object.entries(aliases).filter(([key,values])=>[key,...values].some(value=>requested.includes(voiceText(value)))).flatMap(([,values])=>values).map(voiceText)];return terms.some(term=>term&&labels.some(label=>label===term||label.includes(term)||term.includes(label)))});if(!choices.length)return false;
 const exact=choices.filter(button=>voiceButtonTerms(button).includes(requested));const matches=exact.length?exact:choices;
 if(matches.length>1){msg(`وجدت أكثر من زر مطابق لـ «${spoken}». قل اسم الزر كما يظهر كاملًا، أو قل «مساعدة الأوامر» لعرض الأزرار الحالية.`);return true}
 return pressVoiceControl(matches[0],matches[0].textContent.trim())}
function chooseTeacherByVoice(query,{absence=false,exclude=false}={}){const matches=teacherMatchesByWords(query);if(!matches.length){msg(`لم أجد معلماً مطابقًا لـ «${query}».`);return true}if(matches.length>1){msg(`وجدت أكثر من معلم مطابق: ${matches.slice(0,5).map(t=>t.name).join('، ')}. قل أي كلمة إضافية تميّز المعلم، ولا يلزم ذكر الاسم كاملًا.`);return true}const match=matches[0];if(absence){const search=$('#absenceSearch');if(!search){window.dispatchEvent(new Event('open-absence'));return setTimeout(()=>chooseTeacherByVoice(query,{absence:true}),0),true}search.value=match.name;search.dispatchEvent(new Event('input',{bubbles:true}));const check=document.querySelector(`[data-absence-teacher="${CSS.escape(match.id)}"]`);if(check&&!check.checked){check.checked=true;check.dispatchEvent(new Event('change',{bubbles:true}))}msg(`تم تحديد ${match.name} ضمن المعلمين الغائبين.`);return true}if(exclude){const check=document.querySelector(`[data-sb-exclude="${CSS.escape(match.id)}"]`);if(!check){window.dispatchEvent(new Event('open-standby'));return setTimeout(()=>chooseTeacherByVoice(query,{exclude:true}),0),true}if(!check.checked){check.checked=true;check.dispatchEvent(new Event('change',{bubbles:true}))}msg(`تم استثناء ${match.name} من حصص الانتظار.`);return true}return false}
function setVoiceControl(selector,value,label){const control=$(selector);if(!control)return false;control.value=value;control.dispatchEvent(new Event('change',{bubbles:true}));msg(`تم ضبط ${label} على ${value}.`);return true}
function openVoiceArea(requested){const ask=voiceText(requested),has=(...terms)=>terms.some(term=>ask.includes(voiceText(term)));if(has('جدول المنتظرين','جدول الانتظار')){window.dispatchEvent(new Event('open-standby-table'));msg('فُتح جدول المنتظرين.');return true}if(has('إعداد حصص الانتظار','إعداد الانتظار','إعداد الانتظار')){window.dispatchEvent(new Event('open-standby'));msg('فُتحت إعدادات حصص الانتظار.');return true}if(has('سجل الغياب','تاريخ الغياب')){window.dispatchEvent(new Event('open-absence'));setTimeout(()=>$('#absenceHistory')?.click(),0);msg('فُتح سجل الغياب.');return true}if(has('المعلم الغائب','تسجيل الغياب','الغياب')){window.dispatchEvent(new Event('open-absence'));msg('فُتحت شاشة تسجيل غياب المعلم.');return true}if(has('خيارات التبديل','معاينة التبديل')){if($('#preview').open)msg('معاينة التبديل مفتوحة بالفعل.');else msg('ابدأ بقول: انقل مادة … لفصل … من يوم … الحصة … إلى يوم … الحصة …، وسأفتح المعاينة.');return true}if(has('الطباعة','طباعة الجداول','مركز الطباعة')){if(!project.placements.length){msg('أنشئ الجدول أولًا حتى تتاح الطباعة.');return true}step=5;render();$('#print')?.click();msg('فُتحت خيارات طباعة الجداول.');return true}if(has('تعديل الجدول','محرر الجدول')){if(!project.placements.length){msg('أنشئ الجدول الدراسي أولًا، ثم أفتح محرر التعديل.');return true}step=5;render();$('#openEditor')?.click();msg('فُتح محرر تعديل الجدول.');return true}if(has('الجداول المحفوظة','مكتبة الجداول')){if(!project.placements.length){msg('لا يوجد جدول حالي. انتقل إلى خطوة إنشاء الجدول أولًا.');return true}step=5;render();scheduleLibrary();msg('فُتحت مكتبة الجداول المحفوظة.');return true}if(has('إنشاء جدول جديد','جدول جديد')){if(!project.teachers.length){msg('أضف المعلمين وأسند المواد أولًا قبل إنشاء جدول.');return true}step=5;render();newScheduleDialog();msg('فُتحت نافذة إنشاء جدول جديد. لن يبدأ التوليد حتى تؤكد.');return true}if(has('استيراد المعلمين','استيراد المعلم')){if(step!==3){step=3;render()}document.querySelector('.fileButton')?.scrollIntoView({behavior:'smooth',block:'center'});msg('انتقلت إلى استيراد المعلمين. اختر الملف ثم راجع المعاينة قبل الإضافة.');return true}return false}
function guide(text,state='ready'){if(voiceWaiting&&state==='listening'){text='سأصمت حتى تقول إحدى كلمات العودة.';state='waiting'}const assistant=$('.assistant'),prompt=$('#guidePrompt'),stateText=$('#assistantState');if(assistant)assistant.dataset.state=state;if(prompt)prompt.textContent=String(text).replace(/\s+/g,' ').slice(0,190);if(stateText)stateText.textContent={listening:'أستمع إليك الآن',thinking:'أفهم طلبك…',working:'أنفذ طلبك…',waiting:'بانتظار كلمة العودة',ready:'جاهز لمساعدتك صوتيًا'}[state]||'جاهز لمساعدتك صوتيًا'}
function speakGuide(){if(window.speechSynthesis)window.speechSynthesis.cancel()}
  function setVoiceReplies(){voiceReplies=false;const button=$('#guideSpeaker');if(button){button.hidden=true;button.classList.remove('active');button.setAttribute('aria-pressed','false');button.title='الردود النصية فقط'}if(window.speechSynthesis)window.speechSynthesis.cancel()}
  function handleVoiceOutputCommand(text){const ask=voiceText(text),silence=/(?:لا تتكلم|لا تصدر صوت|اوقف الصوت|اوقف الرد الصوتي|اكتف بالكتابه|اجب كتابه|خلك صامت|اسكت)/.test(ask),enableAttempt=/(?:شغل|فعل|ابدأ).*(?:الرد الصوتي|الصوت)|(?:اقرا|انطق)\s+(?:الردود|ردودك)/.test(ask);if(silence||enableAttempt){setVoiceReplies();msg('الوضع الصامت مفعل؛ سأستمع للأوامر وأنفذها وأعرض النتائج كتابة فقط.');return true}return false}
  const voiceWaitPhrases=['انتظر','انتظر قليلا','انتظر شوي','انتظر لحظه','استنى','استنى شوي','اصبر','اصبر شوي','لحظه','لحظه بس','دقيقه','ثواني','مهلا','مهلا قليلا','قف مؤقتا','توقف مؤقتا','وقف شوي','خلك شوي','هونك','على مهلك','خلني افكر','خليني افكر','خلنا نوقف شوي','تمهل','انتظرني'];
  const voiceResumePhrases=['يلا نبدا','نبدا','بدينا','هيا نبدا','هيا بنا','يلا بينا','يلا نكمل','نكمل','نواصل','كمل','تابع','استمر','واصل','عدنا','رجعنا','رجعنا نكمل','رجعت','انا هنا','انا موجود','الو','يلا','توكلنا','انطلق','تفضل','سم','حياك','ابدأ','نبدأ الآن'];
  function matchVoiceResume(text){const ask=voiceText(text).replace(/(?:من فضلك|لو سمحت)$/,'').trim();const phrase=voiceResumePhrases.map(voiceText).sort((a,b)=>b.length-a.length).find(item=>ask===item||ask.startsWith(item+' '));return phrase?ask.slice(phrase.length).replace(/^(?:و|ثم)\s*/,'').trim():null}
  function handleVoiceWaitCommand(text){const ask=voiceText(text).replace(/(?:من فضلك|لو سمحت)$/,'').trim();if(!voiceWaitPhrases.map(voiceText).includes(ask))return false;voiceWaiting=true;msg('حسنًا، سأنتظر.');guide('سأصمت حتى تقول «يلا نبدأ» أو إحدى كلمات العودة.','waiting');if(!voiceConversation){voiceConversation=true;updateConversationButton();beginVoiceConversation()}return true}
  function acceptedVoiceResult(result){const transcript=String(result?.transcript||'').trim();return transcript&&(!Number.isFinite(result?.confidence)||result.confidence>=.3)?transcript:''}
const assistant=$('.assistant');assistant?.removeAttribute('popover');
const nativeShowModal=HTMLDialogElement.prototype.showModal;
const nativeCloseDialog=HTMLDialogElement.prototype.close,assistantOrigins=new WeakMap();
function restoreAssistant(dialog){const origin=assistantOrigins.get(dialog);if(!origin)return;if(assistant.parentNode===dialog)origin.parent.insertBefore(assistant,origin.next?.parentNode===origin.parent?origin.next:null);assistantOrigins.delete(dialog)}
HTMLDialogElement.prototype.showModal=function(...args){const parent=assistant?.parentNode,next=assistant?.nextSibling;nativeShowModal.apply(this,args);dialogStack.push(this);this.addEventListener('close',()=>{const index=dialogStack.indexOf(this);if(index>=0)dialogStack.splice(index,1)},{once:true});if(!assistant)return;assistantOrigins.set(this,{parent,next});this.prepend(assistant);this.addEventListener('close',()=>restoreAssistant(this),{once:true})};
HTMLDialogElement.prototype.close=function(...args){nativeCloseDialog.apply(this,args);restoreAssistant(this)};
function answerTeacherQuestion(text){const ask=voiceText(text);if(/^(?:اعرض|اذكر|اسماء|من هم)\s+(?:اسماء\s+)?المعلمين?$/.test(ask)){msg(project.teachers.length?`معلمو المدرسة: ${project.teachers.map(t=>t.name).join('، ')}.`:'لم تُضف أسماء معلمين بعد.');return true}const assignment=ask.match(/^(?:من معلم|من هو معلم|من يدرس)\s+(.+?)\s+في\s+(?:فصل\s+)?(.+)$/);if(assignment){const subject=assignment[1],className=assignment[2],cl=project.classes.find(c=>voiceText(c.name)===className)||project.classes.find(c=>voiceText(c.name).includes(className)||className.includes(voiceText(c.name)));if(!cl){msg(`لم أجد فصلًا باسم «${className}». اطلب أسماء الفصول أو أعد ذكر اسم الفصل كاملًا.`);return true}const courses=project.courses.filter(c=>c.classId===cl.id&&(voiceText(c.subject)===subject||voiceText(c.subject).includes(subject)||subject.includes(voiceText(c.subject))));if(!courses.length){msg(`لم أجد مادة «${assignment[1]}» في فصل ${cl.name}.`);return true}const owners=[...new Set(courses.map(c=>project.teachers.find(t=>t.id===c.teacherId)?.name).filter(Boolean))];msg(owners.length?`معلم ${courses[0].subject} في فصل ${cl.name}: ${owners.join('، ')}.`:`مادة ${courses[0].subject} في فصل ${cl.name} غير مسندة إلى معلم بعد.`);return true}const query=ask.match(/^(?:ابحث عن|اعرض بيانات|معلومات عن|من هو|من هي|ما نصاب|كم نصاب|ما مواد|ماذا يدرس|وش يدرس|وين يدرس)\s+(?:المعلم\s+)?(.+)$/);if(!query)return false;const matches=teacherMatchesByWords(query[1]);if(!matches.length){msg(`لم أجد معلمًا باسم «${query[1]}». قل «اعرض أسماء المعلمين» لمعرفة الأسماء المسجلة.`);return true}if(matches.length>1){msg(`وجدت أكثر من اسم مطابق: ${matches.slice(0,5).map(t=>t.name).join('، ')}. قل أي كلمة إضافية تميّز المعلم؛ لا يلزم ذكر الاسم كاملًا.`);return true}const found=matches[0],courses=project.courses.filter(c=>c.teacherId===found.id),details=courses.length?courses.map(c=>`${c.subject} لفصل ${project.classes.find(cl=>cl.id===c.classId)?.name||'غير معروف'} (${c.count})`).join('، '):'لا توجد مواد مسندة إليه بعد';msg(`المعلم ${found.name}. اختصار الطباعة: ${found.short}. النصاب المسند ${load(found.id)} من ${found.max}. ${details}.`);return true}
function teacherMatchesByWords(query){return matchTeacherNames(project.teachers,query)}
function resolveTeacherQuery(query,selectedId){
 const matches=teacherMatchesByWords(query);
 const preferred=project.teachers.find(item=>item.id===selectedId);
 if(matches.length>1&&preferred&&matchTeacherNames([preferred],query).length===1)return [preferred];
 return matches;
}
function resolveAvailabilityTeacher(query){return resolveTeacherQuery(query,teacher)}
function selectAvailabilityTeacherByVoice(text){
 if(step!==4)return false;
 const ask=voiceText(text),explicit=ask.match(/^(?:اختر|اختار|حدد|غير الى|انتقل الى)\s+(?:ال)?(?:معلم\s+)?(.+)$/);
 let query=explicit?explicit[1].trim():ask;
 if(!query)return false;
 const matches=resolveAvailabilityTeacher(query);
 if(!matches.length){if(explicit)msg(`لم أتعرف على المعلم «${query}». اذكر اسمه كما يظهر في قائمة المعلمين.`);return !!explicit}
 if(matches.length>1){msg(`وجدت أكثر من معلم مطابق: ${matches.slice(0,5).map(item=>item.name).join('، ')}. اذكر كلمة إضافية تميّزه؛ لا يلزم الاسم كاملًا.`);return true}
 teacher=matches[0].id;render();msg(`تم اختيار المعلم ${matches[0].name} في الإتاحة والقيود.`);return true;
}
function spokenPeriodLabel(period){return ['الأولى','الثانية','الثالثة','الرابعة','الخامسة','السادسة','السابعة','الثامنة','التاسعة','العاشرة'][period-1]||String(period)}
function handleAvailabilityVoice(text){
 if(step!==4)return false;
 const intent=parseAvailabilityIntent(text);
 if(!intent)return false;
 let target=project.teachers.find(item=>item.id===teacher)||project.teachers[0];
 if(intent.teacherQuery){
  const matches=resolveAvailabilityTeacher(intent.teacherQuery);
  if(matches.length!==1){msg(matches.length?`وجدت أكثر من معلم مطابق لـ«${intent.teacherQuery}». اذكر كلمة إضافية من اسمه لتمييزه.`:`لم أتعرف على المعلم «${intent.teacherQuery}». اذكر اسمه الأول واسمًا آخر منه كما في الإسناد.`);return true}
  target=matches[0];
 }
 if(!target){msg('اختر معلمًا أولًا ثم أعد أمر الإتاحة.');return true}
 const periods=intent.kind==='periods'?intent.periods:[];
 const requestedDays=intent.days||[],dayIndices=requestedDays.map(voiceDayIndex);
 if(dayIndices.some(index=>index<0)){msg(`لم أجد ${requestedDays.filter((_,index)=>dayIndices[index]<0).join(' و')} ضمن أيام الدوام في إعدادات المدرسة.`);return true}
 const appliesToDay=slot=>!dayIndices.length||dayIndices.includes(slot.day);
 if(intent.kind==='range'&&(!Number.isInteger(intent.from)||!Number.isInteger(intent.to)||intent.from<1||intent.to<intent.from)){msg('لم أفهم نطاق الحصص. اذكره بالترتيب، مثل «من الأولى إلى الرابعة».');return true}
 if(intent.kind==='after'&&(!Number.isInteger(intent.period)||intent.period<1)||intent.kind==='periods'&&periods.some(period=>!Number.isInteger(period)||period<1)){msg('لم أتعرف على رقم الحصة في أمر الإتاحة.');return true}
 const targeted=project.slots.map((slot,index)=>({slot,index})).filter(({slot})=>appliesToDay(slot)&&(intent.kind==='all'||intent.kind==='day'||intent.kind==='periods'&&periods.includes(slot.period+1)||intent.kind==='after'&&slot.period+1>intent.period||intent.kind==='range'&&slot.period+1>=intent.from&&slot.period+1<=intent.to)).map(({index})=>index);
 const rest=intent.kind==='range'&&intent.clearRest?project.slots.map((slot,index)=>({slot,index})).filter(({slot})=>appliesToDay(slot)&&(slot.period+1<intent.from||slot.period+1>intent.to)).map(({index})=>index):[];
 const affected=[...new Set([...targeted,...rest])];
 if(!affected.length){msg('لم أجد حصصًا ضمن النطاق المطلوب في أيام الدوام.');return true}
 const previousBlocked=new Set(target.blocked||[]),previousSoft=new Set(target.softBlocked||[]),nextBlocked=new Set(previousBlocked),nextSoft=new Set(previousSoft);
 for(const slot of affected){
  const mode=rest.includes(slot)?'blocked':intent.kind==='range'||intent.kind==='periods'?intent.mode:intent.mode||'blocked';
  if(mode==='available'){nextBlocked.delete(slot);nextSoft.delete(slot)}
  else if(mode==='blocked'){nextBlocked.add(slot);nextSoft.delete(slot)}
  else if(mode==='toggle'){
   if(nextBlocked.has(slot)||nextSoft.has(slot)){nextBlocked.delete(slot);nextSoft.delete(slot)}
   else nextBlocked.add(slot);
  }
 }
 const assigned=load(target.id),available=project.slots.length-nextBlocked.size;
 if(available<assigned){msg(`لم أغيّر الإتاحة؛ سيبقى ${available} حصة متاحة للمعلم ${target.name}، بينما إسناده الحالي ${assigned} حصة. خفّض إسناده أولًا ثم أعد الأمر.`);return true}
 const changed=nextBlocked.size!==previousBlocked.size||[...nextBlocked].some(slot=>!previousBlocked.has(slot))||nextSoft.size!==previousSoft.size||[...nextSoft].some(slot=>!previousSoft.has(slot));
 if(!changed){teacher=target.id;render();msg(`حالة الحصص المطلوبة للمعلم ${target.name} مطبقة مسبقًا.`);return true}
 undo.push(structuredClone(project));
 target.blocked=[...nextBlocked].sort((a,b)=>a-b);
 target.softBlocked=[...nextSoft].sort((a,b)=>a-b);
 teacher=target.id;invalidate();render();
 const dayDescription=dayIndices.length?` يوم ${dayIndices.map(index=>project.days[index].name).join(' و')}`:'';
 const description=(intent.kind==='all'?'جميع الحصص':intent.kind==='day'?'جميع حصص اليوم':intent.kind==='after'?`الحصص بعد ${spokenPeriodLabel(intent.period)}`:intent.kind==='range'?`من ${spokenPeriodLabel(intent.from)} إلى ${spokenPeriodLabel(intent.to)}`:periods.map(spokenPeriodLabel).join(' و'))+dayDescription;
 const action=intent.mode==='toggle'?'تبدّلت حالة':intent.mode==='available'?'أصبحت متاحة':'أصبحت غير متاحة';
 save().then(saved=>{if(saved)msg(`${action} الحصص ${description} للمعلم ${target.name}${intent.clearRest?'، وأصبحت الحصص خارج النطاق غير متاحة':''}.`)});
 return true;
}
function teacherScheduleTable(teacherId){const courses=new Map(project.courses.map(course=>[course.id,course])),maxPeriods=Math.max(...project.days.map(day=>day.count));return `<table class="teacherMatrix"><thead><tr><th>اليوم / الحصة</th>${Array.from({length:maxPeriods},(_,period)=>`<th>الحصة ${period+1}</th>`).join('')}</tr></thead><tbody>${project.days.map((day,dayIndex)=>`<tr><th>${esc(day.name)}</th>${Array.from({length:maxPeriods},(_,period)=>{const slot=project.slots.findIndex(item=>item.day===dayIndex&&item.period===period);if(slot<0)return '<td class="notScheduled">—</td>';const placement=project.placements.find(item=>item.slot===slot&&courses.get(item.courseId)?.teacherId===teacherId),course=placement&&courses.get(placement.courseId);return `<td>${course?`<b>${esc(course.short||course.subject)}</b><small>${esc(project.classes.find(item=>item.id===course.classId)?.name||'')}</small>`:''}</td>`}).join('')}</tr>`).join('')}</tbody></table>`}
function openTeacherScheduleIntent(requested){const match=voiceText(requested).match(/^(?:افتح\s+)?(?:جدول\s+المعلم|جدول)\s+(.+)$/);if(!match)return false;const query=match[1].replace(/^المعلم\s+/,'').trim(),teachers=teacherMatchesByWords(query);if(teachers.length>1){msg(`وجدت أكثر من معلم مطابق: ${teachers.slice(0,5).map(t=>t.name).join('، ')}. قل أي كلمة إضافية تميّز المعلم؛ لا يلزم الاسم كاملًا.`);return true}if(!teachers.length){msg(`لم أجد معلمًا بهذا الاسم: ${query}. قل «اعرض أسماء المعلمين» للتحقق من الاسم.`);return true}if(!project.placements.length){msg('لم يُنشأ جدول دراسي بعد. أنشئ الجدول أولًا ثم اطلب جدول المعلم.');return true}const teacher=teachers[0];setDialogContent(teacherScheduleDialog,`<div class="toolbar"><h2>جدول المعلم ${esc(teacher.name)}</h2><button id="closeTeacherSchedule" class="secondary">إغلاق</button></div><p class="muted">النصاب المسند: ${load(teacher.id)} من ${teacher.max}. المواد والفصول معروضة حسب الجدول الحالي.</p><div class="scroll">${teacherScheduleTable(teacher.id)}</div>`);$('#closeTeacherSchedule').onclick=()=>teacherScheduleDialog.close();teacherScheduleDialog.showModal();msg(`فتحت جدول المعلم ${teacher.name}.`);return true}
function updateContextGuide(){const prompts=['مرحبًا، ما اسم المدرسة؟ يمكنك قوله بصيغة: «اسم المدرسة …».','كم عدد الحصص في كل يوم؟ يمكنك أن تقول: «اجعل يوم الأحد 7 حصص».','كم عدد الفصول لكل صف؟ قل مثلًا: «أول ثانوي 11 فصل».','هل تريد استيراد المعلمين أم إضافة معلم بالاسم والنصاب؟','هل لدى أي معلم وقت تريد منعه؟ اختر المعلم أو قل «انتقل إلى الإتاحة».','هل أبدأ إنشاء الجدول؟ وبعدها أستطيع تعديل أي حصة بصوتك.','هل نبدأ بحساب نصاب الانتظار، أم تريد تسجيل غياب معلم؟'];guide(prompts[step]||prompts[0])}
function voiceScrollTarget(){return topDialog()||document.scrollingElement}
function scrollVoiceTarget(target,top,behavior='smooth'){if(target===document.scrollingElement)window.scrollTo({top,behavior});else target.scrollTo({top,behavior})}
function scrollVoiceBy(amount){const target=voiceScrollTarget();if(target===document.scrollingElement)window.scrollBy({top:amount,behavior:'smooth'});else target.scrollBy({top:amount,behavior:'smooth'})}
function stopVoiceScroll(message='توقفت عن التمرير.'){if(voiceScrollTimer){clearInterval(voiceScrollTimer);voiceScrollTimer=null}guide(message);msg(message);return true}
function startVoiceScroll(direction){if(voiceScrollTimer)clearInterval(voiceScrollTimer);voiceScrollTimer=setInterval(()=>{const target=voiceScrollTarget(),before=target===document.scrollingElement?window.scrollY:target.scrollTop;if(target===document.scrollingElement)window.scrollBy(0,direction*72);else target.scrollBy(0,direction*72);setTimeout(()=>{const after=target===document.scrollingElement?window.scrollY:target.scrollTop;if(Math.abs(after-before)<1&&voiceScrollTimer)stopVoiceScroll(direction>0?'وصلت إلى نهاية الصفحة وتوقفت.':'وصلت إلى أعلى الصفحة وتوقفت.')},20)},180);msg(direction>0?'بدأت النزول الهادئ. قل «توقف» عند الموضع الذي تريده.':'بدأت الصعود الهادئ. قل «توقف» عند الموضع الذي تريده.');guide(direction>0?'أنزل بهدوء، قل «توقف» متى شئت.':'أصعد بهدوء، قل «توقف» متى شئت.','working');return true}
function handleVoiceScroll(text){const ask=lexPlain(stripVoiceFillers(text)),words=ask.split(' ').length,has=list=>lexNorm(list).some(word=>ask===word||lexBoundary(ask,word));if(voiceScrollTimer&&has(scrollWords.stop)&&words<=5)return stopVoiceScroll();if(!voiceScrollTimer&&words<=2&&/^(?:توقف|وقف|قف|استوب|اوقف|بس|خلاص|كفايه)$/.test(ask))return stopVoiceScroll();if(words>7||/\d/.test(ask))return false;const down=has(scrollWords.down)||(has(scrollWords.end)&&/(?:الصفحه|تحت|القاع|اخرها|لين تخلص|لين النهايه)/.test(ask)),up=has(scrollWords.up)||(has(scrollWords.top)&&/(?:الصفحه|فوق|راس|لاعلي)/.test(ask));if(!down&&!up)return false;if(down&&up)return false;if(resolveVoiceTarget(text))return false;const direction=down?1:-1,continuous=has(scrollWords.continuous),toEnd=has(scrollWords.end),toTop=has(scrollWords.top);if(continuous)return startVoiceScroll(direction);const target=voiceScrollTarget();if((direction>0&&toEnd)||(direction<0&&toTop)){scrollVoiceTarget(target,direction>0?target.scrollHeight:0);const reply=direction>0?'وصلت إلى آخر الصفحة.':'وصلت إلى أعلى الصفحة.';msg(reply);return true}scrollVoiceBy(direction*(has(scrollWords.slight)?360:Math.max(520,Math.round((target===document.scrollingElement?window.innerHeight:target.clientHeight)*.75))));const reply=direction>0?'نزلت قليلًا.':'صعدت قليلًا.';msg(reply);return true}
const voiceDayAliases={احد:'الاحد',الحد:'الاحد',الاحد:'الاحد',اثنين:'الاثنين',الاثنين:'الاثنين',تنين:'الاثنين',الثلاثاء:'الثلاثاء',ثلاثاء:'الثلاثاء',تلات:'الثلاثاء',تلاته:'الثلاثاء',الاربعاء:'الاربعاء',اربعاء:'الاربعاء',اربع:'الاربعاء',الخميس:'الخميس',خميس:'الخميس'};
function voiceDayName(name){const key=voiceText(name).replace(/^يوم\s+/,'').trim();return voiceDayAliases[key]||key}
function voiceDayIndex(name){const requested=voiceDayName(name);return project.days.findIndex(day=>voiceDayName(day.name)===requested)}
function voiceSlot(dayName,period){const dayIndex=voiceDayIndex(dayName),periodNumber=voicePeriod(period);return dayIndex<0||!Number.isInteger(periodNumber)?-1:project.slots.findIndex(slot=>slot.day===dayIndex&&slot.period===periodNumber-1)}
function voicePeriod(text){const word=voiceText(text).replace(/^ال/,'').replace(/[هة]$/,''),words={اول:1,اولي:1,ثاني:2,ثالث:3,رابع:4,خامس:5,سادس:6,سابع:7,ثامن:8,تاسع:9,عاشر:10};return words[word]||voiceNumber(word)}
function classVoiceKey(value){return findClassReferences(value)[0]?.key||''}
function voiceOptionPick(select,query){if(select?.id==='assignmentTeacher')return teacherVoicePick(select,query);const classSelect=select?.id==='classSelect'||select?.id==='assignmentClass',key=classSelect?classVoiceKey(query):'',clean=voiceText(query).replace(/\b(?:الاستاذ|استاذ|المعلم|معلم|المدرس|مدرس|الماده|ماده)\b/g,' ').replace(/\s+/g,' ').trim(),compact=value=>voiceText(value).replace(/ابن/g,'بن').replace(/\s+/g,''),queryCompact=compact(clean),terms=clean.split(' ').filter(term=>term.length>1),options=[...select.options].filter(option=>option.value!==''||option.textContent.trim());if(classSelect&&key)return options.filter(option=>classVoiceKey(option.textContent)===key);const scored=options.map(option=>{const text=voiceText(option.textContent),candidateCompact=compact(text),exact=text===clean,compactExact=candidateCompact===queryCompact,all=terms.length>0&&terms.every(term=>text.includes(term)||candidateCompact.includes(compact(term))),contains=queryCompact.length>1&&(candidateCompact.includes(queryCompact)||queryCompact.includes(candidateCompact));const score=exact?100:compactExact?95:all?70+Math.min(terms.length,10):contains?50+Math.min(queryCompact.length,20)/100:0;return {option,score}}).filter(item=>item.score>0);if(!scored.length)return [];const best=Math.max(...scored.map(item=>item.score));return scored.filter(item=>item.score===best).map(item=>item.option)}
function teacherVoicePick(select,query){if(!select)return [];const options=[...select.options].filter(option=>option.value!==''||option.textContent.trim()),matched=matchTeacherNames(options.map(option=>({name:option.textContent.trim(),option})),query);return matched.map(item=>item.option)}
function setVoiceSelect(select,query,label){if(!select)return false;query=String(query).replace(/\s+(?:في|من|على|داخل|من القائمه)\s+.*$/,'').trim();const matches=label==='المعلمين'?teacherVoicePick(select,query):voiceOptionPick(select,query);if(!matches.length){msg(`لم أجد «${query}» ضمن قائمة ${label}. قل جزءًا مميزًا من اسم ${label==='المعلمين'?'المعلم':'المادة'} أو ابدأ الأمر بـ «اختر ${label==='المعلمين'?'المعلم':'المادة'}».`);return true}if(matches.length>1){const exact=matches.find(option=>voiceText(option.textContent)===voiceText(query)||classVoiceKey(option.textContent)===classVoiceKey(query));if(!exact){msg(label==='المعلمين'?`وجدت أكثر من معلم مطابق: ${matches.slice(0,5).map(option=>option.textContent.trim()).join('، ')}. قل أي كلمة إضافية تميّزه؛ لا يلزم الاسم كاملًا.`:`وجدت أكثر من خيار في ${label}: ${matches.slice(0,4).map(option=>option.textContent.trim()).join('، ')}. اذكر اسم المادة كاملًا.`);return true}matches.splice(0,matches.length,exact)}select.value=matches[0].value;select.dispatchEvent(new Event('change',{bubbles:true}));msg(`اخترت ${matches[0].textContent.trim()} في ${label}.`);return true}
function voiceVisible(selector){return [...document.querySelectorAll(selector)].find(el=>el.getClientRects().length)}
function voiceClassMatch(query){
 const key=classVoiceKey(query);
 if(key){const matches=project.classes.filter(item=>classVoiceKey(item.name)===key);if(matches.length)return matches}
 const asked=voiceText(query),compact=asked.replace(/\s+/g,'');
 return project.classes.filter(item=>{const label=voiceText(item.name),flat=label.replace(/\s+/g,'');return label===asked||flat===compact||label.includes(asked)||asked.includes(label)});
}
function voiceCourseMatch(classId,query){
 const asked=voiceText(query).replace(/^(?:الماده|ماده)\s+/,'').trim(),compact=asked.replace(/\s+/g,'');
 const candidates=project.courses.filter(course=>course.classId===classId).map(course=>{
  const subject=voiceText(course.subject),short=voiceText(course.short||''),subjectFlat=subject.replace(/\s+/g,''),shortFlat=short.replace(/\s+/g,'');
  const score=subject===asked||short===asked?100:subjectFlat===compact||shortFlat===compact?95:subject.includes(asked)||short.includes(asked)||asked.includes(subject)||asked.includes(short)?70:0;
  return {course,score};
 }).filter(item=>item.score>0);
 if(!candidates.length)return [];
 const best=Math.max(...candidates.map(item=>item.score));return candidates.filter(item=>item.score===best).map(item=>item.course);
}
function trailingVoiceNumber(value){
 const words=voiceText(value).split(/\s+/).filter(Boolean);
 for(let count=Math.min(4,words.length);count>=1;count--){const tail=words.slice(-count).join(' '),number=voiceNumber(tail);if(Number.isInteger(number))return {number,rest:words.slice(0,-count).join(' ').trim()}}
 return null;
}
function handleTeacherMaxByVoice(text){
 const ask=voiceText(text);if(/(?:نصاب الانتظار|النصاب المستهدف|اجمالي النصاب)/.test(ask))return false;
 const prefix=ask.match(/^(?:(?:خلي|خل|اجعل|حدد|اضبط|غير|عدل|حط)\s+)?(?:نصاب|الحد الاعلى|حد النصاب)\s+(?:المعلم\s+|الاستاذ\s+|المدرس\s+)?(.+)$/);
 if(!prefix)return false;
 const parsed=trailingVoiceNumber(prefix[1]);if(!parsed||parsed.number<1||parsed.number>100){msg('اذكر النصاب بعد اسم المعلم، مثل «نصاب المعلم أحمد سالم 24».');return true}
 const matches=teacherMatchesByWords(parsed.rest);if(!matches.length){msg(`لم أجد معلمًا مطابقًا لـ «${parsed.rest}».`);return true}if(matches.length>1){msg(`وجدت أكثر من معلم مطابق: ${matches.slice(0,5).map(item=>item.name).join('، ')}. قل كلمة إضافية من اسمه.`);return true}
 const target=matches[0];target.max=parsed.number;invalidate();render();save();msg(`تم ضبط نصاب ${target.name} على ${parsed.number} حصة أسبوعيًا.`);return true;
}
function handleCourseVoiceCommand(text){
 if(step!==2&&step!==3)return false;
 const ask=voiceText(text);let match;
 match=ask.match(/^(?:اضف|ضيف|زود)\s+(?:ماده\s+)?(.+?)\s+(?:لفصل|للفصل|في فصل)\s+(.+?)(?:\s+(?:عدد\s+)?حصص?\s+(.+))?$/);
 if(match){
  const subject=match[1].trim(),classes=voiceClassMatch(match[2]);if(classes.length!==1){msg(!classes.length?`لم أجد الفصل «${match[2]}».`:`وجدت أكثر من فصل مطابق. اذكر الصف والشعبة مثل «ثاني 7».`);return true}
  const count=match[3]?trailingVoiceNumber(match[3])?.number:1;if(!Number.isInteger(count)||count<1||count>50){msg('عدد الحصص يجب أن يكون بين 1 و50.');return true}
  const classRecord=classes[0],existing=voiceCourseMatch(classRecord.id,subject);if(existing.length){msg(`مادة «${existing[0].subject}» موجودة بالفعل في فصل ${classRecord.name}.`);return true}
  project.courses.push({id:crypto.randomUUID(),classId:classRecord.id,subject,short:subject,count,pairs:0,room:''});invalidate();render();save();msg(`أضفت مادة ${subject} إلى فصل ${classRecord.name} بعدد ${count} حصص أسبوعيًا.`);return true;
 }
 match=ask.match(/^(?:غير|عدل|بدل|سم)\s+(?:اسم\s+)?(?:الماده|ماده)\s+(.+?)\s+(?:لفصل|للفصل|في فصل)\s+(.+?)\s+(?:الى|الي|ليصبح|تصير)\s+(.+)$/);
 if(match){
  const classes=voiceClassMatch(match[2]),courses=classes.length===1?voiceCourseMatch(classes[0].id,match[1]):[];if(classes.length!==1||courses.length!==1){msg('لم أجد مادة واحدة مطابقة. قل مثلًا: «غيّر مادة الرياضيات لفصل أول 1 إلى رياضيات متقدمة».');return true}
  courses[0].subject=match[3].trim();courses[0].short=match[3].trim();invalidate();render();save();msg(`تم تغيير اسم المادة في فصل ${classes[0].name}.`);return true;
 }
 match=ask.match(/^(?:(?:اجعل|خل|خلي|حدد|اضبط|غير|عدل)\s+)?(?:عدد\s+)?حصص\s+(?:ماده\s+)?(.+?)\s+(?:لفصل|للفصل|في فصل)\s+(.+?)\s+(?:الى|الي|تكون|يكون|هو)?\s+(.+)$/);
 if(match){
  const classes=voiceClassMatch(match[2]),courses=classes.length===1?voiceCourseMatch(classes[0].id,match[1]):[],count=trailingVoiceNumber(match[3])?.number;if(classes.length!==1||courses.length!==1||!Number.isInteger(count)||count<0||count>50){msg('لم أتعرف على المادة أو الفصل أو عدد الحصص. قل مثلًا: «عدد حصص الرياضيات لفصل أول 1 خمس».');return true}
  courses[0].count=count;invalidate();render();save();msg(`تم ضبط عدد حصص ${courses[0].subject} لفصل ${classes[0].name} على ${count}.`);return true;
 }
 return false;
}
function handleGenericVoiceSelection(text){
 const ask=voiceText(text),match=ask.match(/^(?:اختر|اختار|حدد|خلي|خل|اجعل|حط|بدل|غير)\s+(?:من\s+)?(?:قائمه\s+)?(?:ال)?(معلم|استاذ|مدرس|ماده|فصل|شعبه)\s+(.+)$/);
 if(!match)return false;
 const kind=match[1],query=match[2];
 if(/معلم|استاذ|مدرس/.test(kind)){
  if($('#editor')?.open){selectEditorTeacher(query);return true}
  const target=voiceVisible('#assignmentTeacher')||voiceVisible('#teacherSelect');return target?setVoiceSelect(target,query,'المعلمين'):false;
 }
 if(/ماده/.test(kind)){const target=voiceVisible('#assignmentSubject');return target?setVoiceSelect(target,query,'المواد'):false}
 const target=voiceVisible('#classSelect')||voiceVisible('#assignmentClass');return target?setVoiceSelect(target,query,'الفصول'):false;
}
function handleVoiceNavigation(text){
 const cleaned=stripVoiceFillers(text),parts=splitVoiceVerb(cleaned),rawAsk=voiceText(stripVoiceNoise(parts.rest||cleaned)).replace(/^(?:لل?|ال)?خطو[هة]\s+/,'الخطوة '),ask=rawAsk.replace(/^(?:الخطوه|خطوة)\s+/,'').trim();
 if(/^(?:رجوع|ارجع|ارجعني|رجعني|السابق|اللي قبل|اللي قبله|خلف|ورا|ورى)$/.test(ask)){
  if(step===0){msg('أنت في أول خطوة بالفعل.');return true}step--;notice('');render();window.scrollTo({top:0,behavior:'smooth'});msg(`رجعت إلى «${names[step]}».`);return true;
 }
 if(/^(?:التالي|اللي بعد|اللي بعده|كمل|كملنا|تابع|واصل|قدم|قدام)$/.test(ask)){next().catch(error=>notice(error.message));msg('سأتحقق من اكتمال هذه الخطوة ثم أنتقل.');return true}
 if(/^(?:البدايه|البداية|الرئيسيه|الرئيسية|اول صفحه|اول صفحة|الخطوه الاولى|الخطوة الاولى)$/.test(ask)){if(step===0){msg('أنت في بيانات المدرسة بالفعل.');return true}step=0;render();window.scrollTo({top:0,behavior:'smooth'});msg('انتقلت إلى بيانات المدرسة.');return true}
 const number=rawAsk.match(/^(?:الشاشه|الشاشة|الصفحه|الصفحة|التبويب|الخطوه|الخطوة)\s+(?:رقم\s+)?(.+)$/),index=number&&periodNumber(number[1])-1;
 if(Number.isInteger(index)&&index>=0&&index<names.length){const button=document.querySelector(`aside [data-step="${index}"]`);if(button?.disabled){msg(`خطوة «${names[index]}» تحتاج إكمال الخطوات السابقة.`);return true}button?.click();msg(`انتقلت إلى «${names[index]}».`);return true}
 return false;
}
function applyAssignmentBatch(teacherId,items){const teacherRecord=project.teachers.find(t=>t.id===teacherId);if(!teacherRecord||!items.length)return false;const courses=items.map(item=>project.courses.find(course=>course.classId===item.classId&&course.subject===item.subject)).filter(Boolean),conflicts=courses.filter(c=>c.teacherId&&c.teacherId!==teacherId),pendingCourses=courses.filter(c=>c.teacherId!==teacherId);if(conflicts.length){msg(`تعذر إسناد ${conflicts.length} مادة لأنها محجوزة لمعلمين آخرين. ألغِ الحجز أولًا ثم أعد اللصق.`);return true}if(!pendingCourses.length){msg(`كل الفصول الموجودة في النص مسندة بالفعل إلى ${teacherRecord.short}.`);return true}const total=pendingCourses.reduce((sum,c)=>sum+c.count,0),available=Math.min(teacherRecord.max,project.slots.length-(teacherRecord.blocked||[]).length)-load(teacherId);if(total>available){msg(`لا يمكن إسناد النص كاملًا؛ المتبقي للمعلم ${available} حصة والمطلوب ${total} حصة.`);return true}undo.push(structuredClone(project));pendingCourses.forEach(c=>c.teacherId=teacherId);assignmentTeacher=teacherId;invalidate();render();msg(`تم التعرف على النص وإسناد ${pendingCourses.length} فصلًا إلى ${teacherRecord.short}.`);save();return true}
function assignCopiedAssignmentBatch(text){
 if(step!==3)return false;
 const raw=String(text||'').replace(/[\u00a0\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u202f]/g,' ');
 if(!raw.includes('|'))return false;
 const rows=raw.split(/\r?\n/).map(row=>row.trim()).filter(row=>row.includes('|')&&!/^\|?\s*[-:|\s]+\|?\s*$/.test(row));
 const teacherSelect=voiceVisible('#assignmentTeacher'),subjectSelect=voiceVisible('#assignmentSubject');
 if(!teacherSelect||!subjectSelect){msg('افتح تبويب المعلمين والإسنادات ثم ألصق جدول الإسنادات.');return true}
 const parsed=[],seenRows=new Set();
 for(const line of rows){
  const cells=line.replace(/^\s*\|\s*/,'').replace(/\s*\|\s*$/,'').split('|').map(cell=>cell.trim());
  if(cells.length<2)continue;
  const teacherQuery=cells[0],header=voiceText(teacherQuery).replace(/\s+/g,'');
  if(['المعلم','اسمالمعلم','الاسم','المعلمون'].includes(header))continue;
  const teacherMatches=teacherVoicePick(teacherSelect,teacherQuery);
  if(teacherMatches.length!==1){msg(!teacherMatches.length?`لم أتعرف على اسم المعلم في الصف المنسوخ: «${teacherQuery}».`:`وجدت أكثر من معلم مطابق للاسم «${teacherQuery}». استخدم أي كلمة إضافية تميّزه، ولا يلزم الاسم كاملًا.`);return true}
  const teacherId=teacherMatches[0].value,detail=cells.slice(1).join(' '),normalizedDetail=voiceText(detail),hits=findClassReferences(normalizedDetail);
  if(!hits.length){msg(`تعرفت على المعلم «${teacherQuery}» لكن لم أجد مادة وفصلًا في صفه.`);return true}
  const items=[];let previousEnd=0;
  for(const hit of hits){
   const subjectQuery=normalizedDetail.slice(previousEnd,hit.start).replace(/[،,؛:]+/g,' ').trim(),classMatch=project.classes.find(c=>classVoiceKey(c.name)===hit.key);
   if(!subjectQuery||!classMatch){msg(`تعذر فهم المادة أو الفصل قرب «${hit.text}» في صف المعلم «${teacherQuery}».`);return true}
   const subjectMatches=voiceOptionPick(subjectSelect,subjectQuery);
   if(subjectMatches.length!==1){msg(!subjectMatches.length?`لم أتعرف على المادة «${subjectQuery}» في صف المعلم «${teacherQuery}».`:`وجدت أكثر من مادة مطابقة لـ«${subjectQuery}».`);return true}
   items.push({classId:classMatch.id,subject:subjectMatches[0].textContent.trim()});previousEnd=hit.end;
  }
  const rowKey=`${teacherId}|${items.map(item=>`${item.classId}|${item.subject}`).join(',')}`;
  if(!seenRows.has(rowKey)){seenRows.add(rowKey);parsed.push({teacherId,teacherName:teacherMatches[0].textContent.trim(),items})}
 }
 if(!parsed.length){msg('لم أجد صفوف إسناد صالحة في النص المنسوخ.');return true}
 const assignmentByCourse=new Map(),pendingByTeacher=new Map();
 for(const row of parsed)for(const item of row.items){
  const course=project.courses.find(value=>value.classId===item.classId&&value.subject===item.subject);
  if(!course){msg(`لم أجد مادة «${item.subject}» في الفصل المحدد. لم يتم تطبيق أي صف.`);return true}
  const prior=assignmentByCourse.get(course.id);
  if(prior&&prior!==row.teacherId){msg(`الفصل والمادة «${item.subject}» مذكوران لمعلمين مختلفين في النص. لم يتم تطبيق أي صف.`);return true}
  assignmentByCourse.set(course.id,row.teacherId);
  if(!pendingByTeacher.has(row.teacherId))pendingByTeacher.set(row.teacherId,[]);
  if(!pendingByTeacher.get(row.teacherId).some(value=>value.id===course.id)&&course.teacherId!==row.teacherId)pendingByTeacher.get(row.teacherId).push(course);
 }
 for(const [teacherId,courses] of pendingByTeacher){
  const conflicts=courses.filter(course=>course.teacherId&&course.teacherId!==teacherId);
  if(conflicts.length){msg(`يوجد ${conflicts.length} تعارض في الإسنادات. ألغِ الإسناد القديم أولًا، ولم يتم تطبيق أي صف.`);return true}
  const teacherRecord=project.teachers.find(t=>t.id===teacherId),total=courses.reduce((sum,course)=>sum+course.count,0),available=Math.min(teacherRecord?.max||0,project.slots.length-(teacherRecord?.blocked||[]).length)-load(teacherId);
  if(!teacherRecord||total>available){msg(`لا يمكن إسناد صفوف المعلم ${teacherRecord?.short||'المطلوب'} كاملة؛ المتبقي ${Math.max(0,available)} حصة والمطلوب ${total} حصة. لم يتم تطبيق أي صف.`);return true}
 }
 const allPending=[...pendingByTeacher.values()].flat();
 if(!allPending.length){msg('كل الإسنادات الموجودة في النص مطبقة بالفعل.');return true}
 undo.push(structuredClone(project));
 for(const [teacherId,courses] of pendingByTeacher)courses.forEach(course=>{course.teacherId=teacherId});
 assignmentTeacher=parsed.at(-1).teacherId;invalidate();render();msg(`تم التعرف على ${parsed.length} صفوف وإسناد ${allPending.length} مادة دفعة واحدة.`);save();return true;
}
function assignCopiedAssignmentRow(text){
 if(step!==3)return false;
 const raw=String(text||'').replace(/[\u00a0\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u202f]/g,' ');
 if(!raw.includes('|'))return false;
 const rows=raw.split(/\r?\n/).map(row=>row.trim()).filter(row=>row.includes('|')&&!/^\|?\s*[-:|\s]+\|?\s*$/.test(row)),row=rows.find(value=>value.split('|').length>=3);
 if(!row)return false;
 const cells=row.replace(/^\s*\|\s*/,'').replace(/\s*\|\s*$/,'').split('|').map(cell=>cell.trim());
 if(cells.length<2)return false;
 const teacherQuery=cells[0],detail=cells.slice(1).join(' '),teacherSelect=voiceVisible('#assignmentTeacher'),teacherMatches=teacherSelect?teacherVoicePick(teacherSelect,teacherQuery):[];
 if(teacherMatches.length!==1){msg(!teacherMatches.length?`لم أتعرف على اسم المعلم في النص: «${teacherQuery}».`:`وجدت أكثر من معلم مطابق للاسم «${teacherQuery}». استخدم أي كلمة إضافية تميّزه، ولا يلزم الاسم كاملًا.`);return true}
 const normalizedDetail=voiceText(detail),hits=findClassReferences(normalizedDetail);
 if(!hits.length){msg('تعرفت على صف الجدول، لكن لم أجد أسماء فصول مثل «ثاني 7».');return true}
 const items=[];let previousEnd=0;
 for(const hit of hits){
  const subjectQuery=normalizedDetail.slice(previousEnd,hit.start).replace(/[،,؛:]+/g,' ').trim(),classMatch=project.classes.find(c=>classVoiceKey(c.name)===hit.key);
  if(!subjectQuery||!classMatch){msg(`تعذر فهم المادة أو الفصل قرب «${hit.text}».`);return true}
  const subjectSelect=voiceVisible('#assignmentSubject'),subjectMatches=subjectSelect?voiceOptionPick(subjectSelect,subjectQuery):[];
  if(subjectMatches.length!==1){msg(`لم أتعرف على المادة «${subjectQuery}» في النص المنسوخ.`);return true}
  items.push({classId:classMatch.id,subject:subjectMatches[0].textContent.trim()});previousEnd=hit.end;
 }
 return applyAssignmentBatch(teacherMatches[0].value,items);
}
function assignClassesByVoice(text){
 if(step!==3||!assignmentTeacher||!assignmentSubject)return false;
 const ask=voiceText(text),action=ask.match(/^(?:اسند|اسناد|اربط|ربط|كلف|كلفني|عين|خصص|وزع|حط|خل|خلي|سجل|اضف|ضيف|حدد|اختر|اختار)\s+(?:(?:لي|لنا)\s+)?(?:(?:ال)?(?:فصل|فصول|شعبه|شعب)\s+)?(.+)$/);
 const intent=parseClassAssignmentIntent(ask);
 if(intent){
  const targets=resolveClassAssignmentTargets(intent,project.classes);
  if(!targets.length){msg('لم أتعرف على الصف أو الفصل المطلوب. قل مثلًا «ثالث ثانوي كلهم» أو «ألغِ ثالث 7».');return true}
  const classIds=new Set(targets.map(item=>item.id)),courses=project.courses.filter(course=>classIds.has(course.classId)&&course.subject===assignmentSubject);
  if(!courses.length){msg(`لا توجد مادة ${assignmentSubject} في الفصول التي ذكرتها.`);return true}
  if(intent.remove){
   const assigned=courses.filter(course=>course.teacherId===assignmentTeacher);
   if(!assigned.length){msg(`لا يوجد إسناد لمادة ${assignmentSubject} في الفصول المحددة لدى المعلم الحالي حتى ألغيه.`);return true}
   undo.push(structuredClone(project));assigned.forEach(course=>course.teacherId='');invalidate();render();msg(`ألغيت إسناد ${assignmentSubject} عن ${assigned.length} فصلًا للمعلم المحدد.`);save();return true;
  }
  const conflicts=courses.filter(course=>course.teacherId&&course.teacherId!==assignmentTeacher);
  if(conflicts.length){const names=conflicts.slice(0,4).map(course=>project.classes.find(item=>item.id===course.classId)?.name).filter(Boolean);msg(`لم أغيّر شيئًا؛ ${conflicts.length} فصلًا محجوزة لمعلمين آخرين${names.length?': '+names.join('، '):''}. ألغِ الإسناد السابق أولًا.`);return true}
  const pendingCourses=courses.filter(course=>course.teacherId!==assignmentTeacher);
  if(!pendingCourses.length){msg(`كل الفصول المطلوبة لمادة ${assignmentSubject} مسندة بالفعل إلى المعلم المحدد.`);return true}
  const teacherRecord=project.teachers.find(item=>item.id===assignmentTeacher),total=pendingCourses.reduce((sum,course)=>sum+course.count,0),available=teacherRecord?Math.min(teacherRecord.max,project.slots.length-(teacherRecord.blocked||[]).length)-load(assignmentTeacher):0;
  if(!teacherRecord||total>available){msg(`لم أغيّر شيئًا؛ المتبقي للمعلم ${Math.max(0,available)} حصة والمطلوب ${total} حصة.`);return true}
  undo.push(structuredClone(project));pendingCourses.forEach(course=>course.teacherId=assignmentTeacher);invalidate();render();msg(`تم إسناد ${assignmentSubject} إلى ${pendingCourses.length} فصلًا للمعلم المحدد.`);save();return true;
 }
 let query;
 if(action){
  query=action[1].replace(/^(?:الماده|ماده)\s+.+?\s+(?:الى|الي|ل|لفصل|للفصل)\s+/,'').trim();
  query=query.replace(/^(?:المطلوب|المعلمين)\s+/,'').trim();
 }else{
  const references=findClassReferences(ask),remainder=references.reduceRight((value,reference)=>value.slice(0,reference.start)+' '+value.slice(reference.end),ask).split(/\s+/).filter(word=>!['من','الى','الي','حتى','لغاية','و','ثم','فصل','الفصل','فصول','الفصول','شعبه','شعب','ثانوي','متوسط','ابتدائي'].includes(word)).join(' ').trim();
  if(!references.length||remainder)return false;
  query=ask;
 }
 const references=findClassReferences(query),range=query.match(/^(?:من\s+)?(.+?)\s+(?:الى|الي|حتى|لغاية)\s+(.+)$/);let wanted=[];
 if(!references.length)return false;
 if(range){
  const from=classVoiceKey(range[1]),to=classVoiceKey(range[2]),[fromGrade,fromSection]=from.split('|'),[toGrade,toSection]=to.split('|');
  if(fromGrade&&fromGrade===toGrade&&Number.isInteger(Number(fromSection))&&Number.isInteger(Number(toSection)))wanted=project.classes.filter(c=>{const key=classVoiceKey(c.name),parts=key.split('|');return parts[0]===fromGrade&&Number(parts[1])>=Math.min(Number(fromSection),Number(toSection))&&Number(parts[1])<=Math.max(Number(fromSection),Number(toSection))});
 }else{
  wanted=references.flatMap(reference=>project.classes.filter(c=>classVoiceKey(c.name)===reference.key));
 }
 wanted=[...new Map(wanted.map(c=>[c.id,c])).values()];
 if(!wanted.length){msg(`لم أجد الفصل «${query}». جرّب «ثاني 7» أو «ثاني سابع» أو «اسند الفصل أولى أول».`);return true}
 const teacherRecord=project.teachers.find(t=>t.id===assignmentTeacher),courses=wanted.map(c=>project.courses.find(course=>course.classId===c.id&&course.subject===assignmentSubject)).filter(Boolean),conflicts=courses.filter(c=>c.teacherId&&c.teacherId!==assignmentTeacher),pendingCourses=courses.filter(c=>c.teacherId!==assignmentTeacher);
 if(conflicts.length){msg(`تعذر إسناد ${conflicts.length} فصلًا لأن المادة محجوزة لمعلمين آخرين. انتقل إلى المعلم المالك لإلغاء الحجز أولًا.`);return true}
 if(!pendingCourses.length){msg(`الفصول المطلوبة لمادة ${assignmentSubject} مسندة بالفعل إلى ${teacherRecord.short}.`);return true}
 const total=pendingCourses.reduce((sum,c)=>sum+c.count,0),available=Math.min(teacherRecord.max,project.slots.length-(teacherRecord.blocked||[]).length)-load(assignmentTeacher);
 if(total>available){msg(`لا يمكن إسناد الفصول المطلوبة؛ المتبقي للمعلم ${available} حصة والمطلوب ${total} حصة.`);return true}
 undo.push(structuredClone(project));pendingCourses.forEach(c=>c.teacherId=assignmentTeacher);invalidate();render();msg(`تم إسناد ${pendingCourses.length} فصلًا لمادة ${assignmentSubject} إلى ${teacherRecord.short}.`);save();return true;
}
function selectAssignmentNameByVoice(text){if(step!==3)return false;let ask=voiceText(text).replace(/^(?:اختر|اختار|حدد|غير الى|انتقل الى)\s+/,'').trim();const prefix=ask.match(/^(?:المعلم|معلم|الاستاذ|استاذ|الماده|ماده)\s+(.+)$/);if(prefix)ask=prefix[1].trim();if(!ask||/^(?:الفصل|فصل)\s+/.test(ask))return false;const teacherSelect=voiceVisible('#assignmentTeacher'),subjectSelect=voiceVisible('#assignmentSubject'),teacherMatches=teacherSelect?teacherVoicePick(teacherSelect,ask):[],subjectMatches=subjectSelect?voiceOptionPick(subjectSelect,ask):[];if(teacherMatches.length===1){return setVoiceSelect(teacherSelect,ask,'المعلمين')}if(subjectMatches.length===1){return setVoiceSelect(subjectSelect,ask,'المواد')}if(teacherMatches.length>1){msg(`وجدت أكثر من معلم مطابق: ${teacherMatches.slice(0,5).map(option=>option.textContent.trim()).join('، ')}. قل أي كلمة إضافية تميّزه؛ لا يلزم الاسم كاملًا.`);return true}if(subjectMatches.length>1){msg(`وجدت أكثر من مادة مطابقة. اذكر اسم المادة كاملًا.`);return true}return false}
function handleVoiceFields(text,original=text){const ask=voiceText(text);let m;const select=$('#seconds');if(select&&voiceVisible('#seconds')&&(m=ask.match(/^(?:(?:خلي|خل|اجعل|اضبط|ضبط|غير|حط)\s+)?(?:مده|وقت)\s+(?:البحث|التوليد|الحساب)(?:\s+(?:الى|الي|علي|يكون))?\s+(.+)$/))){const value=m[1],index=/دقيقتين|دقيقتان|2 دقيقه|ثنتين|120/.test(value)?2:/دقيقه|60|ستين/.test(value)?1:/20|عشرين|ثانيه/.test(value)?0:-1;if(index<0)return false;select.selectedIndex=index;select.dispatchEvent(new Event('change',{bubbles:true}));msg(`ضبطت مدة البحث على ${select.options[index].textContent.trim()}.`);return true}
 const box=$('#allowExceptions');if(box&&voiceVisible('#allowExceptions')&&/(?:قيود مرنه|استثناء القيود|استثناءات مرنه|تجاوز القيود|الاستثناءات المرنه)/.test(ask)){const off=/(?:امنع|عطل|الغ|لا تسمح|بدون|اوقف|لا تستثني|لا تتجاوز|منع|اقفل)/.test(ask);if(box.checked===!off)msg(`السماح باستثناء القيود المرنة ${off?'معطل':'مفعل'} بالفعل.`);else{box.click();msg(`${off?'عطّلت':'فعّلت'} السماح باستثناء القيود المرنة.`)}return true}
 const paper=$('#printPaper');if(paper&&voiceVisible('#printPaper')&&(m=ask.match(/(?:حجم|مقاس|قياس|نوع)?\s*(?:الورق|الورقه|الصفحه)?\s*(a\s?[345])\b/))){const size=m[1].replace(/\s/g,''),pref=/عمودي/.test(ask)?'عمودي':/افقي/.test(ask)?'افقي':'',options=[...paper.options].filter(option=>voiceText(option.textContent).replace(/\s/g,'').includes(size)),pick=options.find(option=>pref&&voiceText(option.textContent).includes(pref))||options[0];if(!pick){msg(`لم أجد حجم الورق ${m[1].toUpperCase()}.`);return true}paper.value=pick.value;paper.dispatchEvent(new Event('change',{bubbles:true}));msg(`اخترت حجم الورق ${pick.textContent.trim()}.`);return true}
 const nameField=$('#newScheduleName');if(nameField&&voiceVisible('#newScheduleName')&&(m=cleanVoiceRequest(original).match(/^(?:(?:غير|عدل|اكتب|سجل|حط|خلي)\s+)?(?:اسم الجدول الجديد|اسم الجدول|سمي? الجدول(?: الجديد)?|اسمه|سمه|تسمي[ةه] الجدول)(?:\s+(?:الى|إلى|هو|يكون))?\s+(.{1,60})$/))){nameField.value=m[1].trim();nameField.dispatchEvent(new Event('input',{bubbles:true}));msg(`سمّيت الجدول الجديد «${nameField.value}». قل «احفظ الحالي وأنشئ جديد» للمتابعة.`);return true}
 if((m=ask.match(/^(?:اختر|اختار|حدد|غير الى|اجعل|اعرض)\s+(?:ال)?فصل\s+(.+)$/)))return setVoiceSelect(voiceVisible('#classSelect')||voiceVisible('#assignmentClass'),m[1],'الفصول');if((m=ask.match(/^(?:اختر|اختار|حدد|غير الى|اجعل|اعرض)\s+(?:ال)?ماده\s+(.+)$/)))return setVoiceSelect(voiceVisible('#assignmentSubject'),m[1],'المواد');if(!/غياب|غائب|استبعد/.test(ask)&&!$('#editor')?.open&&(m=ask.match(/^(?:اختر|اختار|حدد|غير الى|اجعل|اعرض)\s+(?:ال)?معلم\s+(.+)$/))){const target=voiceVisible('#assignmentTeacher')||voiceVisible('#teacherSelect');if(target)return setVoiceSelect(target,m[1],'المعلمين')}
 if((m=ask.match(/^(?:العام الدراسي|السنه الدراسيه)\s+(.+)$/))){const input=[...document.querySelectorAll('label')].find(label=>voiceText(label.textContent).includes('العام الدراسي'))?.querySelector('input');if(input&&input.getClientRects().length){input.value=text.replace(/^.*?(?:العام الدراسي|السنة الدراسية)\s+/,'').trim();input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));msg(`ضبطت العام الدراسي على ${input.value}.`);return true}}
 return false}
function lessonLocationFromVoice(value){const text=voiceText(value),days='(الاحد|احد|الحد|الاثنين|اثنين|تنين|الثلاثاء|ثلاثاء|تلات|الاربعاء|اربعاء|اربع|الخميس|خميس)',period='((?:ال)?(?:\\d+|اول[ىي]?|ثاني[هة]?|ثالث[هة]?|رابع[هة]?|خامس[هة]?|سادس[هة]?|سابع[هة]?|ثامن[هة]?|تاسع[هة]?|عاشر[هة]?))';let match=text.match(new RegExp(`(?:يوم\\s+)?${days}\\s+(?:الحصه|حصه|الدرس)?\\s*${period}`));if(match)return {day:match[1],period:match[2]};match=text.match(new RegExp(`(?:الحصه|حصه|الدرس)\\s*${period}\\s+(?:يوم\\s+)?${days}`));return match?{day:match[2],period:match[1]}:null}
function selectLessonByVoice(dayName,periodText){const period=voicePeriod(periodText),dayIndex=dayName?voiceDayIndex(dayName):-1;if(!Number.isInteger(period)||period<1||(dayName&&dayIndex<0)){msg('لم أفهم رقم الحصة أو اليوم. قل مثلًا: «الحصة الرابعة يوم الأحد» أو «الأحد الحصة 4».');return false}const editing=$('#editor')?.open,scope=editing?$('#editorBody table'):document,candidates=[...scope.querySelectorAll('[data-drag]')].filter(el=>{const slot=project.slots[Number(el.dataset.slot)],course=project.courses.find(item=>item.id===el.dataset.drag);return slot&&course&&(!editing||course.teacherId===editTeacher)&&slot.period===period-1&&(dayIndex<0||slot.day===dayIndex)&&el.getClientRects().length}),found=[...new Map(candidates.map(el=>[`${el.dataset.drag}|${el.dataset.slot}`,el])).values()];if(!found.length){const available=editing&&dayIndex>=0?[...scope.querySelectorAll('[data-drag]')].filter(el=>{const slot=project.slots[Number(el.dataset.slot)],course=project.courses.find(item=>item.id===el.dataset.drag);return slot&&course?.teacherId===editTeacher&&slot.day===dayIndex}).map(el=>project.slots[Number(el.dataset.slot)].period+1).sort((a,b)=>a-b):[];msg(`لا توجد حصة ظاهرة رقم ${period}${dayName?' يوم '+project.days[dayIndex]?.name:''}${editing?' للمعلم المحدد':''}.${available.length?` حصصه المتاحة في هذا اليوم: ${available.join('، ')}.`:' اختر المعلم المطلوب أولًا أو راجع اليوم والحصة.'}`);return false}if(found.length>1){const days=[...new Set(found.map(el=>project.days[project.slots[Number(el.dataset.slot)].day].name))];msg(`هناك أكثر من حصة مطابقة${dayName?' في هذا الموضع':` برقم ${period}`}: ${days.join('، ')}. حدّد اليوم والحصة، أو اختر المعلم المطلوب أولًا.`);return false}const lesson=found[0],slotInfo=project.slots[Number(lesson.dataset.slot)];if(selectedLesson){selectedLesson=null;clearDrag()}lesson.click();msg(`اخترت ${lesson.firstChild.textContent.trim()} يوم ${project.days[slotInfo.day].name} الحصة ${period}. قل «انقلها إلى الحصة الرابعة يوم الأربعاء» أو «انقل الحصة ${period} يوم ${project.days[slotInfo.day].name} إلى الحصة 4 يوم الأربعاء».`);return true}
function moveSelectedLessonByVoice(dayName,periodText){const source=selectedLesson,from=source&&project.slots[source.sourceSlot];if(!from){msg('اختر حصة أولًا، مثلًا: «الحصة الرابعة يوم الأحد».');return false}const dayIndex=dayName?voiceDayIndex(dayName):from.day,period=periodText?voicePeriod(periodText):from.period+1,target=dayIndex<0||!Number.isInteger(period)?-1:project.slots.findIndex(s=>s.day===dayIndex&&s.period===period-1);if(target<0){msg('اليوم أو رقم الحصة غير موجود في جدول الدوام.');return false}if(source.sourceSlot===target){msg('موضع البداية هو نفس موضع الهدف.');return false}selectedLesson=null;clearDrag();voiceSwapAutoApply=false;requestSwap({courseId:source.courseId,sourceSlot:source.sourceSlot,slot:target});msg(`جارٍ البحث عن بدائل نقل الحصة إلى ${project.days[dayIndex].name} الحصة ${period}. ستظهر نافذة المعاينة بمن سيتبادل معك لتؤكد أو تلغي.`);return true}
function moveEditorLessonByVoice(text){if(!$('#editor')?.open)return false;const ask=voiceText(text),match=ask.match(/^(?:انقل|نقل|حرك|بدل|بدل|حول|ود(?:ي)?)\s+(.+?)\s+(?:الى|الي|ل)\s+(.+)$/);if(!match)return false;const source=lessonLocationFromVoice(match[1]),target=lessonLocationFromVoice(match[2]);if(!source||!target){msg('اذكر موضعي البداية والنهاية بوضوح، مثل «انقل الحصة الرابعة يوم الأحد إلى الحصة الثانية يوم الاثنين».');return true}if(!selectLessonByVoice(source.day,source.period))return true;moveSelectedLessonByVoice(target.day,target.period);return true}
function startVoiceLessonMove(text){const days='(الاحد|احد|الحد|الاثنين|اثنين|تنين|الثلاثاء|ثلاثاء|تلات|الاربعاء|اربعاء|اربع|الخميس|خميس)',period='([^\\s]+)',pattern=new RegExp(`(?:انقل|نقل)\\s+(?:ماده\\s+)?(.+?)\\s+(?:لفصل|للفصل|في فصل)\\s+(.+?)\\s+من\\s+(?:يوم\\s+)?${days}\\s+(?:الحصه\\s*)?${period}\\s+(?:الى|الي)\\s+(?:يوم\\s+)?${days}\\s+(?:الحصه\\s*)?${period}(.*)$`),match=voiceText(text).match(pattern);if(!match)return false;const [,subjectName,className,fromDay,fromPeriod,toDay,toPeriod,tail]=match,classMatch=project.classes.find(c=>voiceText(c.name)===voiceText(className))||project.classes.find(c=>voiceText(c.name).includes(voiceText(className)));if(!classMatch){msg(`لم أجد الفصل «${className}».`);return true}const course=project.courses.find(c=>c.classId===classMatch.id&&(voiceText(c.subject)===voiceText(subjectName)||voiceText(c.short)===voiceText(subjectName)))||project.courses.find(c=>c.classId===classMatch.id&&voiceText(c.subject).includes(voiceText(subjectName)));if(!course){msg(`لم أجد مادة «${subjectName}» في فصل ${classMatch.name}.`);return true}const sourceSlot=voiceSlot(fromDay,fromPeriod),targetSlot=voiceSlot(toDay,toPeriod);if(sourceSlot<0||targetSlot<0){msg('أحد اليومين أو أرقام الحصص غير موجود في جدول الدوام.');return true}if(sourceSlot===targetSlot){msg('موضع البداية هو نفسه موضع الهدف.');return true}if(!project.placements.some(p=>p.courseId===course.id&&p.slot===sourceSlot)){msg(`${course.subject} ليست في ${classMatch.name} يوم ${fromDay} الحصة ${fromPeriod}. راجع الموضع ثم أعد الأمر.`);return true}step=5;render();voiceSwapAutoApply=/(?:ونفذ(?:ه)?|ثم نفذ(?:ه)?|مباشر(?:ه)?|تلقائي(?:ا)?)/.test(tail);requestSwap({courseId:course.id,sourceSlot,slot:targetSlot});msg(`جارٍ البحث عن أنسب تبديل لنقل ${course.subject} في ${classMatch.name} من ${fromDay} الحصة ${fromPeriod} إلى ${toDay} الحصة ${toPeriod}.${voiceSwapAutoApply?' سيُنفّذ البديل الأفضل تلقائيًا بعد التحقق.':' بعد ظهور المعاينة قل «نفّذ أفضل تبديل» أو اختر بديلًا ثم قل «اضغط تنفيذ التبديل».'}`);return true}
function chooseVoiceSwapOption(number,execute=false){if(!$('#preview').open){msg('لا توجد معاينة تبديل مفتوحة الآن. ابدأ أولًا بأمر النقل الصوتي.');return true}if(busy){msg('ما زال البحث عن البدائل جاريًا. أعد الأمر بعد ظهور الخيارات.');return true}const index=periodNumber(number)-1;if(!Number.isInteger(index)||index<0||index>=swapChoices.length){msg(`رقم البديل غير صحيح. البدائل المتاحة مرقمة من 1 إلى ${swapChoices.length}.`);return true}swapIndex=index;drawSwap();if(execute)applyCurrentSwap();else msg(`تم اختيار البديل ${index+1} للمعاينة. قل «نفّذ البديل ${index+1}» لاعتماده.`);return true}
function applyBestVoiceSwap(){return chooseVoiceSwapOption(1,true)}
function periodNumber(value){const word=voiceText(value).trim().replace(/[^\u0600-\u06ff0-9]/g,'').replace(/^لل?/,'').replace(/^ال/,'');const words={اول:1,اولى:1,ثاني:2,ثانية:2,ثالث:3,ثالثة:3,رابع:4,رابعة:4,خامس:5,خامسة:5,سادس:6,سادسة:6,سابع:7,سابعة:7,ثامن:8,ثامنة:8,تاسع:9,تاسعة:9,عاشر:10,عاشرة:10,حاديعشر:11,حاديةعشرة:11,ثانيعشر:12,ثانيةعشرة:12};return words[word]||voiceNumber(word)}
function timeMinutes(value){const m=String(value).match(/^(\d{1,2})\s*:\s*(\d{2})$/);if(!m)return NaN;const h=Number(m[1]),minutes=Number(m[2]);return h>=0&&h<24&&minutes<60?h*60+minutes:NaN}
function timeText(minutes){return String(Math.floor(minutes/60)%24).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0')}

function addLocalTeacher(name,max){const clean=name.trim().replace(/[.،]+$/,'');if(!clean)return false;if(project.teachers.some(t=>t.name===clean)){msg('هذا المعلم موجود أصلًا: '+clean);return false}const words=clean.split(/\s+/),used=new Set(project.teachers.map(t=>t.short));let short=words.length>1?words[0]+' '+words.at(-1):clean;if(used.has(short))short=clean;if(used.has(short))short+=' '+(project.teachers.length+1);project.teachers.push({id:crypto.randomUUID(),name:clean,short,max,blocked:[]});return true}
function command(text){
 const n=canonicalVoiceCommand(text);if(!n)return;if(voiceWaiting){const continuation=matchVoiceResume(n);if(continuation===null)return;voiceWaiting=false;msg('حاضر، أنا معك.');if(voiceConversation)guide('أستمع لأمرك التالي…','listening');if(continuation)command(continuation);return}
 msg(text,true);let m,changed=false;
 if(handleVoiceConfirmation(n))return
 if(handleVoiceConversation(n))return
 if(handleVoiceOutputCommand(n))return
 if(handleVoiceWaitCommand(n))return
 if(answerVoiceContext(n))return
 const absenceVoiceEvent=new CustomEvent('voice-absence-command',{cancelable:true,detail:{text:n,reply:message=>msg(message)}});
 window.dispatchEvent(absenceVoiceEvent);if(absenceVoiceEvent.defaultPrevented)return
 if(handleSignatureTasksVoice(n))return
 if(handleVoiceNavigation(n))return
 if(step===4&&smartVoiceIntent(n))return
 if(handleAvailabilityVoice(n))return
 if(selectAvailabilityTeacherByVoice(n))return
 if(/^(?:لا|لات)\s/.test(n)&&! /^(?:لا تسمح باستثناء|لا تنفذ$|لا تطبق$|لا ابغى$|لا اريد$|لا شكرا$|لا تتكلم$|لا تصدر صوت$|لا تنزل$|لا تطلع$)/.test(n)){msg('لن أنفذ هذا الأمر. اذكر الطلب الذي تريده مباشرةً.');return}
 const schoolField=parseSchoolVoiceField(text);
 if(schoolField){project.school[schoolField.field]=schoolField.value;render();const label={name:'اسم المدرسة',director:'اسم المدير',year:'العام الدراسي',stage:'المرحلة',term:'الفصل الدراسي'}[schoolField.field];msg('تم تسجيل '+label+': '+schoolField.value);save();return}
 const timingRequest=parseTimingRequest(text);
 if(timingRequest){const result=planTiming(project.slots,project.days,timingRequest);if(result.error){msg(result.error);return}undo.push(structuredClone(project));project.slots=result.slots;render();msg('تم حساب التوقيت للمجموعات المطلوبة فقط: '+result.summary.map(rule=>`الحصة ${rule.from}${rule.end&&rule.end!==rule.from?' إلى '+rule.end:!rule.end?' وما بعدها':''} تبدأ ${rule.start}، مدة الحصة ${rule.duration} دقيقة`).join('؛ ')+'. لم أضف فسحة ولم أغيّر الحصص التي لم تحددها.');save();return}
 // Parameterized swap requests take precedence over fuzzy button names.
 const swapRequest=voiceText(n);
 if((m=swapRequest.match(/^(?:اختر|اختار|اعرض|خل)\s+(?:البديل|الخيار)\s+(?:رقم\s+)?([^\s]+)$/))){chooseVoiceSwapOption(m[1]);return}
 if((m=swapRequest.match(/^(?:نفذ|طبق|اعتمد|ثبت)\s+(?:البديل|الخيار)\s+(?:رقم\s+)?([^\s]+)$/))){chooseVoiceSwapOption(m[1],true);return}
 if(/^(?:نفذ|طبق|اعتمد|ثبت|اختار|خل)(?:\s+لي)?\s+(?:افضل|الافضل|احسن|الأحسن|اول|الاول)(?:\s+(?:بديل|خيار|تبديل))?$/.test(swapRequest)){applyBestVoiceSwap();return}
 if(startVoiceLessonMove(n))return
 if(moveEditorLessonByVoice(n))return
 if(handleVoiceScroll(n))return
 if(answerTeacherQuestion(n))return
 if(explainRequestedButton(n))return
 if(/^(?:مساعده|المساعده|ماذا تستطيع|الاوامر|اوامر المساعد)/.test(voiceText(n))){msg(controlHelp());return}
 const lessonCommand=voiceText(n),spokenLessonLocation=lessonLocationFromVoice(lessonCommand);
 if($('#editor')?.open&&spokenLessonLocation&&/(?:الحصه|حصه|الدرس)/.test(lessonCommand)&&!/^(?:انقل|نقل|حرك|بدل|حول|ود)/.test(lessonCommand)){selectLessonByVoice(spokenLessonLocation.day,spokenLessonLocation.period);return}
 if(/^(?:اضغط|انقر|اختر|حدد)\s+(?:(?:على|علي)\s+)?(?:ال)?حصه(?:\s|$)/.test(lessonCommand)){const dayHit=lessonCommand.match(/(الاحد|احد|الحد|الاثنين|اثنين|تنين|الثلاثاء|ثلاثاء|تلات|الاربعاء|اربعاء|اربع|الخميس|خميس)/),periodHit=lessonCommand.match(/حصه\s+(?:ال)?(?!يوم)(\S+)/)||lessonCommand.match(/(?:الاحد|احد|الحد|الاثنين|اثنين|تنين|الثلاثاء|ثلاثاء|تلات|الاربعاء|اربعاء|اربع|الخميس|خميس)\s+(?:ال)?(\S+)$/);if(periodHit){selectLessonByVoice(dayHit?.[1]||'',periodHit[1]);return}}
 if(/^(?:انقلها|حركها|انقل الحصه(?: المحدده)?)\s+(?:الى|الي)\s/.test(voiceText(n))){const spoken=voiceText(n),dayHit=spoken.match(/(الاحد|الاثنين|الثلاثاء|الاربعاء|الخميس)/),periodHit=spoken.match(/حصه\s+(?:ال)?(?!يوم)(\S+)/)||spoken.match(/(?:الاحد|الاثنين|الثلاثاء|الاربعاء|الخميس)\s+(?:ال)?(\S+)$/);if(dayHit||periodHit){moveSelectedLessonByVoice(dayHit?.[1]||'',periodHit?.[1]||'');return}msg('اذكر اليوم أو رقم الحصة التي تريد نقلها إليها.');return}
 if($('#editor')?.open&&/(?:قايمه|قائمه|قائمة)\s+(?:ال)?معلم/.test(voiceText(n))){const select=$('#editTeacher');if(select){select.focus();try{select.showPicker()}catch{}msg('فتحت قائمة «المعلم المطلوب». قل مثلًا: «اختر المعلم سامي عوض» أو «اعرض جدول سامي عوض».')}else msg('افتح تعديل الجدول أولًا.');return}
 if(selectEditorTeacherByVoice(n))return
 if((m=voiceText(n).match(/^(?:اعرض|اظهر|ورني|وريني)\s+(?:لي\s+)?(?:جدول\s+(?:المعلم\s+)?)(?!الفصل|فصل)(.+)$/))){showTeacherSchedule(m[1]);return}
 if(handleTeacherMaxByVoice(n))return
 if(handleCourseVoiceCommand(n))return
 if(assignCopiedAssignmentBatch(text))return
 if(assignCopiedAssignmentRow(text))return
 if(assignClassesByVoice(n))return
 if(selectAssignmentNameByVoice(n))return
 if(handleGenericVoiceSelection(n))return
 if(handleVoiceFields(n,text))return
 if(!/(?:انتقل|اذهب|افتح)\s/.test(n)&&smartVoiceIntent(n))return
 if(handleGenericVoiceButton(n))return
 if(canAskCopilot()&&isOpenQuestion(n)){askCopilot(n);return}
 if((m=n.match(/(?:انتقل|اذهب|افتح)\s+(?:الى\s+)?(.+)/))){const requested=m[1].replace(/^(?:للتبويب|التبويب|تبويب|للمرحلة|المرحلة)\s+/,'' );if(openVoiceArea(requested))return;if(openTeacherScheduleIntent(requested))return;if(smartVoiceIntent(n))return;const tabs=[['بيانات المدرسة','البيانات الرئيسية'],['الايام والتوقيت','ايام الدوام'],['الفصول والخطة','الفصول'],['المعلمين والاسنادات','المعلمين'],['الاتاحة والقيود','القيود'],['انشاء الجدول','الجدول'],['حصص الانتظار','الانتظار']],target=tabs.findIndex(words=>words.some(word=>requested.includes(word)));if(target<0){if(canAskCopilot()){askCopilot(n);return}msg('لم أتعرف على التبويب. قل مثلًا: «انتقل إلى الأيام والتوقيت».');return}if(target===step){msg('أنت في تبويب '+names[target]+' بالفعل.');return}if(target<=unlocked){step=target;render();msg('تم الانتقال إلى '+names[target]+'.');return}if(target===step+1){next().catch(e=>notice(e.message));msg('سأتحقق من اكتمال هذه الخطوة ثم أنتقل إلى '+names[target]+'.');return}msg('لا يمكن القفز إلى '+names[target]+' قبل إكمال الخطوات السابقة. يمكنك قول «التالي» للانتقال بالتسلسل.');return}
 else if((m=n.match(/(?:النصاب\s*(?:المستهدف)?|نصاب الانتظار|اجمالي النصاب)\s*(\d+)/))){if(!$('#sbTarget'))window.dispatchEvent(new Event('open-standby'));setTimeout(()=>{if(!setVoiceControl('#sbTarget',arabicNumber(m[1]),'النصاب المستهدف'))msg('افتح إعداد حصص الانتظار أولًا ثم أعد الأمر.')},0);return}
 else if((m=n.match(/(?:عدد\s*)?المنتظرين\s*(\d+)/))){if(!$('#sbCount')){window.dispatchEvent(new Event('open-standby'));setTimeout(()=>{const next=$('[data-sb-page="1"]');if(next)next.click();setVoiceControl('#sbCount',arabicNumber(m[1]),'عدد المنتظرين')},0)}else setVoiceControl('#sbCount',arabicNumber(m[1]),'عدد المنتظرين');return}
 else if((m=n.match(/(?:اقصى\s*)?مساف(?:ه|ة)\s*(\d+)/))){if(setVoiceControl('#sbDistance',arabicNumber(m[1]),'أقصى مسافة'))return;msg('افتح إعدادات الانتظار ثم انتقل إلى «التغطية والشروط».');return}
 else if((m=n.match(/(?:استبعد|استثناء)\s+(?:المعلم\s+)?(.+)/))){chooseTeacherByVoice(m[1],{exclude:true});return}
 else if((m=n.match(/(?:حدد|اختر|سجل)\s+(?:غياب\s+)?(?:المعلم\s+)?(.+?)(?:\s+غائب)?$/))&&/غياب|غائب/.test(n)){chooseTeacherByVoice(m[1],{absence:true});return}
 else if((m=n.match(/(?:تاريخ\s+الغياب|تاريخ)\s+(\d{4}-\d{2}-\d{2})/))){if(!$('#absenceDate'))window.dispatchEvent(new Event('open-absence'));setTimeout(()=>{if(!setVoiceControl('#absenceDate',m[1],'تاريخ الغياب'))msg('افتح شاشة المعلم الغائب أولًا.')},0);return}
 else if(/^(?:اضغط|انقر|نفذ|شغل)(?:\s|$)/.test(voiceText(n))){if(!pressVoiceButton(n))msg('لم أجد زرًا مطابقًا ظاهرًا الآن. قل «مساعدة الأوامر» لعرض الأزرار المتاحة في هذه الشاشة.');return}
 else if((m=n.match(/^(?:المرحلة\s+)?(ابتدائي|متوسط|ثانوي)$/))){project.school.stage=m[1];msg('تم اختيار المرحلة: '+m[1]);changed=true}
 else if((m=n.match(/(?:الفصل الدراسي|الفصل)\s+(الاول|الثاني|الثالث)/))){project.school.term={'الاول':'الأول','الثاني':'الثاني','الثالث':'الثالث'}[m[1]];msg('تم اختيار الفصل الدراسي '+project.school.term);changed=true}
 else if((m=n.match(/(?:اضف|أضف)\s+معلم\s+(.+?)\s+(?:نصابه|نصابة|بنصاب)\s*(\d+)/))){const max=arabicNumber(m[2]);if(!Number.isInteger(max)||max<1||max>100)msg('النصاب يجب أن يكون رقمًا بين 1 و100.');else if(addLocalTeacher(m[1],max)){msg(`أُضيف المعلم ${m[1].trim()} بنصاب ${max}.`);changed=true}}
 else {
  const counts=stageDefinition().grades.map(()=>0),gradeIndex={'الاول':0,'اول':0,'الثاني':1,'ثاني':1,'الثالث':2,'ثالث':2,'الرابع':3,'رابع':3,'الخامس':4,'خامس':4,'السادس':5,'سادس':5};let found=false,addedGrades=[],configuredGrades=[];
  for(const match of n.matchAll(/(الاول|اول|الثاني|ثاني|الثالث|ثالث|الرابع|رابع|الخامس|خامس|السادس|سادس)\s*(?:(?:ال)?(?:ثانوي|متوسط|ابتدائي))?\s*(\d+)\s*(?:فصل|فصول|شعب[ةه]|شعب)/g)){if(gradeIndex[match[1]]<counts.length){counts[gradeIndex[match[1]]]=arabicNumber(match[2]);found=true}}
  const existing=stageDefinition().grades.map(g=>project.classes.filter(c=>(c.planStage===project.school.stage||!c.planStage)&&c.name.startsWith(g+' ')).length);
  if(!found){const addition=parseClassAdditions(n,project.school.stage,stageDefinition().grades,existing);if(addition){addition.counts.forEach((count,index)=>counts[index]=count);addedGrades=addition.addedGrades;configuredGrades=addition.configuredGrades;found=true}}
  if(found){if(!counts.some(Boolean)||counts.some(x=>x<0||x>40)){msg('عدد الفصول يجب أن يكون بين صفر و40.')}else{const merged=counts.map((value,index)=>value||existing[index]);createClasses(merged);const actions=[];if(addedGrades.length)actions.push(`أُضيفت شعبة واحدة إلى ${addedGrades.join('، ')}`);if(configuredGrades.length)actions.push(`ضُبط عدد شعب ${configuredGrades.map(grade=>`${grade} ${merged[gradeIndex[grade]]}`).join('، ')}`);msg(actions.length?actions.join('، ')+'.':'تم تحديث الفصول دون حذف المراحل أو الصفوف السابقة: '+stageDefinition().grades.map((grade,index)=>grade+' '+merged[index]).join('، ')+'.');changed=true}}
  else {
   const nextCounts=project.days.map(d=>d.count);let dayChanged=false;const dayMap={'الأحد':0,'الاحد':0,'الاثنين':1,'الثلاثاء':2,'الأربعاء':3,'الاربعاء':3,'الخميس':4};
   for(const match of [...n.matchAll(/(?:(?:اجعل|حدد|غير|غيّر|خل|خلي|خلّي|اضبط|ضبط)\s+)?(?:يوم\s*)?(الأحد|الاحد|الاثنين|الثلاثاء|الأربعاء|الاربعاء|الخميس)\s+(\d+)\s*(?:حصة|حصص)/g),...n.matchAll(/(?:(?:اجعل|حدد|غير|غيّر|خل|خلي|خلّي|اضبط|ضبط)\s+)?(?:عدد\s+)?حصص\s+(?:يوم\s*)?(الأحد|الاحد|الاثنين|الثلاثاء|الأربعاء|الاربعاء|الخميس)\s+(?:الى\s+|يكون\s+)?(\d+)/g)]){nextCounts[dayMap[match[1]]]=arabicNumber(match[2]);dayChanged=true}
   if(dayChanged){rebuildSchedule(nextCounts);msg('تم تحديث عدد الحصص في أيام الدوام. راجع الخطة والإتاحة بعد ذلك.');changed=true}
   else if(/التالي|متابعة/.test(n)){next().catch(e=>notice(e.message));msg('سأتحقق من اكتمال الخطوة قبل الانتقال.');return}
  else if(/حفظ/.test(n)){save();msg('جارٍ حفظ المسودة على هذا الجهاز.');return}
    else {if(canAskCopilot()){askCopilot(n);return}const examples=['اسم المدرسة مدرسة الأمل — اسم المدير أحمد سالم','خلي عدد حصص يوم الأحد سبعة','أول ثلاث فصول — اختر الفصل أول 1','اختر المعلم أحمد سالم — اختر المادة الرياضيات','اختر المعلم أحمد سالم — افتح الإتاحة والقيود','افتح تعديل الجدول — خلي مدة البحث دقيقتين','افتح إعداد الانتظار — حط النصاب المستهدف عشرين'];msg(`سمعت «${text}» ولم أحدد الإجراء المطلوب. جرّب: ${examples[step]||examples[0]}. أو قل «مساعدة الأوامر».`);return}
  }
 }
 if(changed){$('#saveStatus').textContent='تغييرات غير محفوظة';render();save()}
}
function submitAssistantCommand(){const input=$('#command'),text=input?.value.trim();if(!text)return;command(text);input.value='';input.dispatchEvent(new Event('input',{bubbles:true}))}
const commandForm=$('#chat');if(commandForm){commandForm.onsubmit=e=>{e.preventDefault();submitAssistantCommand()};const executeCommandButton=commandForm.querySelector('button[type="submit"]');if(executeCommandButton){executeCommandButton.setAttribute('aria-label','تنفيذ الأمر');executeCommandButton.onclick=e=>{e.preventDefault();submitAssistantCommand()}}}
function voiceRecognitionError(code){return ({'not-allowed':'لم يسمح المتصفح باستخدام الميكروفون. اسمح به من إعدادات الموقع ثم أعد المحاولة.','service-not-allowed':'التعرف الصوتي غير متاح في هذا المتصفح أو محجوب منه. افتح الموقع في Chrome أو Edge، واسمح بالميكروفون.','audio-capture':'لم يُعثر على ميكروفون يعمل. تحقق من إعدادات الصوت والميكروفون.','network':'تعذر الاتصال بخدمة التعرف الصوتي. تحقق من الإنترنت ثم أعد المحاولة.','language-not-supported':'التعرف الصوتي العربي غير مدعوم في هذا المتصفح. جرّب Chrome أو Edge.','no-speech':'لم أسمع كلامًا واضحًا. اضغط الميكروفون وتحدث بعد ظهور «جارٍ الاستماع».','aborted':'توقف الاستماع قبل التقاط الكلام. أعد المحاولة.'}[code]||`لم يكتمل التحويل الصوتي (${code||'خطأ غير معروف'}). تحقق من إذن الميكروفون وحاول مجددًا.`)}
function speechTeacherQuery(value){return voiceText(value).replace(/^(?:(?:حدد|اختر|اختار|سجل|اضف|ضيف|علم|علّم|الغ|الغي|الغاء|الغى|ازل|شيل|احذف|اعتبر|حضر|حاضر|داوم|راجع|رجع)\s+)+(?:غياب\s+)?(?:(?:المعلم|الاستاذ|المدرس)\s+)?/,'').replace(/\s+(?:غائب|غايب|حضر|حاضر|داوم|راجع|رجع)$/,'').trim()}
function preferredSpeechTranscript(result){
 const alternatives=[...result].map(item=>({text:item.transcript.trim(),confidence:Number(item.confidence)||0})).filter(item=>item.text);
 if(!alternatives.length)return '';
 const absenceOpen=$('#absenceDialog')?.open;
 if(!absenceOpen)return alternatives.sort((a,b)=>b.confidence-a.confidence)[0].text;
 const ranked=alternatives.map(item=>{
  const matches=matchTeacherNames(project.teachers,speechTeacherQuery(item.text));
  // A unique teacher-name match is stronger evidence than the recognizer's
  // first alternate, but ambiguous matches deliberately receive no boost.
  return {...item,score:item.confidence+(matches.length===1?10:0)};
 }).sort((a,b)=>b.score-a.score);
 return ranked[0].text;
}
function listenForVoice(input,submit){const SR=window.SpeechRecognition||window.webkitSpeechRecognition,button=input?.id==='swapVoiceCommand'?$('#swapVoiceMic'):$('#mic');if(!SR){const text='التحويل الصوتي غير متاح في هذا المتصفح. افتح الموقع في Chrome أو Edge مع إذن الميكروفون.';guide(text);return msg(text)}if(!button)return;setVoiceReplies(true);const original=button.textContent,rec=new SR();let heardResult=false;let watchdog=null;const reset=()=>{if(watchdog){clearTimeout(watchdog);watchdog=null}button.disabled=false;button.textContent=original};rec.lang='ar-SA';rec.interimResults=false;rec.maxAlternatives=5;button.disabled=true;button.textContent='جارٍ الاستماع…';guide('أستمع إليك الآن…','listening');rec.onresult=e=>{heardResult=true;const heard=preferredSpeechTranscript(e.results[e.resultIndex]||e.results[0]);input.value=heard;guide('أفهم طلبك…','thinking');if(submit)submit();else{command(heard);input.value=''}};rec.onerror=e=>{const text=voiceRecognitionError(e?.error);reset();guide(text);msg(text)};rec.onend=()=>{reset();if(!voiceScrollTimer&&!heardResult)guide('لم أسمع أمرًا. اضغط الميكروفون وتحدث بوضوح.');else if(!voiceScrollTimer)guide('جاهز لأمرك التالي.')};watchdog=setTimeout(()=>{if(!heardResult){try{rec.stop()}catch{}const text='لم يصل صوت واضح خلال 12 ثانية. تأكد من اختيار الميكروفون الصحيح ثم أعد المحاولة.';reset();guide(text);msg(text)}},12000);try{rec.start()}catch(error){reset();const text=voiceRecognitionError(error?.name==='NotAllowedError'?'not-allowed':error?.name||'start');guide(text);msg(text)}}
$('#mic').onclick=()=>listenForVoice($('#command'));
function updateConversationButton(){const button=$('#conversationMic');if(!button)return;button.classList.toggle('active',voiceConversation);button.textContent=voiceConversation?'أوقف الحوار الصوتي':'ابدأ الحوار الصوتي';button.title=button.textContent}
function stopVoiceConversation(message='أوقفت الحوار الصوتي. يمكنك استخدام زر الميكروفون متى شئت.'){voiceConversation=false;if(voiceRestartTimer){clearTimeout(voiceRestartTimer);voiceRestartTimer=null}if(conversationRecognition){conversationRecognition.onend=null;conversationRecognition.stop();conversationRecognition=null}updateConversationButton();guide(message);msg(message);return true}
function scheduleVoiceRestart(delay){if(!voiceConversation||voiceRestartTimer)return;voiceRestartTimer=setTimeout(()=>{voiceRestartTimer=null;if(voiceConversation&&!conversationRecognition)beginVoiceConversation()},delay)}
function beginVoiceConversation(){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){stopVoiceConversation('التعرف الصوتي غير متاح في هذا المتصفح. افتح الصفحة في Chrome أو Edge.');return}const mobile=/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);setVoiceReplies(true);const rec=new SR();conversationRecognition=rec;rec.lang='ar-SA';rec.continuous=!mobile;rec.interimResults=false;rec.maxAlternatives=5;rec.onstart=()=>{guide(mobile?'استماع الجوال يعمل لجملة واحدة. بعد تنفيذها اضغط الزر للأمر التالي.':'المحادثة الصوتية تعمل. قل ما تريد، وقل «أوقف المحادثة» عند الانتهاء.','listening');updateConversationButton()};rec.onresult=e=>{for(let i=e.resultIndex;i<e.results.length;i++){if(!e.results[i].isFinal)continue;voiceRestartAttempts=0;const heard=preferredSpeechTranscript(e.results[i]);command(heard);if(voiceConversation&&!mobile)guide('أستمع للأمر التالي…','listening')}};rec.onerror=e=>{if(e.error==='no-speech'||e.error==='aborted')return;if(e.error==='network'&&voiceConversation&&!mobile&&voiceRestartAttempts<3){voiceRestartAttempts++;guide('انقطع اتصال التعرف الصوتي مؤقتًا؛ سأحاول مجددًا…','thinking');scheduleVoiceRestart(700*voiceRestartAttempts);return}const messages={'not-allowed':'لم يسمح المتصفح باستخدام الميكروفون. افتح إعدادات الموقع واسمح به ثم أعد المحاولة.','service-not-allowed':'خدمة التعرف الصوتي غير متاحة في هذا المتصفح. في iPhone استخدم Safari مع تفعيل Siri، أو جرّب Chrome على Android.','audio-capture':'لم يُعثر على ميكروفون يعمل. تحقق من توصيله وإعدادات الصوت.','network':'تعذر الاتصال بخدمة التعرف الصوتي. تحقق من اتصال الإنترنت ثم أعد المحاولة.','language-not-supported':'التعرف الصوتي العربي غير مدعوم في هذا المتصفح.'};stopVoiceConversation(messages[e.error]||`توقف التعرف الصوتي بسبب الخطأ: ${e.error}. تحقق من الميكروفون والاتصال ثم أعد المحاولة.`)};rec.onend=()=>{if(conversationRecognition===rec)conversationRecognition=null;if(voiceConversation&&mobile){voiceConversation=false;updateConversationButton();guide('تم إنهاء جلسة الجوال. اضغط «ابدأ الحوار الصوتي» للأمر التالي.')}else if(voiceConversation)scheduleVoiceRestart(350);else updateConversationButton()};try{rec.start()}catch(error){if(conversationRecognition===rec)conversationRecognition=null;if(voiceRestartAttempts<3&&!mobile){voiceRestartAttempts++;scheduleVoiceRestart(350*voiceRestartAttempts)}else stopVoiceConversation(`تعذر بدء التعرف الصوتي: ${error.message||'خطأ غير معروف'}. تحقق من الميكروفون والاتصال ثم أعد المحاولة.`)}}
function toggleVoiceConversation(){if(voiceConversation)return stopVoiceConversation();voiceConversation=true;updateConversationButton();beginVoiceConversation()}
function handleVoiceConversation(text){const ask=voiceText(text);if(/(?:اوقف|انهي|وقف|سكر|اطف).*(?:المحادثه|الحوار|الاستماع الصوتي)/.test(ask))return stopVoiceConversation();if(/(?:ابدا|شغل|فعل).*(?:المحادثه|الحوار|الاستماع الصوتي)/.test(ask)){if(!voiceConversation){voiceConversation=true;updateConversationButton();beginVoiceConversation()}return true}return false}
$('#conversationMic').onclick=toggleVoiceConversation;
  $('#guideSpeaker').onclick=()=>{setVoiceReplies(!voiceReplies,true);msg(voiceReplies?'الرد الصوتي مفعل.':'تم إيقاف الرد الصوتي.')};
window.addEventListener('open-standby',()=>guide('ما النصاب المستهدف للتدريس والانتظار؟ الافتراضي 20. بعد ذلك حدّد المستبعدين ثم قل «اضغط حساب وتطبيق أنصبة الانتظار».'));
window.addEventListener('open-standby-table',()=>guide('هذا جدول المنتظرين. يمكنك قول «اضغط طباعة جدول المنتظرين» أو التمرير بصوتك لمراجعة الأيام.'));
window.addEventListener('open-absence',()=>guide('من المعلم الغائب؟ ابحث باسمه أو قل «حدد غياب المعلم …»، ثم قل «تأكيد الغياب».'));

let smartTableImportFile=null;
async function smartTableFilePayload(file){
 const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
 for(let index=0;index<bytes.length;index+=0x8000)binary+=String.fromCharCode(...bytes.subarray(index,index+0x8000));
 return btoa(binary);
}
function contactPreviewList(items,empty){return items.length?`<ul class="muted">${items.slice(0,8).map(item=>`<li>${esc(item.name||item.teacherName||'')}</li>`).join('')}${items.length>8?`<li>و${items.length-8} أسماء أخرى</li>`:''}</ul>`:`<p class="muted">${empty}</p>`}
function bindTeacherContactsImport(){
 const input=$('#teacherContactsFile'),preview=$('#teacherContactsPreview');if(!input||!preview)return;
 input.onchange=async event=>{
  const file=event.target.files?.[0];preview.innerHTML='';if(!file)return;
  if(file.size>3000000){notice('الحد الأقصى لملف التقرير 3 ميجابايت.');input.value='';return}
  try{
   preview.textContent='جارٍ قراءة التقرير ومطابقة الأسماء…';
   const fileData=await smartTableFilePayload(file),result=await api('teacher-contacts-preview',{file:fileData});
   const teacherOptions=project.teachers.map(teacher=>`<option value="${esc(teacher.id)}">${esc(teacher.name)}</option>`).join('');
   preview.innerHTML=`<h3>معاينة التقرير — راجع المطابقة قبل الحفظ</h3><div class="stats"><div class="stat"><strong>${result.total}</strong><span>رقمًا صالحًا في التقرير</span></div><div class="stat"><strong>${result.matched.length}</strong><span>مطابقات مقترحة</span></div><div class="stat"><strong>${result.unmatched.length}</strong><span>تحتاج اختيارًا</span></div><div class="stat"><strong>${result.ambiguous.length}</strong><span>متشابهة</span></div></div><p class="muted">الورقة: ${esc(result.source.sheet)}. راجع كل صف: يمكنك تبديل المعلم من القائمة أو تركه دون اختيار لاستبعاده. لا تتغير الأسماء أو الأنصبة.</p><div class="scroll"><table><thead><tr><th>اسم التقرير</th><th>رقم الجوال</th><th>المعلم في النظام</th><th>الحالة</th></tr></thead><tbody>${result.rows.map((row,index)=>`<tr><td>${esc(row.name)}</td><td dir="ltr">${esc(row.phone)}</td><td><select data-contact-map="${index}"><option value="">— لا تحفظ هذا الصف —</option>${teacherOptions}</select></td><td>${row.status==='matched'?'مطابقة مقترحة':row.status==='ambiguous'?'اسم متشابه':'لم يُعثر على تطابق'}</td></tr>`).join('')}</tbody></table></div><button id="confirmTeacherContacts">حفظ الأرقام حسب الاختيارات</button>`;
   result.rows.forEach((row,index)=>{const select=preview.querySelector(`[data-contact-map="${index}"]`);if(select&&row.teacherId)select.value=row.teacherId});
   $('#confirmTeacherContacts')?.addEventListener('click',async()=>{
    const button=$('#confirmTeacherContacts');button.disabled=true;button.textContent='جارٍ الحفظ…';
    const mappings=Object.fromEntries(result.rows.map((row,index)=>[row.name,preview.querySelector(`[data-contact-map="${index}"]`)?.value||'']));
    try{const applied=await api('teacher-contacts-import',{file:fileData,revision:project.revision,mappings});project=applied.project;render();notice(`حُفظت أرقام جوال ${applied.summary.imported} معلمًا حسب المراجعة.${applied.summary.unmatched.length?` بقي ${applied.summary.unmatched.length} اسمًا غير مطابق في التقرير.`:''}`)}catch(error){button.disabled=false;button.textContent='حفظ الأرقام حسب الاختيارات';notice(error.message)}
   });
  }catch(error){input.value='';preview.innerHTML='';notice(error.message)}
 };
}
function bindSavedTeacherContacts(){
 if(contactsOutsideListener){document.removeEventListener('pointerdown',contactsOutsideListener);contactsOutsideListener=null}
 const panel=$('#savedTeacherContacts'),toggle=$('#toggleTeacherContacts');
 if(toggle)toggle.onclick=()=>{contactsPanelOpen=!contactsPanelOpen;render()};
 if(contactsPanelOpen&&panel){
  contactsOutsideListener=event=>{if(!panel.contains(event.target)){contactsPanelOpen=false;document.removeEventListener('pointerdown',contactsOutsideListener);contactsOutsideListener=null;render()}};
  setTimeout(()=>document.addEventListener('pointerdown',contactsOutsideListener),0);
 }
 const button=$('#saveTeacherContacts');if(!button)return;
 button.onclick=async()=>{
  const phones=Object.fromEntries([...document.querySelectorAll('[data-saved-contact]')].map(input=>[input.dataset.savedContact,input.value]));
  button.disabled=true;button.textContent='جارٍ حفظ الأرقام…';
  try{const result=await api('teacher-contacts-save',{revision:project.revision,phones});project=result.project;render();notice('حُفظت أرقام الجوال.')}catch(error){button.disabled=false;button.textContent='حفظ تعديل أرقام الجوال';notice(error.message)}
 };
}
function bindSmartTableImport(){
 const input=$('#smartTableFile'),preview=$('#smartTablePreview');
 if(!input||!preview)return;
 input.onchange=async event=>{
  const file=event.target.files?.[0];smartTableImportFile=null;preview.innerHTML='';
  if(!file)return;
  if(file.size>3000000){notice('الحد الأقصى لتصدير الجدول الذكي هو 3 ميجابايت.');input.value='';return}
  try{
   preview.textContent='جارٍ قراءة تصدير الجدول الذكي…';
   const fileData=await smartTableFilePayload(file),result=await api('smarttable-preview',{file:fileData}),summary=result.summary;
   smartTableImportFile={fileData,name:file.name};
   const warnings=summary.validationErrors?.length?`<p class="importWarning">تنبيه: ${esc(summary.validationErrors.join('، '))}</p>`:'';
   preview.innerHTML=`<h3>المعاينة جاهزة — لم تُغيَّر بيانات مدرستك</h3><div class="stats"><div class="stat"><strong>${summary.teachers}</strong><span>معلّمًا</span></div><div class="stat"><strong>${summary.classes}</strong><span>فصلًا</span></div><div class="stat"><strong>${summary.lessons}</strong><span>حصة في الجدول</span></div><div class="stat"><strong>${summary.waitingAssignments}</strong><span>تكليف انتظار مرتب</span></div></div><p>المدرسة: <strong>${esc(summary.school||'غير محددة')}</strong> — الجدول: <strong>${esc(summary.tableName||'مستورد')}</strong> — ${summary.days} أيام و${summary.slots} حصة أسبوعيًا.</p>${summary.skippedWaitingAssignments?`<p class="importWarning">تعذر ربط ${summary.skippedWaitingAssignments} تكليف انتظار لأنه لا يطابق معلمًا أو حصة في الملف.</p>`:''}${warnings}<button id="confirmSmartTableImport">اعتماد الاستيراد الكامل</button>`;
   $('#confirmSmartTableImport').onclick=async()=>{
    if(!smartTableImportFile)return;
    if(!confirm('سيستبدل هذا الاستيراد مسودة المدرسة الحالية بالجدول والمنتظرين المستوردين. هل تريد المتابعة؟'))return;
    const button=$('#confirmSmartTableImport');button.disabled=true;button.textContent='جارٍ اعتماد الجدول…';
    try{
     const result=await api('smarttable-import',{file:smartTableImportFile.fileData,revision:project.revision});
     project=result.project;step=5;unlocked=project.setupStep||6;teacher=project.teachers[0]?.id;assignmentTeacher=teacher;assignmentClass=project.classes[0]?.id;day=0;undo=[];smartTableImportFile=null;
     render();notice(`تم استيراد «${result.summary.tableName||'الجدول الذكي'}»: ${result.summary.lessons} حصة و${result.summary.waitingAssignments} تكليف انتظار بالترتيب المستورد. افتح «طباعة الجداول» أو «جدول المنتظرين» للمراجعة.`);
    }catch(error){button.disabled=false;button.textContent='اعتماد الاستيراد الكامل';notice(error.message)}
   };
  }catch(error){input.value='';preview.textContent='';notice(error.message)}
 };
}

let importedTeachers=[];
function bindImport(){
 const box=document.createElement('div');box.className='card';box.innerHTML=`<h2>استيراد أسماء المعلمين من Excel</h2><p class="muted">جهّز ملف Excel يحتوي على <strong>اسم المعلم</strong> و<strong>النصاب</strong> فقط كما في المثال. إذا احتوى الملف على أعمدة إضافية، يبحث البرنامج عن عمودي الاسم والنصاب مهما كان ترتيبهما ويتجاهل بقية الأعمدة. يُقبل عنوان «المعلم» للاسم و«عدد الحصص» للنصاب أيضًا. الاختصار يُنشئه البرنامج تلقائيًا، ولا يُؤخذ من ملف Excel. النصاب هو الحد الأعلى الأسبوعي لحصص المعلم. راجع المعاينة قبل الإضافة.</p><figure class="teacherImportExample"><img src="/assets/teacher-excel-example.png?v=3" alt="مثال بأسماء وهمية لملف Excel بعمودين: اسم المعلم، النصاب"><figcaption>مثال توضيحي بأسماء وبيانات وهمية.</figcaption></figure><p class="muted">لا تحتاج إلى أعمدة الإسنادات في هذا الملف؛ اربط المواد والفصول بالمعلمين داخل البرنامج بعد الاستيراد. جميع الأوقات متاحة مبدئيًا، ولا تُستورد إغلاقات الجدول القديم.</p><div class="toolbar"><label class="fileButton">اختيار ملف Excel<input id="teacherFile" type="file" accept=".xlsx"></label><button id="addTeacher" class="secondary">إضافة معلم يدويًا</button></div><div id="importPreview"></div>`;$('#content').prepend(box);
 $('#addTeacher').onclick=()=>{const name=prompt('اسم المعلم الكامل');if(!name?.trim())return;const names=new Set(project.teachers.map(t=>t.short));const words=name.trim().split(/\s+/);let short=words[0]+' '+words[words.length-1];if(names.has(short))short=name.trim();if(names.has(short))return notice('يوجد اسم أو اختصار مطابق. استخدم اسمًا مميزًا.');project.teachers.push({id:crypto.randomUUID(),name:name.trim(),short,max:24,blocked:[]});invalidate();render()};
 $('#teacherFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;if(file.size>3000000)return notice('الحد الأقصى 3 ميجابايت.');try{const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(const b of bytes)binary+=String.fromCharCode(b);const r=await api('import-teachers',{file:btoa(binary)});importedTeachers=r.teachers;$('#importPreview').innerHTML=`<h3>معاينة ${importedTeachers.length} معلمًا — لم تتم الإضافة بعد</h3><div class="scroll"><table><tr><th>الاسم</th><th>اختصار الطباعة</th><th>النصاب</th></tr>${importedTeachers.map(t=>`<tr><td>${esc(t.name)}</td><td>${esc(t.short)}</td><td>${t.max}</td></tr>`).join('')}</table></div><button id="confirmImport">إضافة المعلمين إلى المسودة</button>`;$('#confirmImport').onclick=()=>{const seen=new Set(project.teachers.map(t=>t.name)),shorts=new Set(project.teachers.map(t=>t.short));let added=0;for(const original of importedTeachers){const t=structuredClone(original);if(seen.has(t.name))continue;seen.add(t.name);if(shorts.has(t.short))t.short=t.name;if(shorts.has(t.short))t.short+=' '+t.id.slice(0,4);shorts.add(t.short);project.teachers.push(t);added++}importedTeachers=[];invalidate();render();notice(`أُضيف ${added} معلمًا. راجع النصاب ثم اربط المواد بالمعلمين.`)}}catch(e){notice(e.message)}};
}

const copilotDialog=document.createElement('dialog');copilotDialog.className='copilotDialog';copilotDialog.innerHTML=`<div class="toolbar"><h2>ربط مساعد الذكاء الاصطناعي</h2><button id="closeCopilotDialog" class="secondary" type="button">إغلاق</button></div><p class="muted">سجّل الدخول في GitHub ووافق على Copilot. لا تدخل كلمة مرورك هنا؛ يمر التفويض عبر GitHub مباشرة.</p><p id="copilotConnectionStatus" role="status">جارٍ فحص حالة الربط…</p><div class="toolbar"><button id="connectCopilot" type="button">متابعة مع GitHub Copilot</button><button id="testCopilot" type="button" class="secondary" disabled>اختبار الاتصال</button><button id="disconnectCopilot" type="button" class="secondary" hidden>فصل الحساب</button></div><section class="copilotProviderNote"><strong>ChatGPT</strong><span>ربط خطة ChatGPT بتطبيق مستضاف يحتاج موافقة OpenAI على Sign in with ChatGPT؛ لذلك الخيار غير مفعل حاليًا.</span></section><p id="copilotConnectionNotice" class="muted" role="status"></p>`;document.body.append(copilotDialog);
const COPILOT_ENABLED=false;
const copilotUi={csrf:'',connected:false,running:false};
function canAskCopilot(){return COPILOT_ENABLED&&copilotUi.connected&&!copilotUi.running}
function isOpenQuestion(text){const ask=voiceText(text);return /[؟?]\s*$/.test(text)||/^(?:كم|من(?!\s+(?:الحصه|\d))|ما|ماذا|هل|متى|اين|لماذا|ليش|كيف|وش|ايش|اشرح|لخص|قارن|اعطني|اذكر|اعرض لي|ما هي|ما هو)(?:\s|$)/.test(ask)}
const copilotConnectButton=document.createElement('button');copilotConnectButton.type='button';copilotConnectButton.id='assistantConnect';copilotConnectButton.className='secondary';copilotConnectButton.textContent='ربط المساعد';copilotConnectButton.hidden=!COPILOT_ENABLED;$('.headerButtons').prepend(copilotConnectButton);
async function refreshCopilotStatus(){const response=await fetch('/api/copilot/status',{cache:'no-store'}),data=await response.json();copilotUi.csrf=data.csrfToken||'';copilotUi.connected=!!data.connected;$('#connectCopilot').disabled=!data.configured;$('#testCopilot').disabled=!data.connected;$('#disconnectCopilot').hidden=!data.connected;$('#copilotConnectionStatus').textContent=!data.configured?'OAuth غير مهيأ في بيئة التطوير. راجع تعليمات إعداد GitHub OAuth في README.':data.connected?`متصل بحساب GitHub ${data.login||''}. استخدام Copilot يخضع لخطة هذا الحساب.`:'غير متصل. كل حساب GitHub يربط جلسته وحصته بصورة مستقلة.';$('#copilotConnectionNotice').textContent=data.scope==='local browser session only'?'هذه نسخة تطوير محلية بمدرسة واحدة؛ ربطها ليس إعداد عزل المدارس المنشور.':'';if(location.search.includes('copilot=connected'))$('#copilotConnectionNotice').textContent='اكتمل تفويض GitHub. يمكنك اختبار الاتصال.';if(location.search.includes('copilot=error'))$('#copilotConnectionNotice').textContent='لم يكتمل تسجيل الدخول. ابدأ الربط مجددًا.';return data}
async function copilotPost(path,body={}){const response=await fetch('/api/copilot/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':copilotUi.csrf},body:JSON.stringify(body)}),data=await response.json();if(!response.ok)throw Error((data.errors||['تعذر الطلب']).join('\n'));return data}
const copilotScreenCommands={school_data:'انتقل إلى بيانات المدرسة',time:'انتقل إلى الأيام والتوقيت',classes:'انتقل إلى الفصول والخطة',teachers:'انتقل إلى المعلمين',availability:'انتقل إلى الإتاحة',schedule:'انتقل إلى إنشاء الجدول',standby:'افتح إعداد حصص الانتظار',standby_table:'افتح جدول المنتظرين',absence:'افتح المعلم الغائب',print:'افتح الطباعة',saved_schedules:'افتح الجداول المحفوظة',edit_schedule:'افتح تعديل الجدول'};
function selectEditorTeacher(name){const teachers=resolveTeacherQuery(name,editTeacher);if(!teachers.length){msg(`لم أجد معلمًا باسم «${name}». قل اسمه الأول واسمًا آخر منه، أو اختره من القائمة.`);return}if(teachers.length>1){msg(`وجدت أكثر من معلم مطابق لـ«${name}»: ${teachers.slice(0,5).map(t=>t.name).join('، ')}. قل كلمة إضافية من اسمه؛ لا يلزم ذكر الاسم كاملًا.`);return}if(!project.placements.length){msg('أنشئ الجدول أولًا ثم أفتح محرر التعديل.');return}if(editTeacher!==teachers[0].id){selectedLesson=null;clearDrag()}editTeacher=teachers[0].id;if($('#editor')?.open){$('#editorBody').innerHTML=editTableView();bindEditor()}else{step=5;render();$('#openEditor')?.click()}msg(`عرضت جدول ${teachers[0].name} في محرر التعديل.`)}
function selectEditorTeacherByVoice(text){
 if(!$('#editor')?.open)return false;
 const ask=voiceText(text),explicit=ask.match(/^(?:(?:اختر|اختار|حدد|غير الى|بدل الى|انتقل الى)(?:\s+لي)?\s+(?:(?:ال)?معلم\s+)?|(?:ال)?معلم\s+)(.+)$/);
 const query=explicit?explicit[1].trim():ask;
 if(!query||!explicit&&query.split(/\s+/).length>4)return false;
 const matches=resolveTeacherQuery(query,editTeacher);
 if(!matches.length){if(explicit){msg(`لم أتعرف على المعلم «${query}». قل اسمه الأول واسمًا آخر منه كما يظهر في القائمة.`);return true}return false}
 selectEditorTeacher(query);
 return true;
}
function showTeacherSchedule(name){if($('#editor')?.open)selectEditorTeacher(name);else openTeacherScheduleIntent('جدول '+name)}
function dispatchCopilotActions(actions=[]){copilotUi.running=true;try{for(const action of actions){if(action?.type==='open_screen'&&copilotScreenCommands[action.screen])command(copilotScreenCommands[action.screen]);else if(action?.type==='open_teacher_schedule'&&typeof action.name==='string'&&action.name.trim())showTeacherSchedule(action.name.trim());else if(action?.type==='select_editor_teacher'&&typeof action.name==='string'&&action.name.trim())selectEditorTeacher(action.name.trim());else if(action?.type==='press_button'&&typeof action.label==='string'&&action.label.trim()){if(/حذف|مسح|تفريغ|اعاده ضبط/.test(voiceText(action.label)))msg('أزرار الحذف تحتاج أن تضغطها أنت بنفسك.');else if(!smartVoiceIntent('اضغط '+action.label.trim())&&!pressVoiceButton('اضغط '+action.label.trim()))msg(`لم أجد زرًا ظاهرًا باسم «${action.label}».`)}else if(action?.type==='run_command'&&typeof action.text==='string'&&action.text.trim()&&!/حذف|مسح|تفريغ|اعاده ضبط/.test(voiceText(action.text)))command(action.text.trim())}}finally{copilotUi.running=false}}
function askCopilot(text){guide('أفهم طلبك…','thinking');const controls=visibleVoiceControls().map(button=>button.textContent.trim()||button.getAttribute('aria-label')).filter(Boolean).slice(0,60);const prompt=`أجب بنص عادي فقط دون Markdown أو جداول أو نجوم أو عناوين؛ واذكر الحصص جملة جملة، وعند القوائم الطويلة اذكر أول 8 أسماء مع العدد الكلي. الشاشة الحالية: ${names[step]}.${$('#editor')?.open?` محرر التعديل مفتوح والمعلم المعروض فيه: ${project.teachers.find(t=>t.id===editTeacher)?.name||''}.`:''} عناصر الواجهة الظاهرة: ${controls.join('، ')}. طلب المستخدم: ${text}`;copilotPost('chat',{prompt}).then(result=>{dispatchCopilotActions(result.actions);if(result.reply)msg(result.reply);else if(!result.actions?.length)msg('لم يصل رد من Copilot.')}).catch(error=>msg(error.message))}
copilotConnectButton.onclick=async()=>{copilotDialog.showModal();$('#copilotConnectionNotice').textContent='';try{await refreshCopilotStatus()}catch(error){$('#copilotConnectionStatus').textContent=error.message}};
$('#closeCopilotDialog').onclick=()=>copilotDialog.close();
$('#connectCopilot').onclick=async()=>{try{if(!copilotUi.csrf)await refreshCopilotStatus();const result=await copilotPost('login');location.assign(result.authUrl)}catch(error){$('#copilotConnectionNotice').textContent=error.message}};
$('#testCopilot').onclick=async()=>{const button=$('#testCopilot');button.disabled=true;$('#copilotConnectionNotice').textContent='جارٍ التحقق من Copilot…';try{const result=await copilotPost('test');$('#copilotConnectionNotice').textContent=result.reply||'اكتمل اختبار الاتصال.'}catch(error){$('#copilotConnectionNotice').textContent=error.message}finally{button.disabled=!copilotUi.connected}};
$('#disconnectCopilot').onclick=async()=>{try{await copilotPost('disconnect');await refreshCopilotStatus();$('#copilotConnectionNotice').textContent='تم فصل حساب GitHub Copilot.'}catch(error){$('#copilotConnectionNotice').textContent=error.message}};
if(COPILOT_ENABLED)refreshCopilotStatus().catch(error=>{$('#copilotConnectionStatus').textContent='تعذر فحص حالة Copilot.';console.error(error)});

render();

window.standbyBridge={get:()=>project,accept:value=>{project=value;$('#saveStatus').textContent='حُفظت البيانات'},save:async value=>{project.standby=value;return await save()},notice};
