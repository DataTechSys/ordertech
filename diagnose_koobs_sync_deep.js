#!/usr/bin/env node

/**
 * Deep diagnostic for Koobs modifier options sync failure
 * This will help us understand what's happening at the Foodics API level
 */

const { Client } = require('pg');
const fs = require('fs');

async function diagnoseSyncIssue() {
  console.log('🔬 Deep Diagnostic: Koobs Modifier Options Sync');
  
  let client;
  try {
    // Connect to local proxy database
    client = new Client({
      host: process.env.PGHOST || '/Users/mosawi/.cloudsql/smart-order-469705:me-central1:ordertech-db',
      port: process.env.PGPORT || 5432,
      database: 'postgres',
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD
    });
    
    await client.connect();
    console.log('✅ Connected to database via Cloud SQL proxy');
    
    const KOOBS_TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';
    
    // 1. Check Foodics integration
    console.log('\n📋 Step 1: Checking Foodics integration...');
    const integrationResult = await client.query(`
      SELECT provider, is_active, credentials, created_at, updated_at
      FROM tenant_integrations 
      WHERE tenant_id = $1 AND provider = 'foodics'
    `, [KOOBS_TENANT_ID]);
    
    if (integrationResult.rows.length === 0) {
      console.log('❌ No Foodics integration found for Koobs!');
      return;
    }
    
    const integration = integrationResult.rows[0];
    console.log(`✅ Foodics integration found - Active: ${integration.is_active}`);
    
    // 2. Check sync runs
    console.log('\n📊 Step 2: Checking recent sync runs...');
    const syncRuns = await client.query(`
      SELECT id, started_at, finished_at, ok, error, stats
      FROM integration_sync_runs
      WHERE tenant_id = $1 AND provider = 'foodics'
      ORDER BY started_at DESC
      LIMIT 5
    `, [KOOBS_TENANT_ID]);
    
    if (syncRuns.rows.length === 0) {
      console.log('⚠️  No sync runs found');
    } else {
      console.log(`📈 Found ${syncRuns.rows.length} recent sync runs:`);
      syncRuns.rows.forEach((run, i) => {
        console.log(`  ${i + 1}. ${run.started_at} - OK: ${run.ok}`);
        if (run.stats) {
          const stats = typeof run.stats === 'string' ? JSON.parse(run.stats) : run.stats;
          console.log(`     Stats: Groups: ${JSON.stringify(stats.modifier_groups || {})}, Options: ${JSON.stringify(stats.modifier_options || {})}`);
        }
        if (run.error) {
          console.log(`     Error: ${run.error}`);
        }
      });
    }
    
    // 3. Check current modifier groups
    console.log('\n🗂️  Step 3: Checking current modifier groups...');
    const groupsResult = await client.query(`
      SELECT id, name, reference, external_id, created_at,
             (SELECT COUNT(*) FROM modifier_options WHERE group_id = mg.id) as option_count
      FROM modifier_groups mg
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT 10
    `, [KOOBS_TENANT_ID]);
    
    console.log(`📋 Found ${groupsResult.rows.length} modifier groups:`);
    groupsResult.rows.forEach((group, i) => {
      console.log(`  ${i + 1}. "${group.name}" (${group.reference || 'no-ref'}) - ${group.option_count} options`);
    });
    
    // 4. Check current modifier options
    console.log('\n📝 Step 4: Checking current modifier options...');
    const optionsResult = await client.query(`
      SELECT o.id, o.name, o.name_localized, o.reference, o.price, o.tax_group_reference, 
             o.costing_method, o.external_id, o.is_active, o.created_at,
             g.name as group_name
      FROM modifier_options o
      JOIN modifier_groups g ON g.id = o.group_id
      WHERE o.tenant_id = $1
      ORDER BY o.created_at DESC
      LIMIT 5
    `, [KOOBS_TENANT_ID]);
    
    console.log(`📝 Found ${optionsResult.rows.length} modifier options:`);
    if (optionsResult.rows.length > 0) {
      optionsResult.rows.forEach((opt, i) => {
        console.log(`  ${i + 1}. "${opt.name}" (Group: ${opt.group_name})`);
        console.log(`     Reference: ${opt.reference || 'N/A'}`);
        console.log(`     Price: $${opt.price}`);
        console.log(`     Tax Group: ${opt.tax_group_reference || 'N/A'}`);
        console.log(`     External ID: ${opt.external_id || 'N/A'}`);
        console.log(`     Localized: ${opt.name_localized || 'N/A'}`);
      });
    } else {
      console.log('❌ No modifier options found in database!');
    }
    
    // 5. Check external mappings
    console.log('\n🔗 Step 5: Checking external mappings...');
    const mappingsResult = await client.query(`
      SELECT entity_type, COUNT(*) as count
      FROM tenant_external_mappings
      WHERE tenant_id = $1 AND provider = 'foodics'
      GROUP BY entity_type
      ORDER BY entity_type
    `, [KOOBS_TENANT_ID]);
    
    console.log('📊 External mappings:');
    mappingsResult.rows.forEach(mapping => {
      console.log(`  - ${mapping.entity_type}: ${mapping.count}`);
    });
    
    // 6. Check table schema
    console.log('\n📋 Step 6: Checking modifier_options table schema...');
    const schemaResult = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'modifier_options'
      ORDER BY ordinal_position
    `);
    
    console.log('🏗️  Table schema:');
    schemaResult.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} (${col.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
    });
    
    // 7. Try to get Foodics token (if we can)
    console.log('\n🔑 Step 7: Checking Foodics token availability...');
    try {
      const tokenResult = await client.query(`
        SELECT 
          credentials->>'access_token' as has_token,
          LENGTH(credentials->>'access_token') as token_length
        FROM tenant_integrations 
        WHERE tenant_id = $1 AND provider = 'foodics'
      `, [KOOBS_TENANT_ID]);
      
      if (tokenResult.rows.length > 0 && tokenResult.rows[0].has_token) {
        console.log(`✅ Foodics token present (${tokenResult.rows[0].token_length} characters)`);
      } else {
        console.log('❌ No Foodics token found - this could be the issue!');
      }
    } catch (e) {
      console.log('⚠️  Could not check token:', e.message);
    }
    
    // 8. Summary and recommendations
    console.log('\n🎯 DIAGNOSTIC SUMMARY:');
    
    if (integrationResult.rows.length === 0) {
      console.log('❌ ISSUE: No Foodics integration configured');
    } else if (!integration.is_active) {
      console.log('❌ ISSUE: Foodics integration is inactive');
    } else if (optionsResult.rows.length === 0) {
      console.log('❌ ISSUE: No modifier options in database despite having groups');
      console.log('💡 LIKELY CAUSES:');
      console.log('   1. Foodics API not returning options for this tenant');
      console.log('   2. Group-to-option relationship mapping failing');
      console.log('   3. Options being filtered out (inactive/deleted)');
      console.log('   4. Sync process failing silently');
    } else {
      console.log('✅ Modifier options exist in database');
    }
    
    console.log('\n🔧 NEXT STEPS:');
    console.log('1. Check Cloud Run logs during sync execution');
    console.log('2. Manually test Foodics API with the token');
    console.log('3. Run sync with enhanced logging enabled');
    
  } catch (error) {
    console.error('❌ Diagnostic failed:', error.message);
    console.log('\n💡 Try running with proper database environment:');
    console.log('source scripts/env.local.sh && node diagnose_koobs_sync_deep.js');
  } finally {
    if (client) {
      await client.end();
    }
  }
}

// Run the diagnostic
diagnoseSyncIssue().catch(console.error);