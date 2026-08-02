// ---- 记一笔 ----
function blankExpenseFields() {
  return {
    date: todayKey(),
    category: '',
    vendor: '',
    amount: '',
    paymentMethods: [],
    person: getIdentity(),
  };
}

let expenseForm = blankExpenseFields();
let editingExpenseId = null;

function renderExpenseForm() {
  document.getElementById('expense-date').value = expenseForm.date;
  document.getElementById('expense-vendor').value = expenseForm.vendor;
  document.getElementById('expense-amount').value = expenseForm.amount;
  renderCategoryChips();
  renderQuickVendorChips();
  renderPaymentChips();
  renderPersonSwitch();

  document.getElementById('expense-form-title').textContent = editingExpenseId ? '编辑这一笔' : '记一笔';
  document.getElementById('expense-submit-btn').textContent = editingExpenseId ? '保存修改' : '记这一笔';
  document.getElementById('expense-delete-btn').style.display = editingExpenseId ? '' : 'none';
  document.getElementById('expense-cancel-edit-btn').style.display = editingExpenseId ? '' : 'none';
}

// 消费项目是单选：点一下变色选中，再点一下取消——和支付方式、记账人是同一套
// "点击直接生效"的交互，不需要额外的确认步骤。选中的颜色跟汇总页环形图用的是
// 同一个 categoryColor()（定义在 summary.js，按分类在 settings.categories 里的
// 固定顺序取色，不是按点的顺序），两边看到的颜色永远对得上。
function renderCategoryChips() {
  const wrap = document.getElementById('expense-category-chips');
  wrap.innerHTML = '';
  (state.settings.categories || []).forEach((cat) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const active = expenseForm.category === cat.name;
    btn.className = 'chip' + (active ? ' active' : '');
    if (active) {
      const color = categoryColor(cat.name, state.settings.categories);
      btn.style.background = color;
      btn.style.borderColor = color;
      btn.style.color = '#fff';
    }
    btn.textContent = cat.name;
    btn.addEventListener('click', () => {
      expenseForm.category = expenseForm.category === cat.name ? '' : cat.name;
      renderCategoryChips();
      renderQuickVendorChips();
    });
    wrap.appendChild(btn);
  });
}

function currentCategory() {
  return (state.settings.categories || []).find((c) => c.name === expenseForm.category);
}

// 供应商同样是点一下直接生效（不是先预览再点确认那一套）：点中的常用供应商
// 变成分类的颜色，直接写进供应商栏；再点一下取消选中。栏位本身还能自由打字，
// 手动输入时下面的常用供应商都会跟着变回未选中状态。
function renderQuickVendorChips() {
  const row = document.getElementById('expense-quick-vendor-row');
  const cat = currentCategory();
  if (!cat) {
    row.style.display = 'none';
    return;
  }
  row.style.display = '';
  const color = categoryColor(cat.name, state.settings.categories);
  const currentVendor = document.getElementById('expense-vendor').value;
  const wrap = document.getElementById('expense-quick-vendor-chips');
  wrap.innerHTML = '';
  (cat.vendors || []).forEach((v) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const active = currentVendor === v;
    btn.className = 'chip quick-vendor' + (active ? ' active' : '');
    if (active) {
      btn.style.background = color;
      btn.style.borderColor = color;
      btn.style.color = '#fff';
    }
    btn.textContent = v;
    btn.addEventListener('click', () => {
      const input = document.getElementById('expense-vendor');
      input.value = input.value === v ? '' : v;
      renderQuickVendorChips();
    });
    wrap.appendChild(btn);
  });
}

// 打字新增一个消费项目类别（比如"日用品"），马上选中它，之后就一直留在候选里
function onAddCustomCategory() {
  const input = document.getElementById('expense-category-new');
  const name = input.value.trim();
  if (!name) return;
  const categories = state.settings.categories || [];
  if (!categories.some((c) => c.name === name)) {
    saveSettings({ categories: categories.concat([{ name, vendors: [] }]) });
  }
  expenseForm.category = name;
  input.value = '';
  renderCategoryChips();
  renderQuickVendorChips();
}

// 供应商栏本身就是"打字新增"那个输入框，不再有第二个重复的输入框——打的字
// 本来就是供应商的真实值（提交时直接读这里），点 + 只是顺手把它加进这个类别的
// 常用供应商列表，方便以后同类别记账一点就填，不点 + 也完全不影响这一笔的提交。
function onAddQuickVendor() {
  const input = document.getElementById('expense-vendor');
  const name = input.value.trim();
  const cat = currentCategory();
  if (!name || !cat) return;
  if (cat.vendors.includes(name)) return;
  const categories = (state.settings.categories || []).map((c) =>
    c.name === cat.name ? Object.assign({}, c, { vendors: c.vendors.concat([name]) }) : c
  );
  saveSettings({ categories });
  renderQuickVendorChips();
  showToast(`已加入常用供应商：${name}`);
}

function renderPaymentChips() {
  const wrap = document.getElementById('expense-payment-chips');
  wrap.innerHTML = '';
  (state.settings.paymentMethods || []).forEach((m) => {
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
  updatePaymentPreview();
}

function updatePaymentPreview() {
  const el = document.getElementById('expense-payment-preview');
  el.textContent = expenseForm.paymentMethods.length ? `已选：${expenseForm.paymentMethods.join('、')}` : '';
}

function renderPersonSwitch() {
  document.querySelectorAll('#expense-person-switch button').forEach((b) => {
    b.classList.toggle('active', b.dataset.person === expenseForm.person);
  });
}

// 支付方式支持多选组合，也支持随手打字新增——新方式会同时存进 settings，
// 下次记账、以及 MORI 那台设备同步后，都能在候选里直接选到。
function onAddCustomPaymentMethod() {
  const input = document.getElementById('expense-payment-new');
  const name = input.value.trim();
  if (!name) return;
  if (!state.settings.paymentMethods.includes(name)) {
    const methods = state.settings.paymentMethods.concat([name]);
    saveSettings({ paymentMethods: methods });
  }
  if (!expenseForm.paymentMethods.includes(name)) expenseForm.paymentMethods.push(name);
  input.value = '';
  renderPaymentChips();
}

function onSubmitExpense(e) {
  e.preventDefault();
  const date = document.getElementById('expense-date').value || todayKey();
  const vendor = document.getElementById('expense-vendor').value.trim();
  const amount = evalCalExpr(document.getElementById('expense-amount').value);
  if (amount === null || amount <= 0) {
    showToast('金额没填对');
    return;
  }
  const fields = {
    date,
    category: expenseForm.category,
    vendor,
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

  // 日期、记账人、消费项目多半连续几笔都一样，保留下来，其余清空方便连续记账
  const keepDate = fields.date;
  const keepPerson = fields.person;
  const keepCategory = fields.category;
  editingExpenseId = null;
  expenseForm = Object.assign(blankExpenseFields(), { date: keepDate, person: keepPerson, category: keepCategory });
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

// 供 history.js 调用：点开一条历史记录，进入编辑模式。
// 消费项目和项目说明现在是同一件事，老记录里如果两个字段都有值（改这个功能之前
// 记的），编辑时把项目说明并进供应商栏，不会丢内容。
function openExpenseForEdit(id) {
  const record = state.records.find((r) => r.id === id);
  if (!record) return;
  editingExpenseId = id;
  const mergedVendor = record.description ? `${record.vendor} ${record.description}`.trim() : record.vendor;
  expenseForm = {
    date: record.date,
    category: record.category || '',
    vendor: mergedVendor,
    amount: String(record.amount),
    paymentMethods: (record.paymentMethods || []).slice(),
    person: record.person,
  };
  switchView('expense');
}

function initExpenseForm() {
  document.getElementById('expense-form').addEventListener('submit', onSubmitExpense);
  document.getElementById('expense-category-add-btn').addEventListener('click', onAddCustomCategory);
  document.getElementById('expense-quick-vendor-add-btn').addEventListener('click', onAddQuickVendor);
  // 手动打字的时候，常用供应商那排要跟着刷新选中状态（打的字如果跟某个
  // 常用供应商一样就高亮，不一样就都变回未选中）
  document.getElementById('expense-vendor').addEventListener('input', renderQuickVendorChips);
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
