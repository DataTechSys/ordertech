/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('service_status_history', function(table) {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('service_id').notNullable().references('id').inTable('service_configs').onDelete('CASCADE');
    table.text('status').notNullable();
    table.integer('response_time_ms').notNullable();
    table.jsonb('details').defaultTo('{}');
    table.text('error_message').nullable();
    table.timestamp('timestamp').defaultTo(knex.fn.now());
    
    // Indexes for time-series queries
    table.index(['service_id', 'timestamp']);
    table.index(['timestamp']);
    table.index(['status', 'timestamp']);
    table.index(['service_id', 'status', 'timestamp']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('service_status_history');
};