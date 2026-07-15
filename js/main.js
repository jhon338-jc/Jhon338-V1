/* ============================================
   JHON338 V1 - COMPLETE APPLICATION ENGINE
   IndexedDB + Encryption + Glass UI
   ============================================ */

const APP = {
  db: null,
  encryptionKey: null,
  currentPage: 'dashboard',
  balanceVisible: true,

  async init() {
    this.splashAnim();
    await this.openDB();
    await this.loadKey();
    this.bindNav();
    this.bindUI();
    this.loadPage('dashboard');
    this.hideSplash();
    document.getElementById('appWrapper').classList.add('ready');
  },

  splashAnim() {
    const bar = document.getElementById('splashProgressBar');
    if (bar) bar.style.animation = 'none';
    setTimeout(() => { if (bar) bar.style.animation = 'progressAnim 1.5s ease forwards'; }, 50);
  },

  hideSplash() {
    setTimeout(() => {
      const splash = document.getElementById('splashScreen');
      if (splash) splash.classList.add('hidden');
    }, 1600);
  },

  // ==================== DATABASE ====================
  openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('Jhon338V1', 2);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('vault')) {
          const vs = db.createObjectStore('vault', { keyPath: 'id', autoIncrement: true });
          vs.createIndex('type', 'type'); vs.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('transactions')) {
          const ts = db.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
          ts.createIndex('type', 'type'); ts.createIndex('date', 'date');
        }
        if (!db.objectStoreNames.contains('notes')) {
          const ns = db.createObjectStore('notes', { keyPath: 'id', autoIncrement: true });
          ns.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('files')) {
          const fs = db.createObjectStore('files', { keyPath: 'id', autoIncrement: true });
          fs.createIndex('name', 'name');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      req.onsuccess = (e) => { APP.db = e.target.result; resolve(); };
      req.onerror = (e) => reject(e.target.error);
    });
  },

  storePut(storeName, data) {
    return new Promise((resolve, reject) => {
      const tx = APP.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      data.createdAt = data.createdAt || new Date().toISOString();
      data.updatedAt = new Date().toISOString();
      const req = data.id ? store.put(data) : store.add(data);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  storeGetAll(storeName) {
    return new Promise((resolve, reject) => {
      const tx = APP.db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  storeDelete(storeName, id) {
    return new Promise((resolve, reject) => {
      const tx = APP.db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },

  storeClear(storeName) {
    return new Promise((resolve, reject) => {
      const tx = APP.db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },

  async settingGet(key) {
    const tx = APP.db.transaction('settings', 'readonly');
    const req = tx.objectStore('settings').get(key);
    return new Promise(r => { req.onsuccess = () => r(req.result?.value); });
  },

  async settingSet(key, value) {
    const tx = APP.db.transaction('settings', 'readwrite');
    tx.objectStore('settings').put({ key, value });
    return new Promise(r => { tx.oncomplete = () => r(); });
  },

  // ==================== ENCRYPTION ====================
  async loadKey() {
    const stored = await this.settingGet('encKey');
    if (stored) {
      const raw = Uint8Array.from(atob(stored), c => c.charCodeAt(0));
      this.encryptionKey = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    }
  },

  async setupEncryption(password) {
    const enc = new TextEncoder();
    const keyMat = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, keyMat,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
    const exported = await crypto.subtle.exportKey('raw', key);
    await this.settingSet('encKey', btoa(String.fromCharCode(...new Uint8Array(exported))));
    await this.settingSet('encSalt', btoa(String.fromCharCode(...salt)));
    this.encryptionKey = key;
    this.toast('Encryption key configured', 'ok');
  },

  async encryptData(plaintext) {
    if (!this.encryptionKey) return plaintext;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.encryptionKey, enc.encode(plaintext));
    return { iv: btoa(String.fromCharCode(...iv)), data: btoa(String.fromCharCode(...new Uint8Array(cipher))) };
  },

  async decryptData(encrypted) {
    if (!this.encryptionKey || !encrypted || typeof encrypted === 'string') return encrypted;
    try {
      const iv = Uint8Array.from(atob(encrypted.iv), c => c.charCodeAt(0));
      const data = Uint8Array.from(atob(encrypted.data), c => c.charCodeAt(0));
      const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, this.encryptionKey, data);
      return new TextDecoder().decode(dec);
    } catch { return '[Encrypted]'; }
  },

  // ==================== NAVIGATION ====================
  bindNav() {
    document.querySelectorAll('.nav-link, .bn-item').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        this.navigate(el.dataset.page);
      });
    });
    document.getElementById('menuBtn').addEventListener('click', () => this.toggleSidebar(true));
    document.getElementById('sidebarBackdrop').addEventListener('click', () => this.toggleSidebar(false));
    document.querySelectorAll('.quick-card').forEach(el => {
      el.addEventListener('click', () => this.navigate(el.dataset.nav));
    });
    window.addEventListener('hashchange', () => {
      const page = location.hash.replace('#', '') || 'dashboard';
      this.navigate(page, false);
    });
    const initPage = location.hash.replace('#', '') || 'dashboard';
    this.navigate(initPage, false);
  },

  navigate(page, updateHash = true) {
    this.currentPage = page;
    document.querySelectorAll('.nav-link, .bn-item').forEach(el => el.classList.toggle('active', el.dataset.page === page));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(page + '-page');
    if (target) target.classList.add('active');
    document.getElementById('pageTitle').textContent = page.charAt(0).toUpperCase() + page.slice(1);
    if (updateHash) location.hash = page;
    this.loadPageData(page);
    this.toggleSidebar(false);
    if (window.innerWidth < 1024) document.getElementById('sidebar').classList.remove('open');
  },

  toggleSidebar(show) {
    document.getElementById('sidebar').classList.toggle('open', show);
  },

  loadPageData(page) {
    if (page === 'dashboard') this.loadDashboard();
    if (page === 'vault') this.renderVault();
    if (page === 'finance') { this.renderTransactions(); this.updateBalance(); }
    if (page === 'notes') this.renderNotes();
    if (page === 'files') this.renderFiles();
  },

  // ==================== UI BINDINGS ====================
  bindUI() {
    document.getElementById('searchBtn').addEventListener('click', () => {
      document.getElementById('searchPanel').classList.toggle('active');
    });
    document.getElementById('searchCancel').addEventListener('click', () => {
      document.getElementById('searchPanel').classList.remove('active');
    });
    document.getElementById('fabBtn').addEventListener('click', () => this.fabAction());
    document.getElementById('showVaultForm').addEventListener('click', () => {
      document.getElementById('vaultFormWrap').style.display = 'block';
    });
    document.getElementById('cancelVault').addEventListener('click', () => {
      document.getElementById('vaultFormWrap').style.display = 'none';
    });
    document.getElementById('saveVault').addEventListener('click', () => this.saveVaultItem());
    document.getElementById('saveTx').addEventListener('click', () => this.saveTransaction());
    document.getElementById('showNoteForm').addEventListener('click', () => {
      document.getElementById('noteFormWrap').style.display = 'block';
    });
    document.getElementById('cancelNote').addEventListener('click', () => {
      document.getElementById('noteFormWrap').style.display = 'none';
    });
    document.getElementById('saveNote').addEventListener('click', () => this.saveNote());
    document.getElementById('triggerFileUpload').addEventListener('click', () => {
      document.getElementById('fileUploadInput').click();
    });
    document.getElementById('fileUploadInput').addEventListener('change', (e) => this.handleFileUpload(e));
    document.getElementById('toggleBalance').addEventListener('click', () => this.toggleBalance());
    document.getElementById('exportData').addEventListener('click', () => this.exportAll());
    document.getElementById('importData').addEventListener('click', () => {
      document.getElementById('importFileInput').click();
    });
    document.getElementById('importFileInput').addEventListener('change', (e) => this.importAll(e));
    document.getElementById('clearAll').addEventListener('click', () => this.confirmClear());
    document.getElementById('setupEncryption').addEventListener('click', () => this.promptEncryption());
  },

  fabAction() {
    const page = this.currentPage;
    if (page === 'vault') document.getElementById('showVaultForm').click();
    else if (page === 'finance') document.getElementById('txAmount').focus();
    else if (page === 'notes') document.getElementById('showNoteForm').click();
    else if (page === 'files') document.getElementById('triggerFileUpload').click();
    else this.navigate('vault');
  },

  // ==================== DASHBOARD ====================
  async loadDashboard() {
    const vault = await this.storeGetAll('vault');
    const notes = await this.storeGetAll('notes');
    const txs = await this.storeGetAll('transactions');
    const files = await this.storeGetAll('files');
    document.getElementById('dashTotalItems').textContent = vault.length + notes.length + txs.length + files.length;
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      document.getElementById('dashStorage').textContent = (est.usage / 1024 / 1024).toFixed(1) + ' MB';
    }
  },

  // ==================== VAULT ====================
  async saveVaultItem() {
    const title = document.getElementById('vTitle').value.trim();
    const type = document.getElementById('vType').value;
    const url = document.getElementById('vUrl').value.trim();
    const content = document.getElementById('vContent').value.trim();
    const password = document.getElementById('vPassword').value;
    if (!title || !type || !content) return this.toast('Title, type, and content required', 'warn');

    let encryptedContent = content;
    if (password) {
      const enc = await this.encryptData(content);
      encryptedContent = JSON.stringify(enc);
    }

    await this.storePut('vault', { title, type, url, content: encryptedContent, encrypted: !!password });
    document.getElementById('vTitle').value = '';
    document.getElementById('vContent').value = '';
    document.getElementById('vPassword').value = '';
    document.getElementById('vaultFormWrap').style.display = 'none';
    this.renderVault();
    this.toast('Item saved to vault', 'ok');
  },

  async renderVault() {
    const items = await this.storeGetAll('vault');
    const list = document.getElementById('vaultList');
    if (!items.length) { list.innerHTML = '<p class="empty-msg">Vault is empty</p>'; return; }
    list.innerHTML = items.map(i => `
      <div class="glass-card" style="padding:var(--space-3);">
        <div style="display:flex;justify-content:space-between;align-items:start;">
          <div>
            <strong style="font-size:var(--font-sm);">${this.esc(i.title)}</strong>
            <span style="display:block;font-size:var(--font-xs);color:var(--text-muted);">${i.type}</span>
            ${i.url ? `<a href="${this.esc(i.url)}" target="_blank" style="font-size:var(--font-xs);color:var(--primary-400);">Open link</a>` : ''}
          </div>
          <button class="icon-btn-sm" onclick="APP.deleteVault(${i.id})" title="Delete">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
    `).join('');
  },

  async deleteVault(id) {
    await this.storeDelete('vault', id);
    this.renderVault();
    this.toast('Item deleted', 'ok');
  },

  // ==================== FINANCE ====================
  async saveTransaction() {
    const type = document.getElementById('txType').value;
    const amount = parseFloat(document.getElementById('txAmount').value);
    const desc = document.getElementById('txDesc').value.trim();
    const category = document.getElementById('txCategory').value;
    const date = document.getElementById('txDate').value || new Date().toISOString().split('T')[0];
    if (!amount || amount <= 0) return this.toast('Enter valid amount', 'warn');
    await this.storePut('transactions', { type, amount, description: desc, category, date });
    document.getElementById('txAmount').value = '';
    document.getElementById('txDesc').value = '';
    this.renderTransactions();
    this.updateBalance();
    this.toast('Transaction saved', 'ok');
  },

  async renderTransactions() {
    const txs = await this.storeGetAll('transactions');
    txs.sort((a, b) => new Date(b.date) - new Date(a.date));
    const list = document.getElementById('txList');
    if (!txs.length) { list.innerHTML = '<p class="empty-msg">No transactions</p>'; return; }
    list.innerHTML = txs.map(t => `
      <div class="glass-card" style="padding:var(--space-3);display:flex;justify-content:space-between;align-items:center;">
        <div>
          <span style="font-size:var(--font-sm);font-weight:600;">${this.esc(t.description || t.category || t.type)}</span>
          <span style="display:block;font-size:var(--font-xs);color:var(--text-muted);">${t.date} - ${t.category}</span>
        </div>
        <div style="text-align:right;">
          <span style="font-weight:700;color:${t.type==='income'?'var(--text-green)':'var(--text-red)'};">
            ${t.type==='income'?'+':'-'}Rp ${t.amount.toLocaleString()}
          </span>
          <button class="icon-btn-sm" onclick="APP.deleteTx(${t.id})" title="Delete" style="display:block;margin-left:auto;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
    `).join('');
  },

  async deleteTx(id) {
    await this.storeDelete('transactions', id);
    this.renderTransactions();
    this.updateBalance();
    this.toast('Transaction deleted', 'ok');
  },

  async updateBalance() {
    const txs = await this.storeGetAll('transactions');
    const income = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const balance = income - expense;
    document.getElementById('totalIncome').textContent = 'Rp ' + income.toLocaleString();
    document.getElementById('totalExpense').textContent = 'Rp ' + expense.toLocaleString();
    if (this.balanceVisible) {
      document.getElementById('totalBalance').textContent = 'Rp ' + balance.toLocaleString();
    }
    const change = income > 0 ? ((income - expense) / income * 100).toFixed(1) : '0';
    document.getElementById('balanceChange').textContent = (balance >= 0 ? '+' : '') + change + '% this month';
    document.getElementById('balanceChange').className = 'balance-change ' + (balance >= 0 ? 'text-green' : 'text-red');
  },

  toggleBalance() {
    this.balanceVisible = !this.balanceVisible;
    document.getElementById('totalBalance').textContent = this.balanceVisible ? 'Rp ' + 
      (() => { /* recalc */ return document.getElementById('totalBalance').textContent; })() : 'Rp ••••••••';
    this.updateBalance();
  },

  // ==================== NOTES ====================
  async saveNote() {
    const title = document.getElementById('noteTitle').value.trim();
    const content = document.getElementById('noteContent').value.trim();
    if (!title || !content) return this.toast('Title and content required', 'warn');
    await this.storePut('notes', { title, content });
    document.getElementById('noteTitle').value = '';
    document.getElementById('noteContent').value = '';
    document.getElementById('noteFormWrap').style.display = 'none';
    this.renderNotes();
    this.toast('Note saved', 'ok');
  },

  async renderNotes() {
    const notes = await this.storeGetAll('notes');
    notes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const list = document.getElementById('notesList');
    if (!notes.length) { list.innerHTML = '<p class="empty-msg">No notes</p>'; return; }
    list.innerHTML = notes.map(n => `
      <div class="glass-card" style="padding:var(--space-3);">
        <div style="display:flex;justify-content:space-between;align-items:start;">
          <div>
            <strong style="font-size:var(--font-sm);">${this.esc(n.title)}</strong>
            <p style="font-size:var(--font-xs);color:var(--text-muted);margin-top:4px;">${this.esc(n.content.substring(0, 100))}${n.content.length>100?'...':''}</p>
          </div>
          <button class="icon-btn-sm" onclick="APP.deleteNote(${n.id})" title="Delete">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
    `).join('');
  },

  async deleteNote(id) {
    await this.storeDelete('notes', id);
    this.renderNotes();
    this.toast('Note deleted', 'ok');
  },

  // ==================== FILES ====================
  async handleFileUpload(e) {
    const files = e.target.files;
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = async () => {
        await this.storePut('files', {
          name: file.name,
          type: file.type,
          size: file.size,
          data: reader.result,
        });
        this.renderFiles();
        this.toast('File uploaded', 'ok');
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  },

  async renderFiles() {
    const files = await this.storeGetAll('files');
    const grid = document.getElementById('filesGrid');
    if (!files.length) { grid.innerHTML = '<p class="empty-msg">No files</p>'; return; }
    grid.innerHTML = files.map(f => `
      <div class="glass-card" style="padding:var(--space-3);text-align:center;">
        <p style="font-size:var(--font-xs);word-break:break-all;margin-bottom:var(--space-2);">${this.esc(f.name)}</p>
        <span style="font-size:10px;color:var(--text-muted);">${(f.size/1024).toFixed(1)} KB</span>
        <button class="btn btn-ghost btn-sm" onclick="APP.deleteFile(${f.id})" style="margin-top:var(--space-2);">Delete</button>
      </div>
    `).join('');
  },

  async deleteFile(id) {
    await this.storeDelete('files', id);
    this.renderFiles();
    this.toast('File deleted', 'ok');
  },

  // ==================== SETTINGS ====================
  async exportAll() {
    const data = {
      vault: await this.storeGetAll('vault'),
      transactions: await this.storeGetAll('transactions'),
      notes: await this.storeGetAll('notes'),
      settings: await this.storeGetAll('settings'),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'jhon338-backup-' + Date.now() + '.json';
    a.click();
    this.toast('Backup exported', 'ok');
  },

  async importAll(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result);
        for (const item of data.vault || []) await this.storePut('vault', item);
        for (const item of data.transactions || []) await this.storePut('transactions', item);
        for (const item of data.notes || []) await this.storePut('notes', item);
        this.toast('Data imported successfully', 'ok');
        this.loadPageData(this.currentPage);
      } catch { this.toast('Invalid backup file', 'err'); }
    };
    reader.readAsText(file);
    e.target.value = '';
  },

  async confirmClear() {
    this.showModal(`
      <h3 style="margin-bottom:12px;">Clear All Data?</h3>
      <p style="font-size:var(--font-sm);color:var(--text-muted);margin-bottom:16px;">This action cannot be undone.</p>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-danger" id="confirmClearBtn">Yes, Clear All</button>
        <button class="btn btn-ghost" id="cancelClearBtn">Cancel</button>
      </div>
    `);
    document.getElementById('confirmClearBtn').addEventListener('click', async () => {
      await this.storeClear('vault');
      await this.storeClear('transactions');
      await this.storeClear('notes');
      await this.storeClear('files');
      this.closeModal();
      this.loadPageData(this.currentPage);
      this.toast('All data cleared', 'warn');
    });
    document.getElementById('cancelClearBtn').addEventListener('click', () => this.closeModal());
  },

  async promptEncryption() {
    this.showModal(`
      <h3 style="margin-bottom:12px;">Setup Encryption Key</h3>
      <input type="password" class="glass-input" id="encPassInput" placeholder="Enter master password" style="margin-bottom:12px;">
      <div style="display:flex;gap:8px;">
        <button class="btn btn-primary" id="saveEncBtn">Save Key</button>
        <button class="btn btn-ghost" id="cancelEncBtn">Cancel</button>
      </div>
    `);
    document.getElementById('saveEncBtn').addEventListener('click', async () => {
      const pass = document.getElementById('encPassInput').value;
      if (pass.length < 6) return this.toast('Password too short (min 6)', 'warn');
      await this.setupEncryption(pass);
      this.closeModal();
    });
    document.getElementById('cancelEncBtn').addEventListener('click', () => this.closeModal());
  },

  // ==================== UTILS ====================
  esc(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  toast(msg, type = 'ok') {
    const zone = document.getElementById('toastZone');
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    zone.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  },

  showModal(html) {
    document.getElementById('modalPanel').innerHTML = html;
    document.getElementById('modalOverlay').style.display = 'flex';
  },

  closeModal() {
    document.getElementById('modalOverlay').style.display = 'none';
  }
};

document.addEventListener('DOMContentLoaded', () => APP.init());
document.getElementById('modalOverlay').addEventListener('click', function(e) {
  if (e.target === this) APP.closeModal();
});