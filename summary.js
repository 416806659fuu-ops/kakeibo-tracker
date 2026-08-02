// ---- 月度汇总：按人总额 + 固定出費参考表 ----
let summaryMonth = todayKey().slice(0, 7);

function initSummary() {
  document.getElementById('sum-month-prev').addEventListener('click', () => {
    summaryMonth = shiftMonth(summaryMonth, -1);
    renderSummary();
  });
  document.getElementById('sum-month-next').addEventListener('click', () => {
    summaryMonth = shiftMonth(summaryMonth, 1);
    renderSummary();
  });
}

function renderSummary() {
  document.getElementById('sum-month-label').textContent = monthLabel(summaryMonth);

  const rows = activeRecords().filter((r) => r.date.slice(0, 7) === summaryMonth);
  const totalFuu = rows.filter((r) => r.person === 'FUU').reduce((s, r) => s + Number(r.amount), 0);
  const totalMori = rows.filter((r) => r.person === 'MORI').reduce((s, r) => s + Number(r.amount), 0);
  const total = totalFuu + totalMori;

  document.getElementById('sum-total').textContent = `¥${total.toLocaleString()}`;
  document.getElementById('sum-fuu').textContent = `¥${totalFuu.toLocaleString()}`;
  document.getElementById('sum-mori').textContent = `¥${totalMori.toLocaleString()}`;

  const fixedCosts = state.settings.fixedCosts || {};
  const fixedWrap = document.getElementById('sum-fixed-costs');
  const entries = Object.keys(fixedCosts);
  fixedWrap.innerHTML = entries.map((key) => `
    <div class="fixed-cost-row">
      <span class="fixed-cost-label">${escapeHtml(key)}</span>
      <span class="fixed-cost-value">${fixedCosts[key] ? '¥' + Number(fixedCosts[key]).toLocaleString() : '—'}</span>
    </div>
  `).join('');
}

window.initSummary = initSummary;
window.renderSummary = renderSummary;
