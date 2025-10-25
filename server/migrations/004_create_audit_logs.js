/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('audit_logs', function(table) {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('actor').nullable(); // User/system performing the action
    table.text('action').notNullable(); // What action was performed
    table.text('resource_type').nullable(); // Type of resource (service, config, etc.)
    table.text('resource_id').nullable(); // ID of the resource
    table.jsonb('details').defaultTo('{}'); // Additional details
    table.jsonb('changes').defaultTo('{}'); // Before/after for updates
    table.text('ip_address').nullable();
    table.text('user_agent').nullable();
    table.text('session_id').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    // Indexes for audit queries
    table.index('actor');
    table.index('action');
    table.index('resource_type');
    table.index('resource_id');
    table.index('created_at');
    table.index(['actor', 'created_at']);
    table.index(['action', 'created_at']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('audit_logs');
};