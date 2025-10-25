#!/usr/bin/env node

// Test script to check if Arabic names exist in the database
require('dotenv').config();

const TENANT_ID = '3feff9a3-4721-4ff2-a716-11eb93873fae'; // Koobs Café

// Simple DB connection (mimicking the server setup)
let pool;

try {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
    });
    
    console.log('📊 Connected to database via DATABASE_URL');
  } else {
    console.log('❌ DATABASE_URL not found. Please set it in your environment.');
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Database connection failed:', error.message);
  process.exit(1);
}

async function db(query, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(query, params);
    return result.rows;
  } finally {
    client.release();
  }
}

async function testArabicNames() {
  console.log('🧪 Testing Arabic names directly from database...\n');
  console.log(`🏢 Tenant ID: ${TENANT_ID}\n`);

  try {
    // First, check if the table structure includes name_localized
    console.log('🔍 Checking table structure...');
    const tableInfo = await db(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'products' 
      AND column_name IN ('name', 'name_localized')
      ORDER BY column_name
    `);
    
    console.log('📋 Products table columns:');
    tableInfo.forEach(col => {
      console.log(`   - ${col.column_name}: ${col.data_type}`);
    });
    console.log('');

    // Check total products for this tenant
    const [countResult] = await db('SELECT COUNT(*) as total FROM products WHERE tenant_id = $1', [TENANT_ID]);
    const totalProducts = parseInt(countResult?.total || 0);
    console.log(`📦 Total products for tenant: ${totalProducts}`);

    if (totalProducts === 0) {
      console.log('⚠️ No products found for this tenant');
      return;
    }

    // Check products with Arabic names
    const [arabicCountResult] = await db(
      `SELECT COUNT(*) as total FROM products 
       WHERE tenant_id = $1 
       AND name_localized IS NOT NULL 
       AND LENGTH(TRIM(name_localized)) > 0`,
      [TENANT_ID]
    );
    const productsWithArabic = parseInt(arabicCountResult?.total || 0);
    
    console.log(`🔤 Products with Arabic names: ${productsWithArabic}`);
    console.log(`📊 Coverage: ${Math.round((productsWithArabic / totalProducts) * 100)}%\n`);

    if (productsWithArabic > 0) {
      console.log('✅ Sample products with Arabic names:');
      const samples = await db(
        `SELECT name, name_localized, sku
         FROM products 
         WHERE tenant_id = $1 
         AND name_localized IS NOT NULL 
         AND LENGTH(TRIM(name_localized)) > 0
         ORDER BY name
         LIMIT 10`,
        [TENANT_ID]
      );
      
      samples.forEach((product, i) => {
        console.log(`   ${i + 1}. "${product.name}" → "${product.name_localized}" [${product.sku || 'no-sku'}]`);
      });
    } else {
      console.log('❌ No products with Arabic names found!');
      console.log('\n📋 Sample products (checking name_localized values):');
      const samples = await db(
        `SELECT name, name_localized, sku
         FROM products 
         WHERE tenant_id = $1
         ORDER BY name
         LIMIT 5`,
        [TENANT_ID]
      );
      
      samples.forEach((product, i) => {
        console.log(`   ${i + 1}. "${product.name}" | name_localized: ${JSON.stringify(product.name_localized)} [${product.sku || 'no-sku'}]`);
      });
    }

    // Test the exact query used by the admin API
    console.log('\n🔧 Testing admin API query...');
    const adminApiResults = await db(`
      SELECT 
        p.id, p.name, p.name_localized, p.sku,
        c.name as category_name,
        coalesce(p.active, true) as active
      FROM products p
      JOIN categories c ON c.id=p.category_id
      WHERE p.tenant_id=$1
      ORDER BY c.name, p.name
      LIMIT 5
    `, [TENANT_ID]);

    console.log('📊 Admin API query results:');
    adminApiResults.forEach((product, i) => {
      const hasArabic = product.name_localized && product.name_localized.trim().length > 0;
      console.log(`   ${i + 1}. "${product.name}" ${hasArabic ? '→ "' + product.name_localized + '"' : '(no Arabic)'} [${product.sku || 'no-sku'}]`);
    });

  } catch (error) {
    console.error('❌ Database test failed:', error.message);
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}

// Run the test
testArabicNames().catch(console.error);