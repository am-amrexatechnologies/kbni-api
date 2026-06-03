# KBNI API

Express.js REST API für die KBNI-Anwendung. Datenbank: [Turso](https://turso.tech) (libSQL).

## Projektstruktur

```
kbni-api/
├── src/
│   ├── index.js          # Einstiegspunkt (Server starten)
│   ├── app.js            # Express-App (CORS, Routen, Error-Handler)
│   ├── db/
│   │   ├── turso.js      # Turso-Client
│   │   └── init.js       # Tabellen anlegen + Seed-Daten
│   ├── middleware/
│   │   └── auth.js       # JWT-Middleware
│   └── routes/
│       ├── auth.js       # /api/auth
│       ├── characters.js # /api/characters
│       └── chat.js       # /api/chat
├── .env.example
├── .gitignore
└── package.json
```

## Setup

```bash
# 1. Abhängigkeiten installieren
npm install

# 2. Umgebungsvariablen anlegen
cp .env.example .env
# .env befüllen (siehe unten)

# 3. Datenbank initialisieren (einmalig)
npm run init-db

# 4. Server starten
npm run dev     # mit nodemon (hot-reload)
npm start       # ohne nodemon (Produktion)
```

## Umgebungsvariablen

| Variable | Beschreibung |
|---|---|
| `TURSO_DATABASE_URL` | libSQL-URL der Turso-Datenbank |
| `TURSO_AUTH_TOKEN` | Auth-Token für Turso |
| `JWT_SECRET` | Geheimschlüssel für JWT (min. 32 Zeichen) |
| `PORT` | Port des Servers (Standard: `3000`) |
| `CORS_ORIGIN` | Erlaubte Frontend-Origins, kommasepariert |

## Datenbankschema

```sql
users             (id, username, email, pwhash)
anime             (id, animename)
anime_characters  (id, name, lastname, age, animeid)
chat              (id, username, text, type, timeposted)
character_ratings (user_id, character_id, rating, updated_at)
```

## API-Referenz

### Auth — `/api/auth`

| Methode | Pfad | Auth | Beschreibung |
|---|---|---|---|
| POST | `/register` | – | Neuen Account erstellen |
| POST | `/login` | – | Einloggen, JWT erhalten |
| GET | `/me` | JWT | Eigenes Profil abrufen |
| PUT | `/profile` | JWT | Profil / Passwort ändern |

**POST /register**
```json
{ "username": "alex", "email": "alex@example.com", "password": "secret123" }
```

**POST /login**
```json
{ "username": "alex", "password": "secret123" }
// Antwort: { "token": "...", "user": { "id", "username", "email" } }
```

---

### Charaktere — `/api/characters`

| Methode | Pfad | Auth | Beschreibung |
|---|---|---|---|
| GET | `/` | – | Alle Charaktere mit Ø-Bewertung |
| GET | `/anime` | – | Alle Anime-Serien |
| GET | `/my-ratings` | JWT | Eigene Bewertungen |
| POST | `/rate` | JWT | Charakter bewerten (1–10) |
| GET | `/top5` | JWT | Eigene Top 5 (höchste Ratings) |

**POST /rate**
```json
{ "characterId": 3, "rating": 9 }
```

---

### Chat — `/api/chat`

| Methode | Pfad | Auth | Beschreibung |
|---|---|---|---|
| GET | `/messages` | – | Letzte 100 Nachrichten |
| POST | `/messages` | JWT | Nachricht senden |

**POST /messages**
```json
{ "text": "Hallo zusammen!" }
```

---

### Health-Check

```
GET /api/health
→ { "status": "ok", "app": "KBNI", "timestamp": "..." }
```
