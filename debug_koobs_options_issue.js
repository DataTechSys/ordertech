#!/usr/bin/env node

/**
 * Debug script to investigate why Koobs modifier options are not syncing
 */

const https = require('https');
const { URL } = require('url');

const KOOBS_TENANT_ID = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';
const API_BASE = 'https://ordertech-715493130630.me-central1.run.app';

async function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'OrderTech-Debug/1.0'
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

async function debugKoobsOptions() {
  console.log('🔍 Debugging Koobs Modifier Options Sync Issue');
  console.log(`📋 Tenant: ${KOOBS_TENANT_ID}`);
  console.log(`🌐 API: ${API_BASE}`);
  
  try {
    // 1. Check current modifier groups
    console.log('\n📊 Step 1: Checking current modifier groups...');
    const groupsResp = await makeRequest('GET', `/admin/tenants/${KOOBS_TENANT_ID}/modifiers/groups`);
    console.log(`Status: ${groupsResp.status}`);
    
    if (groupsResp.status === 200 && groupsResp.body?.items) {
      console.log(`✅ Found ${groupsResp.body.items.length} modifier groups:`);
      groupsResp.body.items.slice(0, 5).forEach((g, i) => {
        console.log(`  ${i+1}. "${g.name}" (${g.id}) - ${g.options_count || 0} options`);
      });
    } else {
      console.log(`❌ Failed to fetch groups: ${JSON.stringify(groupsResp.body).slice(0, 200)}`);
    }
    
    // 2. Check current modifier options
    console.log('\n📊 Step 2: Checking current modifier options...');
    const optionsResp = await makeRequest('GET', `/admin/tenants/${KOOBS_TENANT_ID}/modifiers/options`);
    console.log(`Status: ${optionsResp.status}`);
    
    if (optionsResp.status === 200 && optionsResp.body?.items) {
      console.log(`✅ Found ${optionsResp.body.items.length} modifier options:`);
      optionsResp.body.items.slice(0, 5).forEach((o, i) => {
        console.log(`  ${i+1}. "${o.name}" - Group: ${o.group_name} ($${o.price})`);
      });
    } else {
      console.log(`❌ Failed to fetch options: ${JSON.stringify(optionsResp.body).slice(0, 200)}`);
    }
    
    // 3. Check integration status
    console.log('\n📊 Step 3: Checking Foodics integration...');
    const integrationResp = await makeRequest('GET', `/admin/tenants/${KOOBS_TENANT_ID}/integrations`);
    console.log(`Status: ${integrationResp.status}`);
    
    if (integrationResp.status === 200 && integrationResp.body?.integrations) {
      const foodics = integrationResp.body.integrations.find(i => i.provider === 'foodics');
      if (foodics) {
        console.log(`✅ Foodics integration found - Active: ${foodics.is_active}`);
      } else {
        console.log(`❌ No Foodics integration found`);
      }
    }
    
    // 4. Check sync runs history
    console.log('\n📊 Step 4: Checking recent sync runs...');
    const syncHistoryResp = await makeRequest('GET', `/admin/tenants/${KOOBS_TENANT_ID}/integrations/foodics/runs`);
    console.log(`Status: ${syncHistoryResp.status}`);
    
    if (syncHistoryResp.status === 200 && syncHistoryResp.body?.runs) {
      console.log(`✅ Found ${syncHistoryResp.body.runs.length} recent sync runs:`);
      syncHistoryResp.body.runs.slice(0, 3).forEach((run, i) => {
        console.log(`  ${i+1}. ${run.started_at} - OK: ${run.ok} - Options: ${run.stats?.modifier_options || 'N/A'}`);
      });
    }
    
    // 5. Try manual sync with phase=options
    console.log('\n🚀 Step 5: Running manual options sync...');
    const syncResp = await makeRequest('POST', `/admin/tenants/${KOOBS_TENANT_ID}/integrations/foodics/sync?phase=options`);
    console.log(`Status: ${syncResp.status}`);
    
    if (syncResp.status === 200) {
      console.log(`✅ Sync completed successfully!`);
      console.log(`📊 Results:`, syncResp.body?.stats?.modifier_options || 'No stats');
    } else if (syncResp.status === 401) {
      console.log(`❌ Authentication failed - need to authenticate first`);
    } else {
      console.log(`❌ Sync failed: ${JSON.stringify(syncResp.body).slice(0, 300)}`);
    }
    
    // 6. Check options again after sync
    console.log('\n📊 Step 6: Checking options after sync...');
    const optionsAfterResp = await makeRequest('GET', `/admin/tenants/${KOOBS_TENANT_ID}/modifiers/options`);
    
    if (optionsAfterResp.status === 200 && optionsAfterResp.body?.items) {
      console.log(`✅ Now found ${optionsAfterResp.body.items.length} modifier options (change: ${optionsAfterResp.body.items.length - (optionsResp.body?.items?.length || 0)})`);
    }
    
    console.log('\n🔧 Debug Summary:');
    console.log('1. If groups exist but no options → Group-to-options linking issue');
    console.log('2. If sync fails with 401 → Authentication issue');
    console.log('3. If sync succeeds but no options → Foodics API issue or mapping problem');
    console.log('4. Check Cloud Run logs for detailed sync execution info');
    
  } catch (error) {
    console.error('❌ Debug script failed:', error.message);
  }
}

// Run the debug
debugKoobsOptions().catch(console.error);