"""Account, email verification, session, and per-school project storage."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


ROOT = Path(__file__).parent.resolve()
DATA = ROOT / "data"
DB_PATH = Path(os.environ.get("SOUNDTABLE_DB", str(DATA / "soundtable.sqlite3")))
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
SESSION_TTL = 60 * 60 * 24 * 30
VERIFY_TTL = 60 * 60 * 24


class AuthError(Exception):
    pass


class EmailNotVerified(AuthError):
    pass


class AuthConfigError(AuthError):
    pass


@contextmanager
def _connect() -> Iterator[sqlite3.Connection]:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def init_db() -> None:
    with _connect() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                verified INTEGER NOT NULL DEFAULT 0,
                verification_hash TEXT,
                verification_expires INTEGER,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS projects (
                user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                payload TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
            CREATE INDEX IF NOT EXISTS users_verification_idx ON users(verification_hash);
            """
        )


def normalize_email(value: str) -> str:
    email = str(value or "").strip().lower()
    if not EMAIL_RE.fullmatch(email):
        raise AuthError("اكتب بريدًا إلكترونيًا صحيحًا.")
    return email


def _password_hash(password: str, salt: bytes | None = None) -> str:
    if len(password) < 8:
        raise AuthError("كلمة المرور يجب أن تحتوي على 8 أحرف على الأقل.")
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return "scrypt$16384$8$1$%s$%s" % (salt.hex(), digest.hex())


def _password_matches(password: str, encoded: str) -> bool:
    try:
        algorithm, n, r, p, salt_hex, digest_hex = encoded.split("$")
        if algorithm != "scrypt":
            return False
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
        actual = hashlib.scrypt(password.encode(), salt=salt, n=int(n), r=int(r), p=int(p), dklen=len(expected))
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _user(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    return {"id": row["id"], "email": row["email"], "verified": bool(row["verified"]), "createdAt": row["created_at"]}


def _verification_url(token: str) -> str:
    base = os.environ.get("SOUNDTABLE_PUBLIC_URL", "http://127.0.0.1:8767").rstrip("/")
    return f"{base}/verify-email.html?token={quote(token)}"


def _send_resend_email(email: str, token: str) -> None:
    api_key = os.environ.get("RESEND_API_KEY", "").strip()
    sender = os.environ.get("RESEND_FROM", "").strip()
    if not api_key or not sender:
        raise AuthConfigError("لم يتم إعداد Resend بعد. أضف RESEND_API_KEY وRESEND_FROM في الخادم.")
    verification_url = _verification_url(token)
    body = {
        "from": sender,
        "to": [email],
        "subject": "تفعيل حسابك في الجدول الصوتي",
        "html": (
            "<div dir='rtl' style='font-family:Tahoma,Arial,sans-serif;line-height:1.9'>"
            "<h2>مرحبًا بك في الجدول الصوتي</h2>"
            "<p>اضغط الزر التالي لتفعيل بريدك والبدء في إعداد جدول مدرستك:</p>"
            f"<p><a href='{verification_url}' style='display:inline-block;background:#087e72;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none'>تفعيل الحساب</a></p>"
            f"<p>إذا لم يعمل الزر، انسخ هذا الرابط:</p><p dir='ltr'>{verification_url}</p>"
            "</div>"
        ),
    }
    request = Request(
        "https://api.resend.com/emails",
        data=json.dumps(body, ensure_ascii=False).encode(),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "soundtable/1.0",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=20) as response:
            if response.status >= 300:
                raise AuthError("تعذر إرسال رسالة التفعيل.")
    except HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:300]
        raise AuthError(f"تعذر إرسال رسالة التفعيل عبر Resend: {detail}") from error
    except URLError as error:
        raise AuthError("تعذر الاتصال بخدمة البريد لإرسال رسالة التفعيل.") from error


def register(email: str, password: str) -> dict:
    email = normalize_email(email)
    password_hash = _password_hash(str(password or ""))
    user_id = secrets.token_urlsafe(18)
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    with _connect() as db:
        try:
            db.execute(
                "INSERT INTO users(id,email,password_hash,verified,verification_hash,verification_expires,created_at) VALUES(?,?,?,?,?,?,?)",
                (user_id, email, password_hash, 0, _token_hash(token), now + VERIFY_TTL, now),
            )
        except sqlite3.IntegrityError as error:
            raise AuthError("هذا البريد مسجل بالفعل. استخدم تسجيل الدخول أو أعد إرسال رسالة التفعيل.") from error
    try:
        _send_resend_email(email, token)
    except AuthConfigError:
        if os.environ.get("SOUNDTABLE_ALLOW_DEV_VERIFICATION") != "1":
            with _connect() as db:
                db.execute("DELETE FROM users WHERE id=?", (user_id,))
            raise
    except Exception:
        with _connect() as db:
            db.execute("DELETE FROM users WHERE id=?", (user_id,))
        raise
    result = {"user": {"id": user_id, "email": email, "verified": False}, "verificationRequired": True}
    if os.environ.get("SOUNDTABLE_ALLOW_DEV_VERIFICATION") == "1":
        result["verificationUrl"] = _verification_url(token)
    return result


def resend_verification(email: str) -> dict:
    email = normalize_email(email)
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    with _connect() as db:
        row = db.execute("SELECT id,verified FROM users WHERE email=?", (email,)).fetchone()
        if row is None:
            raise AuthError("لا يوجد حساب بهذا البريد.")
        if row["verified"]:
            return {"alreadyVerified": True}
        db.execute("UPDATE users SET verification_hash=?, verification_expires=? WHERE id=?", (_token_hash(token), now + VERIFY_TTL, row["id"]))
    try:
        _send_resend_email(email, token)
    except AuthConfigError:
        if os.environ.get("SOUNDTABLE_ALLOW_DEV_VERIFICATION") != "1":
            raise
    result = {"verificationRequired": True}
    if os.environ.get("SOUNDTABLE_ALLOW_DEV_VERIFICATION") == "1":
        result["verificationUrl"] = _verification_url(token)
    return result


def verify(token: str) -> tuple[dict, str]:
    token = str(token or "").strip()
    if not token:
        raise AuthError("رابط التفعيل غير مكتمل.")
    now = int(time.time())
    with _connect() as db:
        row = db.execute("SELECT * FROM users WHERE verification_hash=?", (_token_hash(token),)).fetchone()
        if row is None or not row["verification_expires"] or row["verification_expires"] < now:
            raise AuthError("رابط التفعيل غير صالح أو انتهت مدته.")
        db.execute("UPDATE users SET verified=1, verification_hash=NULL, verification_expires=NULL WHERE id=?", (row["id"],))
    return {"id": row["id"], "email": row["email"], "verified": True}, create_session(row["id"])


def authenticate(email: str, password: str) -> tuple[dict, str]:
    email = normalize_email(email)
    with _connect() as db:
        row = db.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    if row is None or not _password_matches(str(password or ""), row["password_hash"]):
        raise AuthError("البريد أو كلمة المرور غير صحيحة.")
    if not row["verified"]:
        raise EmailNotVerified("فعّل بريدك أولًا من رسالة التفعيل المرسلة إليك.")
    return _user(row), create_session(row["id"])


def create_session(user_id: str) -> str:
    token = secrets.token_urlsafe(36)
    now = int(time.time())
    with _connect() as db:
        db.execute("DELETE FROM sessions WHERE expires_at<?", (now,))
        db.execute("INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)", (_token_hash(token), user_id, now + SESSION_TTL, now))
    return token


def session_user(token: str | None) -> dict | None:
    if not token:
        return None
    now = int(time.time())
    with _connect() as db:
        row = db.execute(
            "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>=? AND u.verified=1",
            (_token_hash(token), now),
        ).fetchone()
    return _user(row)


def delete_session(token: str | None) -> None:
    if not token:
        return
    with _connect() as db:
        db.execute("DELETE FROM sessions WHERE token_hash=?", (_token_hash(token),))


def load_project(user_id: str, factory) -> dict:
    init_db()
    with _connect() as db:
        row = db.execute("SELECT payload FROM projects WHERE user_id=?", (user_id,)).fetchone()
    if row is None:
        project = factory()
        save_project(user_id, project)
        return project
    return json.loads(row["payload"])


def save_project(user_id: str, project: dict) -> None:
    init_db()
    with _connect() as db:
        db.execute(
            "INSERT INTO projects(user_id,payload,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at",
            (user_id, json.dumps(project, ensure_ascii=False), int(time.time())),
        )


def find_project_by_signature_token(token: str) -> tuple[str, dict, dict, dict, str | None] | None:
    """Locate a task in the active or archived term without exposing other data."""
    if not token or len(token) < 24:
        return None
    init_db()
    with _connect() as db:
        rows = db.execute("SELECT user_id,payload FROM projects").fetchall()
    for row in rows:
        root = json.loads(row["payload"])
        candidates = [(None, root)] + [(item.get("id"), item.get("snapshot", {})) for item in root.get("termWorkspaces", [])]
        for workspace_id, project in candidates:
            task = next((item for item in project.get("signatureTasks", []) if hmac.compare_digest(str(item.get("token", "")), token)), None)
            if task:
                return row["user_id"], root, project, task, workspace_id
    return None
