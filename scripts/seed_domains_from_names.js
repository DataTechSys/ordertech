#!/usr/bin/env node
/**
 * scripts/seed_domains_from_names.js
 *
 * Seeds tenant_domains with {slug-or-name}.<tld> for each tenant.
 *
 * Usage examples:
 *   # Seed for all tenants (dry-run)
 *   node scripts/seed_domains_from_names.js --tld ordertech.me
 *
 *   # Apply changes for a specific tenant
 *   node scripts/seed_domains_from_names.js --tenant-id <UUID> --apply
 *
 * Options:
 *   --tld <domain>     Top-level domain suffix, default: ordertech.me
 *   --tenant-id <uuid> Process only one tenant (optional)
 *   --apply            Execute inserts/updates (default: dry-run)
 *   --force            Reassign existing host from another tenant if collision
 *   --replace          If tenant already has domain(s), replace with the new host (delete old rows)
 *
 * DB connection: uses DATABASE_URL or PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGPORT
 */

const { Client } = require('pg');

function parseArgs(){
  const out = { tld: 'ordertech.me', apply: false, force: false, replace: false };
  const a = process.argv.slice(2);
  for (let i=0;i<a.length;i++){
    const k = a[i];
    if (k === '--tld') out.tld = a[++i];
    else if (k === '--tenant-id' || k === '-t') out.tenantId = a[++i];
    else if (k === '--apply') out.apply = true;
    else if (k === '--force') out.force = true;
    else if (k === '--replace') out.replace = true;
    else if (k === '--help' || k === '-?') out.help = true;
  }
  return out;
}

function isUUID(v) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||'')); }

function normalizeLabel(s){
  if (!s) return '';
  let out = String(s).trim().toLowerCase();
  // Replace non [a-z0-9-] with '-'
  out = out.replace(/[^a-z0-9-]+/g, '-');
  // Collapse dashes
  out = out.replace(/-+/g, '-');
  // Trim leading/trailing dashes
  out = out.replace(/^-+/, '').replace(/-+$/,'');
  // Enforce label length (1..63). If too long, truncate.
  if (out.length > 63) out = out.slice(0,63).replace(/-+$/,'');
  return out;
}

function isValidLabel(label){ return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/.test(label); }

function makeClient(){
  const { DATABASE_URL, PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT } = process.env;
  if (DATABASE_URL) return new Client({ connectionString: DATABASE_URL });
  if (PGHOST && PGUSER && PGDATABASE) return new Client({ host: PGHOST, user: PGUSER, password: PGPASSWORD, database: PGDATABASE, port: PGPORT?Number(PGPORT):5432, ssl: false });
  throw new Error('No DATABASE_URL or PG* env vars found');
}

async function main(){
  const args = parseArgs();
  if (args.help){
    console.log('Usage: node scripts/seed_domains_from_names.js [--tld ordertech.me] [--tenant-id UUID] [--apply] [--force] [--replace]');
    process.exit(0);
  }
  if (args.tenantId && !isUUID(args.tenantId)){
    console.error('Error: --tenant-id must be a UUID');
    process.exit(1);
  }
  const client = makeClient();
  await client.connect();
  try {
    const params = [];
    let sql = `select t.tenant_id as id, t.company_name as name, trim(t.short_code) as short_code, s.slug
               from tenants t
               left join tenant_settings s on s.tenant_id=t.tenant_id`;
    if (args.tenantId){ sql += ' where t.tenant_id=$1'; params.push(args.tenantId); }
    sql += ' order by t.created_at asc';
    const res = await client.query(sql, params);
    if (!res.rowCount){ console.log('No tenants found.'); return; }

    let changes = 0; let skips = 0; let collisions = 0;

    for (const row of res.rows){
      const tid = row.id;
      let label = normalizeLabel(row.slug || row.name || '');
      if (!isValidLabel(label)){
        const fallback = row.short_code || tid.replace(/-/g,'').slice(0,6);
        label = normalizeLabel(fallback);
      }
      if (!isValidLabel(label)){
        console.warn(`Skip: cannot derive valid label for tenant ${tid} (name=${row.name||''}, slug=${row.slug||''})`);
        skips++; continue;
      }
      const host = `${label}.${args.tld}`;

      // If tenant already has a domain and not replacing, skip
      const existing = await client.query('select host from tenant_domains where tenant_id=$1 order by host asc limit 1', [tid]);
      if (existing.rowCount && !args.replace){
        const cur = existing.rows[0].host;
        if (cur === host){ console.log(`OK (exists): ${host} -> ${tid}`); }
        else { console.log(`Skip (tenant already has ${cur}): desired ${host}`); }
        continue;
      }

      // Check host ownership
      const clash = await client.query('select tenant_id from tenant_domains where host=$1', [host]);
      if (clash.rowCount){
        const other = clash.rows[0].tenant_id;
        if (other !== tid && !args.force){
          console.warn(`Collision: ${host} already mapped to ${other}; use --force to reassign.`);
          collisions++; continue;
        }
      }

      if (!args.apply){
        console.log(`[dry-run] Will ${(args.replace?'replace ':'set ')}${host} -> ${tid}${clash.rowCount && args.force ? ' (reassign)' : ''}`);
        changes++; continue;
      }

      // Replace existing tenant domains if requested
      if (args.replace){ await client.query('delete from tenant_domains where tenant_id=$1', [tid]); }

      // Upsert mapping
      await client.query(
        `insert into tenant_domains (host, tenant_id, verified_at)
         values ($1,$2, now())
         on conflict (host) do update set tenant_id=excluded.tenant_id, verified_at=now()`,
        [host, tid]
      );
      console.log(`OK: ${host} -> ${tid}`);
      changes++;
    }

    console.log(`\nDone. Tenants processed: ${res.rowCount}. Changes: ${changes}. Collisions: ${collisions}. Skips: ${skips}. Mode: ${args.apply?'apply':'dry-run'}.`);
  } catch (e){
    console.error('Error:', e.message || e);
    process.exit(2);
  } finally {
    try { await client.end(); } catch {}
  }
}

main().catch(e => { console.error(e); process.exit(99); });
