// product-helpers.js — shared simple options helpers (ES module)

// Decide if a product has simple size/milk options
export function hasMilkVariants(p){
  const name = String(p?.name||'').toLowerCase();
  const cat  = String(p?.category_name||'').toLowerCase();
  const include = ['latte','cappuccino','flat white','mocha','macchiato','cortado','frappe','white mocha','spanish'];
  const exclude = ['americano','espresso','drip','cold brew','iced americano','turkish coffee','tea','mojito','lemonade','juice'];
  if (exclude.some(w => name.includes(w))) return false;
  if (include.some(w => name.includes(w))) return true;
  if (cat.includes('coffee')) return true;
  return false;
}

// Return simple options definition if applicable
export function productOptions(p){
  if (!hasMilkVariants(p)) return null;
  return {
    size: [ {id:'reg', label:'Regular', delta:0}, {id:'lg', label:'Large', delta:0.5} ],
    milk: [ {id:'full', label:'Full fat', delta:0}, {id:'low', label:'Low fat', delta:0}, {id:'oat', label:'Oat', delta:0.25}, {id:'almond', label:'Almond', delta:0.25} ]
  };
}

// Compute price from base + simple options
export function computePriceWith(p, opts, sel){
  try {
    let price = Number(p?.price)||0;
    const size = (opts?.size||[]).find(x=>String(x.id)===String(sel?.sizeId||''));
    const milk = (opts?.milk||[]).find(x=>String(x.id)===String(sel?.milkId||''));
    if (size) price += Number(size.delta||0);
    if (milk) price += Number(milk.delta||0);
    return Math.round(price*1000)/1000;
  } catch { return Math.round(Number(p?.price||0)*1000)/1000; }
}

// Build a human-readable selection label from simple options
export function selectionLabelSimple(opts, sel){
  const parts = [];
  try {
    const size = (opts?.size||[]).find(x=>String(x.id)===String(sel?.sizeId||'')); if (size) parts.push(size.label);
    const milk = (opts?.milk||[]).find(x=>String(x.id)===String(sel?.milkId||'')); if (milk) parts.push(milk.label);
  } catch {}
  return parts.join(', ');
}

