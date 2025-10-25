/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('dashboard_settings', function(table) {
    table.text('key').primary();
    table.jsonb('value').notNullable();
    table.text('description').nullable();
    table.text('category').defaultTo('general');
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    // Index for category-based queries
    table.index('category');
    table.index('updated_at');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('dashboard_settings');
};