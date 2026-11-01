// Convert common spoken phrasing into the existing command grammar.
// Replacements are anchored to command labels, never to arbitrary dictated names.
export function cleanVoiceRequest(value){
 let text=String(value||'').normalize('NFKC').replace(/[\u064B-\u065F\u0670ـ]/g,'').replace(/[٠-٩۰-۹]/g,c=>'٠١٢٣٤٥٦٧٨٩'.includes(c)?'٠١٢٣٤٥٦٧٨٩'.indexOf(c):'۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/\s+/g,' ').trim();
 // Do this only at the beginning so names dictated after the command stay intact.
 // The list deliberately includes common Saudi conversational openers, not names.
 for(let i=0;i<5;i++)text=text.replace(/^(?:آمرني وأنا أنفذ|يا الجدول الصوتي|الجدول الصوتي|يا آمرني|آمرني|يا نسق|يا مرشد|يا مساعد|مرشد نسق|يا طويل العمر|يا بعد حيي|يا الغالي|يا الغالية|يا حبيب|يا حبيبي|يا بعدي|ابشر|أبشر|الله يسلمك|الله يعافيك|لا هنت|لا هنتي|تكفى|تكفين|عساك بخير|لو سمحت|من فضلك|اذا سمحت|إذا سمحت|لو تكرمت|ممكن|تقدر|تكدر|هل يمكنك|اريد ان|أريد أن|ابي|أبي|ابيه|أبيه|ابغى|أبغى|ابغا|أبغا|ابغي|أبغي|ودي|ودي منك|ابي منك|ابغى منك|خلني|خليني|خلنا|يلا|طيب|بالله|باللّه)\s+/,'');
 return text.replace(/\s+(?:لو سمحت|من فضلك|الله يعافيك|آمرني وأنا أنفذ|يا الجدول الصوتي|الجدول الصوتي|يا آمرني|آمرني|يا نسق|يا مرشد)[.؟!]*$/,'').replace(/[.؟!]+$/,'').trim();
}
export function voiceNumber(value){
 const word=String(value).replace(/[إأآ]/g,'ا').replace(/[ةه]$/,'').replace(/ى/g,'ي').replace(/^ال/,'').trim();
 const numbers={صفر:0,واحد:1,واحده:1,وحده:1,اولا:1,اول:1,اولي:1,حادي:1,اثنان:2,اثنين:2,اثنتين:2,اتنين:2,ثنين:2,ثنتين:2,ثانيا:2,ثاني:2,ثنتان:2,ثلاث:3,ثلاثه:3,ثالثا:3,ثالث:3,اربع:4,اربعه:4,رابعا:4,رابع:4,خمس:5,خمسه:5,خامسا:5,خامس:5,ست:6,سته:6,سادسا:6,سادس:6,سبع:7,سبعه:7,سابعا:7,سابع:7,ثمان:8,ثماني:8,ثمانيه:8,ثامنا:8,ثامن:8,تسع:9,تسعه:9,تاسعا:9,تاسع:9,عشر:10,عشره:10,عاشرا:10,عاشر:10,عشرين:20,عشرون:20,ثلاثين:30,ثلاثون:30,اربعين:40,اربعون:40,خمسين:50,خمسون:50,ستين:60,ستون:60};
 if(/^\d+$/.test(word))return Number(word);
 if(Object.prototype.hasOwnProperty.call(numbers,word))return numbers[word];
 const pair=word.match(/^(.+?)\s+و\s*(.+)$/);
 if(pair){const a=voiceNumber(pair[1]),b=voiceNumber(pair[2]);if(a>=1&&a<=9&&b>=20&&b%10===0)return a+b}
 const teen=word.match(/^(.+?)\s+عشر[ةه]?$/);
 if(teen){const first=voiceNumber(teen[1]);if(first>=1&&first<=9)return first+10}
 return NaN;
}
function classTokenText(value){
 return String(value||'').normalize('NFKC').replace(/[\u064B-\u065F\u0670ـ]/g,'').replace(/[إأآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/[٠-٩۰-۹]/g,c=>'٠١٢٣٤٥٦٧٨٩'.includes(c)?'٠١٢٣٤٥٦٧٨٩'.indexOf(c):'۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/[^\p{L}\p{N}\s]/gu,' ').toLowerCase().replace(/\s+/g,' ').trim();
}
const classGrades=new Map([
 ['اول','اول'],['اولا','اول'],['اولي','اول'],['الاول','اول'],['الاولى','اول'],['الاولي','اول'],['الاوليه','اول'],
 ['ثاني','ثاني'],['ثانيا','ثاني'],['ثانيه','ثاني'],['الثاني','ثاني'],['الثانيه','ثاني'],
 ['ثالث','ثالث'],['ثالثا','ثالث'],['ثالثه','ثالث'],['الثالث','ثالث'],['الثالثه','ثالث'],
 ['رابع','رابع'],['رابعا','رابع'],['رابعه','رابع'],['الرابع','رابع'],['الرابعه','رابع'],
 ['خامس','خامس'],['خامسا','خامس'],['خامسه','خامس'],['الخامس','خامس'],['الخامسه','خامس'],
 ['سادس','سادس'],['سادسا','سادس'],['سادسه','سادس'],['السادس','سادس'],['السادسه','سادس'],
]);
const classStages=new Set(['ثانوي','المتوسط','متوسط','الابتدائي','ابتدائي']);
function classGradeAt(token){return classGrades.get(token)||token.startsWith('و')&&classGrades.get(token.slice(1))||''}
function classSectionAt(tokens,index){
 if(index<0||index>=tokens.length)return null;
 const token=tokens[index].startsWith('و')&&Number.isInteger(voiceNumber(tokens[index].slice(1)))?tokens[index].slice(1):tokens[index],one=voiceNumber(token);
 if(Number.isInteger(one)&&one>0)return {section:one,end:index+1};
 if(index+1<tokens.length){
  const next=tokens[index+1].startsWith('و')?tokens[index+1].slice(1):tokens[index+1],combined=voiceNumber(`${token} ${next}`);
  if(Number.isInteger(combined)&&combined>0)return {section:combined,end:index+2};
 }
 return null;
}
export function findClassReferences(value){
 const text=classTokenText(value),tokens=[...text.matchAll(/\S+/g)].map(match=>({value:match[0],start:match.index,end:match.index+match[0].length}));
 const references=[];
 for(let index=0;index<tokens.length;index++){
  const grade=classGradeAt(tokens[index].value);
  if(grade){
   let sectionIndex=index+1;
   while(sectionIndex<tokens.length&&(classStages.has(tokens[sectionIndex].value)||['فصل','الفصل','شعبه','شعبه','شعب','و','ثم'].includes(tokens[sectionIndex].value)))sectionIndex++;
   const section=classSectionAt(tokens.map(token=>token.value),sectionIndex);
   if(section)references.push({key:`${grade}|${section.section}`,start:tokens[index].start,end:tokens[section.end-1].end,text:text.slice(tokens[index].start,tokens[section.end-1].end)});
  }
  const section=classSectionAt(tokens.map(token=>token.value),index);
  if(section&&!classGradeAt(tokens[index].value)&&!(index>0&&classGradeAt(tokens[index-1].value))){
   let gradeIndex=section.end;
   while(gradeIndex<tokens.length&&(classStages.has(tokens[gradeIndex].value)||['فصل','الفصل','شعبه','شعب','و','ثم'].includes(tokens[gradeIndex].value)))gradeIndex++;
   const reverseGrade=classGradeAt(tokens[gradeIndex]?.value||'');
   if(reverseGrade)references.push({key:`${reverseGrade}|${section.section}`,start:tokens[index].start,end:tokens[gradeIndex].end,text:text.slice(tokens[index].start,tokens[gradeIndex].end)});
  }
 }
 return [...new Map(references.map(reference=>[`${reference.start}|${reference.end}|${reference.key}`,reference])).values()].sort((a,b)=>a.start-b.start);
}
export function parseClassAssignmentIntent(value){
 const text=classTokenText(value),removal=text.match(/^(?:الغي|الغاء|الغ|شيل|شيلها|احذف|ازل|فك|الغى|الغاء\s+الاسناد|فك\s+الاسناد|شيل\s+الاسناد|لا\s+تسند)\s+(.+)$/);
 const body=removal?removal[1]:text,exception=body.match(/\s+(?:ما\s+عدا|ماعدا|عدا|الا|باستثناء|استثناء)\s+/),primary=exception?body.slice(0,exception.index).trim():body,excluded=exception?body.slice(exception.index+exception[0].length).trim():'';
 const allTerms=/^(?:كلهم|كلهن|كلها|كلها|جميعا|جميعهم|جميعهن|كافه|كافه الفصول|كل الفصول|جميع الفصول|جميع فصول|كل فصل|كل فصول|فصولها|كامل(?:ه)?|كامل الفصول)$/;
 const gradeTokens=[...primary.matchAll(/\S+/g)].map(match=>({value:match[0],start:match.index,end:match.index+match[0].length,grade:classGradeAt(match[0])})).filter(item=>item.grade);
 const groupWords=primary.split(/\s+/).some(word=>['كل','جميع','كافه','كامل','فصول','الفصول','كلهم','كلهن','جميعا','جميعهم','جميعهن'].includes(word))||allTerms.test(primary);
 const hasGroup=gradeTokens.length>0&&groupWords;
 const references=findClassReferences(primary),excludedReferences=excluded?findClassReferences(excluded):[];
 const recognized=!!removal||hasGroup||references.length>0&&/^(?:اسند|اسناد|اربط|ربط|كلف|كلفني|عين|خصص|وزع|حط|خل|خلي|سجل|اضف|ضيف|حدد|اختر|اختار|الغ|الغي|شيل|احذف|ازل|فك)(?:\s|$)/.test(text);
 if(!recognized)return null;
 const grades=hasGroup?[...new Set(gradeTokens.map(item=>item.grade))]:[];
 return {
  remove:!!removal,
  group:hasGroup,
  grades,
  classKeys:references.map(reference=>reference.key),
  excludedKeys:excludedReferences.map(reference=>reference.key),
  hasException:!!exception,
 };
}
export function resolveClassAssignmentTargets(intent,classes){
 const excluded=new Set(intent.excludedKeys);
 return classes.filter(item=>{
  const key=findClassReferences(item.name)[0]?.key||'';
  const grade=key.split('|')[0];
  return (intent.group?intent.grades.includes(grade):intent.classKeys.includes(key))&&!excluded.has(key);
 });
}
export function parseClassAdditions(value,stage,grades,currentCounts){
 const text=cleanVoiceRequest(value).replace(/[إأآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').toLowerCase();
 const request=text.match(/^(?:اضف|زيد|زود)\s+(.+)$/);
 if(!request)return null;
 const gradeIndexes={الاول:0,اول:0,الثاني:1,ثاني:1,الثالث:2,ثالث:2,الرابع:3,رابع:3,الخامس:4,خامس:4,السادس:5,سادس:5};
 const stageNames={ثانوي:'ثانوي',متوسط:'متوسط',ابتدائي:'ابتدائي'};
 const globalStage=Object.keys(stageNames).find(name=>new RegExp('(?:^|\\s)'+name+'(?:\\s|$)').test(request[1]));
 const requested=new Map();
 const numberWords='واحد|واحده|ثلاث|ثلاثه|اربع|اربعه|خمس|خمسه|ست|سته|سبع|سبعه|ثمان|ثماني|ثمانيه|تسع|تسعه';
 const pattern=new RegExp('(?:^|\\s|و)(الاول|اول|الثاني|ثاني|الثالث|ثالث|الرابع|رابع|الخامس|خامس|السادس|سادس)(?:\\s+(?:ال)?(ثانوي|متوسط|ابتدائي))?(?:\\s+('+numberWords+'|[0-9]+))?(?:\\s+(?:فصل|فصول|شعب[هة]?))?(?=\\s|و|$)','g');
 for(const match of request[1].matchAll(pattern)){
  const index=gradeIndexes[match[1]],spokenStage=match[2]&&stageNames[match[2]],effectiveStage=spokenStage||globalStage;
  if(index>=grades.length||effectiveStage&&effectiveStage!==stage)continue;
  const count=match[3]?voiceNumber(match[3]):null;
  requested.set(index,Number.isInteger(count)&&count>0?{count,added:false}:{count:currentCounts[index]+1,added:true});
 }
 if(!requested.size)return null;
 return {
  counts:grades.map((_,index)=>requested.get(index)?.count||0),
  grades:[...requested.keys()].map(index=>grades[index]),
  addedGrades:[...requested].filter(([,value])=>value.added).map(([index])=>grades[index]),
  configuredGrades:[...requested].filter(([,value])=>!value.added).map(([index])=>grades[index]),
 };
}
function teacherNameText(value){
 return String(value||'').normalize('NFKC').replace(/[\u064B-\u065F\u0670ـ]/g,'').replace(/[إأآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/[^\p{L}\p{N}\s]/gu,' ').toLowerCase().replace(/\s+/g,' ').trim();
}
function editDistanceAtMostOne(first,second){
 if(Math.abs(first.length-second.length)>1)return false;
 let left=0,right=0,differences=0;
 while(left<first.length&&right<second.length){
  if(first[left]===second[right]){left++;right++;continue}
  if(++differences>1)return false;
  if(first.length>second.length)left++;
  else if(second.length>first.length)right++;
  else{left++;right++}
 }
 return differences+(left<first.length||right<second.length?1:0)<=1;
}
function teacherNameTokens(value){
 // Speech recognition commonly joins "عبد العزيز" and "عبد الله", removes
 // "بن", or hears a title before the name.  Keep several equivalent token
 // forms so a partial spoken name is useful but never guessed when ambiguous.
 const ignored=new Set(['المعلم','معلم','المدرس','مدرس','الاستاذ','استاذ','الشيخ','شيخ','الدكتور','دكتور','الاخ','اخ','الاستاذه','استاذه','المعلمة','معلمه','المدرسه','مدرسه']);
 const normalizeWord=word=>{
  if(ignored.has(word)||word==='بن'||word==='ابن'||word==='بنت')return '';
  if(word==='الله')return word;
  if(word.length>4&&word.startsWith('ال'))return word.slice(2);
  return word;
 };
 const words=teacherNameText(value).split(' ').map(normalizeWord).filter(word=>word.length>1),variants=[words];
 for(let index=0;index<words.length;index++){
  const word=words[index];
  if(word.startsWith('عبد')&&word.length>5){
   const remainder=normalizeWord(word.slice(3));
   if(remainder.length>1){
    const splitVariant=[...words.slice(0,index),'عبد',remainder,...words.slice(index+1)];
    variants.push(splitVariant);
   }
  }
  if(words[index]==='عبد'&&words[index+1]){
   variants.push([...words.slice(0,index),words[index]+words[index+1],...words.slice(index+2)]);
  }
  if(word.startsWith('ابو')&&word.length>3){
   variants.push([...words.slice(0,index),'ابو',word.slice(3),...words.slice(index+1)]);
  }
  if(word==='ابو'&&words[index+1]){
   variants.push([...words.slice(0,index),word+words[index+1],...words.slice(index+2)]);
  }
 }
 return [...new Map(variants.map(tokens=>[tokens.join(' '),tokens])).values()];
}
export function matchTeacherNames(teachers,query){
 const cleaned=teacherNameText(query).replace(/^(?:(?:ال)?معلم(?:ه)?|(?:ال)?مدرس(?:ه)?|(?:ال)?استاذ(?:ه)?|(?:ال)?شيخ|(?:ال)?دكتور)\s+/,'');
 const wantedVariants=teacherNameTokens(cleaned);
 if(!wantedVariants.some(tokens=>tokens.length))return [];
 const queryWords=teacherNameTokens(cleaned)[0]||[],singleTokenQuery=queryWords.length===1||queryWords.length===2&&queryWords[0]==='عبد';
 const scored=teachers.map(teacher=>{
  const nameVariants=teacherNameTokens(teacher.name);
  let score=0;
  for(const wanted of wantedVariants){
   for(const name of nameVariants){
    if(singleTokenQuery&&name.some((_,start)=>wanted.every((word,index)=>name[start+index]===word))){
     score=Math.max(score,500);
    }else if(wanted.length===1){
     if(name.includes(wanted[0]))score=Math.max(score,500);
     else if(name.some(word=>Math.min(word.length,wanted[0].length)>=3&&(word.includes(wanted[0])||wanted[0].includes(word))))score=Math.max(score,400);
    }else if(wanted.every((word,index)=>name[index]===word)){
     score=Math.max(score,1000);
    }else if(wanted.length===2&&name[0]===wanted[0]&&name[name.length-1]===wanted[1]){
     score=Math.max(score,950);
    }else if(wanted.length>2&&wanted.slice(0,-1).every((word,index)=>name[index]===word)&&name[name.length-1]===wanted[wanted.length-1]){
     score=Math.max(score,950);
    }else if(name.some((_,start)=>wanted.every((word,index)=>name[start+index]===word))){
     score=Math.max(score,900);
    }else if(wanted.length>=2&&wanted.every(word=>name.includes(word))){
     // A middle "بن" or a spoken honorific must not stop a full two-word
     // match.  We still keep ties, allowing the caller to ask for a detail.
     score=Math.max(score,850+Math.min(wanted.length,8));
    }else if(wanted.length>=2&&wanted.every(queryWord=>name.some(word=>word===queryWord||(Math.min(word.length,queryWord.length)>=4&&editDistanceAtMostOne(word,queryWord))))){
      // Speech recognition occasionally substitutes one Arabic letter in a
      // surname (for example «عوّاد» for «عوّاض»).  Accept that only when the
      // complete multi-word spoken name still identifies one teacher.
      score=Math.max(score,800+Math.min(wanted.length,8));
    }
   }
  }
  if(!score&&wantedVariants.every(tokens=>tokens.length===1)){
   const wanted=wantedVariants.map(tokens=>tokens[0]);
   for(const queryWord of wanted){
    for(const name of nameVariants)for(const word of name){
     if(Math.min(word.length,queryWord.length)>=3&&(word.includes(queryWord)||queryWord.includes(word)))score=Math.max(score,300+Math.min(word.length,queryWord.length));
     else if(Math.min(word.length,queryWord.length)>=4&&editDistanceAtMostOne(word,queryWord))score=Math.max(score,100+Math.min(word.length,queryWord.length));
    }
   }
  }
  return {teacher,score};
 }).filter(item=>item.score>0);
 if(!scored.length)return [];
 const best=Math.max(...scored.map(item=>item.score));
 return scored.filter(item=>item.score===best).map(item=>item.teacher);
}
export function parseAvailabilityIntent(value){
 const text=String(value||'').normalize('NFKC').replace(/[\u064B-\u065F\u0670ـ]/g,'').replace(/[إأآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/[٠-٩۰-۹]/g,c=>'٠١٢٣٤٥٦٧٨٩'.includes(c)?'٠١٢٣٤٥٦٧٨٩'.indexOf(c):'۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).toLowerCase().replace(/\s+/g,' ').trim();
 const weekDays=['الاحد','الاثنين','الثلاثاء','الاربعاء','الخميس','الجمعه','السبت'];
 const dayPattern=new RegExp(`(?:^|\\s)(?:و)?(?:يوم\\s+)?(${weekDays.join('|')})(?=\\s|$)`,'g');
 const days=[...text.matchAll(dayPattern)].map(match=>match[1]);
 const allDaysPattern=/(?:^|\s)(?:كل|جميع)\s+(?:ايام\s+)?(?:ال)?(?:ايام|اسبوع|الاسبوع)(?=\s|$)/g;
 const allDays=allDaysPattern.test(text);
 const withoutDays=text.replace(dayPattern,' ').replace(allDaysPattern,' ').replace(/(?:^|\s)اليوم(?=\s|$)/g,' ').replace(/(?:^|\s)(?:و|ثم)(?=\s|$)/g,' ').replace(/\s+/g,' ').trim();
 const availabilityMode=value=>/غير\s+متاح|بدون|محجوز|احجز|امنع|اغلق|اقفل|الغ\s+الحجز/.test(value)?'blocked':/(?:^|\s)(?:متاح|متاحه|افتح|الغاء\s+المنع|فك\s+الحجز)(?:\s|$)/.test(value)?'available':'toggle';
 if(days.length||allDays){
  const nested=withoutDays?parseAvailabilityIntent(withoutDays):null;
  if(nested)return {...nested,...(days.length?{days:[...new Set(days)]}:{})};
  const mode=availabilityMode(withoutDays||text);
  if(days.length)return {kind:'day',days:[...new Set(days)],mode,teacherQuery:''};
  return {kind:'all',mode,teacherQuery:''};
 }
 const ordinal='(?:ال)?(?:\\d+|اول(?:ي|ه)?|ثاني(?:ه)?|ثالث(?:ه)?|رابع(?:ه)?|خامس(?:ه)?|سادس(?:ه|ين)?|سوادس|سابع(?:ه|ين)?|سوابع|ثامن(?:ه)?|تاسع(?:ه)?|عاشر(?:ه)?)';
 const removeTeacherPrefix=value=>value.trim().replace(/^(?:(?:اختر|اختار|حدد|خصص|اجعل|خلي|خل|انتقل الى|حول الى|المعلم|معلم|الاستاذ|المدرس|للمعلم|للمدرس|للاستاذ)\s+)+/,'').trim();
 const periodList=value=>{
  const periods=[],tokenPattern=new RegExp(`^(?:الحصه\\s+)?(${ordinal})`);
  const markerPattern=/^(?:بدون|ما\s+عنده|لا\s+تعطيه|لا\s+تسنده|غير\s+متاح(?:ه)?|احجز|امنع)\s+/;
  let remainder=value.trim(),match=tokenPattern.exec(remainder);
  if(!match)return null;
  periods.push(spokenPeriodNumber(match[1]));remainder=remainder.slice(match[0].length).trim();
  while(remainder){
   const connector=/^(?:(?:و|ثم|،|,)\s*)?/.exec(remainder);
   remainder=remainder.slice(connector[0].length);
   const repeatedMarker=markerPattern.exec(remainder);
   if(repeatedMarker)remainder=remainder.slice(repeatedMarker[0].length);
   match=tokenPattern.exec(remainder);
   if(!match)return null;
   periods.push(spokenPeriodNumber(match[1]));remainder=remainder.slice(match[0].length).trim();
  }
  return periods;
 };
 let match=text.match(/فرغ(?:ه)?\s+(?:المعلم\s+)?(.+?)\s+من\s+(?:جميع|كل)\s+الحصص/);
 if(match)return {kind:'all',mode:'blocked',teacherQuery:removeTeacherPrefix(match[1])};
 match=text.match(/(?:فرغ(?:ه)?\s+(?:المعلم\s+)?(?:من\s+)?(?:جميع|كل)\s+الحصص|منتدب(?:ه|ين)?|مندوب(?:ه|ين)?|انتداب)/);
 if(match)return {kind:'all',mode:'blocked',teacherQuery:removeTeacherPrefix(text.replace(match[0],' '))};
 const rangePattern=new RegExp(`(?:من\\s+)?(?:الحصه\\s+)?(${ordinal})\\s+(?:الى|الي|حتى)\\s+(?:الحصه\\s+)?(${ordinal})`);
 match=rangePattern.exec(text);
 if(match){
  const before=text.slice(0,match.index),after=text.slice(match.index+match[0].length),remainder=`${before} ${after}`.trim();
  const blocked=/غير\s+متاح|محجوز|احجز|امنع|اغلق|اقفل|بدون/.test(remainder),available=/(?:^|\s)(?:متاح|متاحه|افتح|الغاء\s+المنع|فك\s+الحجز)(?:\s|$)/.test(remainder);
  const clearRest=/(?:يلغي|الغ|احذف|امنع|غير\s+متاح|غير\s+متاحه)/.test(remainder)&&/(?:البقيه|الباقي|ما\s+بعدها)/.test(remainder);
  const teacherText=remainder.replace(/(?:غير\s+متاحه?|محجوز|احجز|امنع|اغلق|اقفل|بدون|متاحه?|افتح|يلغي|الغ|احذف|البقيه|الباقي|بحيث|من|الى|الي|حتى|الحصه|الحصص|الاستاذ|المعلم)/g,' ');
  return {kind:'range',from:spokenPeriodNumber(match[1]),to:spokenPeriodNumber(match[2]),mode:blocked?'blocked':available?'available':'toggle',clearRest,teacherQuery:removeTeacherPrefix(teacherText)};
 }
 const marker=/(?:بدون|ما\s+عنده|لا\s+تعطيه|لا\s+تسنده|فرغ(?:ه)?\s+من|فرغ\s+من|غير\s+متاح(?:ه)?\s+في|احجز|امنع)\s+/g;
 const markerMatch=marker.exec(text);
 if(markerMatch){
  const list=periodList(text.slice(marker.lastIndex));
  if(list?.length){
   const teacherQuery=removeTeacherPrefix(text.slice(0,markerMatch.index));
   return {kind:'periods',periods:[...new Set(list)],mode:'blocked',teacherQuery};
  }
 }
 match=text.match(/فرغ(?:ه)?\s+(?:المعلم\s+)?(.+?)\s+من\s+(.+)$/);
 if(match){const periods=periodList(match[2]);if(periods)return {kind:'periods',periods:[...new Set(periods)],mode:'blocked',teacherQuery:removeTeacherPrefix(match[1])}}
 match=text.match(new RegExp(`(?:الى|الي|حتى)\\s+(?:الحصه\\s+)?(${ordinal})(?:\\s+(بحيث|مابعدها|ما\\s+بعدها).*)?`));
 if(match)return {kind:'after',period:spokenPeriodNumber(match[1]),mode:'blocked',teacherQuery:removeTeacherPrefix(text.replace(match[0],' '))};
 match=new RegExp(`^(?:(?:غير\\s+متاح(?:ه)?|متاح(?:ه)?|بدون|محجوز|احجز|امنع|افتح)\\s+)?(?:الحصه\\s+)?(${ordinal})(?:\\s+(?:غير\\s+متاح(?:ه)?|متاح(?:ه)?|محجوز|احجز|امنع|افتح))?$`).exec(text);
 if(match)return {kind:'periods',periods:[spokenPeriodNumber(match[1])],mode:availabilityMode(text),teacherQuery:''};
 match=new RegExp(`^(?:الحصه\\s+)?(${ordinal})$`).exec(text);
 if(match)return {kind:'periods',periods:[spokenPeriodNumber(match[1])],mode:'toggle',teacherQuery:''};
 return null;
}
function spokenPeriodNumber(value){
 const word=String(value).replace(/^ال/,'').replace(/(?:ه|ين)$/,'');
 const periods={اولي:1,اول:1,ثاني:2,ثالث:3,رابع:4,خامس:5,سادس:6,سوادس:6,سابع:7,سوابع:7,ثامن:8,تاسع:9,عاشر:10};
 return /^\d+$/.test(word)?Number(word):periods[word]||NaN;
}
const numberPhrase='(?:[0-9]+|(?:واحد|اثنين|اثنان|ثنتين|ثلاث[ةه]?|اربع[ةه]?|خمس[ةه]?|ست[ةه]?|سبع[ةه]?|ثماني[ةه]?|تسع[ةه]?)(?:\\s+و\\s*(?:عشرين|عشرون|ثلاثين|ثلاثون|اربعين|اربعون))?|عشرين|عشرون|ثلاثين|ثلاثون|اربعين|اربعون|خمسين|خمسون|ستين|ستون|عشر[ةه]?)';
const ordinalPhrase='(?:ال)?(?:(?:حادي[ةه]?|ثاني[ةه]?)\\s+عشر[ةه]?|اول[ىي]?|ثاني[ةه]?|ثالث[ةه]?|رابع[ةه]?|خامس[ةه]?|سادس[ةه]?|سابع[ةه]?|ثامن[ةه]?|تاسع[ةه]?|عاشر[ةه]?)';

export const commandAliases=[
 [/^(?:تكلم معي|رد علي بالصوت|جاوبني بصوت|اقرا لي الردود|فعل النطق|شغل النطق)$/,'شغل الرد الصوتي'],
 [/^(?:رد علي كتاب[ةه]|جاوبني كتاب[ةه]|بدون صوت|لا تنطق|اطفي الصوت|طفي الصوت|اكتب ولا تتكلم)$/,'اوقف الرد الصوتي'],
 [/^(?:اسمعني|اسمع كلامي|اسمع اوامري|فعل المايك|شغل المايك|شغل الميكروفون|خلنا نتكلم)$/,'شغل الحوار الصوتي'],
 [/^(?:طفي المايك|اطفي المايك|سكر المايك|اقفل المايك|لا تسمعني|وقف الاستماع|اوقف الميكروفون)$/,'اوقف الحوار الصوتي'],
 [/^(?:عطني لحظ[ةه]|عطني دقيق[ةه]|خلني افكر شوي|استناني|انتظر شوي[ةه]|انتظر دقيق[ةه])$/,'انتظر'],
 [/^(?:انا جاهز|جاهز نكمل|ارجع اسمعني|نرجع نكمل|واصل معي|نكمل الحين)$/,'نكمل'],
 // Questions and help.
 [/^(?:ساعدني|مساعد[ةه]|وش تقدر تسوي|ايش تقدر تسوي|كيف استخدم المساعد|علمني الاوامر|ورني الاوامر|اعرض الاوامر|وش الاوامر|ايش الاوامر)$/,'مساعدة الأوامر'],
 [/^(?:وش|ايش|ما هي|ماهو|ما هو)\s+(?:فايد[ةه]|فائد[ةه]|وظيف[ةه]|عمل)\s+(?:الزر|زر)\s+(.+)$/,'اشرح زر $1'],
 [/^(?:وضح|فسر|اشرح لي)\s+(?:الزر|زر)\s+(.+)$/,'اشرح زر $1'],
 [/^(?:دور على|دور عن|فتش عن|ابحث لي عن|جيب بيانات|هات بيانات|ورني بيانات|وريني معلومات)\s+(?:الاستاذ|المدرس|المعلم)?\s*(.+)$/,'ابحث عن المعلم $1'],
 [/^(?:كم|وش|ايش)\s+(?:هو\s+)?نصاب\s+(?:الاستاذ|المدرس|المعلم)?\s*(.+)$/,'ما نصاب المعلم $1'],
 [/^(?:وش|ايش)\s+(?:مواد|يدرس)\s+(?:الاستاذ|المدرس|المعلم)?\s*(.+)$/,'ماذا يدرس المعلم $1'],
 [/^(?:وريني|ورني|طلع لي|هات|جيب|اظهر لي|اعرض لي)\s+جدول\s+(?:(?:الاستاذ|المدرس|المعلم)\s+)?(.+)$/,'اعرض جدول المعلم $1'],
 [/^(?:مين|من هو)\s+(?:مدرس|معلم)\s+(.+?)\s+(?:لفصل|بفصل|في فصل)\s+(.+)$/,'من معلم $1 في فصل $2'],
 [/^(?:ورني|وريني|هات|جيب|اذكر لي|اعرض لي)\s+(?:اسماء|قائم[ةه])\s+(?:المدرسين|المعلمين)$/,'اعرض اسماء المعلمين'],
 // Values and selections.
 [/^(?:خلي|خل|اجعل|حدد|اضبط|ضبط|غير|عدل|حط|سجل)\s+(?:نصاب الانتظار|النصاب المستهدف|مستهدف النصاب|اجمالي النصاب)(?:\s+(?:الى|الي|على|علي|يكون|يساوي))?\s+(.+)$/,'النصاب المستهدف $1'],
 [/^(?:خلي|خل|اجعل|حدد|اضبط|غير|عدل|حط)?\s*(?:عدد المنتظرين|عدد معلمي الانتظار|عدد معلمين الانتظار|عدد الاحتياط|منتظرين لكل حص[ةه])(?:\s+(?:الى|الي|على|علي|يكون|يساوي))?\s+(.+)$/,'عدد المنتظرين $1'],
 [/^(?:خلي|خل|اجعل|حدد|اضبط|غير|عدل)?\s*(?:اقصى مساف[ةه]|المساف[ةه] القصوى|الحد الاقصى للمساف[ةه])(?:\s+(?:الى|الي|على|علي|يكون))?\s+(.+)$/,'اقصى مسافة $1'],
 [/^(?:استثني|استثن|لا تكلف|لا تضيف|شيل|اعف)\s+(?:المعلم|الاستاذ|المدرس)?\s*(.+?)(?:\s+من (?:الانتظار|الاحتياط))?$/,'استبعد المعلم $1'],
 [/^(?:المعلم|الاستاذ|المدرس)\s+(?:الغائب|الغايب|الغايبه|الغائبه|الغائبين|الغايبين)$/,'المعلم الغائب'],
 [/^(?:سجل|حدد|حط|اعتبر)\s+(?:(?:المعلم|الاستاذ|المدرس)\s+)?(.+?)\s+(?:غائب|غايب)$/,'حدد غياب المعلم $1'],
 [/^(?:سجل غياب|حدد غياب|غياب المعلم|غياب الاستاذ|المعلم الغائب هو)\s+(.+)$/,'حدد غياب المعلم $1'],
 [/^(?:خلي|حدد|اضبط|غير|حط)?\s*(?:تاريخ الغياب|يوم الغياب)(?:\s+(?:الى|الي|هو|يكون))?\s+(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/,'تاريخ الغياب $1-$2-$3'],
 [/^(?:اختار|اختار لي|حدد لي|بدل|بدل الى|غير|غير الى|حول الى|حط)\s+(المعلم|الفصل|الماد[ةه])\s+(.+)$/,'اختر $1 $2'],
 [/^(?:اختر|اختار|حدد|اعرض|ورني|حط|بدل الى)\s+(?:الاستاذ|المدرس)\s+(.+)$/,'اختر المعلم $1'],
 [/^(?:مين|من)\s+يدرس\s+(.+?)\s+(?:لفصل|بفصل|في فصل)\s+(.+)$/,'من معلم $1 في فصل $2'],
 [/^(?:(?:خلي|خل|اجعل|حدد|اضبط|عدل|حط|غير)\s+)?(?:عدد\s+)?حصص\s+(?:يوم\s+)?(الاحد|الاثنين|الثلاثاء|الاربعاء|الخميس)(?:\s+(?:الى|الي|على|علي|يكون))?\s+(.+)$/,'عدد حصص يوم $1 $2'],
 [/^(?:زود|ضيف|ادخل|سجل|اضيف)\s+(?:معلم|استاذ|مدرس)\s+(.+?)\s+(?:نصابه|بنصاب|نصاب[هة] هو|نصاب[هة])\s+(.+)$/,'اضف معلم $1 نصابه $2'],
 [/^(?:اضف|ضيف|زود)\s+معلم\s+(.+?)\s+(?:و?نصاب[هة]|بنصاب|نصابه يكون)\s+(.+)$/,'اضف معلم $1 نصابه $2'],
 [/^(?:حدد|اختار|ورني|وريني|عاين|اعرض لي|اعرض)\s+(?:البديل|الخيار)\s+(?:رقم\s+)?(.+)$/,'اختر البديل $1'],
 [/^(?:اعتمد|ثبت|اكد|نفذ لي|طبق لي)\s+(?:البديل|الخيار)\s+(?:رقم\s+)?(.+)$/,'نفذ البديل $1'],
 [/^(?:طبق|نفذ|اعتمد|ثبت|اختار)\s+(?:افضل بديل|البديل الافضل|احسن بديل|احسن تبديل|افضل خيار|الخيار الافضل)$/,'نفذ افضل تبديل'],
 [/^(?:حدد|اختار|اضغط على|اضغط|علم على|اختار لي)\s+(?:الحص[ةه]|حص[ةه]|الدرس)\s+(.+)$/,'اختر الحصة $1'],
 [/^(?:ودها|وديها|حركها|حولها|نقلها|بدل مكانها|انقل الحص[ةه] المحدد[ةه]|انقل الحص[ةه])\s+(?:الى|الي|ل)\s+(.+)$/,'انقلها الى $1'],
 [/^(?:بدل|حرك|حول|نقل)\s+(?:ماد[ةه]\s+)?(.+?)\s+(?:لفصل|للفصل|في فصل)\s+(.+)$/,'انقل مادة $1 لفصل $2'],
 [/^(?:خلي|خل|اجعل|غير|عدل|اضبط|حدد)\s+(?:مد[ةه]|وقت|مهل[ةه])\s+(?:البحث|التوليد|الحساب)(?:\s+(?:الى|الي|على|علي|يكون))?\s+(.+)$/,'مدة البحث $1'],
 [/^(?:افتح|اعرض|ورني|وريني|هات|جيب|ادخلني|ودني)\s+(?:شاش[ةه]\s+|صفح[ةه]\s+|نافذ[ةه]\s+)?(?:استيراد المعلمين|استيراد اسماء المعلمين|ملف المعلمين|رفع ملف المعلمين|رفع ملف اكسل|استيراد اكسل)$/,'افتح استيراد المعلمين'],
 [/^(?:شغل|فعل|اسمح|اتح)\s+(?:الاستثناءات|القيود المرن[ةه]|تجاوز القيود المرن[ةه])$/,'اسمح باستثناء القيود المرنة'],
 [/^(?:عطل|وقف|اوقف|امنع|اقفل)\s+(?:الاستثناءات|القيود المرن[ةه]|تجاوز القيود المرن[ةه])$/,'لا تسمح باستثناء القيود المرنة'],
 [/^(?:اسحب|مرر|حرك)\s+(?:الشاش[ةه]|الصفح[ةه]|النافذ[ةه])\s+(?:الى\s+)?(?:تحت|للاسفل)$/,'انزل'],
 [/^(?:اسحب|مرر|حرك)\s+(?:الشاش[ةه]|الصفح[ةه]|النافذ[ةه])\s+(?:الى\s+)?(?:فوق|للاعلى)$/,'اطلع'],
];

export function canonicalVoiceCommand(value){
 let text=cleanVoiceRequest(value).replace(/[إأآ]/g,'ا');
 for(const [pattern,replacement] of commandAliases){if(pattern.test(text)){text=text.replace(pattern,replacement);break}}
 text=text.replace(/^(تاريخ الغياب \d{4})-(\d{1,2})-(\d{1,2})$/,(all,year,month,day)=>year+'-'+month.padStart(2,'0')+'-'+day.padStart(2,'0'));
 // Normalize number words only in numeric argument positions.
 for(const label of ['النصاب المستهدف','عدد المنتظرين','اقصى مسافة']){
   if(text.startsWith(label+' ')){const number=voiceNumber(text.slice(label.length+1));if(Number.isFinite(number))text=label+' '+number}
 }
 text=text.replace(new RegExp('(نصابه\\s+)('+numberPhrase+')$'),(all,label,value)=>{const number=voiceNumber(value);return Number.isFinite(number)?label+number:all});
 text=text.replace(new RegExp('(عدد حصص يوم (?:الاحد|الاثنين|الثلاثاء|الاربعاء|الخميس)\\s+)('+numberPhrase+')$'),(all,label,value)=>{const number=voiceNumber(value);return Number.isFinite(number)?label+number:all});
 text=text.replace(new RegExp('((?:الحص[ةه]|حص[ةه])\\s+)('+numberPhrase+'|'+ordinalPhrase+')(?=\\s+(?:يوم|من|الى|الي|ل)|$)','g'),(all,label,value)=>{const number=voiceNumber(value);return Number.isFinite(number)?label+number:all});
 text=text.replace(new RegExp('(يوم\\s+(?:الاحد|الاثنين|الثلاثاء|الاربعاء|الخميس)\\s+)('+numberPhrase+')(\\s*(?:حص[ةه]|حصص))','g'),(all,label,value,tail)=>{const number=voiceNumber(value);return Number.isFinite(number)?label+number+tail:all});
 text=text.replace(new RegExp('((?:اول|ثاني|ثالث|رابع|خامس|سادس)(?:\\s+(?:ابتدائي|متوسط|ثانوي))?\\s+)('+numberPhrase+')(\\s+(?:فصل|فصول|شعب[ةه]|شعب))','g'),(all,label,value,tail)=>{const number=voiceNumber(value);return Number.isFinite(number)?label+number+tail:all});
 return text;
}
