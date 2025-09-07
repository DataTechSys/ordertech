// /js/geo.js — client-side country and city helpers
(function(){
  async function loadCountries(){
    // Try REST Countries API (no auth). Fallback to a minimal set if offline.
    try {
      const r = await fetch('https://restcountries.com/v3.1/all?fields=name,cca2', { cache: 'force-cache' });
      if (!r.ok) throw new Error('net');
      const j = await r.json();
      const out = (Array.isArray(j) ? j : []).map(x => ({ code: String(x.cca2||'').toUpperCase(), name: (x.name&&x.name.common)||'' }))
        .filter(x => x.code && x.name)
        .sort((a,b)=>a.name.localeCompare(b.name));
      if (out.length) return out;
    } catch {}
    return [
      { code:'KW', name:'Kuwait' }, { code:'SA', name:'Saudi Arabia' }, { code:'AE', name:'United Arab Emirates' },
      { code:'QA', name:'Qatar' }, { code:'BH', name:'Bahrain' }, { code:'OM', name:'Oman' },
      { code:'EG', name:'Egypt' }, { code:'US', name:'United States' }, { code:'GB', name:'United Kingdom' }
    ];
  }
  const CITIES_BY_CODE = {
    KW: ['Kuwait City','Hawalli','Salmiya','Farwaniya','Mangaf','Fahaheel','Jahra'],
    SA: ['Riyadh','Jeddah','Dammam','Khobar','Makkah','Madinah','Tabuk','Abha'],
    AE: ['Dubai','Abu Dhabi','Sharjah','Ajman','Ras Al Khaimah','Fujairah','Umm Al Quwain'],
    QA: ['Doha','Al Rayyan','Al Wakrah','Al Khor','Umm Salal'],
    BH: ['Manama','Muharraq','Riffa','Isa Town','Sitra'],
    OM: ['Muscat','Seeb','Salalah','Sohar','Nizwa'],
    EG: ['Cairo','Giza','Alexandria','Shubra El Kheima','Port Said'],
    US: ['New York','Los Angeles','Chicago','Houston','Phoenix','Philadelphia','San Antonio','San Diego','Dallas','San Jose'],
    GB: ['London','Birmingham','Manchester','Leeds','Glasgow','Liverpool','Bristol','Sheffield']
  };
  function getCitiesForCountry(code){
    const k = String(code||'').toUpperCase();
    return Array.isArray(CITIES_BY_CODE[k]) ? CITIES_BY_CODE[k].slice() : [];
  }
  window.Geo = { loadCountries, getCitiesForCountry };
})();

