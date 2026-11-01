import {cleanVoiceRequest,voiceNumber} from '/voice-command.js?v=2';

const normalize=text=>cleanVoiceRequest(text).replace(/[إأآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/\s+/g,' ').trim();
const period='(?:\d{1,2}|(?:ال)?(?:(?:حاديه?|ثانيه?)\s+عشره?|اولي?|واحده?|ثانيه?|اثنين|ثلاثه?|ثالثه?|اربعه?|رابعه?|خمسه?|خامسه?|سته?|سادسه?|سبعه?|سابعه?|ثمانيه?|ثامنه?|تسعه?|تاسعه?|عشره?|عاشره?))';
const minutes=text=>{
 const key=normalize(text).replace(/^(?:لمده|مده|حوالي)\s+/,'').replace(/\s*(?:دقيقه|دقائق|دقايق)$/,'').trim();
 return voiceNumber(key);
};
export const clockText=value=>String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0');

export function spokenClock(value){
 let text=normalize(value).replace(/^(?:(?:من|في|عند|الساعه|تمام الساعه)\s+)+/,'');
 const pm=/(?:مساء|مساءا|عصرا|بعد الظهر|بعد الظهره|ليلا)/.test(text);
 const am=/(?:صباحا|صباح|الفجر)/.test(text);
 if(pm&&am)return null;
 text=text.replace(/\s*(?:مساءا?|عصرا|بعد الظهره?|ليلا|صباحا?|الفجر).*$/,'').trim();
 let hour,minute=0;
 const digital=text.match(/^(\d{1,2})\s*[:٫.]\s*(\d{1,2})$/);
 if(digital){hour=Number(digital[1]);minute=Number(digital[2]);}
 else{
   const less=text.match(/^(.+?)\s+الا\s+(الربع|ربع|عشره?|خمس|خمسه|ثلث)$/);
   if(less){hour=voiceNumber(less[1]);const sub=/ربع/.test(less[2])?15:/ثلث/.test(less[2])?20:minutes(less[2]);minute=60-sub;hour-=1;}
   else{
     const parts=text.match(/^(.+?)\s+و\s*(.+)$/)||text.match(/^(\S+)\s+(.+)$/);
     if(parts){hour=voiceNumber(parts[1]);const rest=parts[2].replace(/^ال/,'').trim();minute=/^(?:نص|نصف)$/.test(rest)?30:/^ربع$/.test(rest)?15:/^ثلث$/.test(rest)?20:minutes(rest);}
     else hour=voiceNumber(text);
   }
 }
 if(!Number.isInteger(hour)||!Number.isInteger(minute)||hour<0||hour>23||minute<0||minute>59)return null;
 if((pm||am)&&hour>12)return null;
 if(pm&&hour<12)hour+=12;
 if(am&&hour===12)hour=0;
 return hour*60+minute;
}

function durationOf(part){
 const patterns=[/(?:مده\s+(?:كل\s+)?الحصه|مدتها|مده\s+الحصص|مده|كل\s+حصه)\s+(?:هي\s+|تكون\s+|يساوي\s+)?(.+?)\s+(?:دقيقه|دقائق|دقايق)/, /([^،؛]+?)\s+(?:دقيقه|دقائق|دقايق)\s+(?:لكل\s+حصه|للحصة|للحصه)/, /(?:احسب|اجعل|خلي|خل|حط)\s+(.+?)\s+(?:دقيقه|دقائق|دقايق)/];
 for(const pattern of patterns){const match=part.match(pattern);if(match){const n=minutes(match[1]);return Number.isFinite(n)?n:NaN}}
 const standalone=part.match(/(?:^|\s)(\d+|خمسين|خمسون|اربعين|اربعون|خمسه\s+واربعين|ستين|ستون)\s+(?:دقيقه|دقائق|دقايق)/);
 return standalone?minutes(standalone[1]):null;
}

export function parseTimingRequest(value){
 let text=normalize(value);
 // No timing interpretation for lesson movement, navigation, or questions.
 if(/^(?:انقل|حرك|بدل|افتح|اعرض|اشرح|ما |كم |متي |وش )/.test(text))return null;
 if(!/(?:تبدا|تبتدي|تبدء|توقيت|بدايه|مده|مدتها|دقيقه|دقائق|دقايق)/.test(text))return null;
 if(!/(?:حصه|حصص|الدوام|اليوم الدراسي)/.test(text))return null;
 text=text.replace(/(?:ابتداء|بدايه|بدءا)\s+من\s+/g,'من ').replace(/و?ثم\s+(?=من\s)/g,'').replace(/(?:و|ثم)\s*(?=الحصه\s)/g,' ومن ');
 text=text.replace(new RegExp('(?:و|ثم)\\s*('+period+')(?=\\s+(?:وما|تبدا|تبتدي|مدتها|كل))','g'),' ومن الحصه $1');
 if(/^(?:الحصه|حصه)\s/.test(text))text='من '+text;
 if(/^(?:الدوام|اليوم الدراسي|كل الحصص|جميع الحصص)/.test(text))text='من الحصه الاولي وما بعدها '+text;
 const heads=[...text.matchAll(new RegExp('(?:^|\\s|[،؛])و?من\\s+(?:الحصه\\s+|حصه\\s+|الحصص\\s+)?('+period+')','g'))];
 if(!heads.length)return {error:'حدّد الحصص المطلوبة، مثل «الحصة الأولى تبدأ الساعة…» أو «من الأولى إلى الثالثة، كل حصة… دقيقة».'};
 const rules=[];
 for(let i=0;i<heads.length;i++){
   const head=heads[i],from=voiceNumber(head[1]),part=text.slice(head.index+head[0].length,i+1<heads.length?heads[i+1].index:text.length);
   const range=part.match(new RegExp('^(?:\\s*)(?:الى|الي|حتي|لغاية|لغايه)\\s+(?:الحصه\\s+)?('+period+')'));
   const onwards=/(?:وما\s*يليها|وما\s*بعدها|فما\s*بعد|وما\s*فوق|الي\s+نهايه|الى\s+نهايه|حتي\s+نهايه|لاخر|لباقي|الباقي|باقي\s+الحصص)/.test(part);
   const end=range?voiceNumber(range[1]):onwards?0:from;
   const duration=durationOf(part);
   const startMatch=part.match(/(?:تبدا|تبتدي|تبدء|بدايتها|بدايه(?:\s+(?:الحصه|الحصص))?|توقيت\s+البدايه)\s*(.*)$/);
   let start=null;
   if(startMatch){
     const clock=startMatch[1].split(/\s+(?:و?مدتها|و?مده|و?كل\s+حصه|و?لكل\s+حصه|واحسب|احسب)/)[0].replace(/[،؛]+$/,'').trim();
     start=spokenClock(clock);
     if(start===null)return {error:'لم أفهم وقت البداية. قل الساعة مثل «سبعة ونص»، «عشرة وربع»، أو «7:30». لم أغيّر التوقيت.'};
   }
   if(!Number.isInteger(from)||from<1||from>12||!Number.isInteger(end)||end<0||end>12||(end&&end<from))return {error:'راجع نطاق الحصص؛ يجب أن تكون البداية قبل النهاية، وأرقام الحصص بين 1 و12. لم أغيّر التوقيت.'};
   if(duration!==null&&(!Number.isInteger(duration)||duration<10||duration>180))return {error:'لم أفهم مدة الحصة. اذكر مدة بين 10 و180 دقيقة، مثل «كل حصة خمسين دقيقة». لم أغيّر التوقيت.'};
   if(start===null&&duration===null)return {error:'اذكر وقت البداية أو مدة الحصة للمجموعة المطلوبة. لم أغيّر التوقيت.'};
   rules.push({from,end,start,duration});
 }
 // Overlapping ranges are ambiguous, so never apply only part of a request.
 const used=new Set();
 for(const rule of rules)for(let n=rule.from;n<=(rule.end||12);n++){if(used.has(n))return {error:'نطاقات الحصص متداخلة. حدّد كل مجموعة مرة واحدة. لم أغيّر التوقيت.'};used.add(n)}
 return {rules};
}

export function planTiming(slots,days,request){
 if(request.error)return request;
 const updated=slots.map(slot=>({...slot})),summary=[];
 for(let day=0;day<days.length;day++){
   const original=slots.filter(s=>s.day===day).sort((a,b)=>a.period-b.period);
   let previousEnd=null,activeRule=null;
   for(let index=0;index<original.length;index++){
     const old=original[index],n=old.period+1,slot=updated.find(s=>s.day===day&&s.period===old.period);
     const rule=request.rules.find(r=>n>=r.from&&(!r.end||n<=r.end));
     if(!rule){activeRule=null;previousEnd=null;continue}
     const oldStart=spokenClock(old.start),oldEnd=spokenClock(old.end);
     if(oldStart===null||oldEnd===null||oldEnd<=oldStart)return {error:'توجد أوقات غير صالحة في الجدول الحالي. راجعها قبل تطبيق الأمر.'};
     let start=oldStart,duration=oldEnd-oldStart;
     if(rule.duration!==null)duration=rule.duration;
     if(rule!==activeRule){activeRule=rule;previousEnd=null}
     start=n===rule.from&&rule.start!==null?rule.start:(previousEnd===null?oldStart:previousEnd);
     if(start<0||start+duration>=1440)return {error:'التوقيت المقترح يتجاوز نهاية اليوم. لم أغيّر التوقيت.'};
     if(previousEnd!==null&&start<previousEnd)return {error:'بداية إحدى الحصص تتعارض مع نهاية الحصة السابقة. عدّل البداية أو المدة؛ لم أغيّر التوقيت.'};
     slot.start=clockText(start);slot.end=clockText(start+duration);previousEnd=start+duration;
     if(day===0&&rule&&n===rule.from)summary.push({from:rule.from,end:rule.end,start:slot.start,duration});
   }
 }
 if(!summary.length)return {error:'الحصص المطلوبة غير موجودة في أيام الدوام الحالية. لم أغيّر التوقيت.'};
 return {slots:updated,summary};
}
