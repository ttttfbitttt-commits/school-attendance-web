from pathlib import Path
p=Path('web/app.js');s=p.read_text(encoding='utf-8')
s=s.replace('project.placements=[];notice(', 'project.solverHint=structuredClone(project.placements);project.placements=[];notice(')
s=s.replace('draggable="${!teacherId}"','draggable="false" tabindex="0" role="button" aria-label="اسحب الحصة لتعديل موضعها"')
a=s.index("document.querySelectorAll('[data-drag]').forEach(e=>e.ondragstart")
b=s.index('\n}',a)
s=s[:a]+'bindLessonDrag()}'+s[b:]
s=s.replace('بقية تفضيلات الجودة وإظهار عدة بدائل للتبديل قيد التطوير.','اسحب باليد وأفلت في حصة أخرى لعرض بدائل بسيطة أو مركبة ومعاينة جداول المعلمين قبل التنفيذ. اضغط على الحصة ثم الوجهة كبديل للسحب.')
a=s.index('function showPreview(');b=s.index("$('#next').onclick",a)
s=s[:a]+'''let swapChoices=[],swapBefore=[],swapIndex=0,moveRequest=null;
function weekPreview(positions,tid,changed){
 const width=Math.max(...project.days.map(d=>d.count));
 return `<table class="weekPreview"><thead><tr><th>اليوم</th>${Array.from({length:width},(_,i)=>`<th>${i+1}</th>`).join('')}</tr></thead><tbody>${project.days.map((d,di)=>`<tr><th>${esc(d.name)}</th>${Array.from({length:width},(_,i)=>{const slot=project.slots.findIndex(x=>x.day===di&&x.period===i);const p=positions.find(p=>p.slot===slot&&project.courses.find(c=>c.id===p.courseId)?.teacherId===tid);const c=p&&project.courses.find(c=>c.id===p.courseId);return `<td class="${p&&changed.has(p.courseId+'|'+slot)?'changed':''}">${c?`${esc(project.classes.find(cl=>cl.id===c.classId).name)}<small>${esc(c.short||c.subject)}</small>`:slot<0?'—':'فراغ'}</td>`}).join('')}</tr>`).join('')}</tbody></table>`
}
function drawSwap(){
 const choice=swapChoices[swapIndex];pending=choice.placements;
 const beforeSet=new Set(swapBefore.map(p=>p.courseId+'|'+p.slot)),afterSet=new Set(pending.map(p=>p.courseId+'|'+p.slot));
 const added=new Set(pending.filter(p=>!beforeSet.has(p.courseId+'|'+p.slot)).map(p=>p.courseId+'|'+p.slot));
 const removed=new Set(swapBefore.filter(p=>!afterSet.has(p.courseId+'|'+p.slot)).map(p=>p.courseId+'|'+p.slot));
 const ids=[...new Set(pending.filter(p=>added.has(p.courseId+'|'+p.slot)).map(p=>project.courses.find(c=>c.id===p.courseId).teacherId))];
 $('#previewBody').innerHTML=`<h2>خيارات تعديل الحصة</h2><p>اختر بديلًا ثم راجع الجداول قبل التنفيذ. الخلايا الملوّنة توضح ما سيتغير.</p><div class="swapChoices">${swapChoices.map((o,i)=>`<button data-choice="${i}" class="${i===swapIndex?'selected':'secondary'}">${o.kind}<small>${o.movedLessons} حصص • ${o.affectedTeachers} معلمين</small></button>`).join('')}</div><p class="muted">بسيط: حصتان أو أقل. مركب: 3–4 حصص. مركب مضاعف: 5 حصص فأكثر. هذه بدائل اكتشفها البحث خلال مهلة قصيرة، وليست حصرًا لجميع الاحتمالات.</p>${ids.map(t=>`<section class="card"><h3>${esc(project.teachers.find(x=>x.id===t).name)}</h3><div class="pair"><div><h4>قبل التعديل</h4>${weekPreview(swapBefore,t,removed)}</div><div><h4>بعد التعديل — ${choice.kind}</h4>${weekPreview(pending,t,added)}</div></div></section>`).join('')}`;
 document.querySelectorAll('[data-choice]').forEach(b=>b.onclick=()=>{swapIndex=Number(b.dataset.choice);drawSwap()});$('#applySwap').disabled=false;
}
async function requestSwap(move){
 if(busy)return;busy=true;swapBefore=structuredClone(project.placements);moveRequest=move;pending=null;
 $('#previewBody').innerHTML='<h2>البحث عن خيارات التعديل…</h2><p>نفحص التبديل البسيط وسلاسل النقل مع الحفاظ على الإغلاقات والأنصبة.</p>';$('#applySwap').disabled=true;$('#preview').showModal();
 try{const {jobId}=await api('swaps',{project,move});let r;do{await new Promise(resolve=>setTimeout(resolve,120));r=await fetch('/api/jobs/'+jobId).then(r=>r.json())}while(r.status==='RUNNING');
 if(!$('#preview').open)return;
 if(!r.options?.length){$('#previewBody').innerHTML=`<h2>${r.status==='INFEASIBLE'?'لا يوجد تبديل يحقق القيود الحالية':'لم يُعثر على بديل خلال مهلة البحث'}</h2><p>${esc((r.errors||[]).join(' '))}</p>`;return}
 swapChoices=r.options;swapIndex=0;drawSwap();
 }catch(e){$('#previewBody').innerHTML=`<p>${esc(e.message)}</p>`}finally{busy=false}
}
$('#applySwap').onclick=()=>{if(!pending||busy)return;undo.push(structuredClone(project));project.placements=pending;pending=null;$('#preview').close();$('#saveStatus').textContent='تغييرات غير محفوظة';render();notice('طُبق التعديل في المسودة. يمكنك التراجع أو حفظه.');};
$('#cancelSwap').onclick=()=>{pending=null;$('#preview').close()};
$('#preview').addEventListener('cancel',()=>{pending=null});
let pointerMove=null,dragGhost=null,selectedLesson=null,hoverDay=null;
function clearDrag(){document.body.classList.remove('draggingLesson');dragGhost?.remove();dragGhost=null;document.querySelectorAll('.dropReady,.dropInvalid,.lessonSelected').forEach(x=>x.classList.remove('dropReady','dropInvalid','lessonSelected'));}
function dropOn(cell,source){if(!cell)return;const c=project.courses.find(c=>c.id===source.courseId);if(cell.dataset.class!==c.classId)return notice('اختر موضعًا داخل الفصل نفسه؛ نقل الحصة لفصل آخر يغير الإسناد.');const slot=Number(cell.dataset.drop);if(slot!==source.sourceSlot)requestSwap({...source,slot});}
function bindLessonDrag(){
 document.querySelectorAll('#content [data-drag]').forEach(el=>{
 el.onpointerdown=e=>{if(busy||e.button!==0)return;pointerMove={courseId:el.dataset.drag,sourceSlot:Number(el.dataset.slot),x:e.clientX,y:e.clientY,text:el.innerText,active:false};};
 el.onclick=e=>{if(pointerMove?.active)return;if(selectedLesson){const source=selectedLesson;selectedLesson=null;clearDrag();dropOn(el.closest('[data-drop]'),source)}else{selectedLesson={courseId:el.dataset.drag,sourceSlot:Number(el.dataset.slot)};el.classList.add('lessonSelected');notice('اختر موضع الحصة المطلوب، أو اسحبها باليد.')}};
 el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();el.click()}};
 });
}
document.addEventListener('pointermove',e=>{
 if(!pointerMove)return;const m=pointerMove;
 if(!m.active&&Math.hypot(e.clientX-m.x,e.clientY-m.y)<6)return;
 if(!m.active){m.active=true;selectedLesson=null;document.body.classList.add('draggingLesson');dragGhost=document.createElement('div');dragGhost.className='dragGhost';dragGhost.textContent=m.text;document.body.append(dragGhost)}
 e.preventDefault();dragGhost.style.left=(e.clientX+14)+'px';dragGhost.style.top=(e.clientY+14)+'px';
 document.querySelectorAll('.dropReady,.dropInvalid').forEach(x=>x.classList.remove('dropReady','dropInvalid'));
 const hit=document.elementFromPoint(e.clientX,e.clientY),cell=hit?.closest('#content [data-drop]');
 if(cell)cell.classList.add(cell.dataset.class===project.courses.find(c=>c.id===m.courseId).classId?'dropReady':'dropInvalid');
 const tab=hit?.closest('[data-view-day]');if(tab){const d=Number(tab.dataset.viewDay);if(d!==day&&hoverDay!==d){hoverDay=d;setTimeout(()=>{if(pointerMove?.active&&hoverDay===d){day=d;render()}},450)}}else hoverDay=null;
 const sc=hit?.closest('.scroll');if(sc){const r=sc.getBoundingClientRect();if(e.clientY>r.bottom-36)sc.scrollTop+=15;if(e.clientY<r.top+36)sc.scrollTop-=15;}
},{passive:false});
document.addEventListener('pointerup',e=>{if(!pointerMove)return;const m=pointerMove;if(m.active){const cell=document.elementFromPoint(e.clientX,e.clientY)?.closest('#content [data-drop]');clearDrag();dropOn(cell,m);setTimeout(()=>{pointerMove=null},0)}else pointerMove=null;hoverDay=null;});
document.addEventListener('pointercancel',()=>{pointerMove=null;clearDrag()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){pointerMove=null;selectedLesson=null;clearDrag()}});
''' +s[b:]
p.write_text(s,encoding='utf-8')
p=Path('web/style.css');s=p.read_text(encoding='utf-8');s+='''
.lesson{touch-action:none;user-select:none;cursor:grab}.lesson:active,.draggingLesson,.draggingLesson *{cursor:grabbing!important}.lessonSelected,.dropReady{outline:3px solid #079984!important;background:#d7f6e8!important}.dropInvalid{outline:2px dashed #d88a7d}.dragGhost{position:fixed;z-index:10000;pointer-events:none;white-space:pre-line;background:#087e72;color:white;padding:12px 18px;border-radius:12px;box-shadow:0 8px 25px #1238;max-width:210px;opacity:.94}.swapChoices{display:flex;gap:12px;flex-wrap:wrap;margin:20px 0}.swapChoices button{min-width:160px}.swapChoices small{display:block;color:inherit;margin-top:8px}.swapChoices .selected{outline:3px solid #b0dfc8}.weekPreview{table-layout:fixed}.weekPreview td,.weekPreview th{font-size:10px;border:1px solid #dce7e3;padding:8px 3px;text-align:center;overflow-wrap:anywhere}.weekPreview small{display:block}.weekPreview .changed{background:#fff0c4;outline:2px solid #e8b941}dialog h4{margin:10px 0}.dialogActions{z-index:2}dialog .card{overflow:auto}body:has(#preview[open]) .assistant{visibility:hidden}
''';p.write_text(s,encoding='utf-8')
p=Path('web/index.html');p.write_text(p.read_text(encoding='utf-8').replace('?v=2','?v=3'),encoding='utf-8')
