import os, re, sqlite3, secrets, time
from functools import wraps
from pathlib import Path
from flask import Flask, request, session, jsonify, send_from_directory, g
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

BASE = Path(__file__).parent
DATA = BASE / "data"
UP = DATA / "uploads"
UP.mkdir(parents=True, exist_ok=True)
KEYF = DATA / "secret.key"
if not KEYF.exists():
    KEYF.write_text(secrets.token_hex(32))

app = Flask(__name__, static_folder=str(BASE / "static"), static_url_path="/static")
app.secret_key = KEYF.read_text()
app.config.update(MAX_CONTENT_LENGTH=200 * 1024 * 1024,
                  SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax",
                  PERMANENT_SESSION_LIFETIME=60 * 60 * 24 * 30)
ALLOWED = {"jar", "zip", "yml", "yaml", "json", "properties", "txt", "toml", "conf"}
FAILS = {}

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE COLLATE NOCASE,
  pw_hash TEXT, role TEXT DEFAULT 'user', created_at TEXT, last_login TEXT);
CREATE TABLE IF NOT EXISTS plugins(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT,
  description TEXT, stored TEXT, original TEXT, size INTEGER, created_at TEXT);
CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, title TEXT,
  body TEXT, shared INTEGER DEFAULT 0, updated_at TEXT);
"""


def db():
    if "db" not in g:
        g.db = sqlite3.connect(DATA / "craftvault.db")
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_):
    d = g.pop("db", None)
    if d is not None:
        d.close()


with sqlite3.connect(DATA / "craftvault.db") as _c:
    _c.executescript(SCHEMA)


def now():
    return time.strftime("%Y-%m-%d %H:%M")


def cur():
    uid = session.get("uid")
    if not uid:
        return None
    return db().execute("SELECT id,username,role FROM users WHERE id=?", (uid,)).fetchone()


def auth(admin=False):
    def deco(f):
        @wraps(f)
        def w(*a, **k):
            u = cur()
            if not u:
                return jsonify(error="Chưa đăng nhập"), 401
            if admin and u["role"] != "admin":
                return jsonify(error="Cần quyền quản trị"), 403
            return f(u, *a, **k)
        return w
    return deco


def err(msg, code=400):
    return jsonify(error=msg), code


@app.get("/")
def index():
    return send_from_directory(BASE / "static", "index.html")


# ---------- tài khoản ----------
@app.post("/api/register")
def register():
    d = request.get_json(silent=True) or {}
    name, pw = (d.get("username") or "").strip(), d.get("password") or ""
    if not re.fullmatch(r"[A-Za-z0-9_]{3,20}", name):
        return err("Tên 3-20 ký tự, chỉ gồm chữ, số và _")
    if len(pw) < 6:
        return err("Mật khẩu tối thiểu 6 ký tự")
    c = db()
    first = c.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0
    try:
        r = c.execute("INSERT INTO users(username,pw_hash,role,created_at,last_login) VALUES(?,?,?,?,?)",
                      (name, generate_password_hash(pw), "admin" if first else "user", now(), now()))
    except sqlite3.IntegrityError:
        return err("Tên đã tồn tại", 409)
    c.commit()
    session.clear()
    session["uid"] = r.lastrowid
    session.permanent = True
    return jsonify(ok=True)


@app.post("/api/login")
def login():
    ip = request.remote_addr
    n, t = FAILS.get(ip, (0, time.time()))
    if time.time() - t > 300:
        n, t = 0, time.time()
    if n >= 8:
        return err("Sai quá nhiều lần, thử lại sau 5 phút", 429)
    d = request.get_json(silent=True) or {}
    u = db().execute("SELECT * FROM users WHERE username=?", ((d.get("username") or "").strip(),)).fetchone()
    if not u or not check_password_hash(u["pw_hash"], d.get("password") or ""):
        FAILS[ip] = (n + 1, t)
        return err("Sai tên hoặc mật khẩu", 401)
    FAILS.pop(ip, None)
    db().execute("UPDATE users SET last_login=? WHERE id=?", (now(), u["id"]))
    db().commit()
    session.clear()
    session["uid"] = u["id"]
    session.permanent = True
    return jsonify(ok=True)


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@app.get("/api/me")
@auth()
def me(u):
    return jsonify(id=u["id"], username=u["username"], role=u["role"])


# ---------- plugin ----------
@app.get("/api/plugins")
@auth()
def plugins(u):
    rows = db().execute("SELECT p.id,p.name,p.description,p.original,p.size,p.created_at,p.user_id,u.username "
                        "FROM plugins p JOIN users u ON u.id=p.user_id ORDER BY p.id DESC").fetchall()
    return jsonify([dict(r) for r in rows])


@app.post("/api/plugins")
@auth()
def plugin_upload(u):
    f = request.files.get("file")
    orig = secure_filename(f.filename) if f and f.filename else ""
    ext = orig.rsplit(".", 1)[-1].lower() if "." in orig else ""
    if ext not in ALLOWED:
        return err("Chỉ nhận file: " + ", ".join(sorted(ALLOWED)))
    stored = secrets.token_hex(8) + "." + ext
    f.save(UP / stored)
    name = (request.form.get("name") or orig).strip()[:80]
    db().execute("INSERT INTO plugins(user_id,name,description,stored,original,size,created_at) VALUES(?,?,?,?,?,?,?)",
                 (u["id"], name, (request.form.get("description") or "")[:500], stored, orig,
                  (UP / stored).stat().st_size, now()))
    db().commit()
    return jsonify(ok=True)


@app.get("/api/plugins/<int:pid>/download")
@auth()
def plugin_dl(u, pid):
    p = db().execute("SELECT stored,original FROM plugins WHERE id=?", (pid,)).fetchone()
    if not p:
        return err("Không tìm thấy", 404)
    return send_from_directory(UP, p["stored"], as_attachment=True, download_name=p["original"])


@app.delete("/api/plugins/<int:pid>")
@auth()
def plugin_del(u, pid):
    p = db().execute("SELECT * FROM plugins WHERE id=?", (pid,)).fetchone()
    if not p:
        return err("Không tìm thấy", 404)
    if p["user_id"] != u["id"] and u["role"] != "admin":
        return err("Không có quyền", 403)
    (UP / p["stored"]).unlink(missing_ok=True)
    db().execute("DELETE FROM plugins WHERE id=?", (pid,))
    db().commit()
    return jsonify(ok=True)


# ---------- ghi chú ----------
@app.get("/api/notes")
@auth()
def notes(u):
    rows = db().execute("SELECT n.id,n.title,n.body,n.shared,n.updated_at,n.user_id,u.username FROM notes n "
                        "JOIN users u ON u.id=n.user_id WHERE n.user_id=? OR n.shared=1 ORDER BY n.id DESC",
                        (u["id"],)).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/notes", methods=["POST"])
@app.route("/api/notes/<int:nid>", methods=["PUT"])
@auth()
def note_save(u, nid=None):
    d = request.get_json(silent=True) or {}
    title, body, shared = (d.get("title") or "").strip()[:100], (d.get("body") or "")[:20000], 1 if d.get("shared") else 0
    if not title:
        return err("Cần có tiêu đề")
    if nid is None:
        db().execute("INSERT INTO notes(user_id,title,body,shared,updated_at) VALUES(?,?,?,?,?)",
                     (u["id"], title, body, shared, now()))
    else:
        r = db().execute("UPDATE notes SET title=?,body=?,shared=?,updated_at=? WHERE id=? AND user_id=?",
                         (title, body, shared, now(), nid, u["id"]))
        if r.rowcount == 0:
            return err("Không sửa được ghi chú này", 403)
    db().commit()
    return jsonify(ok=True)


@app.delete("/api/notes/<int:nid>")
@auth()
def note_del(u, nid):
    n = db().execute("SELECT user_id FROM notes WHERE id=?", (nid,)).fetchone()
    if not n or (n["user_id"] != u["id"] and u["role"] != "admin"):
        return err("Không có quyền", 403)
    db().execute("DELETE FROM notes WHERE id=?", (nid,))
    db().commit()
    return jsonify(ok=True)


# ---------- quản trị ----------
@app.get("/api/admin/users")
@auth(admin=True)
def admin_users(u):
    rows = db().execute("SELECT u.id,u.username,u.role,u.created_at,u.last_login,"
                        "(SELECT COUNT(*) FROM plugins WHERE user_id=u.id) plugins,"
                        "(SELECT COUNT(*) FROM notes WHERE user_id=u.id) notes FROM users u ORDER BY u.id").fetchall()
    return jsonify([dict(r) for r in rows])


@app.post("/api/admin/users/<int:uid>/reset")
@auth(admin=True)
def admin_reset(u, uid):
    pw = (request.get_json(silent=True) or {}).get("password") or ""
    if len(pw) < 6:
        return err("Mật khẩu tối thiểu 6 ký tự")
    db().execute("UPDATE users SET pw_hash=? WHERE id=?", (generate_password_hash(pw), uid))
    db().commit()
    return jsonify(ok=True)


@app.post("/api/admin/users/<int:uid>/role")
@auth(admin=True)
def admin_role(u, uid):
    if uid == u["id"]:
        return err("Không thể tự đổi quyền của mình")
    role = "admin" if (request.get_json(silent=True) or {}).get("role") == "admin" else "user"
    db().execute("UPDATE users SET role=? WHERE id=?", (role, uid))
    db().commit()
    return jsonify(ok=True)


@app.delete("/api/admin/users/<int:uid>")
@auth(admin=True)
def admin_del(u, uid):
    if uid == u["id"]:
        return err("Không thể tự xóa mình")
    for p in db().execute("SELECT stored FROM plugins WHERE user_id=?", (uid,)).fetchall():
        (UP / p["stored"]).unlink(missing_ok=True)
    for t in ("plugins", "notes"):
        db().execute(f"DELETE FROM {t} WHERE user_id=?", (uid,))
    db().execute("DELETE FROM users WHERE id=?", (uid,))
    db().commit()
    return jsonify(ok=True)


if __name__ == "__main__":
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=5000, debug=False)
