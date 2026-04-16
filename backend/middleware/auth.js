const jwt = require('jsonwebtoken');
require('dotenv').config();

// Middleware per verificare il token JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ message: 'Token di autenticazione mancante' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Token non valido o scaduto' });
    }
    req.user = user;
    next();
  });
};

module.exports = {
  authenticateToken
};

