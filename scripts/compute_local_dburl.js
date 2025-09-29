#!/usr/bin/env node
// Compute a local DB URL from Secret Manager and rewrite to 127.0.0.1:6555
// Prints the URL to stdout
const { execSync } = require('child_process');
function rewrite(raw, port) {
  if (!raw) return '';
  let s = String(raw).trim();
  if (s.startsWith('DATABASE_URL=')) s = s.slice('DATABASE_URL='.length);
  if (!s.includes('://')) s = 'postgresql://' + s;
  // Make parseable for WHATWG URL by ensuring a hostname is present
  s = s.replace('@/', '@localhost/').replace('@?', '@localhost?');
  let u;
  try { u = new URL(s); } catch { return ''; }
  // Rewrite host/port
  u.hostname = '127.0.0.1';
  u.port = String(port || 6555);
  // Drop cloudsql socket host override and force sslmode=disable for local proxy hop
  if (u.searchParams.has('host')) u.searchParams.delete('host');
  if (u.protocol.startsWith('postgres')) {
    if (u.searchParams.has('sslmode')) u.searchParams.set('sslmode', 'disable');
    else u.search += (u.search ? '&' : '?') + 'sslmode=disable';
  }
  return u.toString();
}
function main(){
  const secret = process.env.DB_URL_SECRET || 'DATABASE_URL';
  const port = Number(process.env.PROXY_PORT || 6555);
  let out = '';
  try {
    out = execSync(`gcloud secrets versions access latest --secret=${secret}`, { stdio: ['ignore','pipe','ignore'] }).toString();
  } catch { out = ''; }
  const url = rewrite(out, port);
  if (url) process.stdout.write(url);
}
main();
