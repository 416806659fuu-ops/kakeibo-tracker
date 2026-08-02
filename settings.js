// ---- 设置页 ----
function initSettings() {
  document.querySelectorAll('#settings-identity-switch button').forEach((b) => {
    b.addEventListener('click', () => {
      setIdentity(b.dataset.identity);
      renderSettings();
      showToast(`身份已设为 ${b.dataset.identity}`);
    });
  });

  document.getElementById('settings-payment-add-btn').addEventListener('click', () => {
    const input = document.getElementById('settings-payment-new');
    const name = input.value.trim();
    if (!name) return;
    if (state.settings.paymentMethods.includes(name)) { input.value = ''; return; }
    saveSettings({ paymentMethods: state.settings.paymentMethods.concat([name]) });
    input.value = '';
    renderSettings();
  });

  document.getElementById('settings-payment-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.payment-remove-btn');
    if (!btn) return;
    const name = btn.dataset.name;
    saveSettings({ paymentMethods: state.settings.paymentMethods.filter((m) => m !== name) });
    renderSettings();
  });

  document.getElementById('settings-fixed-costs').addEventListener('change', (e) => {
    if (!e.target.classList.contains('fixed-cost-input')) return;
    const key = e.target.dataset.key;
    const val = evalCalExpr(e.target.value) || 0;
    const fixedCosts = Object.assign({}, state.settings.fixedCosts, { [key]: val });
    saveSettings({ fixedCosts });
  });

  document.getElementById('reset-api-btn').addEventListener('click', () => {
    localStorage.removeItem('api_url');
    localStorage.removeItem('api_token');
    location.reload();
  });

  document.getElementById('export-btn').addEventListener('click', exportData);
  document.getElementById('import-input').addEventListener('change', importData);
  document.getElementById('clear-btn').addEventListener('click', clearAllData);
}

function renderSettings() {
  const identity = localStorage.getItem(IDENTITY_KEY) || '';
  document.querySelectorAll('#settings-identity-switch button').forEach((b) => {
    b.classList.toggle('active', b.dataset.identity === identity);
  });

  const list = document.getElementById('settings-payment-list');
  list.innerHTML = (state.settings.paymentMethods || []).map((m) => `
    <span class="chip removable">
      ${escapeHtml(m)}
      <button type="button" class="payment-remove-btn" data-name="${escapeHtml(m)}">×</button>
    </span>
  `).join('');

  const fixedWrap = document.getElementById('settings-fixed-costs');
  const fixedCosts = state.settings.fixedCosts || {};
  fixedWrap.innerHTML = Object.keys(fixedCosts).map((key) => `
    <div class="fixed-cost-edit-row">
      <span class="fixed-cost-label">${escapeHtml(key)}</span>
      <input type="text" inputmode="decimal" class="fixed-cost-input" data-key="${escapeHtml(key)}" value="${fixedCosts[key] || ''}" placeholder="0">
    </div>
  `).join('');
}

function exportData() {
  const backup = {
    records: state.records,
    settings: state.settings,
    pendingOps,
    identity: localStorage.getItem(IDENTITY_KEY) || '',
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `记账备份-${todayKey()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('已导出备份文件');
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!Array.isArray(parsed.records) || !parsed.settings) throw new Error('格式不对');
      if (pendingOps.length && !confirm(`本机还有 ${pendingOps.length} 条待同步的修改，导入会连同这些一起被替换，确定继续吗？`)) return;
      if (!confirm('导入将覆盖本机当前所有记账数据，确定继续吗？')) return;

      state = mergeIntoDefaults(parsed);
      pendingOps = Array.isArray(parsed.pendingOps) ? parsed.pendingOps : [];
      if (parsed.identity === 'FUU' || parsed.identity === 'MORI') setIdentity(parsed.identity);

      cacheLocally();
      persistPending();
      renderAllViews();
      flushPendingOps();
      showToast('导入成功');
    } catch (err) {
      alert('文件格式不正确，导入失败');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// 走正常的按条删除流程（本地软删除 + 入队 delete），不是整表清空——
// 这样即使清空过程中网络时断时续，也不会像"覆盖式清空"那样有把
// 别人还没同步下来的记录一并抹掉的风险。
function clearAllData() {
  if (!confirm('将删除服务器上保存的所有记账记录（FUU 和 MORI 双方的都会被删），且无法恢复，确定吗？')) return;
  activeRecords().forEach((r) => deleteExpenseRecord(r.id));
  renderAllViews();
  flushPendingOps();
  showToast('已清空全部记录');
}

window.initSettings = initSettings;
window.renderSettings = renderSettings;
