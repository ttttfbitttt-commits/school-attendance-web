// Keep this import in sync with the main command parser. An old cache version
// here made school-name and director commands behave differently after deploys.
import {cleanVoiceRequest} from '/voice-command.js?v=20';
export const schoolFieldAliases={
 // Keep the specific forms before the short forms.  This matters for
 // phrases such as "مدير المدرسة ...": the value must be captured as the
 // director's name, not mistaken for a school name.
 name:['اسم المدرس[ةه]','اسم مدرستي','اسم الدوام','المدرس[ةه] اسمها','مدرستي اسمها','تسمي[ةه] المدرس[ةه]','تسمية المدرس[ةه]','اسم المنش[أا][ةه]','اسم المؤسس[ةه]'],
 director:['اسم مدير[ةه] المدرس[ةه]','مدير[ةه] المدرس[ةه] اسمها','مدير[ةه] المدرس[ةه] اسمه','مدير[ةه] المدرس[ةه] هو','مدير[ةه] المدرس[ةه]','اسم قائد[ةه] المدرس[ةه]','قائد[ةه] المدرس[ةه] اسمها','قائد[ةه] المدرس[ةه] اسمه','قائد[ةه] المدرس[ةه] هو','قائد[ةه] المدرس[ةه]','اسم المدير','اسم مدير','المدير اسمه','المدير هو','اسم القائد','مديرها','قائدها','المدير'],
 year:['العام الدراسي','السن[ةه] الدراسي[ةه]','عام الدراس[ةه]','سن[ةه] الدراس[ةه]'],
 stage:['المرحل[ةه] الدراسي[ةه]','المرحل[ةه] التعليمي[ةه]','مرحل[ةه] المدرس[ةه]','المرحل[ةه]'],
 term:['الفصل الدراسي','الترم الدراسي','الترم','الفصل'],
};
export function parseSchoolVoiceField(text){
 const raw=cleanVoiceRequest(text);
 const prefix='(?:(?:غير|عدل|اكتب|أكتب|سجل|حدد|اجعل|إجعل|خلي|خل|حط|سم|سمي|اضبط|ضبط|عين|حط لي|اكتب لي)\\s+)?(?:(?:في\\s+)?(?:خانه|خانة|حقل)\\s+)?';
 for(const [field,labels] of Object.entries(schoolFieldAliases)){
   const match=raw.match(new RegExp('^'+prefix+'(?:'+labels.join('|')+')\\s*(?:[:،]\\s*)?(?:(?:إلى|الى|إلي|الي|على|علي|هو|هي|يكون|تكون|ليصبح|ليكون)\\s+)?(.+)$'));
   if(!match)continue;
   let value=match[1].trim();
   if(field==='stage'){
     const key=value.replace(/[إأآ]/g,'ا').replace(/ة/g,'ه').replace(/^(?:ال|تعليم\s+)/,'');
     value=/^(?:ابتدائي|ابتدائيه)$/.test(key)?'ابتدائي':/^(?:متوسط|متوسطه)$/.test(key)?'متوسط':/^(?:ثانوي|ثانويه)$/.test(key)?'ثانوي':'';
   }
   if(field==='term'){
     const key=value.replace(/[إأآ]/g,'ا').replace(/ة/g,'ه').replace(/^ال/,'');
     value={اول:'الأول',اولي:'الأول',واحد:'الأول','1':'الأول',ثاني:'الثاني',ثانيه:'الثاني',اثنين:'الثاني','2':'الثاني',ثالث:'الثالث',ثالثه:'الثالث',ثلاثه:'الثالث','3':'الثالث'}[key]||'';
   }
   if(field==='year'&&!/^[0-9]{4}(?:\s*[-\/]\s*[0-9]{4})?$/.test(value))value='';
   if(value)return {field,value};
 }
 return null;
}
