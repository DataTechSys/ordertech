#!/usr/bin/env node

/**
 * Direct fix for Koobs modifier options sync issue
 * This script directly calls our enhanced sync with proper authentication
 */

const https = require('https');
const { URL } = require('url');

const KOOBS_TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';
const API_BASE = 'https://app.ordertech.me'; // Use the main domain

async function makeAuthenticatedRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    
    // Use basic auth with the provided credentials
    const credentials = Buffer.from('ordertech:Ordertech.2020').toString('base64');
    
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${credentials}`,
        'User-Agent': 'OrderTech-Fix/1.0'
      }
    };

    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = {
            status: res.statusCode,
            headers: res.headers,
            body: data.length > 0 ? (data.startsWith('{') || data.startsWith('[') ? JSON.parse(data) : data) : null
          };
          resolve(result);
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data
          });
        }
      });
    });

    req.on('error', reject);
    
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    
    req.end();
  });
}

async function fixKoobsOptions() {
  console.log('🔧 Fixing Koobs Modifier Options Sync Issue');
  console.log(`📋 Tenant: ${KOOBS_TENANT_ID}`);
  console.log(`🌐 API: ${API_BASE}`);
  
  try {
    // Step 1: Check current state
    console.log('\n📊 Step 1: Checking current modifier groups...');
    const groupsResp = await makeAuthenticatedRequest('GET', `/admin/tenants/${KOOBS_TENANT_ID}/modifiers/groups`);
    console.log(`Status: ${groupsResp.status}`);
    
    if (groupsResp.status === 200 && groupsResp.body?.items) {
      console.log(`✅ Found ${groupsResp.body.items.length} modifier groups`);
      groupsResp.body.items.slice(0, 3).forEach((g, i) => {
        console.log(`  ${i+1}. "${g.name}" - ${g.options_count || 0} options`);
      });
    } else {
      console.log(`❌ Failed to fetch groups: ${groupsResp.status}`);
      return;
    }
    
    // Step 2: Check current options
    console.log('\n📊 Step 2: Checking current modifier options...');
    const optionsResp = await makeAuthenticatedRequest('GET', `/admin/tenants/${KOOBS_TENANT_ID}/modifiers/options`);
    console.log(`Status: ${optionsResp.status}`);
    
    const beforeCount = (optionsResp.status === 200 && optionsResp.body?.items) ? optionsResp.body.items.length : 0;
    console.log(`📋 Current options count: ${beforeCount}`);
    
    // Step 3: Run enhanced sync - GROUPS phase first
    console.log('\n🚀 Step 3: Running Groups sync...');
    const groupsSyncResp = await makeAuthenticatedRequest('POST', `/admin/tenants/${KOOBS_TENANT_ID}/integrations/foodics/sync?phase=groups`);
    console.log(`Groups sync status: ${groupsSyncResp.status}`);
    
    if (groupsSyncResp.status === 200) {
      const groupsStats = groupsSyncResp.body?.stats?.modifier_groups;
      console.log(`✅ Groups sync completed:`, groupsStats || 'no stats');
    } else {
      console.log(`❌ Groups sync failed: ${JSON.stringify(groupsSyncResp.body).slice(0, 300)}`);
    }
    
    // Step 4: Run enhanced sync - OPTIONS phase
    console.log('\n🚀 Step 4: Running OPTIONS sync with enhanced fields...');
    const optionsSyncResp = await makeAuthenticatedRequest('POST', `/admin/tenants/${KOOBS_TENANT_ID}/integrations/foodics/sync?phase=options&force_refresh=1`);
    console.log(`Options sync status: ${optionsSyncResp.status}`);
    
    if (optionsSyncResp.status === 200) {
      const optionsStats = optionsSyncResp.body?.stats?.modifier_options;
      console.log(`✅ Options sync completed:`, optionsStats || 'no stats');
    } else {
      console.log(`❌ Options sync failed: ${JSON.stringify(optionsSyncResp.body).slice(0, 300)}`);
    }
    
    // Step 5: Check results
    console.log('\n📊 Step 5: Checking results...');
    const afterOptionsResp = await makeAuthenticatedRequest('GET', `/admin/tenants/${KOOBS_TENANT_ID}/modifiers/options`);
    
    if (afterOptionsResp.status === 200 && afterOptionsResp.body?.items) {
      const afterCount = afterOptionsResp.body.items.length;
      console.log(`📈 Options count after sync: ${afterCount} (${afterCount - beforeCount > 0 ? '+' : ''}${afterCount - beforeCount})`);
      
      if (afterCount > 0) {
        console.log('\n🎯 Sample options (first 3):');
        afterOptionsResp.body.items.slice(0, 3).forEach((o, i) => {
          console.log(`  ${i+1}. "${o.name}" (Group: ${o.group_name})`);
          console.log(`     - Reference: ${o.reference || 'N/A'}`);
          console.log(`     - Price: $${o.price}`);
          console.log(`     - Tax Group: ${o.tax_group_reference || 'N/A'}`);
          console.log(`     - Costing: ${o.costing_method || 'N/A'}`);
          console.log(`     - External ID: ${o.external_id || 'N/A'}`);
        });
      }
    }
    
    // Step 6: Verify enhanced fields are populated
    console.log('\n🔍 Step 6: Verifying enhanced field population...');
    if (afterOptionsResp.status === 200 && afterOptionsResp.body?.items) {
      const options = afterOptionsResp.body.items;
      const fieldCounts = {
        total: options.length,
        with_localized: options.filter(o => o.name_localized).length,
        with_tax_group: options.filter(o => o.tax_group_reference).length,
        with_costing: options.filter(o => o.costing_method).length,
        with_external_id: options.filter(o => o.external_id).length
      };
      
      console.log('📊 Field population summary:');
      console.log(`  - Total options: ${fieldCounts.total}`);
      console.log(`  - With localized names: ${fieldCounts.with_localized}`);
      console.log(`  - With tax group refs: ${fieldCounts.with_tax_group}`);
      console.log(`  - With costing method: ${fieldCounts.with_costing}`);
      console.log(`  - With external IDs: ${fieldCounts.with_external_id}`);
    }
    
    console.log('\n✅ Koobs modifier options fix completed!');
    console.log('💡 If options are now visible, the enhanced sync is working correctly.');
    console.log('🔗 Check the admin UI: https://app.ordertech.me/modifiers/');
    
  } catch (error) {
    console.error('❌ Fix script failed:', error.message);
  }
}

// Run the fix
fixKoobsOptions().catch(console.error);