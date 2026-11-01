const $=id=>document.getElementById(id),message=(text,error=false)=>{const el=$('message');el.textContent=text;el.classList.toggle('error',error)};
const canvas=$('signature'),ctx=canvas.getContext('2d');ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#093f35';ctx.lineWidth=4;
function point(event){const rect=canvas.getBoundingClientRect();return{x:(event.clientX-rect.left)*canvas.width/rect.width,y:(event.clientY-rect.top)*canvas.height/rect.height}}
let active=false,last=null,dirty=false;
canvas.addEventListener('pointerdown',event=>{active=true;last=point(event);canvas.setPointerCapture(event.pointerId)});
canvas.addEventListener('pointermove',event=>{if(!active)return;const next=point(event);ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(next.x,next.y);ctx.stroke();last=next;dirty=true});
canvas.addEventListener('pointerup',()=>active=false);canvas.addEventListener('pointercancel',()=>active=false);
$('clear').onclick=()=>{ctx.clearRect(0,0,canvas.width,canvas.height);dirty=false;message('')};
$('send').onclick=()=>{if(!dirty)return message('ارسم توقيعًا أولًا داخل المربع.',true);$('send').disabled=true;$('send').textContent='تمت التجربة';message('نجحت التجربة. في التكليف الحقيقي سيُحفظ التوقيع ويظهر تلقائيًا في نموذج حصص الانتظار الرسمي. هذه الصفحة لم تحفظ شيئًا.');};
