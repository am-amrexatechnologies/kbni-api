require('dotenv').config()
const app  = require('./app')
const PORT = process.env.PORT || 3000

const server = app.listen(PORT, () => {
  console.log(`KBNI API läuft auf http://localhost:${PORT}`)
})

// Graceful shutdown
process.on('SIGTERM', () => server.close(() => process.exit(0)))
process.on('SIGINT',  () => server.close(() => process.exit(0)))
