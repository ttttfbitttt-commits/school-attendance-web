const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function bindStandbyExcelImport(getProject, acceptProject, notice) {
 const input=document.querySelector('#standbyExcelFile'),box=document.querySelector('#standbyExcelPreview');
 if(!input||!box)return;
 let fileData='',summary=null,revision=null;
 const schedule=()=>{const p=getProject();return Object.fromEntries(['placements','slots','teachers','courses','days'].map(key=>[key,p[key]]))};
 const request=async(path,teachers)=>{
  const response=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({file:fileData,revision,schedule:schedule(),...(teachers?{teachers}:{})})});
  const data=await response.json();if(!response.ok)throw Error((data.errors||['تعذر تنفيذ الطلب.']).join('، '));return data;
 };
 const choices=()=>Object.fromEntries([...box.querySelectorAll('[data-waiting-name]')].map(select=>[select.dataset.waitingName,select.value]));
 function draw(){
  const teachers=getProject().teachers||[],matched=summary.matches.filter(item=>item.teacherId).length;
  box.innerHTML=`<h3>معاينة جدول المنتظرين</h3><p>قراءة ${summary.entries} تكليف انتظار؛ طُوبق ${matched} من أصل ${summary.matches.length} اسمًا. الخلايا الشاغرة تبقى بلا منتظر.</p>
   <p>طابِق الأسماء غير الواضحة يدويًا، ثم اضغط «التحقق من المطابقة». لا يُغيّر الاستيراد جدول الحصص أو سجلات الغياب السابقة.</p>
   <div class="scroll"><table><thead><tr><th>الاسم في الملف</th><th>المعلم في النظام</th><th>المطابقة</th></tr></thead><tbody>${summary.matches.map(item=>`<tr><td>${escapeHtml(item.name)}</td><td><select data-waiting-name="${escapeHtml(item.name)}"><option value="">اختر المعلم</option>${teachers.map(t=>`<option value="${escapeHtml(t.id)}" ${String(t.id)===item.teacherId?'selected':''}>${escapeHtml(t.name)}</option>`).join('')}</select></td><td>${item.auto?'تلقائية':item.teacherId?'محددة':'تحتاج مطابقة'}</td></tr>`).join('')}</tbody></table></div>
   ${summary.issues.length?`<div class="importWarning"><strong>تعارضات يجب تصحيحها قبل الاعتماد:</strong><ul>${summary.issues.map(issue=>`<li>${escapeHtml(issue)}</li>`).join('')}</ul></div>`:''}
   <p id="waitingImportMessage" role="status"></p><div class="toolbar"><button type="button" id="waitingRecheck" class="secondary">التحقق من المطابقة</button><button type="button" id="waitingApply" ${summary.unmatched||summary.issues.length?'disabled':''}>اعتماد جدول المنتظرين</button></div>`;
  const apply=box.querySelector('#waitingApply'),message=box.querySelector('#waitingImportMessage');
  box.querySelectorAll('[data-waiting-name]').forEach(select=>select.onchange=()=>{apply.disabled=true;message.textContent='تغيّرت المطابقة؛ اضغط «التحقق من المطابقة» قبل الاعتماد.'});
  box.querySelector('#waitingRecheck').onclick=async()=>{try{message.textContent='جارٍ التحقق…';const data=await request('standby-excel-preview',choices());summary=data.summary;draw()}catch(error){message.textContent=error.message}};
  apply.onclick=async()=>{
   if(!confirm('سيحل جدول الانتظار المستورد محل جدول الانتظار الحالي فقط، مع الاحتفاظ بسجلات الغياب السابقة. هل تريد الاعتماد؟'))return;
   apply.disabled=true;message.textContent='جارٍ اعتماد جدول المنتظرين…';
   try{const data=await request('standby-excel-import',choices());acceptProject(data.project);box.innerHTML=`<p>تم اعتماد ${data.count} تكليف انتظار بالترتيب الموجود في الملف. افتح «جدول المنتظرين» للمراجعة.</p>`;notice('تم استيراد جدول المنتظرين واعتماده.')}
   catch(error){message.textContent=error.message;apply.disabled=false}
  };
 }
 input.onchange=async()=>{
  const file=input.files?.[0];input.value='';box.innerHTML='';if(!file)return;
  if(file.size>3000000){box.textContent='حجم الملف أكبر من 3 ميجابايت.';return}
  try{
   box.textContent='جارٍ قراءة ملف الانتظار…';const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
   for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
   fileData=btoa(binary);revision=getProject().revision;
   const data=await request('standby-excel-preview');summary=data.summary;draw();
  }catch(error){box.textContent=error.message}
 };
}
