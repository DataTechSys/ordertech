#!/usr/bin/env node
/*
 * Delete Firebase Authentication users by email for project smart-order-469705.
 * Uses Application Default Credentials (ADC), so you do not handle keys.
 *
 * Usage:
 *   # Login ADC (browser flow) and ensure correct project
 *   gcloud config set project smart-order-469705
 *   gcloud auth application-default login
 *
 *   # Prepare a newline-separated emails file (no header)
 *   # e.g., scripts/emails_to_delete.txt
 *
 *   # Preview (no changes):
 *   DRY_RUN=1 node scripts/delete_firebase_users.js scripts/emails_to_delete.txt
 *
 *   # Execute (permanent):
 *   DRY_RUN=0 node scripts/delete_firebase_users.js scripts/emails_to_delete.txt
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

function readEmails(filePath) {
  const txt = fs.readFileSync(filePath, 'utf8');
  return txt
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.toLowerCase());
}

async function main() {
  const emailsFile = process.argv[2];
  if (!emailsFile) {
    console.error('Usage: node scripts/delete_firebase_users.js <emails.txt>');
    process.exit(2);
  }
  const abs = path.resolve(process.cwd(), emailsFile);
  if (!fs.existsSync(abs)) {
    console.error('File not found:', abs);
    process.exit(2);
  }

  const dryRun = String(process.env.DRY_RUN || '1') === '1';

  // Initialize Admin SDK using ADC; set projectId explicitly for clarity
  try {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: 'smart-order-469705'
    });
  } catch (e) {
    // noop if re-initialized
  }

  const emails = readEmails(abs);
  if (!emails.length) {
    console.error('No emails found in file');
    process.exit(2);
  }

  async function getUidByEmail(email) {
    try {
      const u = await admin.auth().getUserByEmail(email);
      return u?.uid || null;
    } catch (e) {
      if (e && e.errorInfo && e.errorInfo.code === 'auth/user-not-found') return null;
      throw e;
    }
  }

  const resolved = [];
  for (const email of emails) {
    const uid = await getUidByEmail(email);
    resolved.push({ email, uid });
  }

  const deletable = resolved.filter(x => x.uid);
  const missing = resolved.filter(x => !x.uid);

  console.log('Resolved users:', resolved.length);
  console.log(' - Deletable:', deletable.length);
  console.log(' - Not found:', missing.length);
  if (missing.length) {
    missing.forEach(x => console.log('   not_found:', x.email));
  }
  if (deletable.length) {
    console.log('\nWill delete:');
    deletable.forEach(x => console.log('  ', x.email, x.uid));
  }

  if (dryRun) {
    console.log('\nDRY RUN — no users will be deleted. Set DRY_RUN=0 to execute.');
    return;
  }

  // Perform deletions sequentially for clearer logs (small lists)
  let ok = 0, fail = 0;
  for (const { email, uid } of deletable) {
    try {
      await admin.auth().deleteUser(uid);
      console.log('Deleted', email, uid);
      ok++;
    } catch (e) {
      console.error('Failed', email, uid, e && (e.message || e));
      fail++;
    }
  }
  console.log(`\nDone. Deleted=${ok}${fail?` Failed=${fail}`:''}`);
}

main().catch(e => { console.error(e); process.exit(1); });
