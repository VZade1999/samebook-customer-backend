// One-off: copies Drive files stored on this machine (storage/drive) into the
// database (drive_blob_chunks), so files uploaded locally before "db" storage
// existed also open on the deployed server. Only copies keys referenced by
// drive_file_versions that have no chunks yet. Never deletes anything.
//
//   node scripts/drive-local-to-db.js            (dry run)
//   node scripts/drive-local-to-db.js --apply
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
const mysql = require('mysql2/promise');

const CHUNK_BYTES = 2 * 1024 * 1024; // must match drive.storage.ts
const apply = process.argv.includes('--apply');
const cfg = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT || 3306),
};
// A fresh connection per statement: the remote DB drops idle connections.
const q = async (sql, params) => {
  const c = await mysql.createConnection(cfg);
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
};

(async () => {
  const root = path.resolve(process.env.DRIVE_STORAGE_DIR || path.join(__dirname, '..', 'storage', 'drive'));
  const [rows] = await q(
    `SELECT v.storage_key, MAX(v.size_bytes) AS size
     FROM drive_file_versions v
     LEFT JOIN drive_blob_chunks c ON c.storage_key = v.storage_key AND c.seq = 0
     WHERE c.storage_key IS NULL
     GROUP BY v.storage_key`,
  );
  let copied = 0, missing = 0;
  for (const { storage_key: key, size } of rows) {
    const file = path.join(root, key);
    if (!fs.existsSync(file)) {
      missing++;
      console.log(`  ? not on this machine: ${key}`);
      continue;
    }
    const data = fs.readFileSync(file);
    if (Number(size) && data.length !== Number(size)) {
      console.log(`  ! size mismatch, skipped: ${key} (db ${size} B, disk ${data.length} B)`);
      continue;
    }
    const parts = Math.max(1, Math.ceil(data.length / CHUNK_BYTES));
    console.log(`  ${apply ? 'copy' : 'would copy'} ${key} (${data.length} B, ${parts} part${parts === 1 ? '' : 's'})`);
    if (apply) {
      for (let seq = 0; seq < parts; seq++) {
        const part = data.subarray(seq * CHUNK_BYTES, (seq + 1) * CHUNK_BYTES);
        await q(
          'INSERT INTO drive_blob_chunks (storage_key, seq, size, data) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE size = VALUES(size), data = VALUES(data)',
          [key, seq, part.length, part],
        );
      }
    }
    copied++;
  }
  console.log(`\n${rows.length} versions without database copy: ${copied} ${apply ? 'copied' : 'to copy'}, ${missing} not on this machine.`);
  if (!apply && copied) console.log('Run again with --apply to copy them.');
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
