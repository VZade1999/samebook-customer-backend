// One-off: copies Drive files stored on this machine (storage/drive) into the
// S3 / R2 bucket under the same keys, so rows in the shared database that were
// created by local uploads also work on the deployed server.
// Only copies keys referenced by drive_file_versions; skips keys already in
// the bucket. Never deletes anything.
//
//   node scripts/drive-local-to-s3.js            (dry run: lists what it would copy)
//   node scripts/drive-local-to-s3.js --apply
//
// Reads DB_* and DRIVE_S3_* (or AWS_*) settings from .env.local.
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
const mysql = require('mysql2/promise');
const { S3Client, HeadObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

const env = (...names) => names.map((n) => process.env[n]).find((v) => v && v.trim())?.trim();
const apply = process.argv.includes('--apply');

(async () => {
  const bucket = env('DRIVE_S3_BUCKET');
  if (!bucket) throw new Error('Set DRIVE_S3_BUCKET (and credentials) in .env.local first');
  const endpoint = env('DRIVE_S3_ENDPOINT');
  const accessKeyId = env('DRIVE_S3_ACCESS_KEY_ID', 'AWS_ACCESS_KEY', 'AWS_ACCESS_KEY_ID');
  const secretAccessKey = env('DRIVE_S3_SECRET_ACCESS_KEY', 'AWS_SECRET_KEY', 'AWS_SECRET_ACCESS_KEY');
  const s3 = new S3Client({
    region: env('DRIVE_S3_REGION', 'AWS_REGION') || 'auto',
    ...(endpoint ? { endpoint, forcePathStyle: env('DRIVE_S3_PATH_STYLE') === 'true' } : {}),
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
  });
  const root = path.resolve(process.env.DRIVE_STORAGE_DIR || path.join(__dirname, '..', 'storage', 'drive'));

  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 3306),
  });
  const [rows] = await db.query(
    'SELECT storage_key, MAX(mime_type) AS mime FROM drive_file_versions GROUP BY storage_key ORDER BY storage_key',
  );
  await db.end();

  let copied = 0, present = 0, missing = 0;
  for (const { storage_key: key, mime } of rows) {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      present++;
      continue;
    } catch (e) {
      if (e?.$metadata?.httpStatusCode !== 404 && e?.name !== 'NotFound') throw e;
    }
    const file = path.join(root, key);
    if (!fs.existsSync(file)) {
      missing++;
      console.log(`  ? not on this machine: ${key}`);
      continue;
    }
    const size = fs.statSync(file).size;
    console.log(`  ${apply ? 'copy' : 'would copy'} ${key} (${size} B)`);
    if (apply) {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: fs.createReadStream(file),
          ContentLength: size,
          ContentType: mime || 'application/octet-stream',
        }),
      );
    }
    copied++;
  }
  console.log(
    `\n${rows.length} stored objects: ${present} already in bucket, ${copied} ${apply ? 'copied' : 'to copy'}, ${missing} not on this machine.`,
  );
  if (!apply && copied) console.log('Run again with --apply to copy them.');
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
