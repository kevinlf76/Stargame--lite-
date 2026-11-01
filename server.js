const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");
require("dotenv").config?.();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET;

if (isProduction && (!sessionSecret || sessionSecret.length < 32 || sessionSecret.includes("REEMPLAZAR"))) {
  throw new Error("Configurá SESSION_SECRET con al menos 32 caracteres aleatorios antes de producción.");
}
if (isProduction) app.set("trust proxy", 1);

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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT
  );
  CREATE TABLE IF NOT EXISTS demo_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: isProduction ? [] : null
    }
  }
}));
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));

app.use(session({
  name: "stargame.sid",
  store: new SQLiteStore({ db: "sessions.sqlite", dir: dataDir }),
  secret: sessionSecret || "solo-desarrollo-no-usar-en-produccion-cambiar-secreto",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 8
  }
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Esperá unos minutos e intentá nuevamente." }
});

function cleanUsername(value) {
  return typeof value === "string" ? value.trim() : "";
}
function validUsername(username) {
  return /^[a-zA-Z0-9_]{3,20}$/.test(username);
}
function validPassword(password) {
  return typeof password === "string" && password.length >= 10 && password.length <= 72;
}
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Iniciá sesión para continuar." });
  next();
}

app.post("/api/register", authLimiter, async (req, res) => {
  const username = cleanUsername(req.body.username);
  const password = req.body.password;
  if (!validUsername(username)) {
    return res.status(400).json({ error: "El usuario debe tener entre 3 y 20 caracteres: letras, números o guion bajo." });
  }
  if (!validPassword(password)) {
    return res.status(400).json({ error: "La contraseña debe tener entre 10 y 72 caracteres." });
  }
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username, passwordHash);
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: "No se pudo iniciar la sesión." });
      req.session.user = { id: Number(result.lastInsertRowid), username };
      req.session.save((saveErr) => {
        if (saveErr) return res.status(500).json({ error: "No se pudo guardar la sesión." });
        res.status(201).json({ user: req.session.user });
      });
    });
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) {
      return res.status(409).json({ error: "Ese nombre de usuario ya está registrado." });
    }
    console.error(error);
    res.status(500).json({ error: "Ocurrió un error al crear la cuenta." });
  }
});

app.post("/api/login", authLimiter, async (req, res) => {
  const username = cleanUsername(req.body.username);
  const password = req.body.password;
  const row = db.prepare("SELECT id, username, password_hash FROM users WHERE username = ? COLLATE NOCASE").get(username);
  const matches = row ? await bcrypt.compare(String(password || ""), row.password_hash) : false;
  if (!matches) return res.status(401).json({ error: "Usuario o contraseña incorrectos." });

  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(row.id);
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: "No se pudo iniciar la sesión." });
    req.session.user = { id: row.id, username: row.username };
    req.session.save((saveErr) => {
      if (saveErr) return res.status(500).json({ error: "No se pudo guardar la sesión." });
      res.json({ user: req.session.user });
    });
  });
});

app.get("/api/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy((err) => {
    res.clearCookie("stargame.sid", { httpOnly: true, sameSite: "lax", secure: isProduction });
    if (err) return res.status(500).json({ error: "No se pudo cerrar la sesión." });
    res.json({ ok: true });
  });
});

app.get("/api/activity", requireAuth, (req, res) => {
  const rows = db.prepare(
    "SELECT event_type, details, created_at FROM demo_activity WHERE user_id = ? ORDER BY id DESC LIMIT 20"
  ).all(req.session.user.id);
  res.json({ activity: rows });
});

app.post("/api/activity", requireAuth, (req, res) => {
  const allowed = new Set(["demo_game_opened", "profile_viewed"]);
  const eventType = String(req.body.eventType || "");
  if (!allowed.has(eventType)) return res.status(400).json({ error: "Evento no permitido." });
  db.prepare("INSERT INTO demo_activity (user_id, event_type, details) VALUES (?, ?, ?)").run(
    req.session.user.id, eventType, String(req.body.details || "").slice(0, 100)
  );
  res.status(201).json({ ok: true });
});

app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => {
  console.log(`Stargame Elite disponible en http://localhost:${PORT}`);
});
