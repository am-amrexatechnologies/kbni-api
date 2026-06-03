import express from 'express';
import { createClient } from '@libsql/client';

const app = express();
app.use(express.json());

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// ─── USERS ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
	res.json({
		messag: "welcom"
	});
})


app.get('/users', async (req, res) => {
  try {
    const result = await db.execute('SELECT id, username, email FROM users');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// /users/login MUSS vor /users/:id stehen, sonst matched Express "login" als ID
app.post('/users/login', async (req, res) => {
  const { username, pwhash } = req.body;
  if (!username || !pwhash)
    return res.status(400).json({ error: 'username und pwhash erforderlich' });
  try {
    const result = await db.execute({
      sql: 'SELECT id, username, email FROM users WHERE username = ? AND pwhash = ?',
      args: [username, pwhash],
    });
    if (result.rows.length === 0)
      return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/users/:id', async (req, res) => {
  try {
    const result = await db.execute({
      sql: 'SELECT id, username, email FROM users WHERE id = ?',
      args: [req.params.id],
    });
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'User nicht gefunden' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/users', async (req, res) => {
  const { username, email, pwhash } = req.body;
  if (!username || !email || !pwhash)
    return res.status(400).json({ error: 'username, email und pwhash erforderlich' });
  try {
    const result = await db.execute({
      sql: 'INSERT INTO users (username, email, pwhash) VALUES (?, ?, ?)',
      args: [username, email, pwhash],
    });
    res.status(201).json({ id: Number(result.lastInsertRowid), username, email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/users/:id', async (req, res) => {
  const { username, email, pwhash } = req.body;
  try {
    const result = await db.execute({
      sql: `UPDATE users
            SET username = COALESCE(?, username),
                email    = COALESCE(?, email),
                pwhash   = COALESCE(?, pwhash)
            WHERE id = ?`,
      args: [username ?? null, email ?? null, pwhash ?? null, req.params.id],
    });
    if (result.rowsAffected === 0)
      return res.status(404).json({ error: 'User nicht gefunden' });
    res.json({ message: 'User aktualisiert' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/users/:id', async (req, res) => {
  try {
    const result = await db.execute({
      sql: 'DELETE FROM users WHERE id = ?',
      args: [req.params.id],
    });
    if (result.rowsAffected === 0)
      return res.status(404).json({ error: 'User nicht gefunden' });
    res.json({ message: 'User gelöscht' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ANIME ────────────────────────────────────────────────────────────────────

app.get('/anime', async (req, res) => {
  try {
    const result = await db.execute('SELECT * FROM anime');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/anime/:id', async (req, res) => {
  try {
    const result = await db.execute({
      sql: 'SELECT * FROM anime WHERE id = ?',
      args: [req.params.id],
    });
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Anime nicht gefunden' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/anime', async (req, res) => {
  const { id, animename } = req.body;
  if (!animename)
    return res.status(400).json({ error: 'animename erforderlich' });
  try {
    await db.execute({
      sql: 'INSERT INTO anime (id, animename) VALUES (?, ?)',
      args: [id ?? null, animename],
    });
    res.status(201).json({ message: 'Anime erstellt', animename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/anime/:id', async (req, res) => {
  const { animename } = req.body;
  if (!animename)
    return res.status(400).json({ error: 'animename erforderlich' });
  try {
    const result = await db.execute({
      sql: 'UPDATE anime SET animename = ? WHERE id = ?',
      args: [animename, req.params.id],
    });
    if (result.rowsAffected === 0)
      return res.status(404).json({ error: 'Anime nicht gefunden' });
    res.json({ message: 'Anime aktualisiert' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/anime/:id', async (req, res) => {
  try {
    const result = await db.execute({
      sql: 'DELETE FROM anime WHERE id = ?',
      args: [req.params.id],
    });
    if (result.rowsAffected === 0)
      return res.status(404).json({ error: 'Anime nicht gefunden' });
    res.json({ message: 'Anime gelöscht' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ANIME CHARACTERS ─────────────────────────────────────────────────────────

app.get('/characters', async (req, res) => {
  try {
    const result = await db.execute(`
      SELECT ac.*, a.animename
      FROM anime_characters ac
      LEFT JOIN anime a ON ac.animeid = a.id
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/characters/:id', async (req, res) => {
  try {
    const result = await db.execute({
      sql: `SELECT ac.*, a.animename
            FROM anime_characters ac
            LEFT JOIN anime a ON ac.animeid = a.id
            WHERE ac.id = ?`,
      args: [req.params.id],
    });
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Character nicht gefunden' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/anime/:id/characters', async (req, res) => {
  try {
    const result = await db.execute({
      sql: 'SELECT * FROM anime_characters WHERE animeid = ?',
      args: [req.params.id],
    });
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/characters', async (req, res) => {
  const { name, lastname, age, animeid } = req.body;
  try {
    const result = await db.execute({
      sql: 'INSERT INTO anime_characters (name, lastname, age, animeid) VALUES (?, ?, ?, ?)',
      args: [name ?? null, lastname ?? null, age ?? null, animeid ?? null],
    });
    res.status(201).json({
      id: Number(result.lastInsertRowid),
      name,
      lastname,
      age,
      animeid,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/characters/:id', async (req, res) => {
  const { name, lastname, age, animeid } = req.body;
  try {
    const result = await db.execute({
      sql: `UPDATE anime_characters
            SET name     = COALESCE(?, name),
                lastname = COALESCE(?, lastname),
                age      = COALESCE(?, age),
                animeid  = COALESCE(?, animeid)
            WHERE id = ?`,
      args: [name ?? null, lastname ?? null, age ?? null, animeid ?? null, req.params.id],
    });
    if (result.rowsAffected === 0)
      return res.status(404).json({ error: 'Character nicht gefunden' });
    res.json({ message: 'Character aktualisiert' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/characters/:id', async (req, res) => {
  try {
    const result = await db.execute({
      sql: 'DELETE FROM anime_characters WHERE id = ?',
      args: [req.params.id],
    });
    if (result.rowsAffected === 0)
      return res.status(404).json({ error: 'Character nicht gefunden' });
    res.json({ message: 'Character gelöscht' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CHAT ─────────────────────────────────────────────────────────────────────

app.get('/chat', async (req, res) => {
  try {
    const result = await db.execute(
      'SELECT * FROM chat ORDER BY timeposted ASC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/chat', async (req, res) => {
  const { username, text, type } = req.body;
  if (!username)
    return res.status(400).json({ error: 'username erforderlich' });
  const timeposted = new Date().toISOString();
  try {
    const result = await db.execute({
      sql: 'INSERT INTO chat (username, text, type, timeposted) VALUES (?, ?, ?, ?)',
      args: [username, text ?? null, type ?? null, timeposted],
    });
    res.status(201).json({
      id: Number(result.lastInsertRowid),
      username,
      text,
      type,
      timeposted,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/chat/:id', async (req, res) => {
  try {
    const result = await db.execute({
      sql: 'DELETE FROM chat WHERE id = ?',
      args: [req.params.id],
    });
    if (result.rowsAffected === 0)
      return res.status(404).json({ error: 'Nachricht nicht gefunden' });
    res.json({ message: 'Nachricht gelöscht' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CHARACTER RATINGS ────────────────────────────────────────────────────────

app.get('/ratings', async (req, res) => {
  try {
    const result = await db.execute('SELECT * FROM character_ratings');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Spezifische Subrouten vor /:userId/:characterId registrieren
app.get('/ratings/user/:userId', async (req, res) => {
  try {
    const result = await db.execute({
      sql: `SELECT cr.*, ac.name, ac.lastname
            FROM character_ratings cr
            LEFT JOIN anime_characters ac ON cr.character_id = ac.id
            WHERE cr.user_id = ?`,
      args: [req.params.userId],
    });
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/ratings/character/:characterId', async (req, res) => {
  try {
    const result = await db.execute({
      sql: `SELECT cr.*, u.username
            FROM character_ratings cr
            LEFT JOIN users u ON cr.user_id = u.id
            WHERE cr.character_id = ?`,
      args: [req.params.characterId],
    });
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/ratings/:userId/:characterId', async (req, res) => {
  try {
    const result = await db.execute({
      sql: 'SELECT * FROM character_ratings WHERE user_id = ? AND character_id = ?',
      args: [req.params.userId, req.params.characterId],
    });
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Rating nicht gefunden' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upsert: erstellt oder überschreibt ein Rating
app.post('/ratings', async (req, res) => {
  const { user_id, character_id, rating } = req.body;
  if (user_id === undefined || character_id === undefined || rating === undefined)
    return res.status(400).json({ error: 'user_id, character_id und rating erforderlich' });
  const updated_at = new Date().toISOString();
  try {
    await db.execute({
      sql: `INSERT INTO character_ratings (user_id, character_id, rating, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, character_id)
            DO UPDATE SET rating = excluded.rating, updated_at = excluded.updated_at`,
      args: [user_id, character_id, rating, updated_at],
    });
    res.status(201).json({ user_id, character_id, rating, updated_at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/ratings/:userId/:characterId', async (req, res) => {
  try {
    const result = await db.execute({
      sql: 'DELETE FROM character_ratings WHERE user_id = ? AND character_id = ?',
      args: [req.params.userId, req.params.characterId],
    });
    if (result.rowsAffected === 0)
      return res.status(404).json({ error: 'Rating nicht gefunden' });
    res.json({ message: 'Rating gelöscht' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default app;
