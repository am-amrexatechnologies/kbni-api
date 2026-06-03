import { createClient } from '@libsql/client'

if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  throw new Error(
    'TURSO_DATABASE_URL und TURSO_AUTH_TOKEN müssen in der .env gesetzt sein.'
  )
}

const client = createClient({
  url:       process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
})

export default client;
