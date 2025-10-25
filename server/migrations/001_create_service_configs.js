/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('service_configs', function(table) {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('name').notNullable().unique();
    table.text('type').notNullable();
    table.text('host').notNullable();
    table.integer('port').nullable();
    table.text('status').notNullable().defaultTo('unknown');
    table.text('region').nullable();
    table.jsonb('metadata').defaultTo('{}');
    table.text('description').nullable();
    table.boolean('enabled').defaultTo(true);
    table.integer('timeout_ms').defaultTo(5000);
    table.integer('retry_count').defaultTo(3);
    table.timestamps(true, true);
    
    // Indexes for better performance
    table.index('name');
    table.index('type');
    table.index('status');
    table.index('region');
    table.index(['type', 'region']);
    table.index(['status', 'updated_at']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('service_configs');
};