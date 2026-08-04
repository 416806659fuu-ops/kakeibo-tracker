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

// 消费项目（分类），种子数据是从「MORI家出費記録」参考表实际翻过历史记录数出来的
// 最常出现的几类，每类下面再配几个最常用的供应商，点一下就填进供应商栏。
const DEFAULT_CATEGORIES = [
  { name: '食料品', vendors: ['いなげや', '肉のハナマサ', 'まいばすけっと'] },
  { name: '咖啡', vendors: ['711', 'ファミマ', 'LAWSON', 'ミニストップ'] },
  { name: '交通', vendors: ['JR', 'メトロ', 'つくばTX'] },
  { name: '网购', vendors: ['AMAZON', 'taobao', '京东'] },
  { name: '外食', vendors: [] },
];

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
// （这份代码要发布到公开的 GitHub Pages），第一次打开在「设置」页里填一次，
// 存在这台设备的浏览器本地，以后不用再填。FUU 和 MORI 两台设备各自填一次、
// 各自存一份，密码需要你们线下同步一次。
//
// 这里以前是用 prompt() 弹窗问，但 iOS 上「添加到主屏幕」之后的独立窗口模式
// （standalone display mode）不支持 window.prompt()——不会报错，就是弹窗完全
// 不出现，导致 iPhone 上永远填不进后端地址。所以改成设置页里的普通输入框。
function getApiConfig() {
  return {
    url: (localStorage.getItem('api_url') || '').trim(),
    token: (localStorage.getItem('api_token') || '').trim(),
  };
}

function setApiConfig(url, token) {
  localStorage.setItem('api_url', url.trim());
  localStorage.setItem('api_token', token.trim());
}

// 身份是「这台设备是谁在用」，纯本机偏好，不参与同步——FUU 手机上设成 FUU，
// MORI 手机上设成 MORI，只用来决定记一笔时默认选中哪个人。同样原因（iOS
// standalone 模式不支持 prompt()），改成设置页里的按钮选，没选之前先默认 FUU。
function getIdentity() {
  const id = localStorage.getItem(IDENTITY_KEY);
  return id === 'FUU' || id === 'MORI' ? id : 'FUU';
}

function setIdentity(id) {
  localStorage.setItem(IDENTITY_KEY, id);
}

// 记账人除了 FUU / MORI，还有「共用」——两人共同的支出（比如一起吃饭、共同采购），
// 内部存的是 SHARED，只是显示成中文，避免把"共用"这种中文字面值到处当 CSS 类名/枚举值传来传去。
const PERSON_LABELS = { FUU: 'FUU', MORI: 'MORI', SHARED: '共用' };
function personLabel(p) {
  return PERSON_LABELS[p] || p;
}

function defaultState() {
  return {
    records: [],
    settings: {
      paymentMethods: DEFAULT_PAYMENT_METHODS.slice(),
      fixedCosts: Object.assign({}, DEFAULT_FIXED_COSTS),
      categories: DEFAULT_CATEGORIES.map((c) => ({ name: c.name, vendors: c.vendors.slice() })),
    },
  };
}

let state = defaultState();
let pendingOps = [];
let flushing = false;
let offline = false;
let notConfigured = false;
let lastSyncError = ''; // 只给设置页的诊断面板看，方便隔着屏幕排查手机上的问题

function mergeIntoDefaults(parsed) {
  const d = defaultState();
  return {
    records: Array.isArray(parsed.records) ? parsed.records : [],
    settings: Object.assign(d.settings, parsed.settings, {
      paymentMethods: (parsed.settings && parsed.settings.paymentMethods) || d.settings.paymentMethods,
      fixedCosts: Object.assign({}, d.settings.fixedCosts, (parsed.settings || {}).fixedCosts),
      categories: (parsed.settings && parsed.settings.categories && parsed.settings.categories.length)
        ? parsed.settings.categories
        : d.settings.categories,
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
// 一定要设超时——这是本机完全没有缓存时唯一的阻塞路径，网络差/信号弱的时候
// 如果不设超时，界面会卡在"加载中…"卡死，用户没有任何退路。超时或失败就
// 放弃等待，直接用空的本机状态把界面渲染出来，之后随时能点"同步"重试。
async function bootState() {
  try {
    const { url, token } = getApiConfig();
    if (!url || !token) {
      notConfigured = true;
      throw new Error('not configured');
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(`${url}?token=${encodeURIComponent(token)}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error('bad status');
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    state = mergeIntoDefaults(data);
    offline = false;
    notConfigured = false;
    lastSyncError = '';
    cacheLocally();
  } catch (e) {
    offline = true;
    lastSyncError = `首次加载失败：${e && e.message ? e.message : e}`;
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
  // 设置同理：本机还有没发出去的设置改动时，服务器那份必然更旧，先别采纳，
  // 等队列发完（patchSettings 成功后会拿服务端合并好的结果回填）
  const settingsPending = pendingOps.some((o) => o.type === 'patchSettings' || o.type === 'saveSettings');
  if (server.settings && !settingsPending) {
    state.settings = mergeIntoDefaults({ settings: server.settings }).settings;
  }
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
    lastSyncError = '';
    mergeServerData(data);
    renderAllViews();
    updateSyncBar();
  } catch (e) {
    offline = true;
    lastSyncError = `同步失败：${e && e.message ? e.message : e}`;
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
    if (op.type === 'patchSettings') {
      const res = await fetch(url, { method: 'POST', body: JSON.stringify({ token, action: 'patchSettings', ops: op.ops }) });
      if (!res.ok) return false;
      const data = await res.json();
      if (data.error || !data.settings) return false;
      // 服务端套用完这批操作后的结果才是准的（可能还含着对方设备刚加的东西），
      // 直接采纳，本机这份乐观更新的就不要了
      state.settings = mergeIntoDefaults({ settings: data.settings }).settings;
      cacheLocally();
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

// 设置的改动走"上传我做了什么"，不是"上传我认为完整的设置长什么样"。
// 之前是后者，出过真事故：在一台设置还是旧版的设备上新增一个消费项目，一保存
// 就把另一台设备上早先新增的"娱乐"整个覆盖没了。现在每个增删改都是一条独立的
// 操作，服务端在锁里依次套用到它自己那份最新的设置上，两边各自加的都保得住，
// 删除也依然是真删除。
function applySettingsOps(settings, ops) {
  ops.forEach((op) => {
    if (op.type === 'addPaymentMethod') {
      if (!settings.paymentMethods.includes(op.name)) settings.paymentMethods = settings.paymentMethods.concat([op.name]);
    } else if (op.type === 'removePaymentMethod') {
      settings.paymentMethods = settings.paymentMethods.filter((m) => m !== op.name);
    } else if (op.type === 'addCategory') {
      if (!settings.categories.some((c) => c.name === op.name)) {
        settings.categories = settings.categories.concat([{ name: op.name, vendors: [] }]);
      }
    } else if (op.type === 'removeCategory') {
      settings.categories = settings.categories.filter((c) => c.name !== op.name);
    } else if (op.type === 'addVendor') {
      settings.categories = settings.categories.map((c) => (
        c.name === op.category && !(c.vendors || []).includes(op.vendor)
          ? Object.assign({}, c, { vendors: (c.vendors || []).concat([op.vendor]) })
          : c
      ));
    } else if (op.type === 'setFixedCost') {
      settings.fixedCosts = Object.assign({}, settings.fixedCosts, { [op.key]: Number(op.value) || 0 });
    }
  });
  return settings;
}

function patchSettings(ops) {
  applySettingsOps(state.settings, ops);
  cacheLocally();
  pendingOps.push({ opId: uid(), type: 'patchSettings', ops });
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
    status.onclick = () => switchView('settings');
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

  // 从旧版本升上来的设备，队列里可能还压着一条老的整份覆盖式 saveSettings，
  // 它带着的是这台设备当时那份（很可能已经过时的）完整设置。一旦发出去，就会
  // 把服务器上别人后来加的分类/支付方式整个盖掉——正是我们刚刚才修掉的那个 bug，
  // 而且它还会一直卡住"本机有未同步的设置改动"这个判断，导致设置永远不从服务器
  // 刷新。这种历史遗留操作直接丢弃：设置以服务器那份为准，不会有数据损失。
  const legacy = pendingOps.filter((o) => o.type === 'saveSettings').length;
  if (legacy) {
    pendingOps = pendingOps.filter((o) => o.type !== 'saveSettings');
    persistPending();
  }

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
    // 新的 service worker 接管后自动刷新一次，页面已经打开着也能立刻用上最新代码，
    // 不用手动退出 app 重进——配合 sw.js 的网络优先策略，才算真正解决了
    // "改完代码用户手机上还是旧版本"的问题。
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      location.reload();
    });
  }
}

document.addEventListener('DOMContentLoaded', boot);
