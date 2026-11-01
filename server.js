
require("dotenv").config();

const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const production = process.env.NODE_ENV === "production";

if (!process.env.DATABASE_URL) {
  throw new Error("Falta configurar DATABASE_URL con la conexión de Neon.");
}

if (
  production &&
  (!process.env.SESSION_SECRET ||
    process.env.SESSION_SECRET.length < 32 ||
    process.env.SESSION_SECRET.startsWith("CAMBIAR"))
) {
  throw new Error("Configurá SESSION_SECRET con al menos 32 caracteres.");
}

if (production) app.set("trust proxy", 1);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on("error", (err) => {
  console.error("Error inesperado en PostgreSQL:", err);
});

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    );

    CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique
    ON users (LOWER(username));

    CREATE TABLE IF NOT EXISTS activity (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      details TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS activity_user_id_id_idx
    ON activity (user_id, id DESC);
  `);
}

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
  store: new PgSession({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: true
  }),
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
  message: {
    error: "Demasiados intentos. Esperá unos minutos y probá otra vez."
  }
});

const validUsername = (s) =>
  typeof s === "string" && /^[A-Za-z0-9_]{3,20}$/.test(s.trim());

const validPassword = (s) =>
  typeof s === "string" && s.length >= 10 && s.length <= 72;

const requireAuth = (req, res, next) =>
  req.session.user
    ? next()
    : res.status(401).json({ error: "Iniciá sesión para continuar." });

const requireAdmin = (req, res, next) =>
  req.session.user?.role === "admin"
    ? next()
    : res.status(403).json({ error: "Acceso exclusivo para administración." });

async function ensureAdmin() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    throw new Error("Faltan ADMIN_USERNAME o ADMIN_PASSWORD en las variables privadas.");
  }

  if (!validUsername(username) || !validPassword(password)) {
    throw new Error("ADMIN_USERNAME debe tener 3-20 caracteres válidos y ADMIN_PASSWORD entre 10 y 72 caracteres.");
  }

  const existing = await pool.query(
    "SELECT id FROM users WHERE LOWER(username) = LOWER($1)",
    [username]
  );

  if (existing.rows.length) {
    await pool.query(
      "UPDATE users SET role = 'admin' WHERE id = $1",
      [existing.rows[0].id]
    );
  } else {
    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'admin')",
      [username, hash]
    );
  }
}

app.post("/api/register", authLimiter, async (req, res) => {
  const username =
    typeof req.body.username === "string" ? req.body.username.trim() : "";
  const password = req.body.password;

  if (!validUsername(username)) {
    return res.status(400).json({
      error: "El usuario debe tener de 3 a 20 caracteres: letras, números o guion bajo."
    });
  }

  if (!validPassword(password)) {
    return res.status(400).json({
      error: "La contraseña debe tener entre 10 y 72 caracteres."
    });
  }

  try {
    const hash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id",
      [username, hash]
    );

    req.session.regenerate((err) => {
      if (err) {
        return res.status(500).json({ error: "No se pudo iniciar la sesión." });
      }

      req.session.user = {
        id: Number(result.rows[0].id),
        username,
        role: "user"
      };

      req.session.save((saveErr) =>
        saveErr
          ? res.status(500).json({ error: "No se pudo guardar la sesión." })
          : res.status(201).json({ user: req.session.user })
      );
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Ese nombre de usuario ya existe." });
    }

    console.error(err);
    res.status(500).json({ error: "No se pudo crear la cuenta." });
  }
});

app.post("/api/login", authLimiter, async (req, res) => {
  const username =
    typeof req.body.username === "string" ? req.body.username.trim() : "";
  const password =
    typeof req.body.password === "string" ? req.body.password : "";

  try {
    const result = await pool.query(
      "SELECT id, username, password_hash, role FROM users WHERE LOWER(username) = LOWER($1)",
      [username]
    );

    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({
        error: "Usuario o contraseña incorrectos."
      });
    }

    await pool.query(
      "UPDATE users SET last_login_at = NOW() WHERE id = $1",
      [user.id]
    );

    req.session.regenerate((err) => {
      if (err) {
        return res.status(500).json({ error: "No se pudo iniciar la sesión." });
      }

      req.session.user = {
        id: Number(user.id),
        username: user.username,
        role: user.role
      };

      req.session.save((saveErr) =>
        saveErr
          ? res.status(500).json({ error: "No se pudo guardar la sesión." })
          : res.json({ user: req.session.user })
      );
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo iniciar sesión." });
  }
});

app.get("/api/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

app.get("/api/admin/users", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, username, role, created_at, last_login_at FROM users ORDER BY id DESC LIMIT 500"
    );
    res.json({ users: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudieron consultar los usuarios." });
  }
});

app.post("/api/admin/users", requireAuth, requireAdmin, async (req, res) => {
  const username =
    typeof req.body.username === "string" ? req.body.username.trim() : "";
  const password = req.body.password;

  if (!validUsername(username)) {
    return res.status(400).json({
      error: "Usuario: 3 a 20 caracteres, letras, números o guion bajo."
    });
  }

  if (!validPassword(password)) {
    return res.status(400).json({
      error: "La contraseña debe tener entre 10 y 72 caracteres."
    });
  }

  try {
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'user') RETURNING id",
      [username, hash]
    );

    res.status(201).json({
      id: Number(result.rows[0].id),
      username
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Ese usuario ya existe." });
    }

    console.error(err);
    res.status(500).json({ error: "No se pudo crear el usuario." });
  }
});

app.delete("/api/admin/users/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isSafeInteger(id) || id <= 0 || id === req.session.user.id) {
    return res.status(400).json({
      error: "No podés eliminar tu propia cuenta desde este panel."
    });
  }

  try {
    const target = await pool.query(
      "SELECT id, role FROM users WHERE id = $1",
      [id]
    );

    if (!target.rows.length) {
      return res.status(404).json({ error: "Usuario no encontrado." });
    }

    if (target.rows[0].role === "admin") {
      return res.status(403).json({
        error: "No se pueden eliminar administradores desde este panel."
      });
    }

    await pool.query("DELETE FROM users WHERE id = $1", [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo eliminar el usuario." });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy((err) => {
    res.clearCookie("stargame.sid", {
      httpOnly: true,
      sameSite: "lax",
      secure: production
    });

    if (err) {
      return res.status(500).json({ error: "No se pudo cerrar sesión." });
    }

    res.json({ ok: true });
  });
});

app.get("/api/activity", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT event_type, details, created_at FROM activity WHERE user_id = $1 ORDER BY id DESC LIMIT 25",
      [req.session.user.id]
    );

    res.json({ activity: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo consultar la actividad." });
  }
});

app.post("/api/activity", requireAuth, async (req, res) => {
  const allowed = new Set(["demo_game_opened", "profile_viewed"]);
  const type = String(req.body.eventType || "");

  if (!allowed.has(type)) {
    return res.status(400).json({ error: "Acción no permitida." });
  }

  try {
    await pool.query(
      "INSERT INTO activity (user_id, event_type, details) VALUES ($1, $2, $3)",
      [
        req.session.user.id,
        type,
        String(req.body.details || "").slice(0, 100)
      ]
    );

    res.status(201).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo guardar la actividad." });
  }
});

app.get("/admin.html", requireAuth, requireAdmin, (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.use(express.static(path.join(__dirname, "public"), {
  extensions: ["html"]
}));

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

async function start() {
  try {
    await initializeDatabase();
    await ensureAdmin();

    app.listen(PORT, () => {
      console.log(`Stargame Elite iniciado en el puerto ${PORT}`);
    });
  } catch (err) {
    console.error("No se pudo iniciar Stargame Elite:", err);
    process.exit(1);
  }
}

start();
