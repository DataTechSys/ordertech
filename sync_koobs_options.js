#!/usr/bin/env node

/**
 * Sync modifier options for Koobs tenant with enhanced field mapping
 */

async function syncKoobsOptions() {
  console.log('🔄 Syncing modifier options for Koobs tenant...');
  
  const KOOBS_TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';
  const CLOUD_RUN_BASE = 'https://ordertech-715493130630.me-central1.run.app';
  
  try {
    // Get the bearer token from command line argument
    const bearerToken = process.argv[2];
    if (!bearerToken) {
      console.log('❌ Please provide your bearer token as an argument');
      console.log('Usage: node sync_koobs_options.js <your_bearer_token>');
      return;
    }
    
    console.log('🎫 Using provided bearer token...');
    
    // First, let's check current modifier options state
    console.log('\n📊 Checking current modifier options state...');
    const optionsResponse = await fetch(`${CLOUD_RUN_BASE}/admin/tenants/${KOOBS_TENANT_ID}/modifiers/options`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${bearerToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (optionsResponse.ok) {
      const optionsData = await optionsResponse.json();
      console.log(`✅ Current options count: ${optionsData.items?.length || 0}`);
      
      if (optionsData.items && optionsData.items.length > 0) {
        console.log('\n📋 Sample options:');
        optionsData.items.slice(0, 3).forEach((opt, i) => {
          console.log(`  ${i + 1}. ${opt.name} - $${opt.price} (Group: ${opt.group_name})`);
          console.log(`     Reference: ${opt.reference || 'N/A'}`);
          console.log(`     Localized: ${opt.name_localized || 'N/A'}`);
          console.log(`     Tax Group: ${opt.tax_group_reference || 'N/A'}`);
          console.log(`     External ID: ${opt.external_id || 'N/A'}`);
        });
      }
    } else {
      console.log(`❌ Failed to get current options: ${optionsResponse.status} ${optionsResponse.statusText}`);
      if (optionsResponse.status === 401) {
        console.log('💡 Your token may have expired. Please get a fresh token from the browser.');
        return;
      }
    }
    
    // Check modifier groups too
    console.log('\n📊 Checking modifier groups...');
    const groupsResponse = await fetch(`${CLOUD_RUN_BASE}/admin/tenants/${KOOBS_TENANT_ID}/modifiers/groups`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${bearerToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (groupsResponse.ok) {
      const groupsData = await groupsResponse.json();
      console.log(`✅ Current modifier groups: ${groupsData.items?.length || 0}`);
      
      if (groupsData.items && groupsData.items.length > 0) {
        console.log('\n📋 Sample groups:');
        groupsData.items.slice(0, 3).forEach((group, i) => {
          console.log(`  ${i + 1}. ${group.name} (${group.options_count || 0} options, ${group.products_count || 0} products linked)`);
        });
      }
    }
    
    // Run the enhanced modifier options sync
    console.log('\n🚀 Running enhanced modifier options sync...');
    const syncResponse = await fetch(`${CLOUD_RUN_BASE}/admin/tenants/${KOOBS_TENANT_ID}/integrations/foodics/sync?phase=options`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${bearerToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`Sync response: ${syncResponse.status} ${syncResponse.statusText}`);
    
    if (syncResponse.ok) {
      const syncResult = await syncResponse.json();
      console.log('✅ Sync completed successfully!');
      console.log('\n📈 Sync Statistics:');
      
      if (syncResult.stats) {
        const stats = syncResult.stats;
        console.log(`  Modifier Groups: Created ${stats.modifier_groups?.created || 0}, Updated ${stats.modifier_groups?.updated || 0}`);
        console.log(`  Modifier Options: Created ${stats.modifier_options?.created || 0}, Updated ${stats.modifier_options?.updated || 0}, Skipped ${stats.modifier_options?.skipped || 0}`);
        console.log(`  Duration: ${stats.duration_ms || 0}ms`);
      }
    } else {
      const errorText = await syncResponse.text();
      console.log('❌ Sync failed:', errorText);
      return;
    }
    
    // Check the results after sync
    console.log('\n📊 Checking results after sync...');
    const afterSyncResponse = await fetch(`${CLOUD_RUN_BASE}/admin/tenants/${KOOBS_TENANT_ID}/modifiers/options`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${bearerToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (afterSyncResponse.ok) {
      const afterSyncData = await afterSyncResponse.json();
      console.log(`✅ Final options count: ${afterSyncData.items?.length || 0}`);
      
      // Show enhanced fields for a few options
      if (afterSyncData.items && afterSyncData.items.length > 0) {
        console.log('\n🔍 Enhanced field verification (first 3 options):');
        afterSyncData.items.slice(0, 3).forEach((opt, i) => {
          console.log(`\n  Option ${i + 1}: ${opt.name}`);
          console.log(`    Price: $${opt.price}`);
          console.log(`    Group: ${opt.group_name}`);
          console.log(`    Reference/SKU: ${opt.reference || 'N/A'}`);
          console.log(`    Localized Name: ${opt.name_localized || 'N/A'}`);
          console.log(`    Tax Group: ${opt.tax_group_reference || 'N/A'}`);
          console.log(`    Costing Method: ${opt.costing_method || 'N/A'}`);
          console.log(`    External ID: ${opt.external_id || 'N/A'}`);
          console.log(`    Active: ${opt.is_active}`);
          console.log(`    Sort Order: ${opt.sort_order || 'N/A'}`);
        });
      }
    }
    
    console.log('\n🎉 Sync process completed!');
    console.log('💡 If no options are showing in the UI, check:');
    console.log('   1. Modifier groups have options linked');
    console.log('   2. Options are marked as active');
    console.log('   3. Browser cache (try refreshing)');
    
  } catch (error) {
    console.error('❌ Sync failed with error:', error.message);
  }
}

// Run the sync
syncKoobsOptions().catch(console.error);