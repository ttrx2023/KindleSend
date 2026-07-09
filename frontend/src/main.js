let allBooks = [];
let currentFilter = 'ALL';
let sortField = 'modTime';
let sortDirection = 'desc';
let globalConfig = {
    senderEmail: '',
    senderPass: '',
    targetKindle: '',
    downloadPath: 'D:\\Downloads',
    searchUrl: 'https://www.google.com/search?q=%s',
    smtpServer: 'smtp.qq.com',
    smtpPort: 465,
    smtpTestPort: 587,
};

let isSending = false;

function getElement(id) {
    return document.getElementById(id);
}

function normalizeSettingsResult(result) {
    if (Array.isArray(result)) {
        return {
            config: { ...globalConfig, ...(result[0] || {}) },
            isFirstRun: Boolean(result[1]),
        };
    }

    if (result && typeof result === 'object' && result.config !== undefined) {
        return {
            config: { ...globalConfig, ...(result.config || {}) },
            isFirstRun: Boolean(result.isFirstRun),
        };
    }

    const config = { ...globalConfig, ...(result || {}) };
    return {
        config,
        isFirstRun: !config.senderEmail,
    };
}

function init() {
    if (window.runtime && window.runtime.EventsOn) {
        window.runtime.EventsOn('send-progress', handleSendProgress);
    }

    getElement('query').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            searchBook();
        }
    });

    if (!window.go || !window.go.main || !window.go.main.App) {
        showLog('❌ Wails 后端接口未就绪');
        return;
    }

    window.go.main.App.GetSettings()
        .then((result) => {
            const { config, isFirstRun } = normalizeSettingsResult(result);
            globalConfig = config;
            updateSettingsUI(globalConfig);
            if (isFirstRun) {
                openSettings();
            } else {
                loadFiles();
            }
        })
        .catch((err) => showLog(`❌ 初始化失败: ${escapeHtml(err.message || String(err))}`));
}

function sortBooks(field) {
    if (sortField === field) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        sortField = field;
        sortDirection = 'desc';
    }
    renderTable();
}

function getSortIcon(field) {
    if (sortField !== field) return '↕';
    return sortDirection === 'asc' ? '↑' : '↓';
}

function parseSize(sizeStr) {
    if (!sizeStr) return 0;
    const units = { B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 };
    const match = sizeStr.match(/([\d.]+)\s*([A-Z]+)/);
    if (!match) return 0;
    return Number.parseFloat(match[1]) * (units[match[2]] || 1);
}

function handleSendProgress(event) {
    const container = getElement('progress-container');
    const title = getElement('progress-title');
    const count = getElement('progress-count');
    const logs = getElement('progress-logs');

    const circle = document.querySelector('.progress-ring .progress');
    if (circle && event.progressPct !== undefined) {
        const radius = circle.r.baseVal.value;
        const circumference = radius * 2 * Math.PI;
        const offset = circumference - (event.progressPct / 100) * circumference;
        circle.style.strokeDasharray = `${circumference} ${circumference}`;
        circle.style.strokeDashoffset = offset;
        getElement('progress-pct-text').innerText = `${Math.round(event.progressPct)}%`;
    }

    if (event.status === 'processing') {
        isSending = true;
        container.classList.add('show');
        title.innerText = `正在发送: ${event.fileName}`;
        count.innerText = `${event.current} / ${event.total}`;

        const logItem = document.createElement('div');
        logItem.className = 'progress-log-item processing';
        logItem.id = `log-${event.current}`;
        logItem.innerText = `⏳ ${event.message}`;
        logs.appendChild(logItem);
        logs.scrollTop = logs.scrollHeight;
        return;
    }

    if (event.status === 'success') {
        updateProgressLog(event, 'success', '✅');
        count.innerText = `${event.current} / ${event.total}`;
        return;
    }

    if (event.status === 'error') {
        updateProgressLog(event, 'error', '❌');
        if (!event.total) {
            container.classList.add('show');
            title.innerText = '发送失败';
            setTimeout(() => {
                container.classList.remove('show');
                logs.innerHTML = '';
                resetSendButton();
            }, 3000);
        }
        return;
    }

    if (event.status === 'finished') {
        isSending = false;
        title.innerText = `✅ ${event.message}`;
        setTimeout(() => {
            container.classList.remove('show');
            logs.innerHTML = '';
            resetSendButton();
            document.querySelectorAll('.cb').forEach((checkbox) => {
                checkbox.checked = false;
            });
            updateSel();
        }, 3000);
    }
}

function updateProgressLog(event, className, prefix) {
    const logs = getElement('progress-logs');
    let logItem = getElement(`log-${event.current}`);
    if (!logItem) {
        logItem = document.createElement('div');
        logs.appendChild(logItem);
    }
    logItem.className = `progress-log-item ${className}`;
    logItem.innerText = `${prefix} ${event.message}`;
    logs.scrollTop = logs.scrollHeight;
}

function resetSendButton() {
    const btn = getElement('sendBtn');
    btn.disabled = false;
    btn.innerText = '🚀 发送选中书籍 (0)';
    isSending = false;

    const circle = document.querySelector('.progress-ring .progress');
    if (circle) {
        circle.style.strokeDashoffset = circle.r.baseVal.value * 2 * Math.PI;
    }
}

function updateSettingsUI(cfg) {
    getElement('cfg-sender').value = cfg.senderEmail || '';
    getElement('cfg-pass').value = cfg.senderPass || '';
    getElement('cfg-kindle').value = cfg.targetKindle || '';
    getElement('cfg-path').value = cfg.downloadPath || 'D:\\Downloads';
    getElement('cfg-url').value = cfg.searchUrl || 'https://www.google.com/search?q=%s';

    getElement('cfg-smtp-server').value = cfg.smtpServer || 'smtp.qq.com';
    getElement('cfg-smtp-port').value = cfg.smtpPort || 465;
    getElement('cfg-smtp-test-port').value = cfg.smtpTestPort || 587;

    updateConfigWarnings(cfg);
}

function updateConfigWarnings(cfg) {
    const warningsEl = getElement('account-warnings');
    if (!warningsEl) return;

    const warnings = [];
    if (!cfg.senderEmail) warnings.push('发件人邮箱未配置');
    if (!cfg.senderPass) warnings.push('邮箱授权码未配置');
    if (!cfg.targetKindle) warnings.push('Kindle 接收邮箱未配置');

    warningsEl.innerHTML = '';
    warnings.forEach((warning) => {
        const item = document.createElement('div');
        item.className = 'config-warning';
        item.innerText = `⚠️ ${warning}`;
        warningsEl.appendChild(item);
    });
}

function openSettings() {
    updateSettingsUI(globalConfig);
    document.querySelectorAll('.tab-content').forEach((content) => content.classList.remove('active'));
    document.querySelectorAll('.tab-item').forEach((tab) => tab.classList.remove('active'));
    getElement('tab-account').classList.add('active');
    document.querySelector('.tab-item').classList.add('active');
    getElement('modal-settings').classList.add('show');
}

function switchTab(tabId, el) {
    document.querySelectorAll('.tab-content').forEach((content) => content.classList.remove('active'));
    document.querySelectorAll('.tab-item').forEach((tab) => tab.classList.remove('active'));
    getElement(tabId).classList.add('active');
    el.classList.add('active');
}

function openHelp() {
    getElement('modal-help').classList.add('show');
}

function closeModal(id) {
    getElement(id).classList.remove('show');
}

function saveSettings() {
    const config = {
        senderEmail: getElement('cfg-sender').value.trim(),
        senderPass: getElement('cfg-pass').value.trim(),
        targetKindle: getElement('cfg-kindle').value.trim(),
        downloadPath: getElement('cfg-path').value.trim() || 'D:\\Downloads',
        searchUrl: getElement('cfg-url').value.trim() || 'https://www.google.com/search?q=%s',
        smtpServer: getElement('cfg-smtp-server').value.trim() || 'smtp.qq.com',
        smtpPort: readPort('cfg-smtp-port', 465),
        smtpTestPort: readPort('cfg-smtp-test-port', 587),
    };

    if (!config.senderEmail || !config.senderPass || !config.targetKindle) {
        alert('发件邮箱、授权码和 Kindle 接收邮箱不能为空');
        return;
    }

    window.go.main.App.SaveSettings(config)
        .then((res) => {
            showLog(res);
            closeModal('modal-settings');
            globalConfig = config;
            loadFiles();
        })
        .catch((err) => showLog(`❌ 保存失败: ${escapeHtml(err.message || String(err))}`));
}

function readPort(id, fallback) {
    const port = Number.parseInt(getElement(id).value, 10);
    if (Number.isInteger(port) && port > 0 && port <= 65535) {
        return port;
    }
    return fallback;
}

function searchBook() {
    const query = getElement('query').value.trim();
    if (!query) {
        showLog('⚠️ 请先输入书名');
        return;
    }
    window.go.main.App.SearchBook(query).catch((err) => showLog(`❌ 打开搜索失败: ${escapeHtml(err.message || String(err))}`));
}

function testConn() {
    window.go.main.App.TestConnection().then((res) => {
        showLog(res);
    });
}

function testConnInline() {
    const btn = getElement('testConnBtn');
    const originalText = btn.innerText;
    btn.innerText = '⏳ 测试中...';
    btn.disabled = true;

    window.go.main.App.TestConnection()
        .then((res) => {
            btn.innerText = originalText;
            btn.disabled = false;
            showInlineTestResult(btn, res.includes('✅'));
        })
        .catch(() => {
            btn.innerText = originalText;
            btn.disabled = false;
            showInlineTestResult(btn, false);
        });
}

function showInlineTestResult(btn, success) {
    let resultEl = getElement('test-result-inline');
    if (!resultEl) {
        resultEl = document.createElement('span');
        resultEl.id = 'test-result-inline';
        resultEl.className = 'test-result';
        btn.parentNode.insertBefore(resultEl, btn.nextSibling);
    }

    resultEl.className = success ? 'test-result success' : 'test-result error';
    resultEl.innerText = success ? '✅ 连接成功' : '❌ 连接失败';

    setTimeout(() => {
        resultEl.remove();
    }, 3000);
}

function loadFiles() {
    window.go.main.App.ListBooks()
        .then((books) => {
            allBooks = books || [];
            renderTable();
            getElement('status-text').innerText = `已加载 ${allBooks.length} 个文件`;
        })
        .catch((err) => {
            allBooks = [];
            renderTable();
            getElement('status-text').innerText = '加载失败';
            showLog(`❌ 加载书籍失败: ${escapeHtml(err.message || String(err))}`);
        });
}

function renderTable() {
    const tbody = getElement('table-body');
    tbody.innerHTML = '';

    const filtered = allBooks
        .filter((book) => currentFilter === 'ALL' || book.type === currentFilter)
        .sort(compareBooks);

    document.querySelectorAll('th[data-sort]').forEach((th) => {
        th.className = sortField === th.dataset.sort ? 'sorted' : '';
        const icon = th.querySelector('.sort-icon');
        if (icon) icon.innerText = getSortIcon(th.dataset.sort);
    });

    getElement('empty-state').style.display = filtered.length === 0 ? 'block' : 'none';
    filtered.forEach((book) => tbody.appendChild(createBookRow(book)));

    const selectAllCb = getElement('selectAllCb');
    if (selectAllCb) selectAllCb.checked = false;
    updateSel();
}

function compareBooks(a, b) {
    let valA = a[sortField];
    let valB = b[sortField];

    if (sortField === 'size') {
        valA = parseSize(valA);
        valB = parseSize(valB);
    }

    if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
    if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
    return 0;
}

function createBookRow(book) {
    const tr = document.createElement('tr');
    tr.addEventListener('click', (event) => {
        if (event.target instanceof HTMLInputElement && event.target.type === 'checkbox') return;
        const cb = tr.querySelector('.cb');
        cb.checked = !cb.checked;
        updateSel();
    });

    const checkCell = document.createElement('td');
    checkCell.style.textAlign = 'center';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'cb';
    checkbox.dataset.path = book.path || '';
    checkbox.addEventListener('change', updateSel);
    checkCell.appendChild(checkbox);

    const nameCell = document.createElement('td');
    nameCell.style.fontWeight = '500';
    const safeType = sanitizeType(book.type);
    const badge = document.createElement('span');
    badge.className = `type-badge type-${safeType}`;
    badge.innerText = safeType;
    nameCell.appendChild(badge);
    nameCell.appendChild(document.createTextNode(book.name || '未命名文件'));

    const sizeCell = document.createElement('td');
    sizeCell.style.color = '#64748b';
    sizeCell.style.fontSize = '13px';
    sizeCell.innerText = book.size || '-';

    const timeCell = document.createElement('td');
    timeCell.style.color = '#64748b';
    timeCell.style.fontSize = '13px';
    timeCell.innerText = book.modTime || '-';

    tr.append(checkCell, nameCell, sizeCell, timeCell);
    return tr;
}

function sanitizeType(type) {
    const value = String(type || 'BOOK').toUpperCase();
    return /^[A-Z0-9]+$/.test(value) ? value : 'BOOK';
}

function selectAll() {
    document.querySelectorAll('.cb').forEach((checkbox) => {
        checkbox.checked = true;
    });
    updateSel();
}

function deselectAll() {
    document.querySelectorAll('.cb').forEach((checkbox) => {
        checkbox.checked = false;
    });
    updateSel();
}

function invertSelection() {
    document.querySelectorAll('.cb').forEach((checkbox) => {
        checkbox.checked = !checkbox.checked;
    });
    updateSel();
}

function applyFilter(type, el) {
    currentFilter = type;
    document.querySelectorAll('.filter-chip').forEach((chip) => chip.classList.remove('active'));
    el.classList.add('active');
    renderTable();
}

function toggleAll(source) {
    document.querySelectorAll('.cb').forEach((checkbox) => {
        checkbox.checked = source.checked;
    });
    updateSel();
}

function updateSel() {
    const count = document.querySelectorAll('.cb:checked').length;
    const btn = getElement('sendBtn');
    btn.innerText = `🚀 发送选中书籍 (${count})`;
    btn.disabled = count === 0 || isSending;

    const allCbs = document.querySelectorAll('.cb');
    const selectAllCb = getElement('selectAllCb');
    if (selectAllCb) selectAllCb.checked = allCbs.length > 0 && count === allCbs.length;

    document.querySelectorAll('tbody tr').forEach((row) => {
        const checkbox = row.querySelector('.cb');
        row.classList.toggle('selected', Boolean(checkbox && checkbox.checked));
    });
}

function sendFiles() {
    if (isSending) return;
    const paths = Array.from(document.querySelectorAll('.cb:checked')).map((checkbox) => checkbox.dataset.path);
    if (paths.length === 0) {
        showLog('⚠️ 请先选择要发送的书籍');
        return;
    }

    const btn = getElement('sendBtn');
    btn.disabled = true;
    btn.innerText = '⏳ 发送中...';
    isSending = true;

    getElement('progress-logs').innerHTML = '';
    const progressBar = getElement('progress-bar-fill');
    if (progressBar) progressBar.style.width = '0%';

    window.go.main.App.SendSelectedBooks(paths);
}

function showLog(html) {
    const el = getElement('log-overlay');
    el.style.display = 'block';
    el.innerHTML = html;
    setTimeout(() => {
        el.style.display = 'none';
    }, 5000);
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

window.openSettings = openSettings;
window.openHelp = openHelp;
window.closeModal = closeModal;
window.saveSettings = saveSettings;
window.searchBook = searchBook;
window.testConn = testConn;
window.loadFiles = loadFiles;
window.applyFilter = applyFilter;
window.toggleAll = toggleAll;
window.updateSel = updateSel;
window.sendFiles = sendFiles;
window.showLog = showLog;
window.handleSendProgress = handleSendProgress;
window.sortBooks = sortBooks;
window.selectAll = selectAll;
window.deselectAll = deselectAll;
window.invertSelection = invertSelection;
window.switchTab = switchTab;
window.testConnInline = testConnInline;

document.addEventListener('DOMContentLoaded', init);
