#!/usr/bin/env node

// scripts/import_foodics_sales_backfill.js
// Historical backfill import script for Foodics sales data

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Load modules
const { makeClient } = require('../server/integrations/foodics.js');
const { MappingCache } = require('../server/integrations/sales/mappingCache.js');
const transformers = require('../server/integrations/sales/transformers.js');
const { SalesUpserter } = require('../server/integrations/sales/upserts.js');

// Configuration
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || '56ac557e-589d-4602-bc9b-946b201fb6f6';

// Load Foodics token
const FOODICS_TOKEN_PATH = path.join(__dirname, '../ios/foodics_token.txt');
let FOODICS_TOKEN = process.env.FOODICS_TOKEN || null;

if (!FOODICS_TOKEN && fs.existsSync(FOODICS_TOKEN_PATH)) {
    FOODICS_TOKEN = fs.readFileSync(FOODICS_TOKEN_PATH, 'utf8').trim();
}

if (!FOODICS_TOKEN) {
    console.error('❌ Foodics token not found. Set FOODICS_TOKEN env var or ensure ios/foodics_token.txt exists');
    process.exit(1);
}

// Database connection
function createDbPool() {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        console.error('❌ DATABASE_URL environment variable not set');
        process.exit(1);
    }
    
    const pool = new Pool({
        connectionString: dbUrl,
        ssl: false // Cloud SQL Proxy handles SSL
    });
    
    return pool;
}

// Database helper
async function db(pool, sql, params = []) {
    const client = await pool.connect();
    try {
        const result = await client.query(sql, params);
        return result.rows;
    } finally {
        client.release();
    }
}

// Sleep helper
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Parse command line arguments
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        tenant: DEFAULT_TENANT_ID,
        from: null,
        to: null,
        branch: null,
        status: null,
        concurrency: 1,
        includeCanceled: false,
        dryRun: false
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        
        if (arg === '--tenant' && i + 1 < args.length) {
            options.tenant = args[++i];
        } else if (arg === '--from' && i + 1 < args.length) {
            options.from = args[++i];
        } else if (arg === '--to' && i + 1 < args.length) {
            options.to = args[++i];
        } else if (arg === '--branch' && i + 1 < args.length) {
            options.branch = args[++i];
        } else if (arg === '--status' && i + 1 < args.length) {
            options.status = args[++i];
        } else if (arg === '--concurrency' && i + 1 < args.length) {
            options.concurrency = parseInt(args[++i], 10) || 1;
        } else if (arg === '--include-canceled') {
            options.includeCanceled = true;
        } else if (arg === '--dry-run') {
            options.dryRun = true;
        } else if (arg === '--help' || arg === '-h') {
            showHelp();
            process.exit(0);
        }
    }

    return options;
}

function showHelp() {
    console.log(`
Foodics Sales Backfill Import Script

Usage: node scripts/import_foodics_sales_backfill.js [options]

Options:
  --tenant <id>         Tenant ID to import for (default: ${DEFAULT_TENANT_ID})
  --from <date>         Start date (YYYY-MM-DD or ISO string)
  --to <date>           End date (YYYY-MM-DD or ISO string, default: now)
  --branch <id>         Filter by specific branch ID
  --status <status>     Filter by order status (e.g., paid, closed)
  --concurrency <n>     Number of concurrent batches (default: 1)
  --include-canceled    Include canceled/voided orders
  --dry-run            Show what would be imported without saving
  --help, -h           Show this help

Examples:
  # Import last 7 days
  node scripts/import_foodics_sales_backfill.js --from 2023-10-13 --to 2023-10-20

  # Import specific branch only  
  node scripts/import_foodics_sales_backfill.js --branch 12345 --from 2023-10-01

  # Dry run to see what would be imported
  node scripts/import_foodics_sales_backfill.js --from 2023-10-01 --dry-run
`);
}

// Format date for Foodics API
function formatDate(dateStr) {
    if (!dateStr) return null;
    
    // If it looks like YYYY-MM-DD, convert to ISO string
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return new Date(dateStr + 'T00:00:00.000Z').toISOString();
    }
    
    // Try to parse as date
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
        throw new Error(`Invalid date format: ${dateStr}. Use YYYY-MM-DD or ISO string.`);
    }
    
    return date.toISOString();
}

// Main import function
async function runImport() {
    const options = parseArgs();
    const pool = createDbPool();
    
    console.log('🚀 Starting Foodics Sales Backfill Import\n');
    console.log('Options:', {
        ...options,
        token: FOODICS_TOKEN ? '[PRESENT]' : '[MISSING]'
    });
    
    try {
        // Validate dates
        const fromDate = options.from ? formatDate(options.from) : null;
        const toDate = options.to ? formatDate(options.to) : new Date().toISOString();
        
        if (fromDate && toDate && new Date(fromDate) > new Date(toDate)) {
            throw new Error('From date cannot be after to date');
        }
        
        // Initialize Foodics client
        const client = makeClient(FOODICS_TOKEN);
        
        // Initialize mapping cache
        console.log('📋 Loading mapping cache...');
        const cache = new MappingCache(db.bind(null, pool), options.tenant, 'foodics');
        await cache.load();
        console.log('✅ Cache loaded:', cache.getStats());
        
        // Initialize upserter
        const upserter = new SalesUpserter(db.bind(null, pool), options.tenant, 'foodics');
        
        // Build API parameters
        const apiParams = {};
        if (fromDate) apiParams.updated_at_from = fromDate;
        if (toDate) apiParams.updated_at_to = toDate;
        if (options.branch) apiParams.branch_id = options.branch;
        if (options.status) apiParams.status = options.status;
        
        console.log('📦 Fetching orders from Foodics...');
        console.log('API Parameters:', apiParams);
        
        // Start sync run tracking
        let runId = null;
        if (!options.dryRun) {
            const [run] = await db(pool, `
                INSERT INTO integration_sync_runs (tenant_id, provider, ok, stats) 
                VALUES ($1, $2, null, $3::jsonb) 
                RETURNING id
            `, [options.tenant, 'foodics-sales-backfill', JSON.stringify({ type: 'backfill', options })]);
            runId = run.id;
        }
        
        // Fetch orders
        const ordersResult = await client.listOrders(apiParams);
        const orders = Array.isArray(ordersResult.items) ? ordersResult.items : [];
        
        console.log(`📊 Found ${orders.length} orders (${ordersResult.pages || 1} pages, ${ordersResult.requests || 1} requests)`);
        
        if (orders.length === 0) {
            console.log('ℹ️  No orders found matching criteria');
            return;
        }
        
        // Filter out canceled orders if not requested
        let filteredOrders = orders;
        if (!options.includeCanceled) {
            filteredOrders = orders.filter(order => {
                const status = String(order.status || '').toLowerCase();
                return !['canceled', 'cancelled', 'voided', 'void'].includes(status) && !order.is_void && !order.voided;
            });
            
            if (filteredOrders.length < orders.length) {
                console.log(`🚫 Filtered out ${orders.length - filteredOrders.length} canceled/voided orders`);
            }
        }
        
        if (options.dryRun) {
            console.log('\n🔍 DRY RUN - Orders that would be imported:');
            filteredOrders.slice(0, 10).forEach((order, i) => {
                console.log(`  ${i + 1}. ${order.id} - ${order.status} - ${order.total} ${order.currency || 'KWD'} - ${order.created_at}`);
            });
            if (filteredOrders.length > 10) {
                console.log(`  ... and ${filteredOrders.length - 10} more orders`);
            }
            console.log('\n✨ Dry run complete. Use without --dry-run to perform actual import.');
            return;
        }
        
        // Process orders
        const stats = {
            processed: 0,
            created: 0,
            updated: 0,
            errors: 0,
            skipped: 0,
            customers: { processed: 0, created: 0, updated: 0, errors: 0 }
        };
        
        const startTime = Date.now();
        
        // Process customers first
        console.log('\n👥 Processing customers...');
        const customerData = [];
        for (const order of filteredOrders) {
            if (order.customer) {
                const customerTransformed = transformers.transformCustomer(order.customer);
                if (customerTransformed) {
                    customerData.push(customerTransformed);
                }
            }
        }
        
        // Upsert customers
        for (const customer of customerData) {
            try {
                const customerId = await cache.upsertCustomer(customer);
                if (customerId) {
                    stats.customers.processed++;
                    stats.customers.created++; // Can't easily distinguish created vs updated
                }
            } catch (error) {
                console.error(`❌ Customer upsert error:`, error.message);
                stats.customers.errors++;
            }
        }
        
        console.log(`✅ Customers processed: ${stats.customers.processed} (${stats.customers.errors} errors)`);
        
        // Process orders in batches
        console.log('\n📦 Processing orders...');
        const BATCH_SIZE = 10;
        
        for (let i = 0; i < filteredOrders.length; i += BATCH_SIZE) {
            const batch = filteredOrders.slice(i, i + BATCH_SIZE);
            console.log(`   Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(filteredOrders.length / BATCH_SIZE)} (${batch.length} orders)...`);
            
            const batchStats = await upserter.upsertOrders(batch, transformers, cache);
            
            stats.processed += batchStats.processed;
            stats.created += batchStats.created;
            stats.updated += batchStats.updated;
            stats.errors += batchStats.errors;
            stats.skipped += batchStats.skipped;
            
            // Brief pause between batches
            if (i + BATCH_SIZE < filteredOrders.length) {
                await sleep(100);
            }
        }
        
        const duration = Date.now() - startTime;
        
        // Update sync run
        if (runId) {
            await db(pool, `
                UPDATE integration_sync_runs 
                SET finished_at = now(), ok = true, stats = $2::jsonb
                WHERE id = $1
            `, [runId, JSON.stringify(stats)]);
        }
        
        console.log('\n🎉 Import completed!');
        console.log('📊 Final Statistics:');
        console.log(`   Orders: ${stats.processed} processed (${stats.created} new, ${stats.updated} updated, ${stats.errors} errors)`);
        console.log(`   Customers: ${stats.customers.processed} processed (${stats.customers.errors} errors)`);
        console.log(`   Duration: ${Math.round(duration / 1000)}s`);
        
        if (stats.errors > 0) {
            console.log(`\n⚠️  ${stats.errors} orders had errors during processing. Check logs above for details.`);
        }
        
    } catch (error) {
        console.error('\n💥 Import failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Run the import
if (require.main === module) {
    runImport().catch(error => {
        console.error('💥 Critical error:', error);
        process.exit(1);
    });
}

module.exports = { runImport };