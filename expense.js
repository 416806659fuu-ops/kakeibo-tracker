// ---- 记一笔 ----
function blankExpenseFields() {
  return {
    date: todayKey(),
    category: '',
    vendor: '',
    description: '',
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
  document.getElementById('expense-description').value = expenseForm.description;
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

// 消费项目是单选：先选类别，再从这个类别常用的供应商里点一个直接填进供应商栏，
// 供应商栏本身还是自由文本，点快捷项只是省得再打字。
function renderCategoryChips() {
  const wrap = document.getElementById('expense-category-chips');
  wrap.innerHTML = '';
  (state.settings.categories || []).forEach((cat) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip' + (expenseForm.category === cat.name ? ' active' : '');
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

function renderQuickVendorChips() {
  const row = document.getElementById('expense-quick-vendor-row');
  const cat = currentCategory();
  if (!cat) {
    row.style.display = 'none';
    return;
  }
  row.style.display = '';
  const wrap = document.getElementById('expense-quick-vendor-chips');
  wrap.innerHTML = '';
  (cat.vendors || []).forEach((v) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip quick-vendor';
    btn.textContent = v;
    btn.addEventListener('click', () => {
      document.getElementById('expense-vendor').value = v;
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

// 把当前供应商栏里填的名字，加进当前类别的常用供应商列表，以后同类别记账一点就填
function onAddQuickVendor() {
  const input = document.getElementById('expense-quick-vendor-new');
  const name = input.value.trim();
  const cat = currentCategory();
  if (!name || !cat) return;
  if (!cat.vendors.includes(name)) {
    const categories = (state.settings.categories || []).map((c) =>
      c.name === cat.name ? Object.assign({}, c, { vendors: c.vendors.concat([name]) }) : c
    );
    saveSettings({ categories });
  }
  document.getElementById('expense-vendor').value = name;
  input.value = '';
  renderQuickVendorChips();
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
  const description = document.getElementById('expense-description').value.trim();
  const amount = evalCalExpr(document.getElementById('expense-amount').value);
  if (amount === null || amount <= 0) {
    showToast('金额没填对');
    return;
  }
  const fields = {
    date,
    category: expenseForm.category,
    vendor,
    description,
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

// 供 history.js 调用：点开一条历史记录，进入编辑模式
function openExpenseForEdit(id) {
  const record = state.records.find((r) => r.id === id);
  if (!record) return;
  editingExpenseId = id;
  expenseForm = {
    date: record.date,
    category: record.category || '',
    vendor: record.vendor,
    description: record.description,
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
