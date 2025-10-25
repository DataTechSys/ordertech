#!/usr/bin/env node

/**
 * Test script to verify enhanced modifier options sync
 * Runs a modifier options sync and checks that all Foodics fields are imported
 */

const { Client } = require('pg');

async function testEnhancedOptionsSync() {
  console.log('🧪 Testing Enhanced Modifier Options Sync');
  
  const client = new Client({
    connectionString: 'postgres://postgres:postgres@127.0.0.1:6555/postgres'
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');
    
    // Find a tenant with Foodics integration for testing
    const tenants = await client.query(`
      SELECT tenant_id, name 
      FROM tenants 
      WHERE tenant_id IN (
        SELECT DISTINCT tenant_id 
        FROM tenant_integrations 
        WHERE provider = 'foodics'
      )
      LIMIT 5
    `);
    
    if (tenants.rows.length === 0) {
      console.log('⚠️  No tenants with Foodics integration found');
      return;
    }
    
    console.log('📋 Available test tenants:');
    tenants.rows.forEach(t => {
      console.log(`  - ${t.name} (${t.tenant_id})`);
    });
    
    // Use Koobs tenant for testing
    const testTenantId = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';
    console.log(`\n🎯 Testing with tenant: ${testTenantId}`);
    
    // Check current modifier options count and field coverage
    const beforeSync = await client.query(`
      SELECT COUNT(*) as total,
             COUNT(name_localized) as has_localized,
             COUNT(reference) as has_reference,
             COUNT(tax_group_reference) as has_tax_group,
             COUNT(costing_method) as has_costing,
             COUNT(external_id) as has_external_id
      FROM modifier_options
      WHERE tenant_id = $1
    `, [testTenantId]);
    
    console.log('📊 Current modifier options state:');
    const before = beforeSync.rows[0];
    console.log(`  Total options: ${before.total}`);
    console.log(`  With localized names: ${before.has_localized}`);
    console.log(`  With references: ${before.has_reference}`);
    console.log(`  With tax group refs: ${before.has_tax_group}`);
    console.log(`  With costing method: ${before.has_costing}`);
    console.log(`  With external IDs: ${before.has_external_id}`);
    
    // Run sync via HTTP endpoint
    console.log('\n🔄 Triggering Foodics sync...');
    const response = await fetch(`https://ordertech-715493130630.me-central1.run.app/admin/tenants/${testTenantId}/sync-foodics?phase=options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (!response.ok) {
      console.log(`❌ Sync failed: ${response.status} ${response.statusText}`);
      return;
    }
    
    const syncResult = await response.json();
    console.log('✅ Sync completed:', syncResult.stats?.modifier_options || 'no stats');
    
    // Check results after sync
    const afterSync = await client.query(`
      SELECT COUNT(*) as total,
             COUNT(name_localized) as has_localized,
             COUNT(reference) as has_reference,
             COUNT(tax_group_reference) as has_tax_group,
             COUNT(costing_method) as has_costing,
             COUNT(external_id) as has_external_id
      FROM modifier_options
      WHERE tenant_id = $1
    `, [testTenantId]);
    
    console.log('\n📈 After sync modifier options state:');
    const after = afterSync.rows[0];
    console.log(`  Total options: ${after.total} (${after.total - before.total > 0 ? '+' : ''}${after.total - before.total})`);
    console.log(`  With localized names: ${after.has_localized} (${after.has_localized - before.has_localized > 0 ? '+' : ''}${after.has_localized - before.has_localized})`);
    console.log(`  With references: ${after.has_reference} (${after.has_reference - before.has_reference > 0 ? '+' : ''}${after.has_reference - before.has_reference})`);
    console.log(`  With tax group refs: ${after.has_tax_group} (${after.has_tax_group - before.has_tax_group > 0 ? '+' : ''}${after.has_tax_group - before.has_tax_group})`);
    console.log(`  With costing method: ${after.has_costing} (${after.has_costing - before.has_costing > 0 ? '+' : ''}${after.has_costing - before.has_costing})`);
    console.log(`  With external IDs: ${after.has_external_id} (${after.has_external_id - before.has_external_id > 0 ? '+' : ''}${after.has_external_id - before.has_external_id})`);
    
    // Sample 5 options to verify field population
    const samples = await client.query(`
      SELECT name, name_localized, reference, price, tax_group_reference, costing_method, external_id, is_active
      FROM modifier_options
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT 5
    `, [testTenantId]);
    
    console.log('\n🔍 Sample modifier options (latest 5):');
    samples.rows.forEach((opt, i) => {
      console.log(`  ${i + 1}. ${opt.name} (${opt.external_id || 'no-ext-id'})`);
      console.log(`     Localized: ${opt.name_localized || 'N/A'}`);
      console.log(`     Reference: ${opt.reference || 'N/A'}`);
      console.log(`     Price: $${opt.price}`);
      console.log(`     Tax Group: ${opt.tax_group_reference || 'N/A'}`);
      console.log(`     Costing: ${opt.costing_method || 'N/A'}`);
      console.log(`     Active: ${opt.is_active}`);
    });
    
    console.log('\n✅ Enhanced modifier options sync test completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await client.end();
  }
}

// Run the test
testEnhancedOptionsSync().catch(console.error);