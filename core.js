// ==============================================================================
// CORE ENGINE CONDIVISO - UD'A CLINICAL SYSTEM V6 PRO
// ==============================================================================

(function (global) {
  'use strict';

  const CFG = global.UDA_CONFIG || {};
  let serverOffsetSec = 0;

  function getBaseUrl() {
    if (CFG.PORTAL_BASE_URL && CFG.PORTAL_BASE_URL.trim()) {
      return CFG.PORTAL_BASE_URL.replace(/\/+$/, '');
    }
    const loc = global.location;
    if (!loc || loc.protocol === 'file:') return '';
    return (loc.origin + loc.pathname.substring(0, loc.pathname.lastIndexOf('/'))).replace(/\/+$/, '');
  }

  function assertConfigured() {
    if (!CFG.SUPABASE_URL || CFG.SUPABASE_URL.includes('INSERISCI') || !CFG.SUPABASE_ANON_KEY || CFG.SUPABASE_ANON_KEY.includes('INSERISCI')) {
      throw new Error('Configurazione incompleta: inserisci SUPABASE_URL e SUPABASE_ANON_KEY nel file config.js.');
    }
  }

  // ----------------------------------------------------------------------------
  // 1. CLIENT RPC SUPABASE & EDGE FUNCTIONS
  // ----------------------------------------------------------------------------
  async function rpc(fnName, params = {}) {
    assertConfigured();
    const url = `${CFG.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/rpc/${fnName}`;
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': CFG.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${CFG.SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify(params)
      });
    } catch (netErr) {
      throw new Error('Connessione al server assente. Verifica la rete Wi-Fi o dati mobili e riprova.');
    }

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }

    if (!res.ok) {
      const msg = (data && (data.message || data.error_description || data.error)) || `Errore server (${res.status})`;
      const err = new Error(cleanPgError(msg));
      err.raw = msg;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function callEdgeFunction(fnName, payload = {}) {
    assertConfigured();
    const url = `${CFG.SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/${fnName}`;
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': CFG.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${CFG.SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify(payload)
      });
    } catch (_) {
      throw new Error('Impossibile contattare il servizio email (Edge Function non raggiungibile).');
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || data.message || `Errore servizio email (${res.status})`);
    }
    return data;
  }

  function cleanPgError(msg) {
    if (!msg) return 'Operazione non riuscita.';
    return String(msg)
      .replace(/^NON_AUTORIZZATO:\s*/i, '')
      .replace(/^CREDENZIALI_ERRATE:\s*/i, '')
      .replace(/^PIN_ERRATO:\s*/i, '')
      .replace(/^NON_ABILITATO:\s*/i, '')
      .replace(/^PASSWORD_ERRATA:\s*/i, '')
      .replace(/^PASSWORD_DEBOLE:\s*/i, '')
      .replace(/^DISABILITATO:\s*/i, '');
  }

  // ----------------------------------------------------------------------------
  // 2. SESSIONI ISOLATE PER PORTALE (Permette test multi-scheda senza conflitti)
  // ----------------------------------------------------------------------------
  const session = {
    key(scope) { return `uda_v6_token_${scope}`; },
    get(scope) { return localStorage.getItem(this.key(scope)); },
    set(scope, token) { localStorage.setItem(this.key(scope), token); },
    clear(scope) { localStorage.removeItem(this.key(scope)); }
  };

  // ----------------------------------------------------------------------------
  // 3. SINCRONIZZAZIONE OROLOGIO SERVER (ANTI CLOCK-SKEW)
  // ----------------------------------------------------------------------------
  const time = {
    sync(serverEpoch) {
      if (typeof serverEpoch === 'number' && serverEpoch > 0) {
        serverOffsetSec = Math.round(serverEpoch - Math.floor(Date.now() / 1000));
      }
    },
    now() {
      return Math.floor(Date.now() / 1000) + serverOffsetSec;
    }
  };

  // ----------------------------------------------------------------------------
  // 4. SHA-256 (WEB CRYPTO + FALLBACK PURE-JS) & GESTIONE TOKEN QR FIRMATI
  // ----------------------------------------------------------------------------
  function sha256Fallback(str) {
    const bytes = new TextEncoder().encode(str);
    const K = [
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
    ];
    let H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const bitLen = bytes.length * 8;
    const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
    const buf = new Uint8Array(paddedLen);
    buf.set(bytes);
    buf[bytes.length] = 0x80;
    const view = new DataView(buf.buffer);
    view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
    view.setUint32(paddedLen - 4, bitLen >>> 0, false);

    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    const W = new Uint32Array(64);

    for (let offset = 0; offset < paddedLen; offset += 64) {
      for (let i = 0; i < 16; i++) W[i] = view.getUint32(offset + i * 4, false);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
        const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      H = [
        (H[0] + a) >>> 0, (H[1] + b) >>> 0, (H[2] + c) >>> 0, (H[3] + d) >>> 0,
        (H[4] + e) >>> 0, (H[5] + f) >>> 0, (H[6] + g) >>> 0, (H[7] + h) >>> 0
      ];
    }
    return H.map(x => x.toString(16).padStart(8, '0')).join('');
  }

  async function sha256Hex(str) {
    if (global.crypto && global.crypto.subtle && global.isSecureContext) {
      const buf = await global.crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    return sha256Fallback(str);
  }

  async function buildQrToken(matricola, epoch, qrSecret) {
    const hash = await sha256Hex(`${matricola}|${epoch}|${qrSecret}`);
    const firma = hash.slice(0, 16);
    return btoa(`${matricola}|${epoch}|${firma}`);
  }

  function parseQrToken(tokenBase64) {
    const decoded = atob(String(tokenBase64 || '').trim());
    const parts = decoded.split('|');
    if (parts.length !== 3) throw new Error('Formato QR Code non riconosciuto.');
    const ts = parseInt(parts[1], 10);
    if (!parts[0] || Number.isNaN(ts) || !parts[2]) throw new Error('Contenuto QR Code corrotto.');
    return { matricola: parts[0], timestamp: ts, firma: parts[2] };
  }

  // ----------------------------------------------------------------------------
  // 5. UI HELPERS (TOAST, ESCAPE XSS, BUTTON LOCK, ENTER KEY)
  // ----------------------------------------------------------------------------
  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"')
      .replace(/'/g, ''');
  }

  function ensureToastContainer() {
    let el = document.getElementById('udaToastContainer');
    if (!el) {
      el = document.createElement('div');
      el.id = 'udaToastContainer';
      el.className = 'toast-container';
      document.body.appendChild(el);
    }
    return el;
  }

  function toast(message, type = 'info', duration = 3600) {
    const container = ensureToastContainer();
    const item = document.createElement('div');
    item.className = `toast toast-${type}`;
    item.textContent = message;
    container.appendChild(item);
    requestAnimationFrame(() => item.classList.add('show'));
    setTimeout(() => {
      item.classList.remove('show');
      setTimeout(() => item.remove(), 250);
    }, duration);
  }

  async function lockBtn(btn, asyncFn, loadingText = 'Salvataggio...') {
    if (!btn) return asyncFn();
    if (btn.dataset.locked === '1') return;
    btn.dataset.locked = '1';
    const origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-inline"></span> ${esc(loadingText)}`;
    try {
      return await asyncFn();
    } finally {
      btn.disabled = false;
      btn.innerHTML = origHtml;
      delete btn.dataset.locked;
    }
  }

  function bindEnter(ids, callback) {
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            callback();
          }
        });
      }
    });
  }

  function formatDateIt(isoDate) {
    if (!isoDate) return '-';
    const p = String(isoDate).slice(0, 10).split('-');
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : isoDate;
  }

  function formatNum(n) {
    const v = parseFloat(n || 0);
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  }

  // ----------------------------------------------------------------------------
  // 6. CALCOLI DIDATTICI CONDIVISI (COORTI, ANNI, METRICHE STUDENTE)
  // ----------------------------------------------------------------------------
  function targetCoorte(piani, coorte, annoSpecifico = null) {
    const list = (piani || []).filter(p =>
      p.coorte === coorte && (!annoSpecifico || annoSpecifico === 'FC' || String(p.anno_corso) === String(annoSpecifico))
    );
    return list.reduce((acc, r) => {
      acc.tpv += parseFloat(r.target_tpv || 0);
      acc.secondo += parseFloat(r.target_secondo || 0);
      acc.teorico += parseFloat(r.target_teorico || 0);
      acc.ppv += parseInt(r.target_ppv || 0, 10);
      return acc;
    }, { tpv: 0, secondo: 0, teorico: 0, ppv: 0 });
  }

  function metricheStudente(st, piani, timbrature) {
    const mieTimb = (timbrature || []).filter(t => t.matricola === st.matricola || t.id_studente === st.id);
    const oreTpv = mieTimb.filter(t => t.ruolo === 'Primo').reduce((s, t) => s + parseFloat(t.ore || 0), 0) + parseFloat(st.ore_pregresse_bonus || 0);
    const oreSec = mieTimb.filter(t => t.ruolo === 'Secondo').reduce((s, t) => s + parseFloat(t.ore || 0), 0);
    const oreTeo = mieTimb.filter(t => t.ruolo === 'Teorico').reduce((s, t) => s + parseFloat(t.ore || 0), 0);
    const ppv = mieTimb.filter(t => t.ppv).length;
    const tar = targetCoorte(piani, st.coorte);

    const isIdoneo = (tar.tpv > 0 && oreTpv >= tar.tpv && ppv >= tar.ppv);
    const isRischio = (!isIdoneo && st.anno_corso === '6' && tar.tpv > 0 && oreTpv < (tar.tpv * 0.5));

    return {
      oreTpv, oreSec, oreTeo, ppv,
      targetTpv: tar.tpv, targetSec: tar.secondo, targetTeo: tar.teorico, targetPpv: tar.ppv,
      isIdoneo, isRischio, timbrature: mieTimb
    };
  }

  function statoReparto(svTpv, tTpv, svSec, tSec, svTeo, tTeo, svPpv, tPpv) {
    const reqTpv = tTpv <= 0 || svTpv >= tTpv;
    const reqSec = tSec <= 0 || svSec >= tSec;
    const reqTeo = tTeo <= 0 || svTeo >= tTeo;
    const reqPpv = tPpv <= 0 || svPpv >= tPpv;
    const hasAnyTarget = (tTpv + tSec + tTeo + tPpv) > 0;
    const hasProgress = (svTpv + svSec + svTeo + svPpv) > 0;

    if (hasAnyTarget && reqTpv && reqSec && reqTeo && reqPpv) return { code: 'done', label: 'Completato' };
    if (hasProgress) return { code: 'progress', label: 'In corso' };
    return { code: 'todo', label: 'Da iniziare' };
  }

  // ----------------------------------------------------------------------------
  // 7. ESPORTAZIONI (EXCEL ESSE3, CSV STAMPA UNIONE, JSON BACKUP, MAILTO)
  // ----------------------------------------------------------------------------
  function downloadBlob(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function excelStudenti(studenti, piani, timbrature, filenamePrefix = 'Tracciato_ESSE3_UdA') {
    if (!global.XLSX) {
      toast('Libreria Excel non caricata.', 'error');
      return;
    }
    const rows = [[
      'Matricola', 'Cognome', 'Nome', 'Email', 'Coorte', 'Anno Corso',
      'Ore Bonus TPV', 'Ore 1° Op (TPV)', 'Target TPV', 'Ore 2° Op', 'Target 2° Op',
      'Ore Teoriche', 'Target Teorico', 'PPV Svolti', 'Target PPV', 'Stato Carriera'
    ]];
    studenti.forEach(s => {
      const m = metricheStudente(s, piani, timbrature);
      const stato = s.archiviato ? 'ARCHIVIATO' : (m.isIdoneo ? 'IDONEO LAUREA' : (m.isRischio ? 'CRITICITA 6 ANNO' : 'IN CORSO'));
      rows.push([
        s.matricola, s.cognome || '', s.nome || '', s.email, s.coorte || '', s.anno_corso || '',
        parseFloat(s.ore_pregresse_bonus || 0), m.oreTpv, m.targetTpv, m.oreSec, m.targetSec,
        m.oreTeo, m.targetTeo, m.ppv, m.targetPpv, stato
      ]);
    });
    const ws = global.XLSX.utils.aoa_to_sheet(rows);
    const wb = global.XLSX.utils.book_new();
    global.XLSX.utils.book_append_sheet(wb, ws, 'Prospetto_Tirocini');
    global.XLSX.writeFile(wb, `${filenamePrefix}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function csvStampaUnione(utenti, tipo = 'studente') {
    const base = getBaseUrl();
    const linkPortale = tipo === 'studente' ? `${base}/studente.html` : `${base}/index.html`;
    const headers = tipo === 'studente'
      ? ['Email', 'Nominativo', 'Matricola', 'Password_Iniziale', 'Coorte', 'Anno', 'Link_Portale']
      : ['Email', 'Nominativo', 'Qualifica', 'PIN_Terminale', 'Link_Terminale'];

    const lines = [headers.join(';')];
    utenti.forEach(u => {
      const segreto = tipo === 'studente' ? (u.password_iniziale || '(già personalizzata)') : (u.pin || '(impostato)');
      const cols = tipo === 'studente'
        ? [u.email, u.nominativo, u.matricola, segreto, u.coorte || '', u.anno_corso || '', linkPortale]
        : [u.email, u.nominativo, u.ruolo, segreto, linkPortale];
      lines.push(cols.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';'));
    });

    downloadBlob('\uFEFF' + lines.join('\r\n'), `Stampa_Unione_${tipo}_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8;');
  }

  function mailtoCredenziali(utente, tipo = 'studente') {
    const base = getBaseUrl();
    const link = tipo === 'studente' ? `${base}/studente.html` : `${base}/index.html`;
    const subject = tipo === 'studente'
      ? `Credenziali Portale Tirocini Odontoiatria - Matricola ${utente.matricola}`
      : `Credenziali Terminale Convalida Tirocini - ${utente.nominativo}`;

    const body = tipo === 'studente'
      ? `Gentile ${utente.nominativo},\n\n` +
        `sono attive le tue credenziali per il Libretto Elettronico Tirocini (${CFG.CDS_NOME || 'Odontoiatria'}):\n\n` +
        `- Portale Studente: ${link}\n` +
        `- Matricola: ${utente.matricola}\n` +
        `- Password iniziale: ${utente.password_iniziale || '(richiedere reset se dimenticata)'}\n\n` +
        `Al primo accesso potrai cambiare la password dalla sezione Profilo.\n\n` +
        `Cordiali saluti,\nDirezione Sistema Tirocini`
      : `Gentile ${utente.nominativo},\n\n` +
        `il Suo profilo (${utente.ruolo}) è attivo sul Terminale Convalida Tirocini:\n\n` +
        `- Terminale Docenti: ${link}\n` +
        `- Codice PIN Personale: ${utente.pin || '(già configurato)'}\n\n` +
        `Cordiali saluti,\nDirezione Sistema Tirocini`;

    global.location.href = `mailto:${encodeURIComponent(utente.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  // ----------------------------------------------------------------------------
  // 8. GENERATORE CERTIFICATO UFFICIALE A4 (CONDIVISO ADMIN & PRESIDENZA)
  // ----------------------------------------------------------------------------
  function apriCertificato(st, piani, timbrature) {
    const modal = document.getElementById('modalCertificato');
    const box = document.getElementById('certContent');
    if (!modal || !box) return;

    const m = metricheStudente(st, piani, timbrature);
    const pianiCoorte = (piani || []).filter(p => p.coorte === st.coorte);

    const righePiano = pianiCoorte.map(r => {
      const sTpv = m.timbrature.filter(t => t.id_reparto === r.id_reparto && t.ruolo === 'Primo').reduce((s, t) => s + parseFloat(t.ore), 0);
      const sSec = m.timbrature.filter(t => t.id_reparto === r.id_reparto && t.ruolo === 'Secondo').reduce((s, t) => s + parseFloat(t.ore), 0);
      const sTeo = m.timbrature.filter(t => t.id_reparto === r.id_reparto && t.ruolo === 'Teorico').reduce((s, t) => s + parseFloat(t.ore), 0);
      const sPpv = m.timbrature.filter(t => t.id_reparto === r.id_reparto && t.ppv).length;
      const stRep = statoReparto(sTpv, r.target_tpv, sSec, r.target_secondo, sTeo, r.target_teorico, sPpv, r.target_ppv);
      return `
        <tr>
          <td class="text-center"><b>${esc(r.anno_corso)}°</b></td>
          <td>${esc(r.reparto)}</td>
          <td class="text-center">${formatNum(sTpv)} / ${formatNum(r.target_tpv)}h</td>
          <td class="text-center">${formatNum(sSec)} / ${formatNum(r.target_secondo)}h</td>
          <td class="text-center">${formatNum(sTeo)} / ${formatNum(r.target_teorico)}h</td>
          <td class="text-center">${sPpv} / ${r.target_ppv}</td>
          <td class="text-center"><span class="badge status-${stRep.code}">${stRep.label}</span></td>
        </tr>
      `;
    }).join('');

    const righeDiario = m.timbrature.map(t => `
      <tr>
        <td>${formatDateIt(t.data)}<br><small>${esc(t.turno)}</small></td>
        <td><b>${esc(t.reparto)}</b></td>
        <td>${t.ruolo === 'Primo' ? '1° Op (TPV)' : (t.ruolo === 'Secondo' ? '2° Op' : 'Teorico')} ${t.ppv ? '<b>[PPV]</b>' : ''}</td>
        <td>${esc(t.nota)}</td>
        <td>${esc(t.docente)}</td>
        <td class="text-center"><b>${formatNum(t.ore)}h</b></td>
      </tr>
    `).join('');

    box.innerHTML = `
      <div class="cert-header">
        <h2>${esc(CFG.ATENEO_NOME || 'UNIVERSITÀ DEGLI STUDI')}</h2>
        <div class="cert-sub">${esc(CFG.CDS_NOME || '')} (${esc(CFG.NORMATIVA || 'D.M. 653/2022')})</div>
        <h3>CERTIFICAZIONE UFFICIALE DELLE ATTIVITÀ DI TIROCINIO</h3>
      </div>

      <div class="cert-meta-grid">
        <div><b>Candidato:</b> ${esc(st.nominativo)}</div>
        <div><b>Matricola:</b> ${esc(st.matricola)}</div>
        <div><b>Coorte / Anno:</b> ${esc(st.coorte || '-')} (${st.anno_corso === 'FC' ? 'Fuori Corso' : esc(st.anno_corso) + '° Anno'})</div>
        <div><b>Ore 1° Op (TPV):</b> ${formatNum(m.oreTpv)} / ${formatNum(m.targetTpv)}h ${st.ore_pregresse_bonus > 0 ? `(incl. ${formatNum(st.ore_pregresse_bonus)}h bonus)` : ''}</div>
        <div><b>Ore 2° Op / Teoriche:</b> ${formatNum(m.oreSec)}h / ${formatNum(m.oreTeo)}h</div>
        <div><b>Prove PPV / Esito:</b> ${m.ppv}/${m.targetPpv} — <b>${m.isIdoneo ? 'IDONEO' : 'IN CORSO'}</b></div>
      </div>

      <h4 class="cert-section-title">1. Riepilogo per Anno di Corso e Disciplina</h4>
      <table class="cert-table">
        <thead>
          <tr><th>Anno</th><th>Reparto / Modulo</th><th>1° Op (TPV)</th><th>2° Op</th><th>Teorico</th><th>PPV</th><th>Stato</th></tr>
        </thead>
        <tbody>${righePiano || '<tr><td colspan="7" class="text-center">Nessun piano di studi configurato</td></tr>'}</tbody>
      </table>

      <h4 class="cert-section-title">2. Registro Cronologico delle Attività Certificate (${m.timbrature.length})</h4>
      <table class="cert-table">
        <thead>
          <tr><th>Data</th><th>Reparto / Modulo</th><th>Tipologia</th><th>Prestazione Clinica / Argomento</th><th>Docente Certificatore</th><th>Ore</th></tr>
        </thead>
        <tbody>${righeDiario || '<tr><td colspan="6" class="text-center">Nessuna presenza registrata</td></tr>'}</tbody>
      </table>

      <div class="cert-signatures">
        <div>Data di emissione: <b>${new Date().toLocaleDateString('it-IT')}</b></div>
        <div>La Presidenza del Corso di Studio: _______________________________</div>
      </div>

      <div class="cert-actions no-print">
        <button class="btn" onclick="window.print()" style="flex:1;">🖨️ Stampa / Salva PDF (A4)</button>
        <button class="btn btn-secondary" onclick="document.getElementById('modalCertificato').style.display='none'" style="flex:1;">Chiudi</button>
      </div>
    `;

    modal.style.display = 'flex';
  }

  global.UDA = {
    cfg: CFG,
    getBaseUrl,
    rpc,
    callEdgeFunction,
    session,
    time,
    crypto: { sha256Hex, buildQrToken, parseQrToken },
    ui: { esc, toast, lockBtn, bindEnter, formatDateIt, formatNum },
    calc: { targetCoorte, metricheStudente, statoReparto },
    export: { downloadBlob, excelStudenti, csvStampaUnione, mailtoCredenziali },
    pdf: { apriCertificato }
  };
})(window);