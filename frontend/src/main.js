let allBooks = [];
let currentFilter = 'ALL';
let sortField = 'modTime'; // name, size, modTime
let sortDirection = 'desc'; // asc, desc
let globalConfig = {
    senderEmail: "", senderPass: "", targetKindle: "",
    downloadPath: "D:\\Downloads", searchUrl: "https://fuckfbi.ru/s/?q=%s",
    smtpServer: "smtp.qq.com", smtpPort: 465, smtpTestPort: 587
};

// Progress state
let isSending = false;

window.onload = function() {
    // 注册进度事件监听器
    if (window.runtime && window.runtime.EventsOn) {
        window.runtime.EventsOn("send-progress", handleSendProgress);
    }

    if (window.go && window.go.main && window.go.main.App) {
        window.go.main.App.GetSettings().then((result) => {
            let config = result;
            let isFirstRun = false;

            if (Array.isArray(result)) {
                [config, isFirstRun] = result;
            } else if (result && typeof result === 'object') {
                if (result.config !== undefined) {
                    config = result.config;
                    isFirstRun = !!result.isFirstRun;
                } else if (result[0] !== undefined) {
                    config = result[0];
                    isFirstRun = !!result[1];
                }
            }

            if (config && typeof config === 'object') {
                globalConfig = config;
            }

            updateSettingsUI(globalConfig);
            if(isFirstRun) { openSettings(); } else { loadFiles(); }
        });
    }
};

// Sort function
function sortBooks(field) {
    if (sortField === field) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        sortField = field;
        sortDirection = 'desc'; // Default new sort to desc
    }
    renderTable();
}

function getSortIcon(field) {
    if (sortField !== field) return '↕';
    return sortDirection === 'asc' ? '↑' : '↓';
}

function parseSize(sizeStr) {
    if (!sizeStr) return 0;
    const units = { 'B': 1, 'KB': 1024, 'MB': 1024*1024, 'GB': 1024*1024*1024 };
    const match = sizeStr.match(/([\d.]+)\s*([A-Z]+)/);
    if (!match) return 0;
    return parseFloat(match[1]) * (units[match[2]] || 1);
}

// 处理发送进度事件
function handleSendProgress(event) {
    const container = document.getElementById('progress-container');
    const title = document.getElementById('progress-title');
    const count = document.getElementById('progress-count');
    const logs = document.getElementById('progress-logs');

    // Update Ring
    const circle = document.querySelector('.progress-ring .progress');
    const radius = circle.r.baseVal.value;
    const circumference = radius * 2 * Math.PI;
    const offset = circumference - (event.progressPct / 100) * circumference;
    circle.style.strokeDasharray = `${circumference} ${circumference}`;
    circle.style.strokeDashoffset = offset;

    document.getElementById('progress-pct-text').innerText = Math.round(event.progressPct) + '%';

    if (event.status === 'processing') {
        isSending = true;
        container.classList.add('show');
        title.innerText = '正在发送: ' + event.fileName;
        count.innerText = event.current + ' / ' + event.total;

        // 添加处理中日志
        const logItem = document.createElement('div');
        logItem.className = 'progress-log-item processing';
        logItem.id = 'log-' + event.current;
        logItem.innerText = '⏳ ' + event.message;
        logs.appendChild(logItem);
        logs.scrollTop = logs.scrollHeight;
    }
    else if (event.status === 'success') {
        // 更新对应日志条目
        const logItem = document.getElementById('log-' + event.current);
        if (logItem) {
            logItem.className = 'progress-log-item success';
            logItem.innerText = '✅ ' + event.message;
        }
        count.innerText = event.current + ' / ' + event.total;
    }
    else if (event.status === 'error') {
        // 更新对应日志条目为错误状态
        let logItem = document.getElementById('log-' + event.current);
        if (logItem) {
            logItem.className = 'progress-log-item error';
            logItem.innerText = '❌ ' + event.message;
        } else {
            // 如果是初始错误（无文件等），直接添加
            logItem = document.createElement('div');
            logItem.className = 'progress-log-item error';
            logItem.innerText = '❌ ' + event.message;
            logs.appendChild(logItem);
        }

        // 如果是配置错误，直接显示并隐藏
        if (!event.total) {
            container.classList.add('show');
            title.innerText = '发送失败';
            setTimeout(() => {
                container.classList.remove('show');
                logs.innerHTML = '';
                resetSendButton();
            }, 3000);
        }
    }
    else if (event.status === 'finished') {
        isSending = false;
        title.innerText = '✅ ' + event.message;

        // 3秒后隐藏进度条
        setTimeout(() => {
            container.classList.remove('show');
            logs.innerHTML = '';
            resetSendButton();
            // 取消所有勾选
            document.querySelectorAll('.cb').forEach(c => c.checked = false);
            updateSel();
        }, 3000);
    }
}

function resetSendButton() {
    const btn = document.getElementById('sendBtn');
    btn.disabled = false;
    btn.innerText = '🚀 发送选中书籍 (0)';
    isSending = false;

    // Reset ring
    const circle = document.querySelector('.progress-ring .progress');
    if(circle) circle.style.strokeDashoffset = circle.r.baseVal.value * 2 * Math.PI;
}

function updateSettingsUI(cfg) {
    document.getElementById('cfg-sender').value = cfg.senderEmail || "";
    document.getElementById('cfg-pass').value = cfg.senderPass || "";
    document.getElementById('cfg-kindle').value = cfg.targetKindle || "";
    document.getElementById('cfg-path').value = cfg.downloadPath || "D:\\Downloads";
    document.getElementById('cfg-url').value = cfg.searchUrl || "https://fuckfbi.ru/s/?q=%s";

    // SMTP fields
    const smtpServer = document.getElementById('cfg-smtp-server');
    const smtpPort = document.getElementById('cfg-smtp-port');
    const smtpTestPort = document.getElementById('cfg-smtp-test-port');
    if (smtpServer) smtpServer.value = cfg.smtpServer || "smtp.qq.com";
    if (smtpPort) smtpPort.value = cfg.smtpPort || 465;
    if (smtpTestPort) smtpTestPort.value = cfg.smtpTestPort || 587;

    // Show warnings for missing required fields
    updateConfigWarnings(cfg);
}

function updateConfigWarnings(cfg) {
    const warningsEl = document.getElementById('account-warnings');
    if (!warningsEl) return;

    const warnings = [];
    if (!cfg.senderEmail) warnings.push('发件人邮箱未配置');
    if (!cfg.senderPass) warnings.push('邮箱授权码未配置');
    if (!cfg.targetKindle) warnings.push('Kindle 接收邮箱未配置');

    if (warnings.length > 0) {
        warningsEl.innerHTML = warnings.map(w => `<div class="config-warning">⚠️ ${w}</div>`).join('');
    } else {
        warningsEl.innerHTML = '';
    }
}

function updateHint(id, val) {
    const el = document.getElementById(id);
    if(val) { el.innerText = val; el.classList.remove('empty'); }
    else { el.innerText = "未设置"; el.classList.add('empty'); }
}

function openSettings() {
    updateSettingsUI(globalConfig);
    // Reset to first tab
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    const firstTab = document.getElementById('tab-account');
    const firstTabItem = document.querySelector('.tab-item');
    if (firstTab) firstTab.classList.add('active');
    if (firstTabItem) firstTabItem.classList.add('active');
    document.getElementById('modal-settings').classList.add('show');
}

function switchTab(tabId, el) {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    el.classList.add('active');
}

function openHelp() { document.getElementById('modal-help').classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

function saveSettings() {
    const smtpServerEl = document.getElementById('cfg-smtp-server');
    const smtpPortEl = document.getElementById('cfg-smtp-port');
    const smtpTestPortEl = document.getElementById('cfg-smtp-test-port');

    const config = {
        senderEmail: document.getElementById('cfg-sender').value.trim(),
        senderPass: document.getElementById('cfg-pass').value.trim(),
        targetKindle: document.getElementById('cfg-kindle').value.trim(),
        downloadPath: document.getElementById('cfg-path').value.trim(),
        searchUrl: document.getElementById('cfg-url').value.trim(),
        smtpServer: smtpServerEl ? smtpServerEl.value.trim() || "smtp.qq.com" : "smtp.qq.com",
        smtpPort: smtpPortEl ? parseInt(smtpPortEl.value) || 465 : 465,
        smtpTestPort: smtpTestPortEl ? parseInt(smtpTestPortEl.value) || 587 : 587
    };
    if(!config.senderEmail || !config.senderPass) { alert("邮箱信息不能为空"); return; }
    window.go.main.App.SaveSettings(config).then(res => {
        showLog(res); closeModal('modal-settings'); globalConfig = config; loadFiles();
    });
}

function searchBook() { const q=document.getElementById('query').value; if(q) window.go.main.App.SearchBook(q); }
function testConn() { window.go.main.App.TestConnection().then(res => { showLog(res); }); }

function testConnInline() {
    const btn = document.getElementById('testConnBtn');
    const originalText = btn.innerText;
    btn.innerText = '⏳ 测试中...';
    btn.disabled = true;

    window.go.main.App.TestConnection().then(res => {
        btn.innerText = originalText;
        btn.disabled = false;

        // Show result inline
        let resultEl = document.getElementById('test-result-inline');
        if (!resultEl) {
            resultEl = document.createElement('span');
            resultEl.id = 'test-result-inline';
            resultEl.className = 'test-result';
            btn.parentNode.insertBefore(resultEl, btn.nextSibling);
        }

        if (res.includes('✅')) {
            resultEl.className = 'test-result success';
            resultEl.innerText = '✅ 连接成功';
        } else {
            resultEl.className = 'test-result error';
            resultEl.innerText = '❌ 连接失败';
        }

        // Auto hide after 3s
        setTimeout(() => {
            if (resultEl) resultEl.remove();
        }, 3000);
    });
}

function loadFiles() { window.go.main.App.ListBooks().then(books => { allBooks=books; renderTable(); }); }
function renderTable() {
    const tbody = document.getElementById('table-body'); tbody.innerHTML="";
    let filtered = allBooks.filter(b => currentFilter==='ALL'||b.type===currentFilter);

    // Sort
    filtered.sort((a, b) => {
        let valA = a[sortField];
        let valB = b[sortField];

        if (sortField === 'size') {
            valA = parseSize(valA);
            valB = parseSize(valB);
        }

        if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
        return 0;
    });

    // Update headers
    document.querySelectorAll('th[data-sort]').forEach(th => {
        th.className = sortField === th.dataset.sort ? 'sorted' : '';
        const icon = th.querySelector('.sort-icon');
        if(icon) icon.innerText = getSortIcon(th.dataset.sort);
    });

    if(filtered.length===0) { document.getElementById('empty-state').style.display='block'; return; }
    document.getElementById('empty-state').style.display='none';

    filtered.forEach(b => {
        const tr = document.createElement('tr');
        tr.onclick = (e) => { if(e.target.type!=='checkbox') { const cb=tr.querySelector('.cb'); cb.checked=!cb.checked; updateSel(); }};
        tr.innerHTML=`<td style="text-align:center"><input type="checkbox" class="cb" data-path="${b.path}" onchange="updateSel()"></td>
            <td style="font-weight:500"><span class="type-badge type-${b.type}">${b.type}</span>${b.name}</td>
            <td style="color:#64748b;font-size:13px">${b.size}</td><td style="color:#64748b;font-size:13px">${b.modTime}</td>`;
        tbody.appendChild(tr);
    });

    // Reset Select All checkbox
    const selectAllCb = document.getElementById('selectAllCb');
    if(selectAllCb) selectAllCb.checked = false;
    updateSel();
}

function selectAll() { document.querySelectorAll('.cb').forEach(c => c.checked = true); updateSel(); }
function deselectAll() { document.querySelectorAll('.cb').forEach(c => c.checked = false); updateSel(); }
function invertSelection() { document.querySelectorAll('.cb').forEach(c => c.checked = !c.checked); updateSel(); }

function applyFilter(t, el) { currentFilter=t; document.querySelectorAll('.filter-chip').forEach(c=>c.classList.remove('active')); el.classList.add('active'); renderTable(); }
function toggleAll(src) { document.querySelectorAll('.cb').forEach(c=>c.checked=src.checked); updateSel(); }
function updateSel() {
    const n=document.querySelectorAll('.cb:checked').length;
    const btn=document.getElementById('sendBtn');
    btn.innerText=`🚀 发送选中书籍 (${n})`;
    btn.disabled=n===0;

    // Update header checkbox
    const allCbs = document.querySelectorAll('.cb');
    const allChecked = allCbs.length > 0 && n === allCbs.length;
    const selectAllCb = document.getElementById('selectAllCb');
    if(selectAllCb) selectAllCb.checked = allChecked;
}
function sendFiles() {
    if (isSending) return; // 防止重复点击
    const paths = Array.from(document.querySelectorAll('.cb:checked')).map(c => c.getAttribute('data-path'));
    if (paths.length === 0) {
        showLog('⚠️ 请先选择要发送的书籍');
        return;
    }

    const btn = document.getElementById('sendBtn');
    btn.disabled = true;
    btn.innerText = '⏳ 发送中...';
    isSending = true;

    // 清空之前的日志
    document.getElementById('progress-logs').innerHTML = '';
    document.getElementById('progress-bar-fill').style.width = '0%';

    // 调用后端，后端会通过事件推送进度
    window.go.main.App.SendSelectedBooks(paths);
}
function showLog(html) { const el=document.getElementById('log-overlay'); el.style.display='block'; el.innerHTML=html; setTimeout(()=>el.style.display='none', 4000); }

// Expose functions to window for onclick handlers
window.searchBook = searchBook;
window.testConn = testConn;
window.openSettings = openSettings;
window.openHelp = openHelp;
window.closeModal = closeModal;
window.saveSettings = saveSettings;
window.loadFiles = loadFiles;
window.applyFilter = applyFilter;
window.toggleAll = toggleAll;
window.updateSel = updateSel;
window.sendFiles = sendFiles;
window.showLog = showLog;
window.handleSendProgress = handleSendProgress;
window.sortBooks = sortBooks;
window.invertSelection = invertSelection;
window.switchTab = switchTab;
window.testConnInline = testConnInline;
