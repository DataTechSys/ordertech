// Debug modifier relationships
const { finalModifierSync } = require('./final_modifier_sync');

// Check what's actually in the database
async function debugModifiers(db) {
  console.log('🔍 DEBUGGING MODIFIER RELATIONSHIPS');
  console.log('=====================================');
  
  try {
    // Check modifier groups
    const groups = await db('SELECT id, name FROM catalog.modifier_groups ORDER BY name');
    console.log(`\n📦 Found ${groups.length} modifier groups in catalog schema:`);
    groups.forEach(g => console.log(`   - ${g.name} (id: ${g.id})`));
    
    // Check modifier options  
    const options = await db('SELECT id, group_id, name FROM catalog.modifier_options ORDER BY group_id, name');
    console.log(`\n🏷️  Found ${options.length} modifier options in catalog schema:`);
    options.forEach(o => console.log(`   - ${o.name} (group_id: ${o.group_id})`));
    
    // Check products
    const products = await db('SELECT id, name FROM catalog.products WHERE name LIKE \'%Matcha%\' ORDER BY name LIMIT 5');
    console.log(`\n☕ Found ${products.length} Matcha products in catalog schema:`);
    products.forEach(p => console.log(`   - ${p.name} (id: ${p.id})`));
    
    // Check product-modifier relationships
    const relationships = await db('SELECT pmg.product_id, pmg.group_id, p.name as product_name, mg.name as group_name FROM catalog.product_modifier_groups pmg JOIN catalog.products p ON pmg.product_id = p.id JOIN catalog.modifier_groups mg ON pmg.group_id = mg.id ORDER BY p.name, mg.name');
    console.log(`\n🔗 Found ${relationships.length} product-modifier relationships in catalog schema:`);
    relationships.forEach(r => console.log(`   - ${r.product_name} <-> ${r.group_name}`));
    
    // Check if there are any relationships in other schemas
    const otherSchemas = ['public', 'saas'];
    for (const schema of otherSchemas) {
      try {
        const altRels = await db(`SELECT COUNT(*) as count FROM ${schema}.product_modifier_groups`);
        console.log(`\n🔍 Found ${altRels[0]?.count || 0} relationships in ${schema} schema`);
      } catch (e) {
        console.log(`\n❌ No product_modifier_groups table in ${schema} schema`);
      }
    }
    
    // Check the specific Matcha product that was manually linked
    const matchaProducts = await db("SELECT id, name FROM catalog.products WHERE name ILIKE '%matcha%'");
    console.log(`\n🍃 Matcha products found:`);
    matchaProducts.forEach(p => console.log(`   - ${p.name} (id: ${p.id})`));
    
    if (matchaProducts.length > 0) {
      const matchaId = matchaProducts[0].id;
      const matchaRels = await db('SELECT pmg.*, mg.name as group_name FROM catalog.product_modifier_groups pmg JOIN catalog.modifier_groups mg ON pmg.group_id = mg.id WHERE pmg.product_id = ?', [matchaId]);
      console.log(`\n🔗 Modifier groups for ${matchaProducts[0].name}:`);
      matchaRels.forEach(r => console.log(`   - ${r.group_name} (group_id: ${r.group_id})`));
    }
    
  } catch (error) {
    console.error('❌ Debug failed:', error.message);
  }
}

module.exports = { debugModifiers };