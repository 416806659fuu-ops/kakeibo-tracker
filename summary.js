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
// 这几个分类的颜色按"它是什么"固定下来，不跟它在列表里排第几走：饮食相关的
// （食料品/咖啡/外食）统一橙色系，娱乐紫，交通绿。这样比按顺序取色更稳——
// 删掉中间某个分类时，后面的分类不会集体换颜色。
// 没列在这里的分类（用户自己新增的）仍然按列表顺序从 --cat-1..12 里取。
const CATEGORY_SEMANTIC_COLORS = {
  '食料品': 'var(--cat-food-1)',
  '咖啡零食': 'var(--cat-food-2)',
  '咖啡': 'var(--cat-food-2)', // 改名前的旧值，留着让老记录颜色不变
  '外食': 'var(--cat-food-3)',
  '交通': 'var(--cat-transport)',
  '娱乐': 'var(--cat-fun)',
  '网购': 'var(--cat-shopping)',
  '日用品': 'var(--cat-daily)',
};

// 上面 7 个语义色分别占掉了色板的 1/2/3/4/7/11/12 号，剩下这些才是空的。
// 用户自己新增的分类从这里按顺序取，才不会跟"网购"撞成一模一样的蓝。
const FREE_CAT_SLOTS = [5, 6, 8, 9, 10];

function categoryColor(name, categories) {
  if (CATEGORY_SEMANTIC_COLORS[name]) return CATEGORY_SEMANTIC_COLORS[name];
  const rest = categories.filter((c) => !CATEGORY_SEMANTIC_COLORS[c.name]);
  const idx = rest.findIndex((c) => c.name === name);
  if (idx === -1 || idx >= FREE_CAT_SLOTS.length) return 'var(--text-muted)';
  return `var(--cat-${FREE_CAT_SLOTS[idx]})`;
}

function categoryBreakdown(rows) {
  const categories = state.settings.categories || [];
  const totals = {};
  rows.forEach((r) => {
    const key = r.category || '未分类';
    totals[key] = (totals[key] || 0) + Number(r.amount);
  });

  // "未分类"不是一个真的消费项目，不该跟真分类抢显示名额（它永远是灰的，也不占
  // 调色板的位子），所以先拎出来，最后再单独接在末尾。
  const uncategorized = totals['未分类'];
  delete totals['未分类'];

  const entries = Object.keys(totals).map((name) => ({
    label: name,
    value: totals[name],
    color: categoryColor(name, categories),
  }));
  entries.sort((a, b) => b.value - a.value);

  // 上限 20：宁可切得碎，也不要让记过的分类凭空消失——之前上限卡得太死（只留
  // 前 5），咖啡这种金额小的分类在历史里明明记着、饼图上却没有，看起来像没记上。
  // 注意超过 12 类之后颜色就不够分了（调色板到 --cat-12 为止，再往后一律灰色），
  // 那时候真正能区分身份的是图例上的文字，不是颜色。
  const MAX_SLICES = 20;
  let result = entries;
  if (entries.length > MAX_SLICES) {
    result = entries.slice(0, MAX_SLICES - 1);
    const restTotal = entries.slice(MAX_SLICES - 1).reduce((s, e) => s + e.value, 0);
    result.push({ label: '其他', value: restTotal, color: 'var(--text-muted)' });
  }

  if (uncategorized) {
    result = result.concat([{ label: '未分类', value: uncategorized, color: 'var(--text-muted)' }]);
  }
  return result;
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
