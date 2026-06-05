import 'dotenv/config';
import express       from 'express';
import { createClient } from '@libsql/client';
import cookieParser  from 'cookie-parser';
import bcrypt        from 'bcryptjs';

const app = express();
app.use(express.json());
app.use(cookieParser());

// ─── Turso DB Client ──────────────────────────────────────────────────────────
const db = createClient({
  url:       process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// ─── Helper ───────────────────────────────────────────────────────────────────
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch((err) => {
    console.error(err);
    res.status(500).json({ error: err.message });
  });

// ─── AUTH ─────────────────────────────────────────────────────────────────────

// POST /auth/register
app.post('/auth/register', asyncHandler(async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password)
    return res.status(400).json({ error: 'username, email und password sind erforderlich.' });

  const pwhash = await bcrypt.hash(password, 10);

  const result = await db.execute({
    sql:  'INSERT INTO users (username, email, pwhash) VALUES (?, ?, ?)',
    args: [username, email, pwhash],
  });

  res.status(201).json({
    message: 'Registrierung erfolgreich.',
    id: Number(result.lastInsertRowid),
    username,
    email,
  });
}));

// POST /auth/login
app.post('/auth/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password)
    return res.status(400).json({ error: 'username und password sind erforderlich.' });

  const result = await db.execute({
    sql:  'SELECT * FROM users WHERE username = ?',
    args: [username],
  });

  const user = result.rows[0];
  if (!user) return res.status(401).json({ error: 'Ungültige Anmeldedaten.' });

  const match = await bcrypt.compare(password, user.pwhash);
  if (!match) return res.status(401).json({ error: 'Ungültige Anmeldedaten.' });

  res.cookie('session', JSON.stringify({ id: user.id, username: user.username }), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge:   7 * 24 * 60 * 60 * 1000, // 7 Tage
  });

  res.json({
    message: 'Login erfolgreich.',
    user: { id: user.id, username: user.username, email: user.email },
  });
}));

// POST /auth/logout
app.post('/auth/logout', (req, res) => {
  res.clearCookie('session');
  res.json({ message: 'Logout erfolgreich.' });
});

// ─── USERS ────────────────────────────────────────────────────────────────────

// GET /users
app.get('/users', asyncHandler(async (_req, res) => {
  const result = await db.execute('SELECT id, username, email FROM users');
  res.json(result.rows);
}));

// GET /users/:id
app.get('/users/:id', asyncHandler(async (req, res) => {
  const result = await db.execute({
    sql:  'SELECT id, username, email FROM users WHERE id = ?',
    args: [req.params.id],
  });
  if (!result.rows[0]) return res.status(404).json({ error: 'User nicht gefunden.' });
  res.json(result.rows[0]);
}));

// POST /users
app.post('/users', asyncHandler(async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: 'username, email und password sind erforderlich.' });

  const pwhash = await bcrypt.hash(password, 10);
  const result = await db.execute({
    sql:  'INSERT INTO users (username, email, pwhash) VALUES (?, ?, ?)',
    args: [username, email, pwhash],
  });
  res.status(201).json({ id: Number(result.lastInsertRowid), username, email });
}));

// PUT /users/:id
app.put('/users/:id', asyncHandler(async (req, res) => {
  const { username, email, password } = req.body;
  const fields = [];
  const args   = [];

  if (username)  { fields.push('username = ?'); args.push(username); }
  if (email)     { fields.push('email = ?');    args.push(email); }
  if (password)  {
    const pwhash = await bcrypt.hash(password, 10);
    fields.push('pwhash = ?');
    args.push(pwhash);
  }
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

// ─── ANIME CHARACTERS ────────────────────────────────────────────────────────

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
  const { name, lastname, age, animeid } = req.body;

  const result = await db.execute({
    sql:  'INSERT INTO anime_characters (name, lastname, age, animeid) VALUES (?, ?, ?, ?)',
    args: [name ?? null, lastname ?? null, age ?? null, animeid ?? null],
  });
  res.status(201).json({
    id: Number(result.lastInsertRowid),
    name, lastname, age, animeid,
  });
}));

// PUT /characters/:id
app.put('/characters/:id', asyncHandler(async (req, res) => {
  const { name, lastname, age, animeid } = req.body;
  const fields = [];
  const args   = [];

  if (name     !== undefined) { fields.push('name = ?');     args.push(name); }
  if (lastname !== undefined) { fields.push('lastname = ?'); args.push(lastname); }
  if (age      !== undefined) { fields.push('age = ?');      args.push(age); }
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

// POST /ratings  — upsert: legt an oder überschreibt bestehende Bewertung
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