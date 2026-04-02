// ── Tab switching ──────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b, i) => {
    b.classList.toggle('active', (i === 0 && tab === 'single') || (i === 1 && tab === 'batch'));
  });
  document.getElementById('page-single').classList.toggle('active', tab === 'single');
  document.getElementById('page-batch').classList.toggle('active', tab === 'batch');
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
    alert(doFidelity
      ? '請填寫所有欄位：陳情內容、公務員想回答的內容、擬答內容'
      : '請填寫陳情內容與擬答內容');
    return;
  }

  const dimensions = ['completeness', 'fidelity', 'tone'].filter(dim =>
    document.getElementById(`cb-${dim}`).classList.contains('checked')
  );

  if (!dimensions.length) {
    alert('請至少選擇一個評估維度');
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
    resultArea.classList.add('show');
  } catch (e) {
    alert('評估失敗：' + e.message);
    console.error(e);
  } finally {
    btn.disabled = false;
    loading.classList.remove('show');
  }
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
  };
  reader.readAsText(file, 'UTF-8');
}

function parseCSV(text) {
  const lines      = text.trim().split('\n');
  const headers    = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const doFidelity = document.getElementById('cb-fidelity').classList.contains('checked');

  const petitionIdx = headers.findIndex(h => h.includes('陳情'));
  const civilIdx    = headers.findIndex(h => h.includes('公務員'));
  const replyIdx    = headers.findIndex(h => h.includes('擬答'));

  if (petitionIdx === -1 || replyIdx === -1) {
    alert('CSV 需要包含「陳情內容」和「擬答內容」欄位');
    return [];
  }
  if (doFidelity && civilIdx === -1) {
    alert('勾選「忠實性」時，CSV 需要包含「公務員輸入」欄位（或取消勾選忠實性）');
    return [];
  }

  return lines.slice(1).map((line, i) => {
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    return {
      id:           i + 1,
      petition:     cols[petitionIdx]                      || '',
      civil:        civilIdx !== -1 ? cols[civilIdx] || '' : '',
      reply:        cols[replyIdx]                         || '',
      completeness: null,
      fidelity:     null,
      tone:         null,
      status:       'pending'
    };
  }).filter(r => r.petition && r.reply);
}

function renderBatchTable() {
  const tbody = document.getElementById('batchTableBody');
  tbody.innerHTML = batchData.map(row => `
    <tr id="row-${row.id}">
      <td style="font-family:var(--mono);color:var(--fg3)">${row.id}</td>
      <td title="${row.petition}">${row.petition.substring(0, 40)}${row.petition.length > 40 ? '...' : ''}</td>
      <td title="${row.civil}">${row.civil.substring(0, 40)}${row.civil.length > 40 ? '...' : ''}</td>
      <td title="${row.reply}">${row.reply.substring(0, 40)}${row.reply.length > 40 ? '...' : ''}</td>
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

  for (const row of batchData) {
    updateRowStatus(row.id, 'running');
    progressText.textContent  = `正在評估第 ${row.id} 筆...`;
    progressCount.textContent = `${done} / ${total}`;

    try {
      const results = await evaluate(
        row.petition, row.civil, row.reply,
        model,
        dimensions
      );

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
      row.status = 'error';
      updateRowStatus(row.id, 'error');
    }

    done++;
    progressFill.style.width  = `${(done / total) * 100}%`;
    progressCount.textContent = `${done} / ${total}`;
  }

  progressText.textContent = `評測完成！共 ${total} 筆`;
  btn.disabled = false;
  document.getElementById('btnExport').disabled = false;
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
  if (s === null) return '—';
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

// ── Batch detail modal ─────────────────────────────────────────
document.getElementById('batchTableBody').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-done]');
  if (!tr) return;
  const id  = parseInt(tr.id.replace('row-', ''));
  const row = batchData.find(r => r.id === id);
  if (row?.results) openModal(row);
});

function openModal(row) {
  document.getElementById('modalTitle').textContent = `第 ${row.id} 筆 — 詳細分析`;
  renderSingleResult(row.results, 'modalScoreGrid', 'modalDetailBlocks');
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
    };
    reader.readAsText(file, 'UTF-8');
  }
});
