// product-helpers.global.js — simple options helpers exposed on window.ProductHelpers
(function(){
  function hasMilkVariants(p){
    const name = String(p && p.name || '').toLowerCase();
    const cat  = String(p && p.category_name || '').toLowerCase();
    const include = ['latte','cappuccino','flat white','mocha','macchiato','cortado','frappe','white mocha','spanish'];
    const exclude = ['americano','espresso','drip','cold brew','iced americano','turkish coffee','tea','mojito','lemonade','juice'];
    if (exclude.some(w => name.includes(w))) return false;
    if (include.some(w => name.includes(w))) return true;
    if (cat.includes('coffee')) return true;
    return false;
  }
  function productOptions(p){
    if (!hasMilkVariants(p)) return null;
    return {
      size: [ {id:'reg', label:'Regular', delta:0}, {id:'lg', label:'Large', delta:0.5} ],
      milk: [ {id:'full', label:'Full fat', delta:0}, {id:'low', label:'Low fat', delta:0}, {id:'oat', label:'Oat', delta:0.25}, {id:'almond', label:'Almond', delta:0.25} ]
    };
  }
  function computePriceWith(p, opts, sel){
    try {
      let price = Number(p && p.price || 0) || 0;
      const size = (opts && opts.size || []).find(x=>String(x.id)===String(sel && sel.sizeId || ''));
      const milk = (opts && opts.milk || []).find(x=>String(x.id)===String(sel && sel.milkId || ''));
      if (size) price += Number(size.delta||0);
      if (milk) price += Number(milk.delta||0);
      return Math.round(price*1000)/1000;
    } catch { return Math.round((Number(p && p.price || 0) || 0)*1000)/1000; }
  }
  function selectionLabelSimple(opts, sel){
    const parts = [];
    try {
      const size = (opts && opts.size || []).find(x=>String(x.id)===String(sel && sel.sizeId || '')); if (size) parts.push(size.label);
      const milk = (opts && opts.milk || []).find(x=>String(x.id)===String(sel && sel.milkId || '')); if (milk) parts.push(milk.label);
    } catch {}
    return parts.join(', ');
  }
  try { window.ProductHelpers = { hasMilkVariants, productOptions, computePriceWith, selectionLabelSimple }; } catch {}
})();
