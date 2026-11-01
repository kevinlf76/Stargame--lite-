require("dotenv").config();
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const production = process.env.NODE_ENV === "production";
if (production && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 || process.env.SESSION_SECRET.startsWith("CAMBIAR"))) {
  throw new Error("Antes de producción, configurá SESSION_SECRET con una clave aleatoria de al menos 32 caracteres.");
}
if (production) app.set("trust proxy", 1);

const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, "stargame.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT
  );
  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);
// Migración compatible con la base existente.
const userColumns = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
if (!userColumns.includes('role')) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      fontSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));

app.use(session({
  name: "stargame.sid",
  store: new SQLiteStore({ db: "sessions.sqlite", dir: dataDir }),
  secret: process.env.SESSION_SECRET || "solo-desarrollo-no-usar-en-produccion-cambiar",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: production,
    maxAge: 8 * 60 * 60 * 1000
  }
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Esperá unos minutos y probá otra vez." }
});
const validUsername = (s) => typeof s === "string" && /^[A-Za-z0-9_]{3,20}$/.test(s.trim());
const validPassword = (s) => typeof s === "string" && s.length >= 10 && s.length <= 72;
const requireAuth = (req, res, next) => req.session.user ? next() : res.status(401).json({ error: "Iniciá sesión para continuar." });
const requireAdmin = (req, res, next) => req.session.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Acceso exclusivo para administración.' });

// La cuenta administradora se crea mediante variables privadas del servidor.
async function ensureAdmin() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return;
  if (!validUsername(username) || !validPassword(password)) throw new Error('ADMIN_USERNAME debe tener 3-20 caracteres válidos y ADMIN_PASSWORD entre 10 y 72 caracteres.');
  const existing = db.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').get(username);
  if (existing) db.prepare("UPDATE users SET role='admin' WHERE id=?").run(existing.id);
  else { const hash = await bcrypt.hash(password, 12); db.prepare("INSERT INTO users(username,password_hash,role) VALUES(?,?,'admin')").run(username, hash); }
}


app.post("/api/register", authLimiter, async (req, res) => {
  const username = typeof req.body.username === "string" ? req.body.username.trim() : "";
  const password = req.body.password;
  if (!validUsername(username)) return res.status(400).json({ error: "El usuario debe tener de 3 a 20 caracteres: letras, números o guion bajo." });
  if (!validPassword(password)) return res.status(400).json({ error: "La contraseña debe tener entre 10 y 72 caracteres." });
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare("INSERT INTO users(username,password_hash) VALUES(?,?)").run(username, hash);
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: "No se pudo iniciar la sesión." });
      req.session.user = { id: Number(result.lastInsertRowid), username, role: 'user' };
      req.session.save((saveErr) => saveErr ? res.status(500).json({ error: "No se pudo guardar la sesión." }) : res.status(201).json({ user: req.session.user }));
    });
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) return res.status(409).json({ error: "Ese nombre de usuario ya existe." });
    console.error(err);
    res.status(500).json({ error: "No se pudo crear la cuenta." });
  }
});

app.post("/api/login", authLimiter, async (req, res) => {
  const username = typeof req.body.username === "string" ? req.body.username.trim() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const user = db.prepare("SELECT id, username, password_hash, role FROM users WHERE username = ? COLLATE NOCASE").get(username);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: "Usuario o contraseña incorrectos." });
  db.prepare("UPDATE users SET last_login_at=datetime('now') WHERE id=?").run(user.id);
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: "No se pudo iniciar la sesión." });
    req.session.user = { id: user.id, username: user.username, role: user.role };
    req.session.save((saveErr) => saveErr ? res.status(500).json({ error: "No se pudo guardar la sesión." }) : res.json({ user: req.session.user }));
  });
});
app.get("/api/me", (req, res) => res.json({ user: req.session.user || null }));
app.get('/api/admin/users', requireAuth, requireAdmin, (_req, res) => {
  const users = db.prepare("SELECT id, username, role, created_at, last_login_at FROM users ORDER BY id DESC LIMIT 500").all();
  res.json({ users });
});
app.post('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
  const password = req.body.password;
  if (!validUsername(username)) return res.status(400).json({ error: 'Usuario: 3 a 20 caracteres, letras, números o guion bajo.' });
  if (!validPassword(password)) return res.status(400).json({ error: 'La contraseña debe tener entre 10 y 72 caracteres.' });
  try { const hash = await bcrypt.hash(password, 12); const result = db.prepare("INSERT INTO users(username,password_hash,role) VALUES(?,?,'user')").run(username, hash); res.status(201).json({ id: Number(result.lastInsertRowid), username }); }
  catch (err) { if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'Ese usuario ya existe.' }); console.error(err); res.status(500).json({ error: 'No se pudo crear el usuario.' }); }
});
app.delete('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id); if (!Number.isSafeInteger(id) || id === req.session.user.id) return res.status(400).json({ error: 'No podés eliminar tu propia cuenta desde este panel.' });
  const target = db.prepare('SELECT id, role FROM users WHERE id=?').get(id); if (!target) return res.status(404).json({ error: 'Usuario no encontrado.' });
  if (target.role === 'admin') return res.status(403).json({ error: 'No se pueden eliminar administradores desde este panel.' });
  db.prepare('DELETE FROM users WHERE id=?').run(id); res.json({ ok: true });
});
app.post("/api/logout", (req, res) => {
  req.session.destroy((err) => {
    res.clearCookie("stargame.sid", { httpOnly: true, sameSite: "lax", secure: production });
    if (err) return res.status(500).json({ error: "No se pudo cerrar sesión." });
    res.json({ ok: true });
  });
});
app.get("/api/activity", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT event_type, details, created_at FROM activity WHERE user_id=? ORDER BY id DESC LIMIT 25").all(req.session.user.id);
  res.json({ activity: rows });
});
app.post("/api/activity", requireAuth, (req, res) => {
  const allowed = new Set(["demo_game_opened", "profile_viewed"]);
  const type = String(req.body.eventType || "");
  if (!allowed.has(type)) return res.status(400).json({ error: "Acción no permitida." });
  db.prepare("INSERT INTO activity(user_id,event_type,details) VALUES(?,?,?)").run(req.session.user.id, type, String(req.body.details || "").slice(0, 100));
  res.status(201).json({ ok: true });
});
app.get("/admin.html", requireAuth, requireAdmin, (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
ensureAdmin().then(() => app.listen(PORT, () => console.log(`Stargame Elite: http://localhost:${PORT}`))).catch((err) => { console.error(err); process.exit(1); });
