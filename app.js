// ── Confirm dialog ────────────────────────────────────────────
function showConfirm(text, sub = '') {
  return new Promise(resolve => {
    document.getElementById('confirmText').textContent = text;
    document.getElementById('confirmSub').textContent  = sub;
    document.getElementById('confirmModal').classList.add('show');

    const ok     = document.getElementById('confirmOk');
    const cancel = document.getElementById('confirmCancel');

    function cleanup(result) {
      document.getElementById('confirmModal').classList.remove('show');
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      resolve(result);
    }
    const onOk     = () => cleanup(true);
    const onCancel = () => cleanup(false);
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
  });
}

// ── Toast ──────────────────────────────────────────────────────
function toast(msg, type = 'error', duration = 3000) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastOut 0.2s ease forwards';
    el.addEventListener('animationend', () => el.remove());
  }, duration);
}

// ── Tab switching ──────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b, i) => {
    b.classList.toggle('active',
      (i === 0 && tab === 'single') ||
      (i === 1 && tab === 'batch') ||
      (i === 2 && tab === 'records')
    );
  });
  document.getElementById('page-single').classList.toggle('active', tab === 'single');
  document.getElementById('page-batch').classList.toggle('active', tab === 'batch');
  document.getElementById('page-records').classList.toggle('active', tab === 'records');

  
  document.querySelector('.container > .card').style.display = 
    tab === 'records' ? 'none' : '';

  if (tab === 'records') loadRecords();
}

// ── Checkbox toggle ────────────────────────────────────────────
document.querySelectorAll('.checkbox-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    item.classList.toggle('checked');
    item.querySelector('input').checked = item.classList.contains('checked');
    if (item.id === 'cb-fidelity') {
      const show = item.classList.contains('checked');
      document.getElementById('civilField').style.display = show ? '' : 'none';
      if (!show) document.getElementById('inputCivil').value = '';
    }
  });
});

// ── Call backend ───────────────────────────────────────────────
async function evaluate(petition, civil, reply, model, dimensions) {
  const res = await fetch('/api/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ petition, civil, reply, model, dimensions })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Single eval ────────────────────────────────────────────────
async function runSingleEval() {
  const petition = document.getElementById('inputPetition').value.trim();
  const civil    = document.getElementById('inputCivil').value.trim();
  const reply    = document.getElementById('inputReply').value.trim();

  const doFidelity = document.getElementById('cb-fidelity').classList.contains('checked');
  if (!petition || !reply || (doFidelity && !civil)) {
    toast(doFidelity
      ? '請填寫所有欄位：陳情內容、公務員想回答的內容、擬答內容'
      : '請填寫陳情內容與擬答內容', 'warning');
    return;
  }

  const dimensions = ['completeness', 'fidelity', 'tone'].filter(dim =>
    document.getElementById(`cb-${dim}`).classList.contains('checked')
  );

  if (!dimensions.length) {
    toast('請至少選擇一個評估維度', 'warning');
    return;
  }

  const model      = document.getElementById('modelSelect').value;
  const btn        = document.getElementById('btnEval');
  const loading    = document.getElementById('loadingSingle');
  const resultArea = document.getElementById('resultArea');

  btn.disabled = true;
  loading.classList.add('show');
  resultArea.classList.remove('show');

  try {
    const results = await evaluate(petition, civil, reply, model, dimensions);
    renderSingleResult(results);
    await saveRecord('single', [{
      petition: petition,
      civil: civil,
      reply: reply,
      results: results
    }], model);
    resultArea.classList.add('show');
  } catch (e) {
    toast('評估失敗：' + e.message, 'error');
    console.error(e);
  } finally {
    btn.disabled = false;
    loading.classList.remove('show');
  }
}

async function saveRecord(mode, rows, model) {
  await fetch('/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, rows, model })
  });
}

// ── Render single result ───────────────────────────────────────
function renderSingleResult(results, scoreGridId = 'scoreGrid', detailBlocksId = 'detailBlocks') {
  const scoreGrid    = document.getElementById(scoreGridId);
  const detailBlocks = document.getElementById(detailBlocksId);

  const LABELS = { completeness: '回復完整性', fidelity: '忠實性', tone: '語調風格' };
  const ICONS  = { completeness: '📝', fidelity: '🔍', tone: '🎙️' };

  scoreGrid.innerHTML    = '';
  detailBlocks.innerHTML = '';

  for (const [key, data] of Object.entries(results)) {
    const s = data.score;

    scoreGrid.innerHTML += `
      <div class="score-card score-${s}">
        <div class="score-label">${ICONS[key]} ${LABELS[key]}</div>
        <div class="score-value">${s}<span style="font-size:16px;color:var(--fg3)">/5</span></div>
        <div class="score-bar"><div class="score-fill" style="width:${s * 20}%"></div></div>
      </div>`;

    let detailHtml = `
      <div class="reason-block">
        <div class="reason-title">
          ${ICONS[key]} ${LABELS[key]} 詳細分析
          <span class="badge">${s}/5</span>
        </div>`;

    if (key === 'fidelity') {
      if (data.added?.length) {
        detailHtml += subSection('AI 額外加的內容（未經授權）', data.added, 'bad');
      }
      if (data.distorted?.length) {
        detailHtml += subSection('被扭曲的內容', data.distorted, 'bad');
      }
      if (data.missing?.length) {
        detailHtml += subSection('遺漏的重要資訊', data.missing, 'bad');
      }
      if (data.law_references?.length) {
        detailHtml += subSection('⚠️ 引用法規（請人工核實）', data.law_references, 'warn');
      }
      if (!data.added?.length && !data.distorted?.length && !data.missing?.length) {
        detailHtml += `<ul class="issue-list"><li class="good">忠實呈現公務員提供的內容</li></ul>`;
      }
    }

    if (key === 'completeness') {
      if (data.core_issues?.length) detailHtml += subSection('核心問題', data.core_issues, '');
      if (data.missing?.length)     detailHtml += subSection('未充分回答', data.missing, 'bad');
    }

    if (key === 'tone') {
      if (data.positives?.length) detailHtml += subSection('做得好的地方', data.positives, 'good');
      if (data.issues?.length)    detailHtml += subSection('需要改善', data.issues, 'bad');
    }

    detailHtml += `
        <div style="font-size:12px;color:var(--fg2);margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
          ${data.reason}
        </div>
      </div>`;

    detailBlocks.innerHTML += detailHtml;
  }
}

function subSection(title, items, liClass) {
  return `
    <div style="margin-bottom:10px">
      <div style="font-size:11px;color:var(--fg3);margin-bottom:6px;">${title}</div>
      <ul class="issue-list">
        ${items.map(i => `<li${liClass ? ` class="${liClass}"` : ''}>${i}</li>`).join('')}
      </ul>
    </div>`;
}

function clearSingle() {
  ['inputPetition', 'inputCivil', 'inputReply'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('resultArea').classList.remove('show');
}

// ── Batch ──────────────────────────────────────────────────────
let batchData = [];

function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    batchData = parseCSV(ev.target.result);
    renderBatchTable();
    document.getElementById('btnBatchRun').disabled = false;
    document.getElementById('batchControls').style.display = 'flex';
    onUploadSuccess(file.name);
  };
  reader.readAsText(file, 'UTF-8');
}

function parseCSV(text) {
  function parseAllRows(raw) {
    const rows = [];
    let cur = [], field = '', inQ = false, i = 0;
    while (i < raw.length) {
      const ch = raw[i];
      if (inQ) {
        if (ch === '"' && raw[i + 1] === '"') { field += '"'; i += 2; }
        else if (ch === '"')                   { inQ = false; i++; }
        else                                   { field += ch; i++; }
      } else {
        if      (ch === '"')  { inQ = true; i++; }
        else if (ch === ',')  { cur.push(field.trim()); field = ''; i++; }
        else if (ch === '\r' && raw[i + 1] === '\n') {
          cur.push(field.trim()); rows.push(cur); cur = []; field = ''; i += 2;
        }
        else if (ch === '\n') {
          cur.push(field.trim()); rows.push(cur); cur = []; field = ''; i++;
        }
        else { field += ch; i++; }
      }
    }
    if (field || cur.length) { cur.push(field.trim()); rows.push(cur); }
    return rows;
  }

  const rows       = parseAllRows(text);
  const headers    = rows[0] ?? [];
  const doFidelity = document.getElementById('cb-fidelity').classList.contains('checked');

  const petitionIdx = headers.findIndex(h => h.includes('陳情'));
  const civilIdx    = headers.findIndex(h => h.includes('公務員'));
  const replyIdx    = headers.findIndex(h => h.includes('擬答'));

  if (petitionIdx === -1 || replyIdx === -1) {
    toast('CSV 需要包含「陳情內容」和「擬答內容」欄位', 'warning');
    return [];
  }
  if (doFidelity && civilIdx === -1) {
    toast('勾選「忠實性」時，CSV 需要包含「公務員輸入」欄位（或取消勾選忠實性）', 'warning');
    return [];
  }

  return rows.slice(1).map((cols, i) => ({
    id:           i + 1,
    petition:     cols[petitionIdx]                      ?? '',
    civil:        civilIdx !== -1 ? cols[civilIdx] ?? '' : '',
    reply:        cols[replyIdx]                         ?? '',
    completeness: null,
    fidelity:     null,
    tone:         null,
    status:       'pending'
  })).filter(r => r.petition && r.reply);
}

function renderBatchTable() {
  const tbody = document.getElementById('batchTableBody');
  tbody.innerHTML = batchData.map(row => `
    <tr id="row-${row.id}">
      <td style="font-family:var(--mono);color:var(--fg3)">${row.id}</td>
      <td title="${row.petition}">${row.petition.substring(0, 30)}${row.petition.length > 30 ? '...' : ''}</td>
      <td title="${row.civil}">${row.civil.substring(0, 30)}${row.civil.length > 30 ? '...' : ''}</td>
      <td title="${row.reply}">${row.reply.substring(0, 30)}${row.reply.length > 30 ? '...' : ''}</td>
      <td id="score-c-${row.id}">—</td>
      <td id="score-f-${row.id}">—</td>
      <td id="score-t-${row.id}">—</td>
      <td><span class="status-chip status-pending"><span class="dot"></span>待評測</span></td>
    </tr>`).join('');
}

async function runBatch() {
  if (!batchData.length) return;

  const model      = document.getElementById('modelSelect').value;
  const dimensions = ['completeness', 'fidelity', 'tone'].filter(dim =>
    document.getElementById(`cb-${dim}`).classList.contains('checked')
  );
  const btn           = document.getElementById('btnBatchRun');
  const progress      = document.getElementById('progressWrap');
  const progressFill  = document.getElementById('progressFill');
  const progressText  = document.getElementById('progressText');
  const progressCount = document.getElementById('progressCount');

  btn.disabled = true;
  progress.classList.add('show');

  const total = batchData.length;
  let done = 0;
  const times = [];
  for (const row of batchData) {
    updateRowStatus(row.id, 'running');
    progressCount.textContent = `${done} / ${total}`;

    
    const t0 = Date.now();

    try {
      const results = await evaluate(
        row.petition, row.civil, row.reply,
        model, dimensions
      );

      times.push(Date.now() - t0);

      row.completeness = results.completeness?.score ?? null;
      row.fidelity     = results.fidelity?.score     ?? null;
      row.tone         = results.tone?.score         ?? null;
      row.results      = results;
      row.status       = 'done';

      document.getElementById(`score-c-${row.id}`).innerHTML = scoreChip(row.completeness);
      document.getElementById(`score-f-${row.id}`).innerHTML = scoreChip(row.fidelity);
      document.getElementById(`score-t-${row.id}`).innerHTML = scoreChip(row.tone);
      updateRowStatus(row.id, 'done');
      document.getElementById(`row-${row.id}`).dataset.done = '1';
    } catch (e) {
      times.push(Date.now() - t0);
      row.status = 'error';
      updateRowStatus(row.id, 'error');
    }

    done++;
    progressFill.style.width = `${(done / total) * 100}%`;

    if (done < total) {
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const remaining = (total - done) * avg / 1000;
      const min = Math.floor(remaining / 60);
      const sec = Math.floor(remaining % 60);
      progressText.textContent = `正在評估第 ${done + 1} 筆... 預計剩餘 ${min > 0 ? min + ' 分 ' : ''}${sec} 秒`;
      progressCount.textContent = `${done} / ${total}`;
    }
  }

  progressText.textContent = `評測完成！共 ${total} 筆`;
  progressCount.textContent = `${total} / ${total}`;
  btn.disabled = false;
  document.getElementById('btnExport').disabled = false;
  renderBatchSummary();
  await saveRecord('batch', batchData, model);
}

function updateRowStatus(id, status) {
  const row = document.getElementById(`row-${id}`);
  if (!row) return;
  const statusMap = {
    pending: '<span class="status-chip status-pending"><span class="dot"></span>待評測</span>',
    running: '<span class="status-chip status-running"><span class="dot pulse"></span>評估中</span>',
    done:    '<span class="status-chip status-done"><span class="dot"></span>完成</span>',
    error:   '<span class="status-chip status-error"><span class="dot"></span>失敗</span>'
  };
  row.cells[7].innerHTML = statusMap[status] || '';  // 狀態欄是第 8 欄 (index 7)
}

function scoreChip(s) {
  if (s == null) return '—';
  return `<span class="score-chip chip-${s}">${s}</span>`;
}

function exportCSV() {
  const rows = [['id', '陳情內容', '公務員輸入', '擬答內容', '完整性', '忠實性', '語調風格']];
  batchData.forEach(r => rows.push([
    r.id,
    `"${r.petition}"`,
    `"${r.civil}"`,
    `"${r.reply}"`,
    r.completeness ?? '',
    r.fidelity     ?? '',
    r.tone         ?? ''
  ]));
  const csv  = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `eval_result_${Date.now()}.csv`;
  a.click();
}

function renderBatchSummary() {
  const done = batchData.filter(r => r.status === 'done');
  if (!done.length) return;

  const avg = (key) => {
    const vals = done.map(r => r[key]).filter(v => v !== null);
    if (!vals.length) return null;
    return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
  };

  const low = (key) => done.filter(r => r[key] !== null && r[key] < 3).length;

  const dims = [
    { key: 'completeness', label: '完整性', icon: '📝' },
    { key: 'fidelity',     label: '忠實性', icon: '🔍' },
    { key: 'tone',         label: '語調風格', icon: '🎙️' },
  ].filter(d => done.some(r => r[d.key] !== null));

  const avgColor = (v) => {
    if (v === null) return 'var(--fg3)';
    if (v >= 4.5) return 'var(--success)';
    if (v >= 3.5) return '#84cc16';
    if (v >= 2.5) return 'var(--warning)';
    if (v >= 1.5) return '#f97316';
    return 'var(--danger)';
  };

  const avgBarColor = (v) => {
    if (v === null) return 'var(--border)';
    if (v >= 4.5) return 'var(--success)';
    if (v >= 3.5) return '#84cc16';
    if (v >= 2.5) return 'var(--warning)';
    if (v >= 1.5) return '#f97316';
    return 'var(--danger)';
  };

  const summaryEl = document.getElementById('batchSummary');
  summaryEl.innerHTML = `
    <div class="card">
      <div class="section-title">本批次摘要　<span style="color:var(--fg3);font-weight:400;font-size:13px;text-transform:none;letter-spacing:0">${done.length} 筆完成</span></div>
      <div class="summary-grid">
        ${dims.map(d => {
          const a = avg(d.key);
          const aNum = a !== null ? parseFloat(a) : null;
          return `
          <div class="summary-card">
            <div class="summary-label">${d.icon} ${d.label}</div>
            <div class="summary-avg" style="color:${avgColor(aNum)}">${a ?? '—'}<span style="font-size:13px;color:var(--fg3)">/5</span></div>
            <div class="score-bar"><div class="score-fill" style="width:${(aNum ?? 0) * 20}%;background:${avgBarColor(aNum)}"></div></div>
            <div class="summary-low">低於3分：${low(d.key)} 筆</div>
          </div>`;
        }).join('')}
      </div>
    </div>
  `;
  summaryEl.style.display = 'block';
}

// ── Batch detail modal ─────────────────────────────────────────
document.getElementById('batchTableBody').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-done]');
  if (!tr) return;
  const id  = parseInt(tr.id.replace('row-', ''));
  const row = batchData.find(r => r.id === id);
  if (row?.results) openModal(row);
});

function openModal(row) {
  // 第一次點才 render，之後直接用 cache
  if (!row._modalHTML) {
    // 暫時借用隱藏的 div 來 render
    renderSingleResult(row.results, 'modalScoreGrid', 'modalDetailBlocks');
    row._modalHTML = {
      score:  document.getElementById('modalScoreGrid').innerHTML,
      detail: document.getElementById('modalDetailBlocks').innerHTML,
    };
  } else {
    document.getElementById('modalScoreGrid').innerHTML   = row._modalHTML.score;
    document.getElementById('modalDetailBlocks').innerHTML = row._modalHTML.detail;
  }

  document.getElementById('modalContent').innerHTML = `
    <div class="content-block">
      <div class="content-label">陳情內容</div>
      <div class="content-text">${row.petition}</div>
    </div>
    <div class="content-block">
      <div class="content-label">公務員輸入</div>
      <div class="content-text">${row.civil || '—'}</div>
    </div>
    <div class="content-block">
      <div class="content-label">擬答內容</div>
      <div class="content-text">${row.reply}</div>
    </div>
  `;

  document.getElementById('modalTitle').textContent = `第 ${row.id} 筆 — 詳細分析`;
  document.getElementById('detailModal').classList.add('show');
}

function closeModal(e) {
  if (e && e.target !== document.getElementById('detailModal')) return;
  document.getElementById('detailModal').classList.remove('show');
}

// ── Drag & drop ────────────────────────────────────────────────
const zone = document.getElementById('uploadZone');
zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
zone.addEventListener('drop', e => {
  e.preventDefault();
  zone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      batchData = parseCSV(ev.target.result);
      renderBatchTable();
      document.getElementById('btnBatchRun').disabled = false;
      document.getElementById('batchControls').style.display = 'flex';
      onUploadSuccess(file.name);
    };
    reader.readAsText(file, 'UTF-8');
  }
});


function onUploadSuccess(filename) {
  const zone = document.getElementById('uploadZone');
  zone.classList.add('upload-done');
  zone.innerHTML = `
    <div class="upload-done-inner">
      <div class="upload-check">✅</div>
      <div class="upload-filename">${filename}</div>
      <div class="upload-count">共 ${batchData.length} 筆</div>
      <div class="upload-reset" onclick="resetUpload()">重新上傳</div>
    </div>
  `;
}

function resetUpload() {
  const zone = document.getElementById('uploadZone');
  zone.classList.remove('upload-done');
  zone.onclick = () => document.getElementById('fileInput').click();
  zone.innerHTML = `
    <div class="upload-icon">📂</div>
    <div><strong>點擊上傳</strong> 或拖曳 CSV 到這裡</div>
    <p>支援 .csv 格式</p>
  `;
  document.getElementById('fileInput').value = '';
  batchData = [];
  document.getElementById('batchTableBody').innerHTML = `
    <tr><td colspan="8">
      <div class="empty">
        <div class="empty-icon">📋</div>
        <p>上傳 CSV 以開始批次評測</p>
      </div>
    </td></tr>`;
  document.getElementById('btnBatchRun').disabled = true;
  document.getElementById('batchControls').style.display = 'none';
  document.getElementById('batchSummary').style.display = 'none';
  document.getElementById('progressWrap').classList.remove('show');
}


// ── Records management ─────────────────────────────────────────
async function loadRecords() {
  const list = document.getElementById('recordsList');
  list.innerHTML = '<p style="color:var(--fg3);font-size:13px">載入中...</p>';

  const records = await fetch('/api/records').then(r => r.json());
  if (!records.length) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-icon">📭</div>
        <p>還沒有任何紀錄</p>
      </div>`;
    return;
  }

  // 最新的在最上面
  records.reverse();
  // 顯示統計
  if (records.length) {
    const totalCount = records.length;
    const totalRows  = records.reduce((a, r) => a + r.count, 0);

    const avgOf = (key) => {
      const vals = records.map(r => r[key]).filter(v => v != null);
      return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : '—';
    };

    document.getElementById('statCount').textContent        = totalCount;
    document.getElementById('statTotal').textContent        = totalRows;
    document.getElementById('statCompleteness').textContent = avgOf('avg_completeness');
    document.getElementById('statFidelity').textContent     = avgOf('avg_fidelity');
    document.getElementById('statTone').textContent         = avgOf('avg_tone');
    document.getElementById('recordsStats').style.display  = 'flex';
  } else {
    document.getElementById('recordsStats').style.display = 'none';
  }
  list.innerHTML = records.map((r, i) => `
    <div class="record-row" data-index="${i}" onclick="openRecord(this)">
      <div class="record-meta">
        <span class="record-mode">${r.mode === 'batch' ? '批次' : '單筆'}</span>
        <span class="record-time">${r.timestamp}</span>
        <span class="record-model">${r.model}</span>
        <span style="color:var(--fg3);font-size:12px">${r.count} 筆</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <div class="record-scores">
          ${r.avg_completeness != null ? `<span class="score-chip chip-${Math.round(r.avg_completeness)}">📝 ${r.avg_completeness}</span>` : ''}
          ${r.avg_fidelity     != null ? `<span class="score-chip chip-${Math.round(r.avg_fidelity)}">🔍 ${r.avg_fidelity}</span>` : ''}
          ${r.avg_tone         != null ? `<span class="score-chip chip-${Math.round(r.avg_tone)}">🎙️ ${r.avg_tone}</span>` : ''}
        </div>
        <a class="btn-download" href="/records/${r.filename}" download onclick="event.stopPropagation()">↓</a>
        <button class="btn-delete" onclick="deleteRecord(event,'${r.filename}')">✕</button>
      </div>
    </div>
  `).join('');
  
window._allRecords = records;
}


if (!window._recordCache) window._recordCache = {};

async function openRecord(el) {
  const index = parseInt(el.dataset.index);
  const meta  = window._allRecords[index];

  // 先開 modal，讓使用者立刻看到回應
  document.getElementById('recordModalTitle').textContent =
    `${meta.mode === 'batch' ? '批次' : '單筆'}｜${meta.timestamp}｜${meta.model}`;
  document.getElementById('recordModalStats').innerHTML = '';
  document.getElementById('recordModalBody').innerHTML =
    '<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--fg3)">載入中…</td></tr>';
  document.getElementById('recordModal').classList.add('show');

  // 有快取就直接用，否則 fetch
  if (!window._recordCache[meta.filename]) {
    window._recordCache[meta.filename] = await fetch(`/api/records/${meta.filename}`).then(r => r.json());
  }
  const rows = window._recordCache[meta.filename];
  if (!rows.length) return;

  // 頂部小摘要
  document.getElementById('recordModalStats').innerHTML = `
    <div style="display:flex;gap:16px;font-size:13px;color:var(--fg3)">
      <span>共 <strong style="color:var(--fg)">${rows.length}</strong> 筆</span>
      ${meta.avg_completeness != null ? `<span>完整性平均 <strong style="color:var(--accent)">${meta.avg_completeness}</strong></span>` : ''}
      ${meta.avg_fidelity     != null ? `<span>忠實性平均 <strong style="color:var(--accent)">${meta.avg_fidelity}</strong></span>` : ''}
      ${meta.avg_tone         != null ? `<span>語調平均 <strong style="color:var(--accent)">${meta.avg_tone}</strong></span>` : ''}
    </div>
  `;

  // table
  document.getElementById('recordModalBody').innerHTML = rows.map((r, i) => `
    <tr style="cursor:pointer" onclick="openRecordRow(${i})" data-index="${i}">
      <td style="font-family:var(--mono);color:var(--fg3)">${r['編號'] ?? i + 1}</td>
      <td title="${r['陳情內容'] ?? ''}">${(r['陳情內容'] ?? '').substring(0, 40)}...</td>
      <td>${scoreChip(r['完整性\n分數'])}</td>
      <td>${scoreChip(r['忠實性\n分數'])}</td>
      <td>${scoreChip(r['語調\n分數'])}</td>
    </tr>
  `).join('');

  // 把資料存起來，點列的時候用
  window._recordRows = rows;
}

function openRecordRow(index) {
  const r = window._recordRows[index];
  
  // 組成 results 格式餵給現有的 renderSingleResult
  const results = {};
  if (r['完整性\n分數'] != null) results.completeness = { score: r['完整性\n分數'], reason: r['完整性原因'] ?? '' };
  if (r['忠實性\n分數'] != null) results.fidelity     = { score: r['忠實性\n分數'], reason: r['忠實性原因'] ?? '' };
  if (r['語調\n分數']   != null) results.tone         = { score: r['語調\n分數'],   reason: r['語調原因']   ?? '' };

  document.getElementById('modalContent').innerHTML = `
    <div class="content-block">
      <div class="content-label">陳情內容</div>
      <div class="content-text">${r['陳情內容'] ?? '—'}</div>
    </div>
    <div class="content-block">
      <div class="content-label">公務員輸入</div>
      <div class="content-text">${r['公務員輸入'] ?? '—'}</div>
    </div>
    <div class="content-block">
      <div class="content-label">擬答內容</div>
      <div class="content-text">${r['擬答內容'] ?? '—'}</div>
    </div>
  `;

  document.getElementById('modalTitle').textContent = `第 ${r['編號'] ?? index + 1} 筆 — 詳細分析`;
  renderSingleResult(results, 'modalScoreGrid', 'modalDetailBlocks');
  document.getElementById('detailModal').classList.add('show');
}

async function deleteRecord(e, filename) {
  e.stopPropagation();
  if (!await showConfirm('確定要刪除這筆紀錄？', '此操作無法復原')) return;
  await fetch(`/api/records/${filename}`, { method: 'DELETE' });
  delete window._recordCache[filename];
  toast('紀錄已刪除', 'success', 2000);
  loadRecords();
}

function closeRecordModal(e) {
  if (e && e.target !== document.getElementById('recordModal')) return;
  document.getElementById('recordModal').classList.remove('show');
}