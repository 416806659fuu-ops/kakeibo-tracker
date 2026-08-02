// ---- 核心：与后端同步的状态 / 待同步队列 / 通用工具 ----
//
// 和「健康记录小工具」那两个 app 最大的不同：这里 FUU 和 MORI 两人会各自
// 用自己的手机记账，是真正的多设备并发写入。那两个 app 的做法是把整份状态
// 打包成一个 JSON 覆盖式上传（一个人写，谁也不会跟自己抢）；这里如果照搬，
// 一方离线时攒的记录，可能被另一方更早同步的一次「整份覆盖」悄悄冲掉。
// 所以这里改成按条记录同步：每一笔支出独立生成/编辑/删除，本地攒一个
// 「待同步队列」，联网后逐条发送，服务器按 id 合并，谁也不会覆盖谁。
const CACHE_KEY = 'kakeibo-cache-v1';
const PENDING_KEY = 'kakeibo-pending-ops-v1';
const IDENTITY_KEY = 'kakeibo-identity';

// 和 backend-gas/Code.gs 里的 DEFAULT_PAYMENT_METHODS / DEFAULT_FIXED_COSTS 保持一致，
// 只是给「还没连上后端」时的本机初次体验用一份种子数据，真正的准数据以服务器为准。
const DEFAULT_PAYMENT_METHODS = [
  '現金', '電子マネー', 'VIEWカード', 'SMBCカード', 'JALカード',
  'EPOSカード', '招行信用卡', 'd払い', 'ZFB/WX',
];
const DEFAULT_FIXED_COSTS = {
  '家賃': 0, '倉庫': 0, '通信': 0, 'ジム': 0, 'iCloud': 0,
  '娯楽': 0, '電気': 0, '光熱': 0, 'ガス': 0, '水道': 0,
};

// ---- IndexedDB 镜像：localStorage 的第二保险 ----
const IDB_NAME = 'kakeibo-idb';
const IDB_STORE = 'state';

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(key, raw) {
  return idbOpen()
    .then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(raw, key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    }))
    .catch(() => { /* IDB 不可用就算了，localStorage 那份还在 */ });
}

function idbGetKey(key) {
  return idbOpen()
    .then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const rq = tx.objectStore(IDB_STORE).get(key);
      rq.onsuccess = () => { db.close(); resolve(rq.result || null); };
      rq.onerror = () => { db.close(); reject(rq.error); };
    }))
    .catch(() => null);
}

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

// 后端是 Google Apps Script + Google Sheet。地址和密码不写死在代码里
// （这份代码要发布到公开的 GitHub Pages），第一次打开时问一次，
// 存在这台设备的浏览器本地，以后不用再问。FUU 和 MORI 两台设备
// 各自问一次、各自存一份，密码需要你们线下同步一次。
function getApiConfig() {
  let url = localStorage.getItem('api_url');
  let token = localStorage.getItem('api_token');
  if (!url || !token) {
    url = (prompt('请输入后端地址（Apps Script 部署网址）：', url || '') || '').trim();
    token = (prompt('请输入密码（token）：', token || '') || '').trim();
    if (url) localStorage.setItem('api_url', url);
    if (token) localStorage.setItem('api_token', token);
  }
  return { url, token };
}

// 身份是「这台设备是谁在用」，纯本机偏好，不参与同步——FUU 手机上设成 FUU，
// MORI 手机上设成 MORI，只用来决定记一笔时默认选中哪个人。
function getIdentity() {
  let id = localStorage.getItem(IDENTITY_KEY);
  if (id !== 'FUU' && id !== 'MORI') {
    id = (prompt('这台设备是 FUU 在用，还是 MORI 在用？（决定默认记账人，之后可在设置里改）', 'FUU') || '').trim().toUpperCase();
    if (id !== 'FUU' && id !== 'MORI') id = 'FUU';
    localStorage.setItem(IDENTITY_KEY, id);
  }
  return id;
}

function setIdentity(id) {
  localStorage.setItem(IDENTITY_KEY, id);
}

function defaultState() {
  return {
    records: [],
    settings: {
      paymentMethods: DEFAULT_PAYMENT_METHODS.slice(),
      fixedCosts: Object.assign({}, DEFAULT_FIXED_COSTS),
    },
  };
}

let state = defaultState();
let pendingOps = [];
let flushing = false;
let offline = false;
let notConfigured = false;

function mergeIntoDefaults(parsed) {
  const d = defaultState();
  return {
    records: Array.isArray(parsed.records) ? parsed.records : [],
    settings: Object.assign(d.settings, parsed.settings, {
      paymentMethods: (parsed.settings && parsed.settings.paymentMethods) || d.settings.paymentMethods,
      fixedCosts: Object.assign({}, d.settings.fixedCosts, (parsed.settings || {}).fixedCosts),
    }),
  };
}

function cacheLocally() {
  const raw = JSON.stringify(state);
  try { localStorage.setItem(CACHE_KEY, raw); } catch (e) { /* 存储满了不影响主流程 */ }
  idbPut('state', raw);
}

function persistPending() {
  const raw = JSON.stringify(pendingOps);
  try { localStorage.setItem(PENDING_KEY, raw); } catch (e) { /* 同上 */ }
  idbPut('pending', raw);
}

function loadLocalCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return mergeIntoDefaults(JSON.parse(raw));
  } catch (e) {
    return null;
  }
}

async function loadIdbCache() {
  const raw = await withTimeout(idbGetKey('state'), 1500, null);
  if (!raw) return null;
  try { return mergeIntoDefaults(JSON.parse(raw)); } catch (e) { return null; }
}

function loadLocalPending() {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

async function loadIdbPending() {
  const raw = await withTimeout(idbGetKey('pending'), 1500, null);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

// ---- 全新设备第一次打开：等服务器把数据拉下来 ----
async function bootState() {
  try {
    const { url, token } = getApiConfig();
    if (!url || !token) {
      notConfigured = true;
      throw new Error('not configured');
    }
    const res = await fetch(`${url}?token=${encodeURIComponent(token)}`);
    if (!res.ok) throw new Error('bad status');
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    state = mergeIntoDefaults(data);
    offline = false;
    notConfigured = false;
    cacheLocally();
  } catch (e) {
    offline = true;
  }
}

// ---- 按条合并：服务器数据 vs 本机（可能还有未同步的编辑） ----
// 核心规则：本机还有待同步操作的那些记录，服务器的版本一律不采用
// （服务器那份必然更旧，早晚会被这条待同步操作覆盖过去）；
// 其余记录按 updatedAt 谁新用谁——这样两人各自编辑不同记录永远不会互相冲掉，
// 就算撞上同一条，也只丢失较旧的那次编辑，而不是丢掉整个数据集。
function pendingRecordIds() {
  const ids = new Set();
  pendingOps.forEach((op) => {
    if (op.type === 'upsert') ids.add(op.tempId || op.id);
    else if (op.type === 'delete') ids.add(op.id);
  });
  return ids;
}

function mergeServerData(server) {
  const pendingIds = pendingRecordIds();
  const localById = new Map(state.records.map((r) => [r.id, r]));
  const merged = new Map();

  state.records.forEach((r) => {
    if (pendingIds.has(r.id)) merged.set(r.id, r);
  });

  (server.records || []).forEach((sr) => {
    if (merged.has(sr.id)) return; // 本机有待同步的编辑，服务器这份先不采用
    const lr = localById.get(sr.id);
    if (!lr) { merged.set(sr.id, sr); return; }
    const winner = (lr.updatedAt || '') > (sr.updatedAt || '') ? lr : sr;
    merged.set(sr.id, winner);
  });

  state.records = Array.from(merged.values());
  if (server.settings) state.settings = mergeIntoDefaults({ settings: server.settings }).settings;
  cacheLocally();
}

async function refreshFromServer() {
  const url = localStorage.getItem('api_url');
  const token = localStorage.getItem('api_token');
  if (!url || !token) {
    notConfigured = true;
    updateSyncBar();
    return;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`${url}?token=${encodeURIComponent(token)}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error('bad status');
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    offline = false;
    mergeServerData(data);
    renderAllViews();
    updateSyncBar();
  } catch (e) {
    offline = true;
    updateSyncBar();
  }
}

// ---- 待同步队列：新增/编辑/删除都先落本机，再各自入队 ----
function queueUpsert(record, isNew) {
  // 这条记录如果还有一个「新增/编辑」操作在队列里排队、且还没开始发送，
  // 直接把旧的换掉——没必要为同一条记录连发两次请求。
  const key = record.id;
  const idx = pendingOps.findIndex((o) => o.type === 'upsert' && (o.tempId === key || o.id === key));
  const inFlight = flushing && idx === 0;
  if (idx !== -1 && !inFlight) pendingOps.splice(idx, 1);
  pendingOps.push({
    opId: uid(),
    type: 'upsert',
    isNew: !!isNew,
    tempId: isNew ? record.id : null,
    id: isNew ? null : record.id,
    record,
  });
  persistPending();
  updateSyncBar();
}

function queueDelete(id) {
  // 如果针对这条记录的「新增」还在队列里没发出去，说明服务器压根没见过它，
  // 直接把那条排队的新增撤掉，不需要再告诉服务器删除一条它没有的记录。
  const idx = pendingOps.findIndex((o) => o.type === 'upsert' && o.isNew && o.tempId === id);
  const inFlight = flushing && idx === 0;
  if (idx !== -1 && !inFlight) {
    pendingOps.splice(idx, 1);
    persistPending();
    updateSyncBar();
    return;
  }
  pendingOps.push({ opId: uid(), type: 'delete', id });
  persistPending();
  updateSyncBar();
}

// 服务器把临时 id 换成正式 id 之后，本机缓存和队列里后续还引用旧 id 的操作都要跟着改
function reconcileId(oldId, savedRecord) {
  const idx = state.records.findIndex((r) => r.id === oldId);
  if (idx !== -1) state.records[idx] = savedRecord;
  else state.records.push(savedRecord);

  pendingOps.forEach((o) => {
    if (o.type === 'upsert' && o.tempId === oldId) {
      o.tempId = null;
      o.isNew = false;
      o.id = savedRecord.id;
      if (o.record) o.record.id = savedRecord.id;
    }
    if (o.type === 'delete' && o.id === oldId) o.id = savedRecord.id;
  });

  cacheLocally();
  persistPending();
}

async function sendOp(op) {
  const { url, token } = getApiConfig();
  if (!url || !token) return false;
  try {
    if (op.type === 'upsert') {
      const payload = {
        token,
        action: 'upsert',
        record: Object.assign({}, op.record, {
          isNew: op.isNew,
          id: op.isNew ? undefined : op.id,
        }),
      };
      const res = await fetch(url, { method: 'POST', body: JSON.stringify(payload) });
      if (!res.ok) return false;
      const data = await res.json();
      if (data.error || !data.record) return false;
      reconcileId(op.tempId || op.id, data.record);
      return true;
    }
    if (op.type === 'delete') {
      const res = await fetch(url, { method: 'POST', body: JSON.stringify({ token, action: 'delete', id: op.id }) });
      if (!res.ok) return false;
      const data = await res.json();
      if (data.error) return false;
      return true;
    }
    if (op.type === 'saveSettings') {
      const res = await fetch(url, { method: 'POST', body: JSON.stringify({ token, action: 'saveSettings', settings: op.settings }) });
      if (!res.ok) return false;
      const data = await res.json();
      if (data.error) return false;
      return true;
    }
  } catch (e) {
    return false;
  }
  return false;
}

// 队列按顺序逐条 await 发送——这个顺序保证了 tempId 回填的正确性：
// 如果后面排着一条针对同一条记录的编辑，必须等前一条「新增」先拿到正式 id。
async function flushPendingOps() {
  if (flushing) return;
  if (pendingOps.length === 0) { updateSyncBar(); return; }
  flushing = true;
  updateSyncBar();
  try {
    while (pendingOps.length > 0) {
      const op = pendingOps[0];
      const ok = await sendOp(op);
      if (!ok) break;
      pendingOps = pendingOps.filter((o) => o.opId !== op.opId);
      persistPending();
    }
  } finally {
    flushing = false;
    updateSyncBar();
  }
}

// ---- 供 expense.js / history.js 调用的记录读写入口 ----
function createExpenseRecord(fields) {
  const record = Object.assign({
    id: `tmp-${uid()}`,
    updatedAt: new Date().toISOString(),
    deleted: false,
  }, fields);
  state.records.push(record);
  cacheLocally();
  queueUpsert(record, true);
  return record;
}

function updateExpenseRecord(id, fields) {
  const record = state.records.find((r) => r.id === id);
  if (!record) return null;
  Object.assign(record, fields, { updatedAt: new Date().toISOString() });
  cacheLocally();
  queueUpsert(record, record.id.startsWith('tmp-'));
  return record;
}

function deleteExpenseRecord(id) {
  const record = state.records.find((r) => r.id === id);
  if (!record) return;
  record.deleted = true;
  record.updatedAt = new Date().toISOString();
  cacheLocally();
  queueDelete(id);
}

function saveSettings(fields) {
  state.settings = Object.assign({}, state.settings, fields);
  cacheLocally();
  pendingOps = pendingOps.filter((o) => o.type !== 'saveSettings');
  pendingOps.push({ opId: uid(), type: 'saveSettings', settings: state.settings });
  persistPending();
  updateSyncBar();
}

function activeRecords() {
  return state.records.filter((r) => !r.deleted);
}

// ---- 通用工具 ----
function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function fmt(n) {
  return Math.round(n * 10) / 10;
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 1600);
}

// ---- 安全的算式求值（金额输入框用，方便"1200+300"这种分摊场景），不用 eval/Function ----
function evalCalExpr(raw) {
  if (raw == null) return null;
  const str = String(raw).trim().replace(/[xX×]/g, '*').replace(/[÷]/g, '/');
  if (str === '') return null;
  if (!/^[0-9+\-*/(). ]+$/.test(str)) return null;

  let i = 0;
  function skipSpace() { while (str[i] === ' ') i++; }
  function parseNumber() {
    skipSpace();
    const start = i;
    if (str[i] === '+' || str[i] === '-') i++;
    let sawDigit = false;
    while (i < str.length && /[0-9]/.test(str[i])) { i++; sawDigit = true; }
    if (str[i] === '.') {
      i++;
      while (i < str.length && /[0-9]/.test(str[i])) { i++; sawDigit = true; }
    }
    if (!sawDigit) throw new Error('bad number');
    return Number(str.slice(start, i));
  }
  function parseFactor() {
    skipSpace();
    if (str[i] === '(') {
      i++;
      const v = parseExpr();
      skipSpace();
      if (str[i] !== ')') throw new Error('missing )');
      i++;
      return v;
    }
    if (str[i] === '-') { i++; return -parseFactor(); }
    if (str[i] === '+') { i++; return parseFactor(); }
    return parseNumber();
  }
  function parseTerm() {
    let v = parseFactor();
    skipSpace();
    while (str[i] === '*' || str[i] === '/') {
      const op = str[i];
      i++;
      const rhs = parseFactor();
      v = op === '*' ? v * rhs : v / rhs;
      skipSpace();
    }
    return v;
  }
  function parseExpr() {
    let v = parseTerm();
    skipSpace();
    while (str[i] === '+' || str[i] === '-') {
      const op = str[i];
      i++;
      const rhs = parseTerm();
      v = op === '+' ? v + rhs : v - rhs;
      skipSpace();
    }
    return v;
  }

  try {
    const result = parseExpr();
    skipSpace();
    if (i !== str.length) return null;
    if (!Number.isFinite(result)) return null;
    return result;
  } catch (e) {
    return null;
  }
}

// ---- 导航 ----
const VIEW_TITLES = { expense: '记一笔', history: '历史', summary: '汇总', settings: '设置' };

function switchView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === name));
  document.querySelectorAll('.tab-bar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.getElementById('page-title').textContent = VIEW_TITLES[name] || '';
  if (name === 'expense' && window.renderExpenseForm) window.renderExpenseForm();
  if (name === 'history' && window.renderHistory) window.renderHistory();
  if (name === 'summary' && window.renderSummary) window.renderSummary();
  if (name === 'settings' && window.renderSettings) window.renderSettings();
}

function currentViewName() {
  const active = document.querySelector('.tab-bar button.active');
  return active ? active.dataset.tab : 'expense';
}

function renderAllViews() {
  if (window.renderExpenseForm) window.renderExpenseForm();
  if (window.renderHistory) window.renderHistory();
  if (window.renderSummary) window.renderSummary();
  if (window.renderSettings) window.renderSettings();
}

function updateSyncBar() {
  const bar = document.getElementById('sync-bar');
  const status = document.getElementById('sync-status');
  if (!bar || !status) return;
  const n = pendingOps.length;
  if (notConfigured) {
    bar.dataset.mode = 'unconfigured';
    status.textContent = '还没连后端，点这里设置';
    status.style.cursor = 'pointer';
    status.onclick = () => {
      localStorage.removeItem('api_url');
      localStorage.removeItem('api_token');
      location.reload();
    };
    return;
  }
  status.style.cursor = 'default';
  status.onclick = null;
  if (flushing) {
    bar.dataset.mode = 'syncing';
    status.textContent = `同步中…（剩 ${n} 条）`;
  } else if (n > 0) {
    bar.dataset.mode = 'pending';
    status.textContent = `${n} 条待同步`;
  } else if (offline) {
    bar.dataset.mode = 'local';
    status.textContent = '离线 · 使用本机数据';
  } else {
    bar.dataset.mode = 'synced';
    const t = new Date();
    const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    status.textContent = `已同步 · ${hhmm}`;
  }
}

async function boot() {
  const cachedState = loadLocalCache() || (await loadIdbCache());
  const localPending = loadLocalPending();
  pendingOps = localPending.length ? localPending : ((await loadIdbPending()) || []);

  if (cachedState) {
    state = cachedState;
  } else {
    await bootState();
  }

  document.querySelectorAll('.tab-bar button[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.tab));
  });

  const syncBtn = document.getElementById('sync-btn');
  if (syncBtn) syncBtn.addEventListener('click', () => { flushPendingOps().then(refreshFromServer); });

  [
    ['记一笔', window.initExpenseForm],
    ['历史', window.initHistory],
    ['汇总', window.initSummary],
    ['设置', window.initSettings],
  ].forEach(([label, init]) => {
    if (!init) return;
    try { init(); } catch (e) { console.error(`[${label}] 初始化失败`, e); }
  });

  switchView('expense');
  updateSyncBar();

  document.getElementById('app-loading').style.display = 'none';
  document.getElementById('app-root').style.display = '';

  if (cachedState) {
    refreshFromServer();
    if (pendingOps.length) flushPendingOps();
  }

  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', boot);
