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
    patchSettings([{ type: 'addPaymentMethod', name }]);
    input.value = '';
    renderSettings();
  });

  document.getElementById('settings-payment-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.payment-remove-btn');
    if (!btn) return;
    const name = btn.dataset.name;
    patchSettings([{ type: 'removePaymentMethod', name }]);
    renderSettings();
  });

  document.getElementById('settings-fixed-costs').addEventListener('change', (e) => {
    if (!e.target.classList.contains('fixed-cost-input')) return;
    const key = e.target.dataset.key;
    const val = evalCalExpr(e.target.value) || 0;
    patchSettings([{ type: 'setFixedCost', key, value: val }]);
  });

  document.getElementById('save-api-btn').addEventListener('click', onSaveApiConfig);

  document.getElementById('export-btn').addEventListener('click', exportData);
  document.getElementById('import-input').addEventListener('change', importData);
  document.getElementById('clear-btn').addEventListener('click', clearAllData);
  document.getElementById('force-update-btn').addEventListener('click', forceUpdate);
}

// 手机上（尤其是 iOS 加到主屏幕之后）常常一直跑着好几天前的旧代码：service worker
// 把前端文件存在本地好离线用，而 app 一直挂在后台从来没真正重新加载过，就永远
// 不会去服务器拿新版本。这个按钮是最后的退路：注销 service worker、清空代码缓存、
// 再强制重新加载。只动代码缓存，不碰记账数据（数据在服务器上，本地那份下次同步
// 自然会回来）。
async function forceUpdate() {
  showToast('正在更新…');
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (e) {
    // 清不掉也照样往下走，加时间戳重新加载本身就能绕开大部分缓存
  }
  location.replace(`${location.pathname}?u=${Date.now()}`);
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

  renderDiagnostics();

  // 后端地址/密码只在没有正在打字编辑时回填，避免用户正输入到一半又被重画覆盖掉
  const urlInput = document.getElementById('settings-api-url');
  const tokenInput = document.getElementById('settings-api-token');
  const cfg = getApiConfig();
  if (document.activeElement !== urlInput) urlInput.value = cfg.url;
  if (document.activeElement !== tokenInput) tokenInput.value = cfg.token;
}

// 隔着一部手机排查问题太靠猜了：把几个关键的内部状态摊开显示，一张截图就能
// 判断是"数据根本没同步下来"还是"数据在、但显示逻辑有问题"。
function renderDiagnostics() {
  const wrap = document.getElementById('settings-diagnostics');
  if (!wrap) return;
  const thisMonth = todayKey().slice(0, 7);
  const active = activeRecords();
  const monthRows = active.filter((r) => r.date.slice(0, 7) === thisMonth);
  const withCat = monthRows.filter((r) => r.category).length;
  // 后端地址只显示末尾一小段：足够看出"是不是连到了另一个部署"，又不至于把
  // 整条网址糊在小屏幕上占满一整屏
  const apiUrl = getApiConfig().url;
  const m = apiUrl.match(/\/s\/([^/]+)\//);
  const backendState = backendWrongApp ? '⚠️ 不是记账的后端'
    : (backendOutdated ? '⚠️ 旧版本，需更新地址' : '正常');
  const rows = [
    ['后端部署', backendState],
    ['后端地址结尾', m ? `…${m[1].slice(-12)}/exec` : '（未设置）'],
    ['消费项目（分类）', `${(state.settings.categories || []).length} 个`],
    ['分类名称', (state.settings.categories || []).map((c) => c.name).join('、') || '（空）'],
    ['支付方式', `${(state.settings.paymentMethods || []).length} 种`],
    ['本机记录总数', `${active.length} 条`],
    [`${thisMonth} 记录`, `${monthRows.length} 条，其中 ${withCat} 条有分类`],
    ['待同步', `${pendingOps.length} 条`],
    ['连接状态', notConfigured ? '未配置后端' : (offline ? '离线' : '正常')],
    ['最近错误', lastSyncError || '（无）'],
  ];
  wrap.innerHTML = rows.map(([k, v]) => `
    <div class="fixed-cost-row">
      <span class="fixed-cost-label">${escapeHtml(k)}</span>
      <span class="fixed-cost-value" style="text-align:right;max-width:60%;word-break:break-all;">${escapeHtml(v)}</span>
    </div>
  `).join('');
}

function onSaveApiConfig() {
  const url = document.getElementById('settings-api-url').value.trim();
  const token = document.getElementById('settings-api-token').value.trim();
  if (!url || !token) {
    showToast('地址和密码都要填');
    return;
  }
  setApiConfig(url, token);
  notConfigured = false;
  showToast('已保存，正在同步…');
  flushPendingOps().then(refreshFromServer);
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
