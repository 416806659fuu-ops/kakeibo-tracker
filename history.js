// ---- 历史列表：按月分组，人员/支付方式筛选 ----
let historyMonth = todayKey().slice(0, 7); // 'YYYY-MM'
let historyPersonFilter = 'ALL'; // 'ALL' | 'FUU' | 'MORI'
let historyMethodFilter = 'ALL';

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${y}年${m}月`;
}

function initHistory() {
  document.getElementById('hist-month-prev').addEventListener('click', () => {
    historyMonth = shiftMonth(historyMonth, -1);
    renderHistory();
  });
  document.getElementById('hist-month-next').addEventListener('click', () => {
    historyMonth = shiftMonth(historyMonth, 1);
    renderHistory();
  });
  document.querySelectorAll('#hist-person-filter button').forEach((b) => {
    b.addEventListener('click', () => {
      historyPersonFilter = b.dataset.person;
      renderHistory();
    });
  });
  document.getElementById('hist-method-filter').addEventListener('change', (e) => {
    historyMethodFilter = e.target.value;
    renderHistory();
  });
  document.getElementById('hist-list').addEventListener('click', (e) => {
    const row = e.target.closest('.expense-row');
    if (row && row.dataset.id) openExpenseForEdit(row.dataset.id);
  });
}

function renderMethodFilterOptions() {
  const sel = document.getElementById('hist-method-filter');
  const prev = sel.value || historyMethodFilter;
  sel.innerHTML = '<option value="ALL">全部支付方式</option>' +
    (state.settings.paymentMethods || []).map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
  sel.value = [...sel.options].some((o) => o.value === prev) ? prev : 'ALL';
  historyMethodFilter = sel.value;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderHistory() {
  document.getElementById('hist-month-label').textContent = monthLabel(historyMonth);
  document.querySelectorAll('#hist-person-filter button').forEach((b) => {
    b.classList.toggle('active', b.dataset.person === historyPersonFilter);
  });
  renderMethodFilterOptions();

  const rows = activeRecords()
    .filter((r) => r.date.slice(0, 7) === historyMonth)
    .filter((r) => historyPersonFilter === 'ALL' || r.person === historyPersonFilter)
    .filter((r) => historyMethodFilter === 'ALL' || (r.paymentMethods || []).includes(historyMethodFilter))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const list = document.getElementById('hist-list');
  if (rows.length === 0) {
    list.innerHTML = '<div class="empty-hint"><p>这个月还没有记录</p></div>';
    return;
  }

  list.innerHTML = rows.map((r) => `
    <div class="expense-row" data-id="${r.id}">
      <div class="expense-row-main">
        <div class="expense-row-top">
          <span class="expense-vendor">${escapeHtml(r.vendor || '（未填供应商）')}</span>
          <span class="expense-amount">¥${Number(r.amount).toLocaleString()}</span>
        </div>
        <div class="expense-row-sub">
          <span class="expense-date">${r.date}</span>
          ${r.category ? `<span class="expense-tag">${escapeHtml(r.category)}</span>` : ''}
          ${r.description ? `<span class="expense-desc">${escapeHtml(r.description)}</span>` : ''}
          ${(r.paymentMethods || []).map((m) => `<span class="expense-tag">${escapeHtml(m)}</span>`).join('')}
        </div>
      </div>
      <span class="person-tag person-${r.person}">${personLabel(r.person)}</span>
    </div>
  `).join('');
}

window.initHistory = initHistory;
window.renderHistory = renderHistory;
