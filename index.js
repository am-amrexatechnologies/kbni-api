import 'dotenv/config';
import express          from 'express';
import { createClient } from '@libsql/client';
import cookieParser     from 'cookie-parser';
import bcrypt           from 'bcryptjs';
import nodemailer       from 'nodemailer';
import cors             from 'cors';
import dns              from 'dns/promises';

const app = express();

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['https://kbni.vercel.app'];

app.use(cors({
  origin: (origin, cb) => {
    // Erlaubt auch requests ohne Origin (z.B. Server-zu-Server, curl)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: Origin ${origin} nicht erlaubt.`));
  },
  credentials:    true,
  methods:        ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.options('*', cors()); // Preflight für alle Routen

app.use(express.json());
app.use(cookieParser());

// ─── Turso DB Client ──────────────────────────────────────────────────────────
const db = createClient({
  url:       process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// ─── Nodemailer Transporter ───────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true', // true für Port 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ─── Helper ───────────────────────────────────────────────────────────────────
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch((err) => {
    console.error(err);
    res.status(500).json({ error: err.message });
  });

/** Prüft E-Mail-Format via Regex */
function isEmailFormatValid(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/**
 * Prüft ob die Domain der E-Mail-Adresse einen MX-Record besitzt.
 * Das ist kein Garant, aber filtert Fake-Domains (z.B. test@nonexistent.xyz) zuverlässig.
 */
async function isEmailDomainValid(email) {
  const domain = email.split('@')[1];
  if (!domain) return false;
  try {
    const records = await dns.resolveMx(domain);
    return Array.isArray(records) && records.length > 0;
  } catch {
    return false;
  }
}

/** Sendet eine Willkommens-E-Mail nach erfolgreicher Registrierung */
async function sendWelcomeEmail(email, username) {
  await transporter.sendMail({
    from:    `"${process.env.SMTP_FROM_NAME || 'App'}" <${process.env.SMTP_FROM_EMAIL}>`,
    to:      email,
    subject: 'Willkommen bei uns! 🎉',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: auto;">
        <h2>Hey ${username}, willkommen! 👋</h2>
        <p>Dein Account wurde erfolgreich erstellt. Schön, dass du dabei bist!</p>
        <p>Viel Spaß auf der Plattform.</p>
        <hr style="border: none; border-top: 1px solid #eee;" />
        <p style="font-size: 12px; color: #999;">
          Diese E-Mail wurde automatisch verschickt. Bitte antworte nicht darauf.
        </p>
      </div>
    `,
  });
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────

/**
 * POST /auth/register
 * Registriert einen neuen User mit gehashtem Passwort.
 * Validiert E-Mail-Format und Domain (MX-Record).
 * Sendet anschließend eine Willkommens-E-Mail.
 */
app.post('/auth/register', asyncHandler(async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password)
    return res.status(400).json({ error: 'username, email und password sind erforderlich.' });

  // E-Mail-Format prüfen
  if (!isEmailFormatValid(email))
    return res.status(400).json({ error: 'Ungültiges E-Mail-Format.' });

  // E-Mail-Domain prüfen (MX-Record)
  const domainValid = await isEmailDomainValid(email);
  if (!domainValid)
    return res.status(400).json({ error: 'Die E-Mail-Domain existiert nicht oder akzeptiert keine Mails.' });

  // Passwort hashen
  const pwhash = await bcrypt.hash(password, 12);

  const result = await db.execute({
    sql:  'INSERT INTO users (username, email, pwhash) VALUES (?, ?, ?)',
    args: [username, email, pwhash],
  });

  // Willkommens-E-Mail – Fehler hier sollen die Registrierung nicht blockieren
  try {
    await sendWelcomeEmail(email, username);
  } catch (mailErr) {
    console.error('Willkommens-E-Mail konnte nicht gesendet werden:', mailErr.message);
  }

  res.status(201).json({
    message: 'Registrierung erfolgreich.',
    id:      Number(result.lastInsertRowid),
    username,
    email,
  });
}));

/**
 * POST /auth/login
 * Login für normale User — alle Rollen erlaubt (für die User-App).
 */
app.post('/auth/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password)
    return res.status(400).json({ error: 'username und password sind erforderlich.' });

  const result = await db.execute({
    sql:  'SELECT u.*, r.role as role_name FROM users u JOIN roles r ON r.id = u.role WHERE u.username = ?',
    args: [username],
  });

  const user = result.rows[0];
  if (!user) return res.status(401).json({ error: 'Ungültige Anmeldedaten.' });

  const passwordMatch = await bcrypt.compare(password, user.pwhash);
  if (!passwordMatch) return res.status(401).json({ error: 'Ungültige Anmeldedaten.' });

  res.cookie('session', JSON.stringify({ id: user.id, username: user.username, role: user.role_name }), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge:   7 * 24 * 60 * 60 * 1000, // 7 Tage
  });

  res.json({
    message: 'Login erfolgreich.',
    user: { id: user.id, username: user.username, email: user.email, role: user.role_name },
  });
}));

/**
 * POST /auth/admin/login
 * Login ausschließlich für Admins — für die Management App.
 * Normale User erhalten 403.
 */
app.post('/auth/admin/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password)
    return res.status(400).json({ error: 'username und password sind erforderlich.' });

  const result = await db.execute({
    sql:  'SELECT u.*, r.role as role_name FROM users u JOIN roles r ON r.id = u.role WHERE u.username = ?',
    args: [username],
  });

  const user = result.rows[0];
  if (!user) return res.status(401).json({ error: 'Ungültige Anmeldedaten.' });

  const passwordMatch = await bcrypt.compare(password, user.pwhash);
  if (!passwordMatch) return res.status(401).json({ error: 'Ungültige Anmeldedaten.' });

  // Nur Admins dürfen sich hier anmelden
  if (user.role_name !== 'admin')
    return res.status(403).json({ error: 'Keine Berechtigung für die Management App.' });

  res.cookie('session', JSON.stringify({ id: user.id, username: user.username, role: user.role_name }), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge:   7 * 24 * 60 * 60 * 1000,
  });

  res.json({
    message: 'Login erfolgreich.',
    user: { id: user.id, username: user.username, email: user.email, role: user.role_name },
  });
}));

// POST /auth/logout
app.post('/auth/logout', (req, res) => {
  res.clearCookie('session');
  res.json({ message: 'Logout erfolgreich.' });
});

// GET /auth/me — gibt den aktuell eingeloggten User zurück
app.get('/auth/me', asyncHandler(async (req, res) => {
  const raw = req.cookies?.session;
  if (!raw) return res.status(401).json({ error: 'Nicht eingeloggt.' });

  let session;
  try {
    session = JSON.parse(raw);
  } catch {
    return res.status(401).json({ error: 'Ungültige Session.' });
  }

  const result = await db.execute({
    sql:  'SELECT u.id, u.username, u.email, r.role as role_name FROM users u JOIN roles r ON r.id = u.role WHERE u.id = ?',
    args: [session.id],
  });

  if (!result.rows[0]) return res.status(401).json({ error: 'User nicht gefunden.' });
  res.json(result.rows[0]);
}));

// ─── ROLES ────────────────────────────────────────────────────────────────────

// GET /roles
app.get('/roles', asyncHandler(async (_req, res) => {
  const result = await db.execute('SELECT * FROM roles');
  res.json(result.rows);
}));

// ─── USERS ────────────────────────────────────────────────────────────────────

// GET /users
app.get('/users', asyncHandler(async (_req, res) => {
  const result = await db.execute(
    'SELECT u.id, u.username, u.email, u.role, r.role as role_name FROM users u JOIN roles r ON r.id = u.role'
  );
  res.json(result.rows);
}));

// GET /users/:id
app.get('/users/:id', asyncHandler(async (req, res) => {
  const result = await db.execute({
    sql:  'SELECT u.id, u.username, u.email, u.role, r.role as role_name FROM users u JOIN roles r ON r.id = u.role WHERE u.id = ?',
    args: [req.params.id],
  });
  if (!result.rows[0]) return res.status(404).json({ error: 'User nicht gefunden.' });
  res.json(result.rows[0]);
}));

// POST /users
app.post('/users', asyncHandler(async (req, res) => {
  const { username, email, password, role } = req.body;

  if (!username || !email || !password)
    return res.status(400).json({ error: 'username, email und password sind erforderlich.' });

  if (!isEmailFormatValid(email))
    return res.status(400).json({ error: 'Ungültiges E-Mail-Format.' });

  const pwhash = await bcrypt.hash(password, 12);

  const result = await db.execute({
    sql:  'INSERT INTO users (username, email, pwhash, role) VALUES (?, ?, ?, ?)',
    args: [username, email, pwhash, role ?? 1],
  });
  res.status(201).json({ id: Number(result.lastInsertRowid), username, email, role: role ?? 1 });
}));

// PUT /users/:id
app.put('/users/:id', asyncHandler(async (req, res) => {
  const { username, email, password, role } = req.body;
  const fields = [];
  const args   = [];

  if (username) { fields.push('username = ?'); args.push(username); }
  if (email)    { fields.push('email = ?');    args.push(email); }
  if (password) {
    const pwhash = await bcrypt.hash(password, 12);
    fields.push('pwhash = ?');
    args.push(pwhash);
  }
  if (role !== undefined) { fields.push('role = ?'); args.push(role); }

  if (!fields.length) return res.status(400).json({ error: 'Keine Felder zum Aktualisieren.' });

  args.push(req.params.id);
  await db.execute({ sql: `UPDATE users SET ${fields.join(', ')} WHERE id = ?`, args });
  res.json({ message: 'User aktualisiert.' });
}));

// DELETE /users/:id
app.delete('/users/:id', asyncHandler(async (req, res) => {
  await db.execute({ sql: 'DELETE FROM users WHERE id = ?', args: [req.params.id] });
  res.json({ message: 'User gelöscht.' });
}));

// ─── ANIME ────────────────────────────────────────────────────────────────────

// GET /anime
app.get('/anime', asyncHandler(async (_req, res) => {
  const result = await db.execute('SELECT * FROM anime');
  res.json(result.rows);
}));

// GET /anime/:id
app.get('/anime/:id', asyncHandler(async (req, res) => {
  const result = await db.execute({
    sql:  'SELECT * FROM anime WHERE id = ?',
    args: [req.params.id],
  });
  if (!result.rows[0]) return res.status(404).json({ error: 'Anime nicht gefunden.' });
  res.json(result.rows[0]);
}));

// POST /anime
app.post('/anime', asyncHandler(async (req, res) => {
  const { id, animename } = req.body;
  if (!animename) return res.status(400).json({ error: 'animename ist erforderlich.' });

  await db.execute({
    sql:  'INSERT INTO anime (id, animename) VALUES (?, ?)',
    args: [id ?? null, animename],
  });
  res.status(201).json({ message: 'Anime erstellt.', id: id ?? null, animename });
}));

// PUT /anime/:id
app.put('/anime/:id', asyncHandler(async (req, res) => {
  const { animename } = req.body;
  if (!animename) return res.status(400).json({ error: 'animename ist erforderlich.' });

  await db.execute({
    sql:  'UPDATE anime SET animename = ? WHERE id = ?',
    args: [animename, req.params.id],
  });
  res.json({ message: 'Anime aktualisiert.' });
}));

// DELETE /anime/:id
app.delete('/anime/:id', asyncHandler(async (req, res) => {
  await db.execute({ sql: 'DELETE FROM anime WHERE id = ?', args: [req.params.id] });
  res.json({ message: 'Anime gelöscht.' });
}));

// ─── ANIME CHARACTERS ─────────────────────────────────────────────────────────
// Hinweis: Das Feld `age` existiert nicht mehr im DB-Schema und wurde entfernt.

// GET /characters
app.get('/characters', asyncHandler(async (_req, res) => {
  const result = await db.execute('SELECT * FROM anime_characters');
  res.json(result.rows);
}));

// GET /characters/:id
app.get('/characters/:id', asyncHandler(async (req, res) => {
  const result = await db.execute({
    sql:  'SELECT * FROM anime_characters WHERE id = ?',
    args: [req.params.id],
  });
  if (!result.rows[0]) return res.status(404).json({ error: 'Character nicht gefunden.' });
  res.json(result.rows[0]);
}));

// POST /characters
app.post('/characters', asyncHandler(async (req, res) => {
  const { name, lastname, animeid } = req.body;

  const result = await db.execute({
    sql:  'INSERT INTO anime_characters (name, lastname, animeid) VALUES (?, ?, ?)',
    args: [name ?? null, lastname ?? null, animeid ?? null],
  });
  res.status(201).json({
    id: Number(result.lastInsertRowid),
    name, lastname, animeid,
  });
}));

// PUT /characters/:id
app.put('/characters/:id', asyncHandler(async (req, res) => {
  const { name, lastname, animeid } = req.body;
  const fields = [];
  const args   = [];

  if (name     !== undefined) { fields.push('name = ?');     args.push(name); }
  if (lastname !== undefined) { fields.push('lastname = ?'); args.push(lastname); }
  if (animeid  !== undefined) { fields.push('animeid = ?');  args.push(animeid); }

  if (!fields.length) return res.status(400).json({ error: 'Keine Felder zum Aktualisieren.' });

  args.push(req.params.id);
  await db.execute({ sql: `UPDATE anime_characters SET ${fields.join(', ')} WHERE id = ?`, args });
  res.json({ message: 'Character aktualisiert.' });
}));

// DELETE /characters/:id
app.delete('/characters/:id', asyncHandler(async (req, res) => {
  await db.execute({
    sql:  'DELETE FROM anime_characters WHERE id = ?',
    args: [req.params.id],
  });
  res.json({ message: 'Character gelöscht.' });
}));

// ─── CHAT ─────────────────────────────────────────────────────────────────────

// GET /chat
app.get('/chat', asyncHandler(async (_req, res) => {
  const result = await db.execute('SELECT * FROM chat ORDER BY timeposted ASC');
  res.json(result.rows);
}));

// GET /chat/:id
app.get('/chat/:id', asyncHandler(async (req, res) => {
  const result = await db.execute({
    sql:  'SELECT * FROM chat WHERE id = ?',
    args: [req.params.id],
  });
  if (!result.rows[0]) return res.status(404).json({ error: 'Nachricht nicht gefunden.' });
  res.json(result.rows[0]);
}));

// POST /chat
app.post('/chat', asyncHandler(async (req, res) => {
  const { username, text, type, timeposted } = req.body;

  if (!username || !timeposted)
    return res.status(400).json({ error: 'username und timeposted sind erforderlich.' });

  const result = await db.execute({
    sql:  'INSERT INTO chat (username, text, type, timeposted) VALUES (?, ?, ?, ?)',
    args: [username, text ?? null, type ?? null, timeposted],
  });
  res.status(201).json({
    id: Number(result.lastInsertRowid),
    username, text, type, timeposted,
  });
}));

// PUT /chat/:id
app.put('/chat/:id', asyncHandler(async (req, res) => {
  const { text, type } = req.body;
  const fields = [];
  const args   = [];

  if (text !== undefined) { fields.push('text = ?'); args.push(text); }
  if (type !== undefined) { fields.push('type = ?'); args.push(type); }

  if (!fields.length) return res.status(400).json({ error: 'Keine Felder zum Aktualisieren.' });

  args.push(req.params.id);
  await db.execute({ sql: `UPDATE chat SET ${fields.join(', ')} WHERE id = ?`, args });
  res.json({ message: 'Nachricht aktualisiert.' });
}));

// DELETE /chat/:id
app.delete('/chat/:id', asyncHandler(async (req, res) => {
  await db.execute({ sql: 'DELETE FROM chat WHERE id = ?', args: [req.params.id] });
  res.json({ message: 'Nachricht gelöscht.' });
}));

// ─── CHARACTER RATINGS ───────────────────────────────────────────────────────

// GET /ratings
app.get('/ratings', asyncHandler(async (_req, res) => {
  const result = await db.execute('SELECT * FROM character_ratings');
  res.json(result.rows);
}));

// GET /ratings/:userId/:characterId
app.get('/ratings/:userId/:characterId', asyncHandler(async (req, res) => {
  const result = await db.execute({
    sql:  'SELECT * FROM character_ratings WHERE user_id = ? AND character_id = ?',
    args: [req.params.userId, req.params.characterId],
  });
  if (!result.rows[0]) return res.status(404).json({ error: 'Rating nicht gefunden.' });
  res.json(result.rows[0]);
}));

// POST /ratings — upsert: legt an oder überschreibt bestehende Bewertung
app.post('/ratings', asyncHandler(async (req, res) => {
  const { user_id, character_id, rating } = req.body;

  if (!user_id || !character_id || rating === undefined)
    return res.status(400).json({ error: 'user_id, character_id und rating sind erforderlich.' });

  await db.execute({
    sql: `INSERT INTO character_ratings (user_id, character_id, rating)
          VALUES (?, ?, ?)
          ON CONFLICT(user_id, character_id)
          DO UPDATE SET rating = excluded.rating, updated_at = datetime('now')`,
    args: [user_id, character_id, rating],
  });
  res.status(201).json({ message: 'Rating gespeichert.' });
}));

// PUT /ratings/:userId/:characterId
app.put('/ratings/:userId/:characterId', asyncHandler(async (req, res) => {
  const { rating } = req.body;
  if (rating === undefined) return res.status(400).json({ error: 'rating ist erforderlich.' });

  await db.execute({
    sql:  `UPDATE character_ratings SET rating = ?, updated_at = datetime('now')
           WHERE user_id = ? AND character_id = ?`,
    args: [rating, req.params.userId, req.params.characterId],
  });
  res.json({ message: 'Rating aktualisiert.' });
}));

// DELETE /ratings/:userId/:characterId
app.delete('/ratings/:userId/:characterId', asyncHandler(async (req, res) => {
  await db.execute({
    sql:  'DELETE FROM character_ratings WHERE user_id = ? AND character_id = ?',
    args: [req.params.userId, req.params.characterId],
  });
  res.json({ message: 'Rating gelöscht.' });
}));

export default app;
