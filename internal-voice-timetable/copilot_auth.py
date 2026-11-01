from __future__ import annotations

import asyncio
from concurrent.futures import TimeoutError as FutureTimeoutError
import hashlib
import json
import os
import re
import secrets
import threading
import time
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from copilot import CopilotClient, ToolSet
from copilot.session_events import AssistantMessageData
from copilot.tools import Tool, ToolInvocation, ToolResult


CLIENT_ID_ENV = "GITHUB_CLIENT_ID"
CLIENT_SECRET_ENV = "GITHUB_CLIENT_SECRET"
REDIRECT_URI_ENV = "GITHUB_REDIRECT_URI"
DEFAULT_REDIRECT_URI = "http://127.0.0.1:8767/auth/copilot/callback"
_lock = threading.RLock()
_login_states: dict[str, tuple[str, float]] = {}
_connections: dict[str, dict[str, object]] = {}
_conversation_history: dict[str, list[tuple[str, str]]] = {}

UI_GUIDE = (
    'أنت «آمرني وأنا أنفذ»، مساعد ذكي حقيقي داخل برنامج الجدول الصوتي. تحدّث كإنسان لبق وودود بلهجة سعودية بيضاء بسيطة، '
    'بجمل قصيرة، دون قوالب جامدة ودون Markdown. افهم الكلام العامي والأخطاء الإملائية والكلام الناقص، واستنتج القصد من السياق '
    '(الشاشة الحالية والمعلم المعروض)، وإن كان الطلب ملتبسًا فاسأل سؤالًا واحدًا قصيرًا بدل التخمين. بعد كل تنفيذ اقترح الخطوة المنطقية التالية بجملة واحدة. '
    'لا تدّعِ أن شيئًا تم قبل ردّ الواجهة؛ قل «طلبت من البرنامج…» أو «فتحت لك…» حسب ما أرجعته الأداة.\n'
    'خريطة الجدول الصوتي: سبعة تبويبات: (1) بيانات المدرسة: اسم المدرسة والمدير والعام الدراسي والمرحلة والفصل الدراسي. '
    '(2) الأيام والتوقيت: عدد حصص كل يوم وأوقات الحصص وزر «تطبيق عدد الحصص». (3) الفصول والخطة: عدد فصول كل صف وزر «إنشاء الفصول» وقائمة الفصل والمواد وأزرار «إضافة مادة» و«حذف». '
    '(4) المعلمون والإسنادات: استيراد Excel و«إضافة معلم يدويًا» وقوائم المعلم والمادة والفصل لإسناد المواد. (5) الإتاحة والقيود: اختيار معلم وحجب حصص معينة و«استيراد إتاحات الجدول الذكي». '
    '(6) إنشاء الجدول: أزرار «إنشاء جدول جديد» و«تعديل الجدول» و«التحقق من الجدول» و«تراجع» و«طباعة الجداول» و«نسخة JSON» و«الجداول المحفوظة وتغيير الاسم» وأيام الأسبوع لعرض كل يوم، ومدة البحث والسماح باستثناء القيود المرنة. '
    '(7) حصص الانتظار: «إعداد حصص الانتظار» (أنصبة واستثناءات ثم تغطية وشروط ثم جدول واعتماد) و«جدول المنتظرين» و«المعلم الغائب» (تحديد غياب ثم تأكيد ثم توزيع المنتظرين وسجل الغياب).\n'
    'أزرار الرأس: «ربط المساعد» و«حفظ المسودة»، وأسفل كل شاشة «الخطوة السابقة» و«حفظ ومتابعة». نوافذ: طباعة (الجدول العام حسب المعلمين/الفصول، جداول المعلمين/الفصول المنفردة، وحجم الورق)، محرر التعديل (قائمة المعلم المطلوب وسحب الحصص)، معاينة التبديل (بدائل مرقمة وزرا «تنفيذ التبديل» و«إلغاء»).\n'
    'اختر الأداة الأنسب: go_to_tab للتنقل بين التبويبات، press_button لأي زر ظاهر (استخدم نص الزر أو أي تسمية شائعة له)، run_ui_command لأي أمر نصي يفهمه المرشد '
    '(مثل: «اسم المدرسة …»، «اسم المدير …»، «العام الدراسي 1448»، «اجعل يوم الأحد 6 حصص»، «أول ثانوي 11 فصل»، «اختر الفصل أول 3»، «اختر المادة الرياضيات»، «اختر المعلم …»، «مدة البحث دقيقة»، «حجم الورق A3»، «النصاب المستهدف 20»، «حدد غياب المعلم …»، «تاريخ الغياب 2026-10-25»)، '
    'select_editor_teacher لعرض معلم في محرر التعديل، move_lesson لنقل حصة (يفتح معاينة بالبدائل ليؤكد المستخدم أو يلغي)، scroll_page للنزول والصعود، '
    'وأدوات القراءة get_teacher_schedule وget_class_schedule وfind_free_teachers وsearch_teacher للإجابة الدقيقة. '
    'إن طلب المستخدم أمرين أو أكثر فنفّذها بالترتيب باستدعاءات متتالية. للتنقل المطلوب قبل إجراء آخر، انتقل أولًا ثم نفّذ. '
    'لا تضغط أزرار الحذف أو المسح أبدًا؛ اشرح للمستخدم أنه يضغطها بنفسه. ولا تنفّذ إنشاء جدول جديد إلا إذا طلبه المستخدم صراحة.\n'
)

class CopilotAuthError(Exception):
    pass


def oauth_configured() -> bool:
    return bool(os.environ.get(CLIENT_ID_ENV) and os.environ.get(CLIENT_SECRET_ENV))


def redirect_uri() -> str:
    default=f"http://127.0.0.1:{os.environ.get('NASQ_PORT','8767')}/auth/copilot/callback"
    return os.environ.get(REDIRECT_URI_ENV, default).strip()


def status(session_id: str) -> dict[str, object]:
    with _lock:
        connection = _connections.get(session_id)
        return {
            "configured": oauth_configured(),
            "connected": bool(connection),
            "login": connection.get("login") if connection else None,
        }


def begin_login(session_id: str) -> tuple[str, str]:
    client_id = os.environ.get(CLIENT_ID_ENV, "").strip()
    if not client_id or not os.environ.get(CLIENT_SECRET_ENV):
        raise CopilotAuthError("لم يُضبط GitHub OAuth في بيئة التشغيل المحلية.")
    callback = redirect_uri()
    if not callback.startswith(("http://127.0.0.1:", "http://localhost:", "https://")):
        raise CopilotAuthError("عنوان العودة OAuth يجب أن يكون localhost أثناء التطوير أو HTTPS عند النشر.")
    state = secrets.token_urlsafe(32)
    now = time.time()
    with _lock:
        expired = [key for key, (_, created) in _login_states.items() if now - created > 600]
        for key in expired:
            _login_states.pop(key, None)
        _login_states[state] = (session_id, now)
    query = urlencode({
        "client_id": client_id,
        "redirect_uri": callback,
        "scope": "read:user",
        "state": state,
    })
    return f"https://github.com/login/oauth/authorize?{query}", state


def _post_github(payload: dict[str, str]) -> dict[str, object]:
    request = Request(
        "https://github.com/login/oauth/access_token",
        data=urlencode(payload).encode("utf-8"),
        headers={
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Nasq-School-Timetable",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=15) as response:
            data = json.loads(response.read())
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
        raise CopilotAuthError("تعذر إكمال الاتصال بـ GitHub. حاول مرة أخرى.") from error
    if not isinstance(data, dict) or data.get("error") or not data.get("access_token"):
        raise CopilotAuthError("رفض GitHub تسجيل الدخول. أعد المحاولة أو تحقق من إعداد OAuth App.")
    return data


def _github_login(access_token: str) -> str:
    request = Request(
        "https://api.github.com/user",
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {access_token}",
            "User-Agent": "Nasq-School-Timetable",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urlopen(request, timeout=15) as response:
            user = json.loads(response.read())
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
        raise CopilotAuthError("تعذر التحقق من حساب GitHub بعد التفويض.") from error
    login = user.get("login") if isinstance(user, dict) else None
    if not isinstance(login, str) or not login:
        raise CopilotAuthError("لم يُرجع GitHub اسم الحساب.")
    return login


def finish_login(session_id: str, state: str, code: str) -> str:
    with _lock:
        pending = _login_states.pop(state, None)
    if not pending or pending[0] != session_id or time.time() - pending[1] > 600:
        raise CopilotAuthError("انتهت صلاحية طلب تسجيل الدخول. ابدأ الربط من جديد.")
    tokens = _post_github({
        "client_id": os.environ[CLIENT_ID_ENV].strip(),
        "client_secret": os.environ[CLIENT_SECRET_ENV],
        "code": code,
        "redirect_uri": redirect_uri(),
    })
    access_token = str(tokens["access_token"])
    login = _github_login(access_token)
    now = time.time()
    with _lock:
        _connections[session_id] = {
            "access_token": access_token,
            "refresh_token": tokens.get("refresh_token"),
            "expires_at": now + int(tokens.get("expires_in", 0)) if tokens.get("expires_in") else None,
            "refresh_expires_at": now + int(tokens.get("refresh_token_expires_in", 0)) if tokens.get("refresh_token_expires_in") else None,
            "login": login,
        }
    return login


def disconnect(session_id: str) -> None:
    with _lock:
        _connections.pop(session_id, None)
        _conversation_history.pop(session_id, None)


def _access_token(session_id: str) -> str:
    with _lock:
        connection = _connections.get(session_id)
        if not connection:
            raise CopilotAuthError("اربط حساب GitHub Copilot أولًا.")
        expires_at = connection.get("expires_at")
        if not isinstance(expires_at, (int, float)) or expires_at - time.time() > 60:
            return str(connection["access_token"])
        refresh_token = connection.get("refresh_token")
        refresh_expires_at = connection.get("refresh_expires_at")
        if not isinstance(refresh_token, str) or (
            isinstance(refresh_expires_at, (int, float)) and refresh_expires_at <= time.time()
        ):
            _connections.pop(session_id, None)
            raise CopilotAuthError("انتهت صلاحية الاتصال. أعد ربط GitHub Copilot.")
        tokens = _post_github({
            "client_id": os.environ[CLIENT_ID_ENV].strip(),
            "client_secret": os.environ[CLIENT_SECRET_ENV],
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        })
        connection["access_token"] = tokens["access_token"]
        connection["refresh_token"] = tokens.get("refresh_token", refresh_token)
        connection["expires_at"] = time.time() + int(tokens.get("expires_in", 0)) if tokens.get("expires_in") else None
        connection["refresh_expires_at"] = time.time() + int(tokens.get("refresh_token_expires_in", 0)) if tokens.get("refresh_token_expires_in") else refresh_expires_at
        return str(connection["access_token"])


class _CopilotRuntime:
    def __init__(self) -> None:
        self.loop=asyncio.new_event_loop()
        self.ready=threading.Event()
        self.client: CopilotClient | None=None
        self.client_lock: asyncio.Lock | None=None
        self.thread=threading.Thread(target=self._run_loop,name='nasq-copilot-runtime',daemon=True)
        self.thread.start()
        if not self.ready.wait(5): raise CopilotAuthError('تعذر بدء خدمة Copilot المحلية.')

    def _run_loop(self) -> None:
        asyncio.set_event_loop(self.loop)
        self.ready.set()
        self.loop.run_forever()

    async def _get_client(self) -> CopilotClient:
        if self.client_lock is None: self.client_lock=asyncio.Lock()
        async with self.client_lock:
            if self.client is None:
                runtime_home=Path(__file__).parent/'data'/'copilot_runtime'
                self.client=CopilotClient(
                    use_logged_in_user=False,
                    mode='empty',
                    base_directory=str(runtime_home),
                    session_idle_timeout_seconds=300,
                    log_level='error',
                )
                await self.client.start()
            return self.client

    async def _ask(self, access_token: str, prompt: str, project: dict[str, object], session_tools: list[Tool], available_tools: list[str]) -> str:
        client=await self._get_client()
        session_id='nasq-'+uuid.uuid4().hex
        session=await client.create_session(
            session_id=session_id,
            github_token=access_token,
            model='auto',
            tools=session_tools,
            available_tools=available_tools,
            enable_session_store=False,
            enable_skills=False,
            memory={'enabled':False},
            system_message={'mode':'append','content':UI_GUIDE+(
                'أنت مساعد مدرسي داخل الجدول الصوتي. أجب بالعربية السعودية الواضحة وباختصار. '
                'استخدم أداة البحث عن المعلمين عند السؤال عن اسم أو نصاب أو مواد. '
                'استخدم أدوات جدول المعلم وجدول الفصل والمعلمين الفارغين للإجابة عن أسئلة الجداول، ولا تخمّن بيانات لم تُرجعها الأدوات. '
                'استخدم أدوات فتح الشاشة أو جدول المعلم عند طلب التنقل أو العرض. '
                'واجهة الجدول الصوتي تنفذ طلبات الفتح بعد اكتمال ردك؛ لا تدّع أن إجراءً تم قبل تأكيد الواجهة. '
                'نفّذ طلب المستخدم بنفسك عبر الأدوات؛ ولا تطلب منه خطوات يدوية إلا إذا لم توجد أداة مناسبة. '
                'لا تحذف ولا تمسح بيانات، ولا تطلب كلمة مرور أو مفتاح API.'
            )},
        )
        try:
            result=await session.send_and_wait(prompt,timeout=60)
            if result and isinstance(result.data,AssistantMessageData): return result.data.content.strip()
            return 'لم يصل رد من Copilot.'
        finally:
            await session.disconnect()
            await client.delete_session(session_id)

    def ask(self, access_token: str, prompt: str, project: dict[str, object], session_tools: list[Tool], available_tools: list[str]) -> str:
        future=asyncio.run_coroutine_threadsafe(self._ask(access_token,prompt,project,session_tools,available_tools),self.loop)
        try: return future.result(timeout=70)
        except FutureTimeoutError as error:
            future.cancel()
            raise CopilotAuthError('تأخر Copilot عن الرد. حاول مرة أخرى.') from error


_runtime: _CopilotRuntime | None=None
_runtime_lock=threading.Lock()


def ask(session_id: str, prompt: str, project: dict[str, object]) -> dict[str, object]:
    global _runtime
    access_token=_access_token(session_id)
    with _lock:
        previous=list(_conversation_history.get(session_id,[]))
    actions: list[dict[str, str]]=[]
    tools=ToolSet().add_custom('search_teacher').add_custom('open_screen').add_custom('open_teacher_schedule').add_custom('get_teacher_schedule').add_custom('get_class_schedule').add_custom('find_free_teachers').add_custom('select_editor_teacher').add_custom('press_button').add_custom('run_ui_command').add_custom('move_lesson').add_custom('go_to_tab').add_custom('scroll_page')

    def search_teacher(invocation: ToolInvocation) -> ToolResult:
        query=str((invocation.arguments or {}).get('query','')).strip()
        if not query: return ToolResult(text_result_for_llm='اكتب اسم المعلم أو جزءًا منه للبحث.')
        wanted=' '.join(query.split()).casefold()
        teachers=project.get('teachers',[]); courses=project.get('courses',[]); classes=project.get('classes',[])
        if not isinstance(teachers,list) or not isinstance(courses,list) or not isinstance(classes,list):
            return ToolResult(text_result_for_llm='بيانات المدرسة غير متاحة لهذه الجلسة.',result_type='failure')
        class_names={item.get('id'):item.get('name') for item in classes if isinstance(item,dict)}
        matches=[teacher for teacher in teachers if isinstance(teacher,dict) and wanted in str(teacher.get('name','')).casefold()]
        if not matches: return ToolResult(text_result_for_llm='لم أجد معلمًا بهذا الاسم في المشروع الحالي.')
        details=[]
        for teacher in matches[:10]:
            assigned=[course for course in courses if isinstance(course,dict) and course.get('teacherId')==teacher.get('id')]
            details.append({'name':teacher.get('name'),'short':teacher.get('short'),'load':sum(int(course.get('count',0)) for course in assigned),'max':teacher.get('max'),'subjects':[{'subject':course.get('subject'),'className':class_names.get(course.get('classId')),'count':course.get('count')} for course in assigned[:30]]})
        return ToolResult(text_result_for_llm=json.dumps(details,ensure_ascii=False))

    def open_screen(invocation: ToolInvocation) -> ToolResult:
        screen=str((invocation.arguments or {}).get('screen',''))
        allowed={'school_data','time','classes','teachers','availability','schedule','standby','standby_table','absence','print','saved_schedules','edit_schedule'}
        if screen not in allowed: return ToolResult(text_result_for_llm='هذه الشاشة ليست ضمن الشاشات المسموحة.',result_type='rejected')
        actions.append({'type':'open_screen','screen':screen})
        return ToolResult(text_result_for_llm='سأطلب من واجهة الجدول الصوتي فتح الشاشة بعد اكتمال الرد.')

    def open_teacher_schedule(invocation: ToolInvocation) -> ToolResult:
        name=str((invocation.arguments or {}).get('name','')).strip()
        if not name: return ToolResult(text_result_for_llm='أحتاج اسم المعلم لفتح جدوله.',result_type='failure')
        actions.append({'type':'open_teacher_schedule','name':name})
        return ToolResult(text_result_for_llm=f'سأطلب من واجهة الجدول الصوتي فتح جدول المعلم المطابق لـ {name}.')

    def _norm(value: object) -> str:
        return ' '.join(str(value).replace('أ','ا').replace('إ','ا').replace('آ','ا').split()).casefold()

    def _lessons(match) -> list[dict[str, object]]:
        slots=project.get('slots',[]); days=project.get('days',[]); placements=project.get('placements',[])
        courses={c.get('id'):c for c in project.get('courses',[]) if isinstance(c,dict)}
        class_names={c.get('id'):c.get('name') for c in project.get('classes',[]) if isinstance(c,dict)}
        teacher_names={t.get('id'):t.get('name') for t in project.get('teachers',[]) if isinstance(t,dict)}
        rows=[]
        for placement in placements:
            course=courses.get(placement.get('courseId')); index=placement.get('slot')
            if not course or not isinstance(index,int) or not 0<=index<len(slots) or not match(course): continue
            slot=slots[index]; day=days[slot['day']]['name'] if slot['day']<len(days) else slot['day']
            rows.append({'day':day,'dayIndex':slot['day'],'period':slot['period']+1,'time':f"{slot.get('start','')}-{slot.get('end','')}",'subject':course.get('subject'),'class':class_names.get(course.get('classId')),'teacher':teacher_names.get(course.get('teacherId'))})
        rows.sort(key=lambda row:(row['dayIndex'],row['period']))
        for row in rows: row.pop('dayIndex')
        return rows

    def get_teacher_schedule(invocation: ToolInvocation) -> ToolResult:
        wanted=_norm((invocation.arguments or {}).get('name',''))
        if not wanted: return ToolResult(text_result_for_llm='أحتاج اسم المعلم.',result_type='failure')
        teachers=[t for t in project.get('teachers',[]) if isinstance(t,dict) and wanted in _norm(t.get('name',''))][:3]
        if not teachers: return ToolResult(text_result_for_llm='لم أجد معلمًا بهذا الاسم.')
        result=[{'teacher':t.get('name'),'lessons':_lessons(lambda course,t=t:course.get('teacherId')==t.get('id'))} for t in teachers]
        return ToolResult(text_result_for_llm=json.dumps(result,ensure_ascii=False))

    def get_class_schedule(invocation: ToolInvocation) -> ToolResult:
        wanted=_norm((invocation.arguments or {}).get('name',''))
        if not wanted: return ToolResult(text_result_for_llm='أحتاج اسم الفصل.',result_type='failure')
        classes=[c for c in project.get('classes',[]) if isinstance(c,dict)]
        found=[c for c in classes if _norm(c.get('name',''))==wanted] or [c for c in classes if wanted in _norm(c.get('name',''))][:3]
        if not found: return ToolResult(text_result_for_llm='لم أجد فصلًا بهذا الاسم.')
        result=[{'class':c.get('name'),'lessons':_lessons(lambda course,c=c:course.get('classId')==c.get('id'))} for c in found]
        return ToolResult(text_result_for_llm=json.dumps(result,ensure_ascii=False))

    def find_free_teachers(invocation: ToolInvocation) -> ToolResult:
        args=invocation.arguments or {}; day=_norm(args.get('day','')); period=args.get('period')
        days=project.get('days',[]); slots=project.get('slots',[])
        day_index=next((i for i,d in enumerate(days) if isinstance(d,dict) and _norm(d.get('name',''))==day),None)
        slot_index=next((i for i,s in enumerate(slots) if s.get('day')==day_index and s.get('period')==(period-1 if isinstance(period,int) else -1)),None)
        if day_index is None or slot_index is None: return ToolResult(text_result_for_llm='اليوم أو رقم الحصة غير صالح.',result_type='failure')
        courses={c.get('id'):c for c in project.get('courses',[]) if isinstance(c,dict)}
        busy={courses[p['courseId']].get('teacherId') for p in project.get('placements',[]) if p.get('slot')==slot_index and p.get('courseId') in courses}
        free=[t.get('name') for t in project.get('teachers',[]) if isinstance(t,dict) and t.get('id') not in busy]
        return ToolResult(text_result_for_llm=json.dumps({'day':args.get('day'),'period':period,'freeTeachers':free[:80],'count':len(free)},ensure_ascii=False))

    destructive=re.compile(r'حذف|مسح|تفريغ|احذف|امسح|افرغ|إعادة ضبط|اعادة ضبط|استبدال الجدول')

    def select_editor_teacher(invocation: ToolInvocation) -> ToolResult:
        name=str((invocation.arguments or {}).get('name','')).strip()
        if not name: return ToolResult(text_result_for_llm='أحتاج اسم المعلم.',result_type='failure')
        actions.append({'type':'select_editor_teacher','name':name})
        return ToolResult(text_result_for_llm=f'سأطلب من الواجهة اختيار {name} في محرر تعديل الجدول.')

    def press_button(invocation: ToolInvocation) -> ToolResult:
        label=str((invocation.arguments or {}).get('label','')).strip()
        if not label: return ToolResult(text_result_for_llm='أحتاج نص الزر.',result_type='failure')
        if destructive.search(label): return ToolResult(text_result_for_llm='أزرار الحذف والمسح تحتاج أن يضغطها المستخدم بنفسه.',result_type='rejected')
        actions.append({'type':'press_button','label':label})
        return ToolResult(text_result_for_llm=f'سأطلب من الواجهة الضغط على الزر «{label}».')

    def run_ui_command(invocation: ToolInvocation) -> ToolResult:
        text=str((invocation.arguments or {}).get('text','')).strip()
        if not text or len(text)>300: return ToolResult(text_result_for_llm='اكتب أمرًا قصيرًا يفهمه آمرني وأنا أنفذ.',result_type='failure')
        if destructive.search(text): return ToolResult(text_result_for_llm='أوامر الحذف والمسح تحتاج أن ينطقها المستخدم بنفسه.',result_type='rejected')
        actions.append({'type':'run_command','text':text})
        return ToolResult(text_result_for_llm='سأطلب من آمرني وأنا أنفذ تنفيذ هذا الأمر.')

    def move_lesson(invocation: ToolInvocation) -> ToolResult:
        args=invocation.arguments or {}
        days=[d for d in project.get('days',[]) if isinstance(d,dict)]; slots=project.get('slots',[])
        def slot_of(day_name: object, period: object) -> tuple[int | None, str]:
            day_index=next((i for i,d in enumerate(days) if _norm(d.get('name',''))==_norm(day_name)),None)
            if day_index is None or not isinstance(period,int): return None,''
            index=next((i for i,s in enumerate(slots) if s.get('day')==day_index and s.get('period')==period-1),None)
            return index,str(days[day_index].get('name',''))
        source,from_name=slot_of(args.get('fromDay',''),args.get('fromPeriod'))
        target,to_name=slot_of(args.get('toDay',''),args.get('toPeriod'))
        if source is None or target is None: return ToolResult(text_result_for_llm='اليوم أو رقم الحصة غير موجود في جدول الدوام.',result_type='failure')
        if source==target: return ToolResult(text_result_for_llm='موضع البداية هو نفس موضع الهدف.',result_type='failure')
        courses={c.get('id'):c for c in project.get('courses',[]) if isinstance(c,dict)}
        class_names={c.get('id'):c.get('name') for c in project.get('classes',[]) if isinstance(c,dict)}
        teacher_names={t.get('id'):t.get('name') for t in project.get('teachers',[]) if isinstance(t,dict)}
        wanted_teacher=_norm(args.get('teacher','')); wanted_class=_norm(args.get('className','')); wanted_subject=_norm(args.get('subject',''))
        candidates=[]
        for placement in project.get('placements',[]):
            course=courses.get(placement.get('courseId'))
            if placement.get('slot')!=source or not course: continue
            teacher=str(teacher_names.get(course.get('teacherId'),'')); class_name=str(class_names.get(course.get('classId'),''))
            if wanted_teacher and wanted_teacher not in _norm(teacher): continue
            if wanted_class and wanted_class!=_norm(class_name): continue
            if wanted_subject and wanted_subject not in _norm(course.get('subject','')): continue
            candidates.append({'subject':course.get('subject'),'class':class_name,'teacher':teacher})
        if not candidates: return ToolResult(text_result_for_llm=f'لا توجد حصة مطابقة يوم {from_name} الحصة {args.get("fromPeriod")}. راجع جدول المعلم أو الفصل بالأداة وأعد المحاولة.',result_type='failure')
        if len(candidates)>1: return ToolResult(text_result_for_llm='هناك أكثر من حصة متطابقة، حدد المعلم أو الفصل أو المادة: '+json.dumps(candidates[:12],ensure_ascii=False),result_type='failure')
        lesson=candidates[0]
        text=f"انقل {lesson['subject']} لفصل {lesson['class']} من يوم {from_name} الحصة {args.get('fromPeriod')} إلى يوم {to_name} الحصة {args.get('toPeriod')}"
        actions.append({'type':'run_command','text':text})
        return ToolResult(text_result_for_llm=f"سأطلب من الواجهة فتح معاينة نقل {lesson['subject']} لفصل {lesson['class']} (المعلم {lesson['teacher']}). المستخدم يؤكد أو يلغي بنفسه من نافذة المعاينة، فلا تقل إن النقل تم.")

    def go_to_tab(invocation: ToolInvocation) -> ToolResult:
        name=str((invocation.arguments or {}).get('tab','')).strip()
        if not name: return ToolResult(text_result_for_llm='أحتاج اسم التبويب.',result_type='failure')
        actions.append({'type':'run_command','text':f'انتقل إلى {name}'})
        return ToolResult(text_result_for_llm=f'سأطلب من الواجهة الانتقال إلى «{name}»، والواجهة تؤكد النتيجة للمستخدم.')

    def scroll_page(invocation: ToolInvocation) -> ToolResult:
        direction=str((invocation.arguments or {}).get('direction','')).strip(); amount=str((invocation.arguments or {}).get('amount','step')).strip()
        commands={('down','step'):'انزل',('down','little'):'انزل شوي',('down','end'):'انزل لاخر الصفحة',('down','continuous'):'انزل بهدوء',('up','step'):'اطلع',('up','little'):'اطلع شوي',('up','top'):'اطلع لاول الصفحة',('up','continuous'):'اطلع بهدوء',('stop','step'):'توقف'}
        text=commands.get((direction,amount)) or commands.get((direction,'step'))
        if not text: return ToolResult(text_result_for_llm='الاتجاه غير معروف.',result_type='failure')
        actions.append({'type':'run_command','text':text})
        return ToolResult(text_result_for_llm='سأطلب من الواجهة تمرير الصفحة.')

    session_tools=[
        Tool(name='go_to_tab',description='انتقل إلى تبويب من تبويبات الجدول الصوتي السبعة باسمه أو بأي تسمية شائعة له (بيانات المدرسة، الأيام والتوقيت، الفصول، المعلمون، الإتاحة، إنشاء الجدول، حصص الانتظار).',parameters={'type':'object','properties':{'tab':{'type':'string','description':'اسم التبويب كما يقوله المستخدم'}},'required':['tab'],'additionalProperties':False},handler=go_to_tab,skip_permission=True),
        Tool(name='scroll_page',description='مرّر الصفحة أو النافذة المفتوحة للأسفل أو الأعلى أو أوقف التمرير.',parameters={'type':'object','properties':{'direction':{'type':'string','enum':['down','up','stop']},'amount':{'type':'string','enum':['step','little','end','top','continuous'],'description':'step خطوة عادية، little قليل، end آخر الصفحة، top أعلى الصفحة، continuous تمرير هادئ حتى التوقف'}},'required':['direction'],'additionalProperties':False},handler=scroll_page,skip_permission=True),
        Tool(name='move_lesson',description='انقل حصة من يوم وحصة إلى يوم وحصة آخرين مع إيجاد تبديل صالح وتطبيقه في مسودة الجدول (يمكن التراجع عنه). حدد الحصة بالمعلم أو الفصل أو المادة إن لزم.',parameters={'type':'object','properties':{'fromDay':{'type':'string','description':'يوم الحصة الحالي مثل الأحد'},'fromPeriod':{'type':'integer','description':'رقم الحصة الحالية بدءًا من 1'},'toDay':{'type':'string','description':'اليوم المطلوب'},'toPeriod':{'type':'integer','description':'رقم الحصة المطلوبة'},'teacher':{'type':'string','description':'اسم المعلم (اختياري)'},'className':{'type':'string','description':'اسم الفصل كما يظهر مثل ثالث 1 (اختياري)'},'subject':{'type':'string','description':'اسم المادة (اختياري)'}},'required':['fromDay','fromPeriod','toDay','toPeriod'],'additionalProperties':False},handler=move_lesson,skip_permission=True),
        Tool(name='select_editor_teacher',description='افتح محرر تعديل الجدول إن لم يكن مفتوحًا واختر المعلم المطلوب فيه ليظهر جدوله للتعديل.',parameters={'type':'object','properties':{'name':{'type':'string','description':'اسم المعلم أو جزء منه'}},'required':['name'],'additionalProperties':False},handler=select_editor_teacher,skip_permission=True),
        Tool(name='press_button',description='اضغط زرًا ظاهرًا الآن في واجهة الجدول الصوتي بنصه (من قائمة عناصر الواجهة الظاهرة). لا يُسمح بأزرار الحذف.',parameters={'type':'object','properties':{'label':{'type':'string','description':'نص الزر كما يظهر'}},'required':['label'],'additionalProperties':False},handler=press_button,skip_permission=True),
        Tool(name='run_ui_command',description='نفّذ أي أمر عربي يفهمه آمرني وأنا أنفذ مثل «اسم المدرسة ...» أو «اضف معلم ... نصابه 20» أو «انقل مادة ... لفصل ... من يوم ... الحصة ... إلى ...» أو «حدد غياب المعلم ...». استخدمها لأي طلب تنفيذ لا تغطيه الأدوات الأخرى.',parameters={'type':'object','properties':{'text':{'type':'string','description':'الأمر بصيغة عربية بسيطة'}},'required':['text'],'additionalProperties':False},handler=run_ui_command,skip_permission=True),
        Tool(name='get_teacher_schedule',description='أعد جدول حصص معلم (اليوم والحصة والوقت والمادة والفصل). استخدمها للأسئلة عن حصص المعلم أو فراغه أو يومه.',parameters={'type':'object','properties':{'name':{'type':'string','description':'اسم المعلم أو جزء مميز منه'}},'required':['name'],'additionalProperties':False},handler=get_teacher_schedule,skip_permission=True),
        Tool(name='get_class_schedule',description='أعد جدول حصص فصل (اليوم والحصة والمادة والمعلم). اسم الفصل مثل «اول 1».',parameters={'type':'object','properties':{'name':{'type':'string','description':'اسم الفصل'}},'required':['name'],'additionalProperties':False},handler=get_class_schedule,skip_permission=True),
        Tool(name='find_free_teachers',description='أعد المعلمين الذين ليس لديهم حصة في يوم وحصة محددين.',parameters={'type':'object','properties':{'day':{'type':'string','description':'اسم اليوم مثل الأحد أو الاثنين'},'period':{'type':'integer','description':'رقم الحصة بدءًا من 1'}},'required':['day','period'],'additionalProperties':False},handler=find_free_teachers,skip_permission=True),
        Tool(name='search_teacher',description='ابحث في أسماء معلمي المدرسة وأعد النصاب والمواد والفصول المسندة. استخدمها قبل الإجابة عن اسم معلم أو نصابه.',parameters={'type':'object','properties':{'query':{'type':'string','description':'اسم المعلم أو جزء مميز من الاسم'}},'required':['query'],'additionalProperties':False},handler=search_teacher,skip_permission=True),
        Tool(name='open_screen',description='اطلب من واجهة الجدول الصوتي فتح تبويب أو نافذة مسموحة؛ لا تدّع أنها فتحت حتى ترد الواجهة.',parameters={'type':'object','properties':{'screen':{'type':'string','enum':['school_data','time','classes','teachers','availability','schedule','standby','standby_table','absence','print','saved_schedules','edit_schedule']}},'required':['screen'],'additionalProperties':False},handler=open_screen,skip_permission=True),
        Tool(name='open_teacher_schedule',description='اطلب فتح الجدول الأسبوعي لمعلم معروف بالاسم أو جزء من اسمه.',parameters={'type':'object','properties':{'name':{'type':'string','description':'اسم المعلم أو جزء منه'}},'required':['name'],'additionalProperties':False},handler=open_teacher_schedule,skip_permission=True),
    ]
    try:
        with _runtime_lock:
            if _runtime is None: _runtime=_CopilotRuntime()
            runtime=_runtime
        context='\n'.join(f'{role}: {message}' for role,message in previous[-8:])
        contextual_prompt=(f'سياق المحادثة السابقة (للمتابعة فقط):\n{context}\n\nطلب المستخدم الحالي: {prompt}' if context else prompt)
        result=runtime.ask(access_token,contextual_prompt,project,session_tools,tools.to_list())
        with _lock:
            history=_conversation_history.setdefault(session_id,[])
            history.extend([('المستخدم',prompt),('المساعد',result)])
            del history[:-16]
        return {'reply':result,'actions':[action for index,action in enumerate(actions) if action not in actions[:index]]}
    except CopilotAuthError:
        raise
    except Exception as error:
        message=str(error).lower()
        if '401' in message or 'unauthorized' in message or 'forbidden' in message:
            disconnect(session_id)
            raise CopilotAuthError('رفض GitHub Copilot هذا الحساب أو انتهت صلاحيته. أعد ربط الحساب وتحقق من اشتراك Copilot.') from error
        raise CopilotAuthError('تعذر الاتصال بـ Copilot. تحقق من الاشتراك والاتصال وحاول مرة أخرى.') from error
