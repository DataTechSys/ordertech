// data.js — tiny helper to expose formatters and totals calc
export const money = (n) => `${Number(n).toFixed(3)} KWD`;
export function computeTotals(items){
  const subtotal = items.reduce((s,i) => s + Number(i.price)*Number(i.qty||1), 0);
  const tax = 0; // adjust if needed
  const total = subtotal + tax;
  return { subtotal, tax, total };
}

