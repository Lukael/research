#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function usage() {
  console.error('Usage: REPORT_PASSWORD=... node scripts/encrypt-report.js <input-html> <output-enc>');
  process.exit(2);
}

const [, , input, output] = process.argv;
if (!input || !output) usage();

const password = process.env.REPORT_PASSWORD;
if (!password) {
  console.error('REPORT_PASSWORD is required.');
  process.exit(3);
}

const plaintext = fs.readFileSync(input);
const salt = crypto.randomBytes(16);
const iv = crypto.randomBytes(12);
const iterations = 310000;
const key = crypto.pbkdf2Sync(Buffer.from(password), salt, iterations, 32, 'sha256');
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const tag = cipher.getAuthTag();

const payload = {
  version: 1,
  kdf: 'PBKDF2-SHA-256',
  cipher: 'AES-256-GCM',
  iterations,
  salt: salt.toString('base64'),
  iv: iv.toString('base64'),
  ciphertext: Buffer.concat([ciphertext, tag]).toString('base64'),
};

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(payload, null, 2) + '\n');
console.log(`Encrypted ${path.relative(process.cwd(), output)}`);
