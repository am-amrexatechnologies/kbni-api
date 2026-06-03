const jwt = require('jsonwebtoken')

/**
 * Schützt eine Route: erwartet einen gültigen Bearer-Token im
 * Authorization-Header und schreibt die Nutzdaten nach req.user.
 */
module.exports = function authMiddleware(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Kein Token vorhanden.' })
  }
  const token = header.slice(7)
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET)
    next()
  } catch {
    return res.status(401).json({ message: 'Token ungültig oder abgelaufen.' })
  }
}
