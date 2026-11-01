const $=s=>document.querySelector(s);
const message=(text,ok=false)=>{const el=$('#message');if(el){el.textContent=text||'';el.className='message'+(ok?' ok':'')}};
async function post(path,body){const response=await fetch('/api/auth/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw Error((data.errors||['تعذر تنفيذ الطلب']).join('\n'));return data}
const params=new URLSearchParams(location.search);
if($('#registerForm')){
  $('#registerForm').onsubmit=async event=>{event.preventDefault();const email=$('#email').value.trim(),password=$('#password').value,confirm=$('#confirm').value;if(password!==confirm){message('كلمتا المرور غير متطابقتين.');return}try{const result=await post('register',{email,password});message('أرسلنا رسالة تفعيل إلى بريدك. افتحها لإكمال التسجيل.',true);if(result.verificationUrl)message('وضع التطوير: افتح رابط التفعيل التالي: '+result.verificationUrl,true)}catch(error){message(error.message)}};
}
if($('#loginForm')){
  $('#loginForm').onsubmit=async event=>{event.preventDefault();try{await post('login',{email:$('#email').value.trim(),password:$('#password').value});location.assign('/index.html')}catch(error){message(error.message);if(error.message.includes('فعّل'))$('#resend').hidden=false}};
  $('#resend')?.addEventListener('click',async()=>{try{await post('resend',{email:$('#email').value.trim()});message('أرسلنا رسالة تفعيل جديدة إلى بريدك.',true)}catch(error){message(error.message)}});
}
if($('#verify')){
  const token=params.get('token');if(!token)message('رابط التفعيل غير مكتمل.');else post('verify',{token}).then(()=>{message('تم تفعيل الحساب. يمكنك الدخول الآن.',true);$('#continue')?.removeAttribute('hidden')}).catch(error=>message(error.message));
}
