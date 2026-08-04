// ---- 记一笔 ----
//
// 操作顺序（按实际记账习惯定的，DOM 顺序也照这个来）：
//   日期 → 消费项目 → 供应商 → 金额 → 支付方式 → 消费人 → 确认
//
// 这个文件唯一的事实来源是 expenseForm。输入框只负责把用户敲的东西写回
// expenseForm，渲染永远从 expenseForm 出发，提交也只读 expenseForm。
// 上一版不是这样：供应商/日期/金额的真值其实存在 DOM 的 value 里，
// expenseForm.vendor 从头到尾没被更新过，判断高亮和提交都直接去读 DOM。
// 状态和 DOM 各存一份、互相不同步，是这个文件最容易出问题的地方。

function blankExpenseFields() {
  return {
    date: todayKey(),
    noSpecificDay: false,
    category: '',
    vendor: '',
    amount: '',
    paymentMethods: [],
    person: getIdentity(),
  };
}

let expenseForm = blankExpenseFields();
let editingExpenseId = null;

// 分类列表在渲染这一层再兜一次底：只要 settings 里是空的（不管什么原因——
// 同步没跟上、设置被别的设备清掉、队列卡住导致设置永远不刷新），就退回内置的
// 默认分类，而不是渲染出一片空白让人以为 app 坏了。
function activeCategories() {
  const cats = (state.settings && state.settings.categories) || [];
  return cats.length ? cats : DEFAULT_CATEGORIES;
}

function currentCategory() {
  return activeCategories().find((c) => c.name === expenseForm.category);
}

function renderExpenseForm() {
  // 日期存的是完整 YYYY-MM-DD，或者只有年月的 YYYY-MM（"月度大额消费"）。
  // 后者原生日期选择器显示不了，回填时补一个"1号"占位；真正提交时按
  // noSpecificDay 再截回年月，所以占位的那个"1号"不会被存进去。
  document.getElementById('expense-date').value =
    expenseForm.noSpecificDay ? `${expenseForm.date.slice(0, 7)}-01` : expenseForm.date;
  document.getElementById('expense-no-specific-day').checked = expenseForm.noSpecificDay;
  document.getElementById('expense-vendor').value = expenseForm.vendor;
  document.getElementById('expense-amount').value = expenseForm.amount;

  renderCategoryChips();
  renderVendorSection();
  renderPaymentChips();
  renderPersonSwitch();

  document.getElementById('expense-form-title').textContent = editingExpenseId ? '编辑这一笔' : '记一笔';
  document.getElementById('expense-submit-btn').textContent = editingExpenseId ? '保存修改' : '记这一笔';
  document.getElementById('expense-delete-btn').style.display = editingExpenseId ? '' : 'none';
  document.getElementById('expense-cancel-edit-btn').style.display = editingExpenseId ? '' : 'none';
}

// 消费项目单选：点一下选中变色，再点一下取消。选中色跟汇总页环形图用的是
// 同一个 categoryColor()（在 summary.js），两边永远对得上。
function renderCategoryChips() {
  const wrap = document.getElementById('expense-category-chips');
  wrap.innerHTML = '';
  const cats = activeCategories();
  cats.forEach((cat) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const active = expenseForm.category === cat.name;
    btn.className = 'chip' + (active ? ' active' : '');
    if (active) {
      const color = categoryColor(cat.name, cats);
      btn.style.background = color;
      btn.style.borderColor = color;
      btn.style.color = '#fff';
    }
    btn.textContent = cat.name;
    btn.addEventListener('click', () => {
      const turningOff = expenseForm.category === cat.name;
      expenseForm.category = turningOff ? '' : cat.name;
      // 换了消费项目，原来那个供应商多半不属于新类别了，清掉免得串味；
      // 取消选中同理。
      expenseForm.vendor = '';
      document.getElementById('expense-vendor').value = '';
      renderCategoryChips();
      renderVendorSection();
    });
    wrap.appendChild(btn);
  });
}

// 供应商是消费项目的子选项：没选消费项目时整档隐藏，选了之后才出现对应的
// 常用供应商。点一下直接填进供应商栏并变成该分类的颜色，再点一下取消。
function renderVendorSection() {
  const row = document.getElementById('expense-quick-vendor-row');
  const cat = currentCategory();
  if (!cat) {
    row.style.display = 'none';
    return;
  }
  row.style.display = '';
  const color = categoryColor(cat.name, activeCategories());
  const wrap = document.getElementById('expense-quick-vendor-chips');
  wrap.innerHTML = '';
  (cat.vendors || []).forEach((v) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const active = expenseForm.vendor === v;
    btn.className = 'chip quick-vendor' + (active ? ' active' : '');
    if (active) {
      btn.style.background = color;
      btn.style.borderColor = color;
      btn.style.color = '#fff';
    }
    btn.textContent = v;
    btn.addEventListener('click', () => {
      expenseForm.vendor = expenseForm.vendor === v ? '' : v;
      document.getElementById('expense-vendor').value = expenseForm.vendor;
      renderVendorSection();
    });
    wrap.appendChild(btn);
  });
}

// 打字新增一个消费项目（比如"医疗"），马上选中它，之后一直留在候选里
function onAddCustomCategory() {
  const input = document.getElementById('expense-category-new');
  const name = input.value.trim();
  if (!name) return;
  if (!activeCategories().some((c) => c.name === name)) {
    patchSettings([{ type: 'addCategory', name }]);
  }
  expenseForm.category = name;
  expenseForm.vendor = '';
  document.getElementById('expense-vendor').value = '';
  input.value = '';
  renderCategoryChips();
  renderVendorSection();
  showToast(`已新增消费项目：${name}`);
}

// 供应商栏本身就是"打字新增"那个输入框：打的字就是这一笔的供应商（提交时直接
// 用），点 + 只是顺手把它加进当前类别的常用供应商，方便下次一点就填。
// 不点 + 完全不影响这一笔的提交。
function onAddQuickVendor() {
  const name = expenseForm.vendor.trim();
  const cat = currentCategory();
  if (!name) { showToast('先在下面输入供应商名字'); return; }
  if (!cat) { showToast('先选一个消费项目'); return; }
  if ((cat.vendors || []).includes(name)) { showToast('这个供应商已经在清单里了'); return; }
  patchSettings([{ type: 'addVendor', category: cat.name, vendor: name }]);
  renderVendorSection();
  showToast(`已加入常用供应商：${name}`);
}

function renderPaymentChips() {
  const wrap = document.getElementById('expense-payment-chips');
  wrap.innerHTML = '';
  ((state.settings && state.settings.paymentMethods) || []).forEach((m) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip' + (expenseForm.paymentMethods.includes(m) ? ' active' : '');
    btn.textContent = m;
    btn.addEventListener('click', () => {
      const i = expenseForm.paymentMethods.indexOf(m);
      if (i === -1) expenseForm.paymentMethods.push(m);
      else expenseForm.paymentMethods.splice(i, 1);
      renderPaymentChips();
    });
    wrap.appendChild(btn);
  });
  const preview = document.getElementById('expense-payment-preview');
  preview.textContent = expenseForm.paymentMethods.length
    ? `已选：${expenseForm.paymentMethods.join('、')}` : '';
}

// 支付方式支持多选组合，也支持随手打字新增——新方式会同时存进 settings，
// 下次记账、以及 MORI 那台设备同步后都能直接选到。
function onAddCustomPaymentMethod() {
  const input = document.getElementById('expense-payment-new');
  const name = input.value.trim();
  if (!name) return;
  if (!((state.settings && state.settings.paymentMethods) || []).includes(name)) {
    patchSettings([{ type: 'addPaymentMethod', name }]);
  }
  if (!expenseForm.paymentMethods.includes(name)) expenseForm.paymentMethods.push(name);
  input.value = '';
  renderPaymentChips();
  showToast(`已新增支付方式：${name}`);
}

function renderPersonSwitch() {
  document.querySelectorAll('#expense-person-switch button').forEach((b) => {
    b.classList.toggle('active', b.dataset.person === expenseForm.person);
  });
}

function onSubmitExpense(e) {
  e.preventDefault();

  // 校验按 flow 的顺序来，哪一步没填就提示哪一步，一次只说一件事
  if (!expenseForm.category) {
    showToast('还没选消费项目');
    return;
  }
  const amount = evalCalExpr(expenseForm.amount);
  if (amount === null || amount <= 0) {
    showToast('金额没填对');
    return;
  }

  const date = expenseForm.noSpecificDay ? expenseForm.date.slice(0, 7) : expenseForm.date;
  const fields = {
    date,
    category: expenseForm.category,
    vendor: expenseForm.vendor.trim(),
    amount,
    paymentMethods: expenseForm.paymentMethods.slice(),
    person: expenseForm.person,
  };

  if (editingExpenseId) {
    updateExpenseRecord(editingExpenseId, fields);
    showToast('已保存修改');
  } else {
    createExpenseRecord(fields);
    showToast('已记录');
  }

  // 连续记账时，日期/消费人/消费项目多半几笔都一样，保留；供应商和金额清空
  const keep = {
    date: expenseForm.date,
    noSpecificDay: expenseForm.noSpecificDay,
    person: expenseForm.person,
    category: expenseForm.category,
  };
  editingExpenseId = null;
  expenseForm = Object.assign(blankExpenseFields(), keep);
  renderExpenseForm();
  if (window.renderHistory) window.renderHistory();
  if (window.renderSummary) window.renderSummary();
}

function onDeleteFromForm() {
  if (!editingExpenseId) return;
  if (!confirm('删除这条记录吗？')) return;
  deleteExpenseRecord(editingExpenseId);
  editingExpenseId = null;
  expenseForm = blankExpenseFields();
  renderExpenseForm();
  showToast('已删除');
  if (window.renderHistory) window.renderHistory();
  if (window.renderSummary) window.renderSummary();
  switchView('history');
}

function onCancelEdit() {
  editingExpenseId = null;
  expenseForm = blankExpenseFields();
  renderExpenseForm();
}

// 供 history.js 调用：点开一条历史记录进入编辑。
// 消费项目和项目说明现在是同一件事，很老的记录里如果两个字段都有值，
// 编辑时把项目说明并进供应商栏，不会丢内容。
function openExpenseForEdit(id) {
  const record = state.records.find((r) => r.id === id);
  if (!record) return;
  editingExpenseId = id;
  expenseForm = {
    date: record.date,
    noSpecificDay: record.date.length === 7,
    category: record.category || '',
    vendor: record.description ? `${record.vendor} ${record.description}`.trim() : record.vendor,
    amount: String(record.amount),
    paymentMethods: (record.paymentMethods || []).slice(),
    person: record.person,
  };
  switchView('expense');
}

function initExpenseForm() {
  document.getElementById('expense-form').addEventListener('submit', onSubmitExpense);

  // 输入框只做一件事：把用户敲的东西写回 expenseForm
  document.getElementById('expense-date').addEventListener('change', (e) => {
    expenseForm.date = e.target.value || todayKey();
  });
  document.getElementById('expense-no-specific-day').addEventListener('change', (e) => {
    expenseForm.noSpecificDay = e.target.checked;
  });
  document.getElementById('expense-vendor').addEventListener('input', (e) => {
    expenseForm.vendor = e.target.value;
    // 手打的字如果正好等于某个常用供应商，那个 chip 要跟着高亮；不等就都取消
    renderVendorSection();
  });
  document.getElementById('expense-amount').addEventListener('input', (e) => {
    expenseForm.amount = e.target.value;
  });

  document.getElementById('expense-category-add-btn').addEventListener('click', onAddCustomCategory);
  document.getElementById('expense-quick-vendor-add-btn').addEventListener('click', onAddQuickVendor);
  document.getElementById('expense-payment-add-btn').addEventListener('click', onAddCustomPaymentMethod);
  document.getElementById('expense-delete-btn').addEventListener('click', onDeleteFromForm);
  document.getElementById('expense-cancel-edit-btn').addEventListener('click', onCancelEdit);
  document.querySelectorAll('#expense-person-switch button').forEach((b) => {
    b.addEventListener('click', () => { expenseForm.person = b.dataset.person; renderPersonSwitch(); });
  });

  expenseForm = blankExpenseFields();
  renderExpenseForm();
}

window.initExpenseForm = initExpenseForm;
window.renderExpenseForm = renderExpenseForm;
window.openExpenseForEdit = openExpenseForEdit;
