// ---- 历史：按月日历，点进某天看明细，明细每条可向左滑动删除 ----
let historyMonth = todayKey().slice(0, 7); // 'YYYY-MM'
let historyPersonFilter = 'ALL'; // 'ALL' | 'FUU' | 'MORI' | 'SHARED'
let historyMethodFilter = 'ALL';
let dayDetailDate = null; // 当天明细弹层对应的日期，null 表示没打开

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${y}年${m}月`;
}

function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function firstWeekday(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).getDay(); // 0=周日
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
  document.getElementById('hist-calendar').addEventListener('click', (e) => {
    const cell = e.target.closest('.cal-day');
    if (!cell || !cell.dataset.date) return;
    openDayDetail(cell.dataset.date);
  });
  document.getElementById('day-detail-back').addEventListener('click', closeDayDetail);
}

function filteredRecords() {
  return activeRecords()
    .filter((r) => historyPersonFilter === 'ALL' || r.person === historyPersonFilter)
    .filter((r) => historyMethodFilter === 'ALL' || (r.paymentMethods || []).includes(historyMethodFilter));
}

function renderMethodFilterOptions() {
  const sel = document.getElementById('hist-method-filter');
  const prev = sel.value || historyMethodFilter;
  sel.innerHTML = '<option value="ALL">全部支付方式</option>' +
    (state.settings.paymentMethods || []).map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
  sel.value = [...sel.options].some((o) => o.value === prev) ? prev : 'ALL';
  historyMethodFilter = sel.value;
}

function renderHistory() {
  document.getElementById('hist-month-label').textContent = monthLabel(historyMonth);
  document.querySelectorAll('#hist-person-filter button').forEach((b) => {
    b.classList.toggle('active', b.dataset.person === historyPersonFilter);
  });
  renderMethodFilterOptions();

  const rows = filteredRecords().filter((r) => r.date.slice(0, 7) === historyMonth);
  const totalsByDay = {};
  rows.forEach((r) => { totalsByDay[r.date] = (totalsByDay[r.date] || 0) + Number(r.amount); });

  const grid = document.getElementById('hist-calendar');
  const total = daysInMonth(historyMonth);
  const offset = firstWeekday(historyMonth);
  const today = todayKey();
  let html = '';
  for (let i = 0; i < offset; i++) html += '<div class="cal-day empty"></div>';
  for (let d = 1; d <= total; d++) {
    const dateStr = `${historyMonth}-${String(d).padStart(2, '0')}`;
    const amt = totalsByDay[dateStr];
    html += `<div class="cal-day${dateStr === today ? ' today' : ''}" data-date="${dateStr}">
      <span class="cal-day-num">${d}</span>
      ${amt ? `<span class="cal-day-amt">¥${amt.toLocaleString()}</span>` : ''}
    </div>`;
  }
  grid.innerHTML = html;

  // 明细弹层开着的时候（比如刚删完一条），联动重画，数字才跟得上
  if (dayDetailDate) renderDayDetail();
}

function openDayDetail(dateStr) {
  dayDetailDate = dateStr;
  renderDayDetail();
  document.getElementById('day-detail').style.display = '';
}

function closeDayDetail() {
  dayDetailDate = null;
  document.getElementById('day-detail').style.display = 'none';
}

function renderDayDetail() {
  if (!dayDetailDate) return;
  document.getElementById('day-detail-title').textContent = dayDetailDate;
  const rows = filteredRecords()
    .filter((r) => r.date === dayDetailDate)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  const list = document.getElementById('day-detail-list');
  if (rows.length === 0) {
    list.innerHTML = '<div class="empty-hint"><p>这天没有记录</p></div>';
    return;
  }

  list.innerHTML = rows.map((r) => `
    <div class="swipe-row" data-id="${r.id}">
      <div class="swipe-row-bg">删除</div>
      <div class="swipe-row-fg expense-row">
        <div class="expense-row-main">
          <div class="expense-row-top">
            <span class="expense-vendor">${escapeHtml(r.vendor || '（未填供应商）')}</span>
            <span class="expense-amount">¥${Number(r.amount).toLocaleString()}</span>
          </div>
          <div class="expense-row-sub">
            ${r.category ? `<span class="expense-tag">${escapeHtml(r.category)}</span>` : (r.description ? `<span class="expense-tag">${escapeHtml(r.description)}</span>` : '')}
            ${(r.paymentMethods || []).map((m) => `<span class="expense-tag">${escapeHtml(m)}</span>`).join('')}
          </div>
        </div>
        <span class="person-tag person-${r.person}">${personLabel(r.person)}</span>
      </div>
    </div>
  `).join('');

  bindSwipeRows();
}

// 向左滑过阈值就删除，没过就弹回去；没有明显横向位移则当成一次点击，进编辑页。
function bindSwipeRows() {
  const THRESHOLD = 64;
  document.querySelectorAll('#day-detail-list .swipe-row').forEach((row) => {
    const fg = row.querySelector('.swipe-row-fg');
    const id = row.dataset.id;
    let startX = 0;
    let dx = 0;
    let dragging = false;
    let moved = false;

    function onDown(e) {
      dragging = true;
      moved = false;
      startX = e.clientX;
      fg.style.transition = 'none';
      fg.setPointerCapture && e.pointerId != null && fg.setPointerCapture(e.pointerId);
    }
    function onMove(e) {
      if (!dragging) return;
      dx = Math.min(0, e.clientX - startX);
      if (Math.abs(dx) > 5) moved = true;
      fg.style.transform = `translateX(${Math.max(dx, -110)}px)`;
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      fg.style.transition = 'transform 0.2s ease-out';
      if (dx < -THRESHOLD) {
        fg.style.transform = 'translateX(-100%)';
        setTimeout(() => {
          deleteExpenseRecord(id);
          renderHistory();
          if (window.renderSummary) window.renderSummary();
          showToast('已删除');
        }, 150);
      } else {
        fg.style.transform = 'translateX(0)';
      }
      dx = 0;
    }

    fg.addEventListener('pointerdown', onDown);
    fg.addEventListener('pointermove', onMove);
    fg.addEventListener('pointerup', onUp);
    fg.addEventListener('pointercancel', onUp);
    fg.addEventListener('click', (e) => {
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
        moved = false;
        return;
      }
      // 先关掉当天明细弹层，再进编辑页——不然记一笔页面其实已经切换到编辑态了，
      // 只是被这个弹层挡在下面看不见，非要手动点返回才"突然"看到编辑界面。
      closeDayDetail();
      openExpenseForEdit(id);
    });
  });
}

window.initHistory = initHistory;
window.renderHistory = renderHistory;
