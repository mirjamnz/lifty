const fs = require('fs');
const db = require('../db');

(async () => {
  try {
    const rawSql = fs.readFileSync('scripts/create_stub_legacy_tables.sql', 'utf8');
    // Remove single-line and block comments
    const sql = rawSql
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');

    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s);
    for (const stmt of statements) {
      try {
        await db.query(stmt);
        console.log(`✅ Executed: ${stmt.substring(0, 60)}...`);
      } catch (err) {
        console.error(`❌ Error executing statement:`, err.message);
      }
    }
    console.log('🛠️ Stub legacy tables created/ensured');
  } catch (err) {
    console.error(err);
  }
  process.exit(0);
})();
