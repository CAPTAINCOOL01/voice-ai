/**
 * Download all recordings from R2 to local ./recordings/ folder
 * Run: node download-recordings.js
 */

require("dotenv").config({ path: "./backend/.env" });
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require("@aws-sdk/client-s3");
const fs   = require("fs");
const path = require("path");

const s3 = new S3Client({
  region:   "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET  = process.env.R2_BUCKET;
const OUT_DIR = path.join(__dirname, "recordings");

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

  console.log(`\nConnecting to R2 bucket: ${BUCKET}`);
  const list = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET }));

  if (!list.Contents || list.Contents.length === 0) {
    console.log("No recordings found in R2.");
    return;
  }

  console.log(`Found ${list.Contents.length} file(s). Downloading...\n`);

  for (const obj of list.Contents) {
    const key      = obj.Key;
    const destPath = path.join(OUT_DIR, key);
    const sizeMB   = (obj.Size / 1024 / 1024).toFixed(2);

    if (fs.existsSync(destPath)) {
      console.log(`  ⏭  Skip (already exists): ${key} (${sizeMB} MB)`);
      continue;
    }

    process.stdout.write(`  ⬇  Downloading: ${key} (${sizeMB} MB)...`);
    const { Body } = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(destPath);
      Body.pipe(ws);
      ws.on("finish", resolve);
      ws.on("error",  reject);
    });
    console.log(" done");
  }

  console.log(`\n✅ All recordings saved to: ${OUT_DIR}`);
}

main().catch(err => { console.error("❌ Error:", err.message); process.exit(1); });
