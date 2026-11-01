from pathlib import Path
p=Path(__file__).parent/'web'/'app.js'
s=p.read_text(encoding='utf-8')
s=s.replace("let project=await fetch('/api/project').then(r=>r.json()),step=0,unlocked=0", "let project=await fetch('/api/project').then(r=>r.json()),step=project.setupStep||0,unlocked=project.setupStep||0")
a=s.index('const templates=');b=s.index('\nconst api=',a)
s=s[:a]+"const templateData=await fetch('/api/templates').then(r=>r.json());\nconst templates=Object.fromEntries(gradeNames.map((g,i)=>[g,Object.entries(templateData.grades[i]).map(([subject,count])=>({subject,short:subject,count,pairs:0,room:''}))]));"+s[b:]
s=s.replace('بيانات الفزاري مستوردة للتجربة، ويمكنك تخصيصها قبل إنشاء الجدول.', 'ابدأ ببيانات مدرستك. لن تُضاف فصول أو أسماء معلمين إلا بعد إنشائها أو استيرادها بنفسك.')
s=s.replace('الخطة الحالية مستوردة من مدرستك.', 'اختر عدد الشعب ثم اضغط «إنشاء الفصول». يمكنك استخدام قالب الفزاري للفصل الأول أو تخصيص المواد يدويًا.')
s=s.replace("coursesTable(project.classes[0].id)","coursesTable(project.classes[0]?.id)")
s=s.replace("function coursesTable(cid){const courses=", "function coursesTable(cid){if(!cid){$('#courseTable').innerHTML='<p class=\"muted\">لم تُنشأ فصول بعد. أدخل عدد الشعب في النموذج أعلاه ثم اضغط إنشاء الفصول.</p>';return}const courses=")
s=s.replace('<button id="createClasses">تطبيق عدد الشعب</button>', '<button id="createClasses">إنشاء الفصول</button>')
s=s.replace("$('#addCourse').onclick=()=>{project.courses.push", "$('#addCourse').onclick=()=>{if(!project.classes.length)return notice('أنشئ الفصول أولًا.');project.courses.push")
s=s.replace("if(step===4){$('#teacherSelect')", "if(step===4&&project.teachers.length){$('#teacherSelect')")
s=s.replace("function availabilityView(){const t=", "function availabilityView(){if(!project.teachers.length)return '<div class=\"card\">استورد المعلمين في الخطوة السابقة أولًا.</div>';const t=")
s=s.replace('الجدول المستورد مرجع للتجربة.', 'يستخدم المولّد البيانات التي أنشأتها والإغلاقات التي حددتها فقط.')
s=s.replace("<p>لا توجد نتيجة حالية. أكمل البيانات ثم ابدأ التوليد.</p>","<p>بعد اكتمال الإسنادات يمكنك إنشاء الجدول. إذا تعذرت الشروط سنعرض حالة البحث دون اعتبارها أخطاء في أسماء المعلمين.</p>")
a=s.index('async function next()');b=s.index('\nfunction bind()',a)
s=s[:a]+'''async function next(){
 notice('');
 if(step===0&&(!project.school.name.trim()||!project.school.director.trim()||!project.school.year.trim()))return notice('أكمل اسم المدرسة والمدير والعام الدراسي.');
 if(step===2&&!project.classes.length)return notice('أدخل عدد الشعب واضغط إنشاء الفصول أولًا.');
 if(step>=2){const d=await api('validate',project);if(step===2)d.errors=d.errors.filter(e=>!e.startsWith('إسناد غير مكتمل:')&&e!=='أكمل الأيام والفصول والمعلمين.');if(d.errors.length)return notice(d.errors.slice(0,8).join('\\n')+(d.errors.length>8?'\\nوتوجد عناصر أخرى تحتاج الإكمال.':''));}
 const previous=project.setupStep||0;project.setupStep=Math.max(previous,step+1);
 if(!await save()){project.setupStep=previous;return}unlocked=project.setupStep;step++;render();window.scrollTo(0,0);
}'''+s[b:]
needle="function bind(){"
s=s.replace(needle,needle+"\n if(step===3)bindImport();")
s=s.replace("if(!r.placements){notice((r.errors||[r.status]).join('\\n'));return}","if(!r.placements){notice(r.status==='INFEASIBLE'?'لم يوجد توزيع يحقق الإسنادات والإغلاقات الحالية معًا. لم يتجاوز البرنامج أي شرط صارم. راجع الإتاحة أو الإسنادات؛ الأسماء ليست أخطاء.':(r.errors||[r.status]).slice(0,3).join('\\n'));return}")
# Append explicit import controls, with preview and no implicit application.
s=s.replace("render();\n", "render();\n",1)
extra='''
let importedTeachers=[];
function bindImport(){
 const box=document.createElement('div');box.className='card';box.innerHTML=`<h2>استيراد أسماء المعلمين من Excel</h2><p class="muted">اختر ملفك ثم راجع الأسماء قبل إضافتها. تُستورد الأسماء والاختصارات والنصاب فقط؛ جميع الأوقات متاحة مبدئيًا. لا تُستورد إغلاقات الجدول القديم.</p><div class="toolbar"><label class="fileButton">اختيار ملف Excel<input id="teacherFile" type="file" accept=".xlsx"></label><button id="addTeacher" class="secondary">إضافة معلم يدويًا</button></div><div id="importPreview"></div>`;$('#content').prepend(box);
 $('#addTeacher').onclick=()=>{const name=prompt('اسم المعلم الكامل');if(!name?.trim())return;const names=new Set(project.teachers.map(t=>t.short));const words=name.trim().split(/\\s+/);let short=words[0]+' '+words[words.length-1];if(names.has(short))short=name.trim();if(names.has(short))return notice('يوجد اسم أو اختصار مطابق. استخدم اسمًا مميزًا.');project.teachers.push({id:crypto.randomUUID(),name:name.trim(),short,max:24,blocked:[]});invalidate();render()};
 $('#teacherFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;if(file.size>3000000)return notice('الحد الأقصى 3 ميجابايت.');try{const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(const b of bytes)binary+=String.fromCharCode(b);const r=await api('import-teachers',{file:btoa(binary)});importedTeachers=r.teachers;$('#importPreview').innerHTML=`<h3>معاينة ${importedTeachers.length} معلمًا — لم تتم الإضافة بعد</h3><div class="scroll"><table><tr><th>الاسم</th><th>اختصار الطباعة</th><th>النصاب</th></tr>${importedTeachers.map(t=>`<tr><td>${esc(t.name)}</td><td>${esc(t.short)}</td><td>${t.max}</td></tr>`).join('')}</table></div><button id="confirmImport">إضافة المعلمين إلى المسودة</button>`;$('#confirmImport').onclick=()=>{const seen=new Set(project.teachers.map(t=>t.name)),shorts=new Set(project.teachers.map(t=>t.short));let added=0;for(const original of importedTeachers){const t=structuredClone(original);if(seen.has(t.name))continue;seen.add(t.name);if(shorts.has(t.short))t.short=t.name;if(shorts.has(t.short))t.short+=' '+t.id.slice(0,4);shorts.add(t.short);project.teachers.push(t);added++}importedTeachers=[];invalidate();render();notice(`أُضيف ${added} معلمًا. راجع النصاب ثم اربط المواد بالمعلمين.`)}}catch(e){notice(e.message)}};
}
'''
s=s.replace("p.scrollIntoView({block:'nearest'})","p.scrollIntoView({block:'nearest'})")
# Function declarations are hoisted, but initialize importedTeachers before first render.
last=s.rfind('render();')
s=s[:last]+extra+'\n'+s[last:]
p.write_text(s,encoding='utf-8')
