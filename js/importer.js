(function(){
  async function ensurePapa(){
    if (window.Papa) return window.Papa;
    await new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      s.src='https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js';
      s.async=true; s.onload=resolve; s.onerror=reject; document.head.appendChild(s);
    });
    return window.Papa;
  }

  async function parseFile(file){
    const Papa = await ensurePapa();
    return new Promise((resolve, reject)=>{
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h)=> String(h||'').trim(),
        complete: (res)=>{
          const headers = res.meta && res.meta.fields ? res.meta.fields.map(String) : [];
          const rows = Array.isArray(res.data) ? res.data : [];
          resolve({ headers, rows });
        },
        error: (err)=> reject(err)
      });
    });
  }

  function renderPreview(container, headers, rows, limit=20){
    if (!container) return;
    const thead = '<thead><tr>' + headers.map(h=>`<th>${escapeHtml(h)}</th>`).join('') + '</tr></thead>';
    const bodyRows = (rows||[]).slice(0,limit).map(r=>{
      return '<tr>' + headers.map(h=>`<td>${escapeHtml(r[h]??'')}</td>`).join('') + '</tr>';
    }).join('');
    container.innerHTML = `<div class="table" role="region"><table>${thead}<tbody>${bodyRows}</tbody></table></div>`;
  }

  function escapeHtml(s){
    s = String(s==null?'':s);
    return s.replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[c]));
  }

  function toCsv(headers, rows){
    const esc = (v)=>{
      const s = String(v==null?'':v);
      if (/[",\n]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
      return s;
    };
    const head = headers.map(esc).join(',');
    const body = (rows||[]).map(r=> headers.map(h=> esc(r[h])).join(',')).join('\n');
    return head + '\n' + body + '\n';
  }

  function downloadCsv(filename, headers, rows){
    const csv = toCsv(headers, rows);
    const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url), 4000);
  }

  window.Importer = { ensurePapa, parseFile, renderPreview, downloadCsv };
})();

