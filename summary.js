// ---- 月度汇总：按人总额 + 消费项目/记账人占比环形图 + 固定出費参考表 ----
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
  document.getElementById('sum-edit-fixed-costs-btn').addEventListener('click', () => switchView('settings'));
}

// 颜色跟着"这个类别是谁"走，不跟着它这个月排第几——同一个类别，不管这个月占比
// 涨了跌了，颜色永远一样，两张环形图之间/跨月份对比时不会认错。
function categoryColor(name, categories) {
  const idx = categories.findIndex((c) => c.name === name);
  if (idx === -1 || idx >= 8) return 'var(--text-muted)';
  return `var(--cat-${idx + 1})`;
}

function categoryBreakdown(rows) {
  const categories = state.settings.categories || [];
  const totals = {};
  rows.forEach((r) => {
    const key = r.category || '未分类';
    totals[key] = (totals[key] || 0) + Number(r.amount);
  });
  const entries = Object.keys(totals).map((name) => ({
    label: name,
    value: totals[name],
    color: name === '未分类' ? 'var(--text-muted)' : categoryColor(name, categories),
  }));
  entries.sort((a, b) => b.value - a.value);
  // 饼图切太碎反而看不清楚，超过 6 类就只留前 5，其余折进"其他"
  if (entries.length > 6) {
    const head = entries.slice(0, 5);
    const restTotal = entries.slice(5).reduce((s, e) => s + e.value, 0);
    head.push({ label: '其他', value: restTotal, color: 'var(--text-muted)' });
    return head;
  }
  return entries;
}

function personBreakdown(rows) {
  const totals = { FUU: 0, MORI: 0, SHARED: 0 };
  rows.forEach((r) => { totals[r.person] = (totals[r.person] || 0) + Number(r.amount); });
  return [
    { label: 'FUU', value: totals.FUU, color: 'var(--fuu-color)' },
    { label: 'MORI', value: totals.MORI, color: 'var(--mori-color)' },
    { label: '共用', value: totals.SHARED, color: 'var(--shared-color)' },
  ].filter((e) => e.value > 0);
}

function renderDonut(donutId, totalId, legendId, entries) {
  const donut = document.getElementById(donutId);
  const totalEl = document.getElementById(totalId);
  const legendEl = document.getElementById(legendId);
  const total = entries.reduce((s, e) => s + e.value, 0);
  totalEl.textContent = `¥${total.toLocaleString()}`;

  if (total <= 0) {
    donut.style.background = 'var(--gridline)';
    legendEl.innerHTML = '<div class="chart-empty">这个月还没有数据</div>';
    return;
  }

  let acc = 0;
  const stops = entries.map((e) => {
    const start = (acc / total) * 360;
    acc += e.value;
    const end = (acc / total) * 360;
    return `${e.color} ${start}deg ${end}deg`;
  }).join(', ');
  donut.style.background = `conic-gradient(${stops})`;

  legendEl.innerHTML = entries.map((e) => `
    <div class="chart-legend-row">
      <span class="chart-legend-dot" style="background:${e.color}"></span>
      <span class="chart-legend-label">${escapeHtml(e.label)}</span>
      <span class="chart-legend-value">¥${e.value.toLocaleString()}（${Math.round((e.value / total) * 100)}%）</span>
    </div>
  `).join('');
}

function renderSummary() {
  document.getElementById('sum-month-label').textContent = monthLabel(summaryMonth);

  const rows = activeRecords().filter((r) => r.date.slice(0, 7) === summaryMonth);
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  const totalFuu = rows.filter((r) => r.person === 'FUU').reduce((s, r) => s + Number(r.amount), 0);
  const totalMori = rows.filter((r) => r.person === 'MORI').reduce((s, r) => s + Number(r.amount), 0);
  const totalShared = rows.filter((r) => r.person === 'SHARED').reduce((s, r) => s + Number(r.amount), 0);

  document.getElementById('sum-total').textContent = `¥${total.toLocaleString()}`;
  document.getElementById('sum-fuu').textContent = `¥${totalFuu.toLocaleString()}`;
  document.getElementById('sum-mori').textContent = `¥${totalMori.toLocaleString()}`;
  document.getElementById('sum-shared').textContent = `¥${totalShared.toLocaleString()}`;

  renderDonut('sum-category-donut', 'sum-category-donut-total', 'sum-category-legend', categoryBreakdown(rows));
  renderDonut('sum-person-donut', 'sum-person-donut-total', 'sum-person-legend', personBreakdown(rows));

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
