const express = require('express')
const cors    = require('cors')

const app = express()

// ── CORS ───────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGIN || '*')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

app.use(cors({
  origin: allowedOrigins.includes('*') ? '*' : (origin, cb) => {
    // Requests ohne Origin (z. B. curl, Postman) immer erlauben
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true)
    cb(new Error(`CORS: Origin "${origin}" nicht erlaubt.`))
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}))

app.use(express.json())

// ── Routen ─────────────────────────────────────────────────────────────────
app.use('/api/auth',       require('./routes/auth'))
app.use('/api/characters', require('./routes/characters'))
app.use('/api/chat',       require('./routes/chat'))

app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', app: 'KBNI', timestamp: new Date().toISOString() })
)

// 404
app.use('/api/*', (_req, res) =>
  res.status(404).json({ message: 'Route nicht gefunden.' })
)

// Globaler Error-Handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[Error]', err.message)
  res.status(500).json({ message: 'Interner Serverfehler.' })
})

export default app
