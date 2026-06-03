const router = require('express').Router()
const db     = require('../db/turso')
const auth   = require('../middleware/auth')

// ── GET /api/characters ──────────────────────────────────────────────────────
// Alle Anime-Charaktere mit Anime-Name + Durchschnittsbewertung
router.get('/', async (req, res) => {
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
    console.error('[GET /characters]', err)
    res.status(500).json({ message: 'Serverfehler.' })
  }
})

// ── GET /api/characters/anime ────────────────────────────────────────────────
// Alle Anime-Serien (für Filter)
router.get('/anime', async (req, res) => {
  try {
    const result = await db.execute('SELECT id, animename FROM anime ORDER BY animename')
    res.json(result.rows)
  } catch (err) {
    console.error('[GET /characters/anime]', err)
    res.status(500).json({ message: 'Serverfehler.' })
  }
})

// ── GET /api/characters/my-ratings ──────────────────────────────────────────
// Eigene Bewertungen als { [characterId]: rating }
router.get('/my-ratings', auth, async (req, res) => {
  try {
    const result = await db.execute({
      sql:  'SELECT character_id, rating FROM character_ratings WHERE user_id = ?',
      args: [req.user.id],
    })
    const map = {}
    for (const row of result.rows) map[row.character_id] = row.rating
    res.json(map)
  } catch (err) {
    console.error('[GET /characters/my-ratings]', err)
    res.status(500).json({ message: 'Serverfehler.' })
  }
})

// ── POST /api/characters/rate ────────────────────────────────────────────────
// Charakter bewerten (1–10)
router.post('/rate', auth, async (req, res) => {
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
    console.error('[POST /characters/rate]', err)
    res.status(500).json({ message: 'Serverfehler.' })
  }
})

// ── GET /api/characters/top5 ─────────────────────────────────────────────────
// Die 5 höchst bewerteten Charaktere des eingeloggten Nutzers
router.get('/top5', auth, async (req, res) => {
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
    console.error('[GET /characters/top5]', err)
    res.status(500).json({ message: 'Serverfehler.' })
  }
})

module.exports = router
