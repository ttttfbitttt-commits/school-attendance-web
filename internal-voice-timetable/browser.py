"""
browser.py — أداة Playwright للتحكم في التطبيق برمجياً.
الاستخدام:
  python browser.py screenshot           # التقاط صورة للصفحة الحالية
  python browser.py click "selector"     # ضغط عنصر
  python browser.py goto 5               # الانتقال لخطوة معينة
  python browser.py eval "js_code"       # تنفيذ JavaScript وعرض النتيجة
  python browser.py text "selector"      # قراءة نص عنصر
  python browser.py fill "selector" "value"  # ملء حقل نص
  python browser.py api "path"           # استدعاء GET endpoint
"""
import sys, json, pathlib
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8767"
SHOT_DIR = pathlib.Path(r"C:\Users\PCD\.gemini\antigravity\brain\8f8cce30-a0e3-4456-b0bf-2a9e849a0bdc\scratch")
SHOT_DIR.mkdir(parents=True, exist_ok=True)
SHOT = SHOT_DIR / "screen.png"
STATE_FILE = SHOT_DIR / "browser_state.json"

def load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {}

def save_state(state):
    STATE_FILE.write_text(json.dumps(state))

def run(cmd, args):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1400, "height": 900}, locale="ar-SA")
        page = ctx.new_page()

        # استعادة URL السابق
        state = load_state()
        target_url = state.get("url", URL)

        page.goto(target_url, wait_until="networkidle", timeout=15000)

        if cmd == "screenshot":
            page.screenshot(path=str(SHOT), full_page=False)
            save_state({"url": page.url})
            print(f"SCREENSHOT:{SHOT}")

        elif cmd == "goto_step":
            step = int(args[0])
            page.evaluate(f"() => {{ step={step}; unlocked=Math.max(unlocked,{step}); render(); }}")
            page.wait_for_timeout(800)
            page.screenshot(path=str(SHOT))
            save_state({"url": page.url})
            print(f"SCREENSHOT:{SHOT}")

        elif cmd == "click":
            sel = args[0]
            page.click(sel, timeout=5000)
            page.wait_for_timeout(600)
            page.screenshot(path=str(SHOT))
            save_state({"url": page.url})
            print(f"SCREENSHOT:{SHOT}")

        elif cmd == "fill":
            sel, value = args[0], args[1]
            page.fill(sel, value)
            page.wait_for_timeout(300)
            page.screenshot(path=str(SHOT))
            save_state({"url": page.url})
            print(f"SCREENSHOT:{SHOT}")

        elif cmd == "eval":
            js = args[0]
            result = page.evaluate(js)
            page.wait_for_timeout(500)
            page.screenshot(path=str(SHOT))
            save_state({"url": page.url})
            print(f"RESULT:{json.dumps(result, ensure_ascii=False)}")
            print(f"SCREENSHOT:{SHOT}")

        elif cmd == "text":
            sel = args[0]
            text = page.inner_text(sel)
            print(f"TEXT:{text}")

        elif cmd == "html":
            sel = args[0] if args else "body"
            html = page.inner_html(sel)
            print(f"HTML:{html[:3000]}")

        elif cmd == "api":
            path = args[0]
            result = page.evaluate(f"() => fetch('{path}').then(r=>r.json())")
            page.wait_for_timeout(1000)
            result = page.evaluate(f"() => fetch('{path}').then(r=>r.json())")
            print(f"API:{json.dumps(result, ensure_ascii=False, indent=2)[:3000]}")

        elif cmd == "command":
            # تنفيذ أمر نصي في المساعد
            text = args[0]
            page.evaluate(f"() => command({json.dumps(text)})")
            page.wait_for_timeout(1000)
            page.screenshot(path=str(SHOT))
            save_state({"url": page.url})
            print(f"SCREENSHOT:{SHOT}")

        browser.close()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)
    cmd = sys.argv[1]
    args = sys.argv[2:]
    run(cmd, args)
