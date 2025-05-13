require('dotenv').config();
const mysql = require('mysql2/promise');

console.log('[DB] Attempting connection with user:', process.env.DB_USER);

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'lifty',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  debug: true // Enable debug output
});

module.exports = pool;
