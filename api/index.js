import 'dotenv/config'

import express from 'express'
import cors    from 'cors'
import bcrypt  from 'bcryptjs'
import jwt     from 'jsonwebtoken'
import db      from './db/turso.js'

const app = express()

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGIN || '*')
  .split(',').map(s => s.trim()).filter(Boolean)

app.use(cors({
  origin: allowedOrigins.includes('*') ? '*' : (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true)
    cb(new Error(`CORS: Origin "${origin}" nicht erlaubt.`))
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}))

app.use(express.json())

// ── JWT-Middleware ────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer '))
    return res.status(401).json({ message: 'Kein Token vorhanden.' })
  try {
    req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ message: 'Token ungültig oder abgelaufen.' })
  }
}

// ════════════════════════════════════════════════════════════════════════════
// AUTH  /api/auth
// ════════════════════════════════════════════════════════════════════════════

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  try {
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
  } catch (err) {
    console.error('[POST /api/auth/register]', err)
    res.status(500).json({ message: 'Serverfehler.' })
  }
})

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
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
  } catch (err) {
    console.error('[POST /api/auth/login]', err)
    res.status(500).json({ message: 'Serverfehler.' })
  }
})

// GET /api/auth/me
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const result = await db.execute({
      sql: 'SELECT id, username, email FROM users WHERE id = ?', args: [req.user.id],
    })
    const u = result.rows[0]
    if (!u) return res.status(404).json({ message: 'Nutzer nicht gefunden.' })
    res.json({ id: u.id, username: u.username, email: u.email })
  } catch (err) {
    console.error('[GET /api/auth/me]', err)
    res.status(500).json({ message: 'Serverfehler.' })
  }
})

// PUT /api/auth/profile
app.put('/api/auth/profile', requireAuth, async (req, res) => {
  try {
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
  } catch (err) {
    console.error('[PUT /api/auth/profile]', err)
    res.status(500).json({ message: 'Serverfehler.' })
  }
})

// ════════════════════════════════════════════════════════════════════════════
// CHARACTERS  /api/characters
// ════════════════════════════════════════════════════════════════════════════

// GET /api/characters  — alle Charaktere mit Ø-Bewertung
app.get('/api/characters', async (req, res) => {
  try {
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
  } catch (err) {
    console.error('[GET /api/characters]', err)
    res.status(500).json({ message: 'Serverfehler.' })
  }
})

// GET /api/characters/anime  — alle Anime-Serien
app.get('/api/characters/anime', async (req, res) => {
  try {
    const result = await db.execute('SELECT id, animename FROM anime ORDER BY animename')
    res.json(result.rows)
  } catch (err) {
    console.error('[GET /api/characters/anime]', err)
    res.status(500).json({ message: 'Serverfehler.' })
  }
})

// GET /api/characters/my-ratings  — eigene Bewertungen { [characterId]: rating }
app.get('/api/characters/my-ratings', requireAuth, async (req, res) => {
  try {
    const result = await db.execute({
      sql: 'SELECT character_id, rating FROM character_ratings WHERE user_id = ?', args: [req.user.id],
    })
    const map = {}
    for (const row of result.rows) map[row.character_id] = row.rating
    res.json(map)
  } catch (err) {
    console.error('[GET /api/characters/my-ratings]', err)
    res.status(500).json({ message: 'Serverfehler.' })
  }
})

// POST /api/characters/rate  — Charakter bewerten (1–10)
app.post('/api/characters/rate', requireAuth, async (req, res) => {
  try {
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
  } catch (err) {
    console.error('[POST /api/characters/rate]', err)
    res.status(500).json({ message: 'Serverfehler.' })
  }
})

// GET /api/characters/top5  — 5 höchst bewertete Charaktere des Nutzers
app.get('/api/characters/top5', requireAuth, async (req, res) => {
  try {
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
  } catch (err) {
    console.error('[GET /api/characters/top5]', err)
    res.status(500).json({ message: 'Serverfehler.' })
  }
})

// ════════════════════════════════════════════════════════════════════════════
// CHAT  /api/chat
// ════════════════════════════════════════════════════════════════════════════

// GET /api/chat/messages  — letzte 100 Nachrichten
app.get('/api/chat/messages', async (req, res) => {
  try {
    const result = await db.execute(
      'SELECT id, username, text, type, timeposted FROM chat ORDER BY timeposted ASC LIMIT 100'
    )
    res.json(result.rows)
  } catch (err) {
    console.error('[GET /api/chat/messages]', err)
    res.status(500).json({ message: 'Serverfehler.' })
  }
})

// POST /api/chat/messages  — Nachricht senden
app.post('/api/chat/messages', requireAuth, async (req, res) => {
  try {
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
  } catch (err) {
    console.error('[POST /api/chat/messages]', err)
    res.status(500).json({ message: 'Serverfehler.' })
  }
})

// ════════════════════════════════════════════════════════════════════════════
// HEALTH + FALLBACK
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', app: 'KBNI', timestamp: new Date().toISOString() })
)

app.use('/api/*', (_req, res) =>
  res.status(404).json({ message: 'Route nicht gefunden.' })
)

// Globaler Error-Handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[Error]', err.message)
  res.status(500).json({ message: 'Interner Serverfehler.' })
})

export default app;