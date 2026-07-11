// Fast4FBMP sidepanel/panel.js
const $ = id => document.getElementById(id);
let scannedItems = [];
let selectedIds = new Set();

// ── Status helpers ──
function setStatus(msg, type='') {
  const el = $('status');
  el.textContent = msg;
  el.className = type;
}
function setProgress(pct) {
  $('progressFill').style.width = Math.min(100, pct) + '%';
}

// ── Folder chooser ──
$('btnChooseFolder').addEventListener('click', async () => {
  try {
    const root = await window.F4Local.chooseRoot();
    $('folderPath').textContent = '✅ Folder selected: ' + (root.name || 'Fast4FBMP');
    setStatus('Folder saved! Ready to scan.', 'success');
  } catch(e) {
    if (e.name !== 'AbortError') setStatus('Folder error: ' + e.message, 'error');
  }
});

// ── Scan ──
$('btnScan').addEventListener('click', () => {
  setStatus('🔄 Scanning your profile...', '');
  setProgress(0);
  chrome.runtime.sendMessage({type: 'f4runscan'});
});

// ── Select all ──
$('selectAll').addEventListener('click', () => {
  const checks = document.querySelectorAll('#listingsList input[type=checkbox]');
  const allChecked = [...checks].every(c => c.checked);
  checks.forEach(c => {
    c.checked = !allChecked;
    if (!allChecked) selectedIds.add(c.dataset.id);
    else selectedIds.delete(c.dataset.id);
  });
  updateBulkSection();
});

// ── Bulk create ──
$('btnBulk').addEventListener('click', () => {
  if (!selectedIds.size) { setStatus('Select at least one listing first.', 'error'); return; }
  const settings = {
    ids: Array.from(selectedIds),
    autoPublish: true,
    minGap: parseInt($('minGap').value) || 60,
    maxGap: parseInt($('maxGap').value) || 180,
    breakEvery: parseInt($('breakEvery').value) || 0,
    breakMin: parseInt($('breakMin').value) || 300,
    breakMax: parseInt($('breakMax').value) || 600,
    cap: parseInt($('cap').value) || 0,
    categoryMap: {}
  };
  chrome.runtime.sendMessage({type: 'f4runbulk', settings});
  $('btnCancel').style.display = 'block';
  $('btnBulk').style.display = 'none';
  setStatus('🚀 Bulk create started for ' + settings.ids.length + ' listings...', '');
  setProgress(0);
});

// ── Cancel ──
$('btnCancel').addEventListener('click', () => {
  chrome.runtime.sendMessage({type: 'f4cancel'});
  setStatus('⏹ Cancelling...', '');
});

// ── Render listings ──
function renderListings(items) {
  const list = $('listingsList');
  list.innerHTML = '';
  items.forEach(item => {
    const div = document.createElement('div');
    div.className = 'listing-item';
    const checked = selectedIds.has(item.id) ? 'checked' : '';
    div.innerHTML = `
      <input type="checkbox" data-id="${item.id}" ${checked}/>
      <img src="${item.photoUrl||''}" onerror="this.style.display='none'" alt=""/>
      <div class="info">
        <div class="title">${item.title||'(no title)'}</div>
        <div class="price">${item.price ? '$'+item.price : ''}</div>
      </div>`;
    div.querySelector('input').addEventListener('change', e => {
      if (e.target.checked) selectedIds.add(item.id);
      else selectedIds.delete(item.id);
      updateBulkSection();
    });
    list.appendChild(div);
  });
  $('listingsSection').style.display = 'block';
  updateBulkSection();
}

function updateBulkSection() {
  $('bulkSection').style.display = selectedIds.size > 0 ? 'block' : 'none';
}

// ── Message listener ──
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'f4status') return;
  switch(msg.event) {
    case 'scanstart':
      setStatus('🔍 Scanning profile...', '');
      setProgress(5);
      break;
    case 'progress':
      setStatus(msg.text || 'Working...', '');
      setProgress(20);
      break;
    case 'scandone':
      scannedItems = msg.items || [];
      setStatus('✅ Found ' + scannedItems.length + ' listings. Select which to relist.', 'success');
      setProgress(100);
      selectedIds = new Set(scannedItems.map(i => i.id));
      renderListings(scannedItems);
      // Save to local folder
      scannedItems.forEach(async item => {
        try { await window.F4Local.writeListing(item, item.photos||[], 'Active'); } catch(e) {}
      });
      break;
    case 'itemextract':
      setStatus('🔍 Extracting ['+msg.index+'/'+msg.total+']: '+msg.id, '');
      setProgress((msg.index/msg.total)*50);
      break;
    case 'itemcreate':
      setStatus('📝 Creating ['+msg.index+'/'+msg.total+']: '+(msg.title||msg.id), '');
      setProgress(50+(msg.index/msg.total)*50);
      break;
    case 'itemdone':
      setStatus('✅ Done '+msg.done+' | Failed '+msg.failed, 'success');
      break;
    case 'itemfailed':
      setStatus('❌ Failed '+msg.id+': '+msg.error, 'error');
      break;
    case 'waiting':
      setStatus('⏳ Waiting '+msg.seconds+'s before next listing...', '');
      break;
    case 'countdown':
      setStatus('⏳ Next listing in '+msg.remaining+'s...', '');
      break;
    case 'bulkdone':
      setStatus('🎉 Done! Created: '+msg.done+' | Failed: '+msg.failed, 'success');
      setProgress(100);
      $('btnCancel').style.display = 'none';
      $('btnBulk').style.display = 'block';
      break;
    case 'cancelled':
      setStatus('⏹ Cancelled.', '');
      $('btnCancel').style.display = 'none';
      $('btnBulk').style.display = 'block';
      break;
    case 'error':
      setStatus('❌ '+msg.message, 'error');
      $('btnCancel').style.display = 'none';
      $('btnBulk').style.display = 'block';
      break;
  }
});

// ── Init ──
(async () => {
  const root = await window.F4Local.getRoot().catch(() => null);
  if (root) $('folderPath').textContent = '✅ Folder: ' + (root.name || 'Fast4FBMP');
  const stored = await chrome.storage.local.get('f4scanned').catch(() => ({}));
  if (stored.f4scanned && stored.f4scanned.length) {
    scannedItems = stored.f4scanned;
    selectedIds = new Set(scannedItems.map(i => i.id));
    renderListings(scannedItems);
    setStatus('Loaded ' + scannedItems.length + ' cached listings. Click Scan to refresh.', '');
  }
})();
