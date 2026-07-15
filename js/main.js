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
    await this.loadPage('dashboard');
    this.hideSplash();
    document.getElementById('appWrapper').classList.add('ready');
  },

  splashAnim() {
    const bar = document.getElementById('splashProgressBar');
    if (bar) {
      bar.style.animation = 'none';
      bar.offsetHeight; // Trigger reflow
      bar.style.animation = 'progressAnim 1.5s ease forwards';
    }
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
          vs.createIndex('type', 'type'); 
          vs.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('transactions')) {
          const ts = db.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
          ts.createIndex('type', 'type'); 
          ts.createIndex('date', 'date');
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
      req.onsuccess = (e) => { 
        APP.db = e.target.result; 
        resolve(); 
      };
      req.onerror = (e) => reject(e.target.error);
    });
  },

  storePut(storeName, data) {
    return new Promise((resolve, reject) => {
      const tx = APP.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const itemToSave = { ...data };
      itemToSave.createdAt = itemToSave.createdAt || new Date().toISOString();
      itemToSave.updatedAt = new Date().toISOString();
      
      const req = itemToSave.id ? store.put(itemToSave) : store.add(itemToSave);
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
    return new Promise((resolve) => {
      const tx = APP.db.transaction('settings', 'readonly');
      const req = tx.objectStore('settings').get(key);
      req.onsuccess = () => resolve(req.result?.value);
      req.onerror = () => resolve(null);
    });
  },

  async settingSet(key, value) {
    return new Promise((resolve) => {
      const tx = APP.db.transaction('settings', 'readwrite');
      tx.objectStore('settings').put({ key, value });
      tx.oncomplete = () => resolve();
    });
  },

  // ==================== ENCRYPTION ====================
  async loadKey() {
    try {
      const stored = await this.settingGet('encKey');
      if (stored) {
        const raw = Uint8Array.from(atob(stored), c => c.charCodeAt(0));
        this.encryptionKey = await crypto.subtle.importKey(
          'raw', 
          raw, 
          { name: 'AES-GCM' }, 
          false, 
          ['encrypt', 'decrypt']
        );
      }
    } catch (e) {
      console.log('Encryption key not configured');
      this.encryptionKey = null;
    }
  },

  async setupEncryption(password) {
    const enc = new TextEncoder();
    const keyMat = await crypto.subtle.importKey(
      'raw', 
      enc.encode(password), 
      'PBKDF2', 
      false, 
      ['deriveKey']
    );
    
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, 
      keyMat,
      { name: 'AES-GCM', length: 256 }, 
      false, 
      ['encrypt', 'decrypt']
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
    const cipher = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, 
      this.encryptionKey, 
      enc.encode(plaintext)
    );
    return { 
      iv: btoa(String.fromCharCode(...iv)), 
      data: btoa(String.fromCharCode(...new Uint8Array(cipher))) 
    };
  },

  async decryptData(encrypted) {
    if (!this.encryptionKey || !encrypted || typeof encrypted === 'string') return encrypted;
    try {
      const iv = Uint8Array.from(atob(encrypted.iv), c => c.charCodeAt(0));
      const data = Uint8Array.from(atob(encrypted.data), c => c.charCodeAt(0));
      const dec = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv }, 
        this.encryptionKey, 
        data
      );
      return new TextDecoder().decode(dec);
    } catch { 
      return '[Encrypted]'; 
    }
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
    if (!page) return;
    
    this.currentPage = page;
    
    document.querySelectorAll('.nav-link, .bn-item').forEach(el => {
      el.classList.toggle('active', el.dataset.page === page);
    });
    
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    
    const target = document.getElementById(page + '-page');
    if (target) {
      target.classList.add('active');
    }
    
    const pageTitle = document.getElementById('pageTitle');
    if (pageTitle) {
      pageTitle.textContent = page.charAt(0).toUpperCase() + page.slice(1);
    }
    
    if (updateHash) {
      location.hash = page;
    }
    
    this.loadPageData(page);
    this.toggleSidebar(false);
    
    if (window.innerWidth < 1024) {
      document.getElementById('sidebar').classList.remove('open');
    }
  },

  toggleSidebar(show) {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
      if (show === undefined) {
        sidebar.classList.toggle('open');
      } else {
        sidebar.classList.toggle('open', show);
      }
    }
  },

  async loadPageData(page) {
    switch(page) {
      case 'dashboard': 
        await this.loadDashboard(); 
        break;
      case 'vault': 
        await this.renderVault(); 
        break;
      case 'finance': 
        await this.renderTransactions(); 
        await this.updateBalance(); 
        break;
      case 'notes': 
        await this.renderNotes(); 
        break;
      case 'files': 
        await this.renderFiles(); 
        break;
    }
  },

  // ==================== UI BINDINGS ====================
  bindUI() {
    // Search
    document.getElementById('searchBtn').addEventListener('click', () => {
      document.getElementById('searchPanel').classList.toggle('active');
    });
    
    document.getElementById('searchCancel').addEventListener('click', () => {
      document.getElementById('searchPanel').classList.remove('active');
    });
    
    // FAB
    document.getElementById('fabBtn').addEventListener('click', () => this.fabAction());
    
    // Vault
    document.getElementById('showVaultForm').addEventListener('click', () => {
      document.getElementById('vaultFormWrap').style.display = 'block';
    });
    
    document.getElementById('cancelVault').addEventListener('click', () => {
      document.getElementById('vaultFormWrap').style.display = 'none';
    });
    
    document.getElementById('saveVault').addEventListener('click', () => this.saveVaultItem());
    
    // Finance
    document.getElementById('saveTx').addEventListener('click', () => this.saveTransaction());
    
    // Notes
    document.getElementById('showNoteForm').addEventListener('click', () => {
      document.getElementById('noteFormWrap').style.display = 'block';
    });
    
    document.getElementById('cancelNote').addEventListener('click', () => {
      document.getElementById('noteFormWrap').style.display = 'none';
    });
    
    document.getElementById('saveNote').addEventListener('click', () => this.saveNote());
    
    // Files
    document.getElementById('triggerFileUpload').addEventListener('click', () => {
      document.getElementById('fileUploadInput').click();
    });
    
    document.getElementById('fileUploadInput').addEventListener('change', (e) => this.handleFileUpload(e));
    
    // Balance toggle
    document.getElementById('toggleBalance').addEventListener('click', () => this.toggleBalance());
    
    // Export/Import
    document.getElementById('exportData').addEventListener('click', () => this.exportAll());
    
    document.getElementById('importData').addEventListener('click', () => {
      document.getElementById('importFileInput').click();
    });
    
    document.getElementById('importFileInput').addEventListener('change', (e) => this.importAll(e));
    
    // Clear all
    document.getElementById('clearAll').addEventListener('click', () => this.confirmClear());
    
    // Encryption setup
    document.getElementById('setupEncryption').addEventListener('click', () => this.promptEncryption());
    
    // Theme toggle
    document.getElementById('themeSelect').addEventListener('change', (e) => {
      document.documentElement.setAttribute('data-theme', e.target.value);
    });
  },

  fabAction() {
    const page = this.currentPage;
    switch(page) {
      case 'vault':
        document.getElementById('showVaultForm').click();
        break;
      case 'finance':
        document.getElementById('txAmount').focus();
        break;
      case 'notes':
        document.getElementById('showNoteForm').click();
        break;
      case 'files':
        document.getElementById('triggerFileUpload').click();
        break;
      default:
        this.navigate('vault');
    }
  },

  // ==================== DASHBOARD ====================
  async loadDashboard() {
    try {
      const vault = await this.storeGetAll('vault');
      const notes = await this.storeGetAll('notes');
      const txs = await this.storeGetAll('transactions');
      const files = await this.storeGetAll('files');
      
      const totalItems = vault.length + notes.length + txs.length + files.length;
      document.getElementById('dashTotalItems').textContent = totalItems;
      
      if (navigator.storage?.estimate) {
        const est = await navigator.storage.estimate();
        const usageMB = (est.usage / 1024 / 1024).toFixed(1);
        document.getElementById('dashStorage').textContent = usageMB + ' MB';
      }
      
      // Update activity feed
      const activity = [];
      txs.slice(-3).forEach(t => {
        activity.push(`${t.type === 'income' ? '💰 Income' : '💸 Expense'}: Rp ${t.amount.toLocaleString()}`);
      });
      notes.slice(-2).forEach(n => {
        activity.push(`📝 Note: ${n.title}`);
      });
      
      const feed = document.getElementById('activityFeed');
      if (feed) {
        if (activity.length) {
          feed.innerHTML = activity.map(a => `<div style="padding:8px;font-size:var(--font-sm);">${a}</div>`).join('');
        } else {
          feed.innerHTML = '<p class="empty-msg">No recent activity</p>';
        }
      }
    } catch (e) {
      console.error('Dashboard load error:', e);
    }
  },

  // ==================== VAULT ====================
  async saveVaultItem() {
    const title = document.getElementById('vTitle').value.trim();
    const type = document.getElementById('vType').value;
    const url = document.getElementById('vUrl').value.trim();
    const content = document.getElementById('vContent').value.trim();
    const password = document.getElementById('vPassword').value;
    
    if (!title || !type || !content) {
      return this.toast('Title, type, and content required', 'warn');
    }

    let finalContent = content;
    if (password) {
      const enc = await this.encryptData(content);
      finalContent = JSON.stringify(enc);
    }

    await this.storePut('vault', { 
      title, 
      type, 
      url, 
      content: finalContent, 
      encrypted: !!password 
    });
    
    document.getElementById('vTitle').value = '';
    document.getElementById('vContent').value = '';
    document.getElementById('vPassword').value = '';
    document.getElementById('vUrl').value = '';
    document.getElementById('vaultFormWrap').style.display = 'none';
    
    await this.renderVault();
    this.toast('Item saved to vault', 'ok');
  },

  async renderVault() {
    const items = await this.storeGetAll('vault');
    const list = document.getElementById('vaultList');
    
    if (!items.length) { 
      list.innerHTML = '<p class="empty-msg">Vault is empty</p>'; 
      return; 
    }
    
    list.innerHTML = items.map(i => `
      <div class="glass-card" style="padding:var(--space-3);">
        <div style="display:flex;justify-content:space-between;align-items:start;">
          <div>
            <strong style="font-size:var(--font-sm);">${this.esc(i.title)}</strong>
            <span style="display:block;font-size:var(--font-xs);color:var(--text-muted);">${i.type}${i.encrypted ? ' 🔒' : ''}</span>
            ${i.url ? `<a href="${this.esc(i.url)}" target="_blank" rel="noopener" style="font-size:var(--font-xs);color:var(--primary-400);">Open link</a>` : ''}
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
    await this.renderVault();
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
    if (!desc) return this.toast('Enter description', 'warn');
    
    await this.storePut('transactions', { 
      type, 
      amount, 
      description: desc, 
      category: category || 'other', 
      date 
    });
    
    document.getElementById('txAmount').value = '';
    document.getElementById('txDesc').value = '';
    
    await this.renderTransactions();
    await this.updateBalance();
    this.toast('Transaction saved', 'ok');
  },

  async renderTransactions() {
    const txs = await this.storeGetAll('transactions');
    txs.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    const list = document.getElementById('txList');
    if (!txs.length) { 
      list.innerHTML = '<p class="empty-msg">No transactions</p>'; 
      return; 
    }
    
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
    await this.renderTransactions();
    await this.updateBalance();
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
    } else {
      document.getElementById('totalBalance').textContent = 'Rp ••••••••';
    }
    
    const change = income > 0 ? ((income - expense) / income * 100).toFixed(1) : '0';
    document.getElementById('balanceChange').textContent = (balance >= 0 ? '+' : '') + change + '% this month';
    
    const balanceChangeEl = document.getElementById('balanceChange');
    balanceChangeEl.className = 'balance-change';
    if (balance >= 0) {
      balanceChangeEl.classList.add('text-green');
    } else {
      balanceChangeEl.classList.add('text-red');
    }
  },

  toggleBalance() {
    this.balanceVisible = !this.balanceVisible;
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
    
    await this.renderNotes();
    this.toast('Note saved', 'ok');
  },

  async renderNotes() {
    const notes = await this.storeGetAll('notes');
    notes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    const list = document.getElementById('notesList');
    if (!notes.length) { 
      list.innerHTML = '<p class="empty-msg">No notes</p>'; 
      return; 
    }
    
    list.innerHTML = notes.map(n => `
      <div class="glass-card" style="padding:var(--space-3);">
        <div style="display:flex;justify-content:space-between;align-items:start;">
          <div>
            <strong style="font-size:var(--font-sm);">${this.esc(n.title)}</strong>
            <p style="font-size:var(--font-xs);color:var(--text-muted);margin-top:4px;">${this.esc(n.content.substring(0, 100))}${n.content.length>100?'...':''}</p>
            <span style="font-size:10px;color:var(--text-muted);">${new Date(n.createdAt).toLocaleDateString()}</span>
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
    await this.renderNotes();
    this.toast('Note deleted', 'ok');
  },

  // ==================== FILES ====================
  async handleFileUpload(e) {
    const files = e.target.files;
    if (!files.length) return;
    
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = async () => {
        await this.storePut('files', {
          name: file.name,
          type: file.type,
          size: file.size,
          data: reader.result,
        });
        await this.renderFiles();
        this.toast('File uploaded', 'ok');
      };
      reader.onerror = () => {
        this.toast('Error uploading file', 'err');
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  },

  async renderFiles() {
    const files = await this.storeGetAll('files');
    const grid = document.getElementById('filesGrid');
    
    if (!files.length) { 
      grid.innerHTML = '<p class="empty-msg">No files</p>'; 
      return; 
    }
    
    grid.innerHTML = files.map(f => `
      <div class="glass-card" style="padding:var(--space-3);text-align:center;">
        <div style="font-size:2rem;margin-bottom:8px;">${this.getFileIcon(f.type)}</div>
        <p style="font-size:var(--font-xs);word-break:break-all;margin-bottom:var(--space-2);">${this.esc(f.name)}</p>
        <span style="font-size:10px;color:var(--text-muted);">${(f.size/1024).toFixed(1)} KB</span>
        <div style="margin-top:8px;display:flex;gap:4px;justify-content:center;">
          <a href="${f.data}" download="${f.name}" class="btn btn-ghost btn-sm">Download</a>
          <button class="btn btn-ghost btn-sm" onclick="APP.deleteFile(${f.id})">Delete</button>
        </div>
      </div>
    `).join('');
  },

  getFileIcon(type) {
    if (type.startsWith('image/')) return '🖼️';
    if (type.startsWith('video/')) return '🎬';
    if (type.startsWith('audio/')) return '🎵';
    if (type.includes('pdf')) return '📄';
    if (type.includes('document')) return '📝';
    return '📁';
  },

  async deleteFile(id) {
    await this.storeDelete('files', id);
    await this.renderFiles();
    this.toast('File deleted', 'ok');
  },

  // ==================== SETTINGS ====================
  async exportAll() {
    try {
      const data = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        vault: await this.storeGetAll('vault'),
        transactions: await this.storeGetAll('transactions'),
        notes: await this.storeGetAll('notes'),
        files: await this.storeGetAll('files'),
        settings: await this.storeGetAll('settings'),
      };
      
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'jhon338-backup-' + Date.now() + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      this.toast('Backup exported', 'ok');
    } catch (e) {
      this.toast('Export failed', 'err');
    }
  },

  async importAll(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result);
        
        if (data.vault) {
          for (const item of data.vault) await this.storePut('vault', item);
        }
        if (data.transactions) {
          for (const item of data.transactions) await this.storePut('transactions', item);
        }
        if (data.notes) {
          for (const item of data.notes) await this.storePut('notes', item);
        }
        if (data.files) {
          for (const item of data.files) await this.storePut('files', item);
        }
        
        this.toast('Data imported successfully', 'ok');
        await this.loadPageData(this.currentPage);
      } catch (e) { 
        this.toast('Invalid backup file', 'err'); 
      }
    };
    reader.onerror = () => {
      this.toast('Error reading file', 'err');
    };
    reader.readAsText(file);
    e.target.value = '';
  },

  async confirmClear() {
    this.showModal(`
      <h3 style="margin-bottom:12px;">Clear All Data?</h3>
      <p style="font-size:var(--font-sm);color:var(--text-muted);margin-bottom:16px;">This action cannot be undone. All your data will be permanently deleted.</p>
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
      await this.loadPageData(this.currentPage);
      this.toast('All data cleared', 'warn');
    });
    
    document.getElementById('cancelClearBtn').addEventListener('click', () => this.closeModal());
  },

  async promptEncryption() {
    this.showModal(`
      <h3 style="margin-bottom:12px;">Setup Encryption Key</h3>
      <p style="font-size:var(--font-sm);color:var(--text-muted);margin-bottom:12px;">Set a master password to encrypt your vault data</p>
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
    setTimeout(() => {
      if (t.parentNode) {
        t.remove();
      }
    }, 3500);
  },

  showModal(html) {
    document.getElementById('modalPanel').innerHTML = html;
    document.getElementById('modalOverlay').style.display = 'flex';
  },

  closeModal() {
    document.getElementById('modalOverlay').style.display = 'none';
  }
};

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  APP.init().catch(err => {
    console.error('App initialization error:', err);
  });
});

// Close modal on overlay click
document.getElementById('modalOverlay').addEventListener('click', function(e) {
  if (e.target === this) APP.closeModal();
});