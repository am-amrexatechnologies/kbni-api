// Use "type: module" in package.json to use ES modules
import express from 'express';
import db      from './db/turso.js'
const app = express();
 
// Define your routes
app.get('/', (req, res) => {
  res.json({ message: 'Hello from Express on Vercel!' });
});


app.post('/api/auth/register', async (req, res) => {
	const { username, email, password } = req.body
	if (!username || !email || !password)
	  return res.status(400).json({ message: 'Alle Felder sind Pflicht.' })
	if (username.length < 3)
	  return res.status(400).json({ message: 'Benutzername muss mindestens 3 Zeichen haben.' })
	if (password.length < 6)
	  return res.status(400).json({ message: 'Passwort muss mindestens 6 Zeichen haben.' })

	const existing = await db.execute({
	  sql:  'SELECT id FROM users WHERE username = ? OR email = ?',
	  args: [username, email],
	})
	if (existing.rows.length > 0)
	  return res.status(409).json({ message: 'Benutzername oder E-Mail bereits vergeben.' })

	await db.execute({
	  sql:  'INSERT INTO users (username, email, pwhash) VALUES (?, ?, ?)',
	  args: [username, email, await bcrypt.hash(password, 10)],
	})
	res.status(201).json({ message: 'Registrierung erfolgreich.' })
})

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
	const { username, password } = req.body
	if (!username || !password)
	  return res.status(400).json({ message: 'Benutzername und Passwort erforderlich.' })

	const result = await db.execute({
	  sql: 'SELECT * FROM users WHERE username = ?', args: [username],
	})
	const user = result.rows[0]
	if (!user || !(await bcrypt.compare(password, user.pwhash)))
	  return res.status(401).json({ message: 'Benutzername oder Passwort falsch.' })

	const token = jwt.sign(
	  { id: user.id, username: user.username },
	  process.env.JWT_SECRET,
	  { expiresIn: '7d' }
	)
	res.json({ token, user: { id: user.id, username: user.username, email: user.email } })
})

// GET /api/auth/me
app.get('/api/auth/me', async (req, res) => {
	const result = await db.execute({
	  sql: 'SELECT id, username, email FROM users WHERE id = ?', args: [req.user.id],
	})
	const u = result.rows[0]
	if (!u) return res.status(404).json({ message: 'Nutzer nicht gefunden.' })
	res.json({ id: u.id, username: u.username, email: u.email })
})

// PUT /api/auth/profile
app.put('/api/auth/profile', async (req, res) => {
	const { username, email, currentPassword, newPassword } = req.body

	if (username || email) {
	  const check = await db.execute({
		sql:  'SELECT id FROM users WHERE (username = ? OR email = ?) AND id != ?',
		args: [username ?? '', email ?? '', req.user.id],
	  })
	  if (check.rows.length > 0)
		return res.status(409).json({ message: 'Benutzername oder E-Mail bereits vergeben.' })
	}

	if (currentPassword && newPassword) {
	  if (newPassword.length < 6)
		return res.status(400).json({ message: 'Neues Passwort muss mindestens 6 Zeichen haben.' })
	  const row = await db.execute({
		sql: 'SELECT pwhash FROM users WHERE id = ?', args: [req.user.id],
	  })
	  if (!(await bcrypt.compare(currentPassword, row.rows[0].pwhash)))
		return res.status(401).json({ message: 'Aktuelles Passwort falsch.' })
	  await db.execute({
		sql: 'UPDATE users SET pwhash = ? WHERE id = ?',
		args: [await bcrypt.hash(newPassword, 10), req.user.id],
	  })
	}

	if (username) await db.execute({ sql: 'UPDATE users SET username = ? WHERE id = ?', args: [username, req.user.id] })
	if (email)    await db.execute({ sql: 'UPDATE users SET email    = ? WHERE id = ?', args: [email,    req.user.id] })

	const u     = (await db.execute({ sql: 'SELECT id, username, email FROM users WHERE id = ?', args: [req.user.id] })).rows[0]
	const token = jwt.sign({ id: u.id, username: u.username }, process.env.JWT_SECRET, { expiresIn: '7d' })
	res.json({ token, user: { id: u.id, username: u.username, email: u.email } })
})

// ════════════════════════════════════════════════════════════════════════════
// CHARACTERS  /api/characters
// ════════════════════════════════════════════════════════════════════════════

// GET /api/characters  — alle Charaktere mit Ø-Bewertung
app.get('/api/characters', async (req, res) => {
	const result = await db.execute(`
	  SELECT
		ac.id,
		ac.name,
		ac.lastname,
		ac.age,
		ac.animeid,
		a.animename,
		ROUND(AVG(cr.rating), 1) AS avg_rating,
		COUNT(cr.rating)         AS rating_count
	  FROM anime_characters ac
	  JOIN  anime a              ON a.id  = ac.animeid
	  LEFT JOIN character_ratings cr ON cr.character_id = ac.id
	  GROUP BY ac.id
	  ORDER BY avg_rating DESC NULLS LAST, rating_count DESC
	`)
	res.json(result.rows)
})

// GET /api/characters/anime  — alle Anime-Serien
app.get('/api/characters/anime', async (req, res) => {
	const result = await db.execute('SELECT id, animename FROM anime ORDER BY animename')
	res.json(result.rows)
})

// GET /api/characters/my-ratings  — eigene Bewertungen { [characterId]: rating }
app.get('/api/characters/my-ratings', async (req, res) => {
	const result = await db.execute({
	  sql: 'SELECT character_id, rating FROM character_ratings WHERE user_id = ?', args: [req.user.id],
	})
	const map = {}
	for (const row of result.rows) map[row.character_id] = row.rating
	res.json(map)
})

// POST /api/characters/rate  — Charakter bewerten (1–10)
app.post('/api/characters/rate', async (req, res) => {
	const { characterId, rating } = req.body
	if (!characterId || !rating || rating < 1 || rating > 10)
	  return res.status(400).json({ message: 'Bewertung muss zwischen 1 und 10 liegen.' })

	await db.execute({
	  sql: `INSERT INTO character_ratings (user_id, character_id, rating, updated_at)
			VALUES (?, ?, ?, ?)
			ON CONFLICT(user_id, character_id)
			DO UPDATE SET rating = excluded.rating, updated_at = excluded.updated_at`,
	  args: [req.user.id, characterId, rating, new Date().toISOString()],
	})
	res.json({ message: 'Bewertung gespeichert.' })
})

// GET /api/characters/top5  — 5 höchst bewertete Charaktere des Nutzers
app.get('/api/characters/top5', async (req, res) => {
	const result = await db.execute({
	  sql: `SELECT
			  ac.id, ac.name, ac.lastname, ac.age, ac.animeid,
			  a.animename,
			  cr.rating
			FROM character_ratings cr
			JOIN anime_characters ac ON ac.id = cr.character_id
			JOIN anime             a  ON a.id  = ac.animeid
			WHERE cr.user_id = ?
			ORDER BY cr.rating DESC
			LIMIT 5`,
	  args: [req.user.id],
	})
	res.json(result.rows)
})

// ════════════════════════════════════════════════════════════════════════════
// CHAT  /api/chat
// ════════════════════════════════════════════════════════════════════════════

// GET /api/chat/messages  — letzte 100 Nachrichten
app.get('/api/chat/messages', async (req, res) => {
	const result = await db.execute(
	  'SELECT id, username, text, type, timeposted FROM chat ORDER BY timeposted ASC LIMIT 100'
	)
	res.json(result.rows)

})

// POST /api/chat/messages  — Nachricht senden
app.post('/api/chat/messages', async (req, res) => {
	const { text } = req.body
	if (!text?.trim())
	  return res.status(400).json({ message: 'Nachrichtentext fehlt.' })
	if (text.length > 500)
	  return res.status(400).json({ message: 'Nachricht zu lang (max. 500 Zeichen).' })

	const timeposted = new Date().toISOString()
	await db.execute({
	  sql:  'INSERT INTO chat (username, text, type, timeposted) VALUES (?, ?, ?, ?)',
	  args: [req.user.username, text.trim(), 'message', timeposted],
	})

	const inserted = await db.execute({
	  sql:  'SELECT id, username, text, type, timeposted FROM chat WHERE username = ? AND timeposted = ?',
	  args: [req.user.username, timeposted],
	})
	res.status(201).json(inserted.rows[0])
})

// ════════════════════════════════════════════════════════════════════════════
// HEALTH + FALLBACK
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', app: 'KBNI', timestamp: new Date().toISOString() })
)

 
// Export the Express app
export default app;
