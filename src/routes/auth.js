const router = require('express').Router()
const bcrypt = require('bcryptjs')
const jwt    = require('jsonwebtoken')
const db     = require('../db/turso')
const auth   = require('../middleware/auth')

// ── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register', async (req, res) => {
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

    const pwhash = await bcrypt.hash(password, 10)
    await db.execute({
      sql:  'INSERT INTO users (username, email, pwhash) VALUES (?, ?, ?)',
      args: [username, email, pwhash],
    })

    res.status(201).json({ message: 'Registrierung erfolgreich.' })
  } catch (err) {
    console.error('[register]', err)
    res.status(500).json({ message: 'Serverfehler.' })
  }
})

// ── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body
    if (!username || !password)
      return res.status(400).json({ message: 'Benutzername und Passwort erforderlich.' })

    const result = await db.execute({
      sql:  'SELECT * FROM users WHERE username = ?',
      args: [username],
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
    console.error('[login]', err)
    res.status(500).json({ message: 'Serverfehler.' })
  }
})

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', auth, async (req, res) => {
  try {
    const result = await db.execute({
      sql:  'SELECT id, username, email FROM users WHERE id = ?',
      args: [req.user.id],
    })
    const u = result.rows[0]
    if (!u) return res.status(404).json({ message: 'Nutzer nicht gefunden.' })
    res.json({ id: u.id, username: u.username, email: u.email })
  } catch (err) {
    console.error('[me]', err)
    res.status(500).json({ message: 'Serverfehler.' })
  }
})

// ── PUT /api/auth/profile ────────────────────────────────────────────────────
router.put('/profile', auth, async (req, res) => {
  try {
    const { username, email, currentPassword, newPassword } = req.body

    // Duplikat-Prüfung
    if (username || email) {
      const check = await db.execute({
        sql:  'SELECT id FROM users WHERE (username = ? OR email = ?) AND id != ?',
        args: [username ?? '', email ?? '', req.user.id],
      })
      if (check.rows.length > 0)
        return res.status(409).json({ message: 'Benutzername oder E-Mail bereits vergeben.' })
    }

    // Passwort ändern
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

    const updated = (await db.execute({ sql: 'SELECT id, username, email FROM users WHERE id = ?', args: [req.user.id] })).rows[0]
    const token   = jwt.sign({ id: updated.id, username: updated.username }, process.env.JWT_SECRET, { expiresIn: '7d' })

    res.json({ token, user: { id: updated.id, username: updated.username, email: updated.email } })
  } catch (err) {
    console.error('[profile]', err)
    res.status(500).json({ message: 'Serverfehler.' })
  }
})

module.exports = router
