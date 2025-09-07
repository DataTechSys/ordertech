#!/usr/bin/env node
/* Import categories, products, and modifiers via the deployed Admin API.
   Usage:
     FIREBASE_ID_TOKEN=... node scripts/import_via_api.js \
       --base https://smart-order-64v5pfkeba-ew.a.run.app \
       --tenant 3feff9a3-4721-4ff2-a716-11eb93873fae \
       data/categories.csv data/products.csv [data/modifiers.csv data/modifiers_options.csv]
*/

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

function yn(v){ const s = String(v??'').trim().toLowerCase(); return s==='yes'||s==='true'||s==='1'; }
function toInt(v){ const n = parseInt(String(v??'').trim(), 10); return Number.isFinite(n) ? n : null; }
function toNum(v){ const n = Number(String(v??'').trim()); return Number.isFinite(n) ? n : null; }

async function main(){
  const argv = process.argv.slice(2);
  let BASE = process.env.SERVICE_BASE_URL || 'https://smart-order-64v5pfkeba-ew.a.run.app';
  let TENANT = process.env.DEFAULT_TENANT_ID || '3feff9a3-4721-4ff2-a716-11eb93873fae';
  const tok = process.env.FIREBASE_ID_TOKEN;
  if (!tok) {
    console.error('FIREBASE_ID_TOKEN env var is required');
    process.exit(1);
  }
  let catsPath = null, prodsPath = null, modsPath = null, optsPath = null;
  for (let i=0; i<argv.length; i++){
    const a = argv[i];
    if (a === '--base') { BASE = argv[++i] || BASE; continue; }
    if (a === '--tenant') { TENANT = argv[++i] || TENANT; continue; }
    if (!catsPath) { catsPath = a; continue; }
    if (!prodsPath) { prodsPath = a; continue; }
    if (!modsPath) { modsPath = a; continue; }
    if (!optsPath) { optsPath = a; continue; }
  }
  if (!catsPath || !prodsPath) {
    console.error('Usage: node scripts/import_via_api.js [--base URL] [--tenant TENANT_ID] data/categories.csv data/products.csv [modifiers.csv modifiers_options.csv]');
    process.exit(1);
  }
  const catsCsv = fs.readFileSync(catsPath, 'utf8');
  const prodsCsv = fs.readFileSync(prodsPath, 'utf8');
  const cats = parse(catsCsv, { columns: true, skip_empty_lines: true, trim: true });
  const prods = parse(prodsCsv, { columns: true, skip_empty_lines: true, trim: true });
  const refToCatName = new Map();
  const nameToCat = new Map();
  for (const c of cats) {
    const name = c.name || c.category_name || '';
    const ref = (c.reference || '').toString();
    if (ref) refToCatName.set(ref, name);
  }

  async function call(method, url, body){
    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${tok}`,
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    if (!res.ok) {
      const msg = json && (json.error || json.message) ? (json.error || json.message) : text;
      throw new Error(`${method} ${url} -> ${res.status} ${msg}`);
    }
    return json ?? {};
  }

  // 1) Ensure categories by name (+ optional reference, name_localized, image_url)
  console.log(`Creating categories (${cats.length})...`);
  let createdCats = 0; let skippedCats = 0;
  for (const c of cats) {
    const name = c.name || c.category_name || '';
    if (!name) continue;
    const reference = (c.reference ?? '').toString().trim();
    const name_localized = (c.name_localized ?? '').toString().trim();
    const image_url = (c.image || c.image_url || '').toString().trim();
    const payload = { name };
    if (reference) payload.reference = reference;
    if (name_localized) payload.name_localized = name_localized;
    if (image_url) payload.image_url = image_url;
    try {
      await call('POST', `${BASE}/admin/tenants/${TENANT}/categories`, payload);
      createdCats++;
    } catch (e) {
      // Treat conflicts (by name or reference unique index) as already-existing
      if (/409/.test(String(e)) || /duplicate|unique/i.test(String(e?.message||''))) { skippedCats++; }
      else throw e;
    }
  }
  console.log(`Categories: created=${createdCats}, skipped(existing)=${skippedCats}`);

  // 2) Fetch categories with ids
  const catsApi = await call('GET', `${BASE}/api/categories`);
  for (const c of catsApi) { if (c?.name && c?.id) nameToCat.set(c.name, c); }

  // 3) Create products
  console.log(`Creating products (${prods.length})...`);
  let createdProds = 0; let skippedProds = 0; let failedProds = 0;
  for (const p of prods) {
    try {
      const name = p.name || p.product_name || '';
      if (!name) { skippedProds++; continue; }
      // Resolve category_id
      let catName = p.category_name || '';
      if (!catName) {
        const cref = (p.category_reference || '').toString();
        if (cref) catName = refToCatName.get(cref) || '';
      }
      const catObj = nameToCat.get(catName || '') || null;
      if (!catObj?.id) { console.warn('Skip product; unknown category', catName, name); skippedProds++; continue; }
      const category_id = catObj.id;

      // Build product payload
      const body = {
        name,
        name_localized: (p.name_localized || p.name_ar || null),
        category_id,
        price: toNum(p.price) || 0,
        cost: toNum(p.cost),
        packaging_fee: toNum(p.packaging_fee),
        description: p.description || null,
        description_localized: p.description_localized || null,
        tax_group_reference: p.tax_group_reference || null,
        is_sold_by_weight: yn(p.is_sold_by_weight),
        is_stock_product: yn(p.is_stock_product),
        barcode: p.barcode ? String(p.barcode) : null,
        preparation_time: toInt(p.preparation_time),
        calories: toInt(p.calories),
        is_high_salt: yn(p.is_high_salt),
        sku: p.sku ? String(p.sku) : null,
        image_url: p.image || p.image_url || null,
        ingredients_en: p.ingredients_en || null,
        ingredients_ar: p.ingredients_ar || null,
        allergens: (p.allergens ? String(p.allergens).split(',').map(s=>s.trim()).filter(Boolean) : []),
        fat_g: toNum(p.fat_g),
        carbs_g: toNum(p.carbs_g),
        protein_g: toNum(p.protein_g),
        sugar_g: toNum(p.sugar_g),
        sodium_mg: toInt(p.sodium_mg),
        serving_size: p.serving_size || null,
        pos_visible: p.pos_visible===''?null:yn(p.pos_visible ?? 'yes'),
        online_visible: p.online_visible===''?null:yn(p.online_visible ?? 'yes'),
        delivery_visible: p.delivery_visible===''?null:yn(p.delivery_visible ?? 'yes'),
        spice_level: p.spice_level || null,
        talabat_reference: p.talabat_reference || null,
        jahez_reference: p.jahez_reference || null,
        vthru_reference: p.vthru_reference || null,
        active: p.is_active != null ? yn(p.is_active) : true
      };
      await call('POST', `${BASE}/admin/tenants/${TENANT}/products`, body);
      createdProds++;
    } catch (e) {
      failedProds++;
      console.warn('Product failed:', e.message);
    }
  }
  console.log(`Products: created=${createdProds}, skipped=${skippedProds}, failed=${failedProds}`);

  // 4) Modifiers (optional)
  if (modsPath && fs.existsSync(modsPath)) {
    console.log('Creating modifier groups...');
    const modsCsv = fs.readFileSync(modsPath, 'utf8');
    const mods = parse(modsCsv, { columns: true, skip_empty_lines: true, trim: true });
    const refToGroupId = new Map();
    for (const g of mods) {
      const name = g.name || g.group_name || '';
      if (!name) continue;
      const payload = {
        name,
        reference: (g.reference || g.ref || g.group_reference || '').toString() || null,
        min_select: toInt(g.min_select ?? g.min ?? g.min_required),
        max_select: toInt(g.max_select ?? g.max ?? g.max_allowed),
        required: yn(g.required ?? g.is_required)
      };
      try {
        const resp = await call('POST', `${BASE}/admin/tenants/${TENANT}/modifiers/groups`, payload);
        if (payload.reference && resp?.group?.id) refToGroupId.set(payload.reference, resp.group.id);
      } catch (e) {
        console.warn('Group failed:', e.message);
      }
    }
    if (optsPath && fs.existsSync(optsPath)) {
      console.log('Creating modifier options...');
      const optsCsv = fs.readFileSync(optsPath, 'utf8');
      const opts = parse(optsCsv, { columns: true, skip_empty_lines: true, trim: true });
      for (const o of opts) {
        const name = o.name || o.option_name || '';
        if (!name) continue;
        let group_id = o.group_id || null;
        const group_ref = (o.modifier_group_reference || o.group_reference || o.group_ref || '').toString();
        if (!group_id && group_ref) group_id = refToGroupId.get(group_ref) || null;
        if (!group_id) { console.warn('Skip option; unknown group', group_ref, name); continue; }
        const payload = {
          group_id,
          name,
          price: toNum(o.price ?? o.delta_price ?? o.price_kwd) || 0,
          is_active: yn(o.is_active ?? o.active ?? 'yes'),
          sort_order: toInt(o.sort_order ?? o.position)
        };
        try {
          await call('POST', `${BASE}/admin/tenants/${TENANT}/modifiers/options`, payload);
        } catch (e) {
          console.warn('Option failed:', e.message);
        }
      }
    }
  }

  console.log('Import via API complete.');
}

main().catch(e => { console.error(e); process.exit(1); });

