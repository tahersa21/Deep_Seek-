(() => {
    // ------------------------------------------------------------------ //
    // State                                                                //
    // ------------------------------------------------------------------ //
    let sessionId      = null;
    let isStreaming    = false;
    let parentMessageId = null;
    let sessionPromise  = null;

    // ------------------------------------------------------------------ //
    // DOM refs                                                             //
    // ------------------------------------------------------------------ //
    const chatMessages    = document.getElementById('chatMessages');
    const messageInput    = document.getElementById('messageInput');
    const sendBtn         = document.getElementById('sendBtn');
    const newChatBtn      = document.getElementById('newChatBtn');
    const thinkingToggle  = document.getElementById('thinkingToggle');
    const searchToggle    = document.getElementById('searchToggle');
    const welcomeScreen   = document.getElementById('welcomeScreen');
    const toast           = document.getElementById('toast');
    const noTokenBanner   = document.getElementById('noTokenBanner');
    const statusDot       = document.getElementById('statusDot');
    const statusText      = document.getElementById('statusText');
    const modelDot        = document.getElementById('modelDot');

    // ------------------------------------------------------------------ //
    // Tab switching                                                        //
    // ------------------------------------------------------------------ //
    window.switchTab = function(tabName) {
        document.querySelectorAll('.dash-nav-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.dash-panel').forEach(p => p.classList.add('hidden'));
        const tab   = document.querySelector(`.dash-nav-tab[data-tab="${tabName}"]`);
        const panel = document.getElementById('panel-' + tabName);
        if (tab)   tab.classList.add('active');
        if (panel) panel.classList.remove('hidden');

        if (tabName === 'accounts') { loadAccounts(); stopBalancerPolling(); }
        if (tabName === 'balancer') startBalancerPolling();
        else stopBalancerPolling();
        if (tabName === 'api')  loadKeys();
        if (tabName === 'test') sessionPromise = prefetchSession().catch(() => {});
    };

    document.querySelectorAll('.dash-nav-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // ------------------------------------------------------------------ //
    // Accounts management                                                  //
    // ------------------------------------------------------------------ //
    const accountsList   = document.getElementById('accountsList');
    const accountsResult = document.getElementById('accountsResult');
    const addAccountForm = document.getElementById('addAccountForm');
    const accNameInput   = document.getElementById('accNameInput');
    const accTokenInput  = document.getElementById('accTokenInput');
    const accProxyInput  = document.getElementById('accProxyInput');
    const saveAccountBtn = document.getElementById('saveAccountBtn');

    async function loadAccounts() {
        try {
            const res  = await fetch('/dsk/accounts');
            const data = await res.json();
            renderAccounts(data.accounts || []);
            updateHeaderStatus(data.accounts && data.accounts.some(a => a.active));
        } catch {
            accountsList.innerHTML = '<div class="empty-state"><p>فشل تحميل الحسابات</p></div>';
        }
    }

    function renderAccounts(accounts) {
        if (!accounts.length) {
            accountsList.innerHTML = `
                <div class="empty-state">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                        <circle cx="9" cy="7" r="4"/>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
                    </svg>
                    <p>لا توجد حسابات — اضغط "إضافة حساب" للبدء</p>
                </div>`;
            noTokenBanner && noTokenBanner.classList.remove('hidden');
            updateHeaderStatus(false);
            return;
        }

        const hasActive = accounts.some(a => a.active);
        updateHeaderStatus(hasActive);
        if (noTokenBanner) noTokenBanner.classList.add('hidden');

        accountsList.innerHTML = accounts.map(acc => `
            <div class="account-card ${acc.active ? 'is-active' : ''}" id="acc-${acc.id}">
                <div class="account-card-header">
                    <div class="account-card-indicator ${acc.active ? 'active' : ''}"></div>
                    <div class="account-card-name">
                        ${escapeHtml(acc.name)}
                        ${acc.active ? '<span class="badge-active">نشط</span>' : ''}
                        ${acc.proxy ? '<span class="badge-proxy">🔒 بروكسي</span>' : ''}
                    </div>
                    <div class="account-card-actions">
                        ${!acc.active ? `<button class="btn-sm-accent" onclick="activateAccount('${acc.id}','${escapeHtml(acc.name)}')">تفعيل</button>` : ''}
                        <button class="btn-sm-ghost" onclick="openProxyEditor('${acc.id}','${escapeHtml(acc.proxy||'')}')" title="بروكسي">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
                        </button>
                        <button class="btn-sm-danger" onclick="removeAccount('${acc.id}')" title="حذف">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6M9 6V4h6v2"/></svg>
                        </button>
                    </div>
                </div>
                <div class="account-card-meta">
                    <span class="account-card-token">${escapeHtml(acc.masked)}</span>
                    ${acc.proxy ? `<span class="account-card-proxy ltr">${escapeHtml(acc.proxy)}</span>` : ''}
                </div>

                <div class="proxy-editor hidden" id="proxy-editor-${acc.id}">
                    <input type="text" class="form-input ltr proxy-editor-input" id="proxy-input-${acc.id}"
                        placeholder="http://host:port  أو  socks5://host:port"
                        value="${escapeHtml(acc.proxy || '')}"
                        style="font-size:11.5px">
                    <div class="proxy-editor-actions">
                        <button class="btn-sm-accent" onclick="saveProxy('${acc.id}')">حفظ</button>
                        <button class="btn-sm-ghost"  onclick="closeProxyEditor('${acc.id}')">إلغاء</button>
                        ${acc.proxy ? `<button class="btn-sm-danger" onclick="clearProxy('${acc.id}')">حذف البروكسي</button>` : ''}
                    </div>
                </div>
            </div>
        `).join('');
    }

    window.activateAccount = async function(id, name) {
        try {
            const res = await fetch(`/dsk/accounts/${id}/activate`, { method: 'POST' });
            if (res.ok) {
                showAccountsResult(`✅ تم تفعيل "${name}"`, 'success');
                await loadAccounts();
                sessionId     = null;
                sessionPromise = prefetchSession().catch(() => {});
            } else {
                showAccountsResult('❌ فشل تفعيل الحساب', 'error');
            }
        } catch { showAccountsResult('❌ خطأ في الاتصال', 'error'); }
    };

    window.removeAccount = async function(id) {
        if (!confirm('هل تريد حذف هذا الحساب؟')) return;
        try {
            const res = await fetch(`/dsk/accounts/${id}`, { method: 'DELETE' });
            if (res.ok) {
                showAccountsResult('🗑️ تم حذف الحساب', 'success');
                await loadAccounts();
                sessionId = null;
            } else { showAccountsResult('❌ فشل الحذف', 'error'); }
        } catch { showAccountsResult('❌ خطأ في الاتصال', 'error'); }
    };

    saveAccountBtn.addEventListener('click', async () => {
        const name  = accNameInput.value.trim() || 'حساب جديد';
        const token = accTokenInput.value.trim();
        const proxy = accProxyInput ? accProxyInput.value.trim() : '';
        if (!token) { showAccountsResult('يرجى إدخال التوكن', 'error'); return; }
        saveAccountBtn.disabled    = true;
        saveAccountBtn.textContent = 'جارٍ الحفظ...';
        try {
            const res  = await fetch('/dsk/accounts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, token, proxy }),
            });
            const data = await res.json();
            if (res.ok && data.ok) {
                showAccountsResult('✅ ' + data.message, 'success');
                accNameInput.value  = '';
                accTokenInput.value = '';
                if (accProxyInput) accProxyInput.value = '';
                addAccountForm.classList.add('hidden');
                await loadAccounts();
                if (data.active) {
                    sessionId     = null;
                    sessionPromise = prefetchSession().catch(() => {});
                }
            } else { showAccountsResult('❌ ' + (data.error || 'حدث خطأ'), 'error'); }
        } catch { showAccountsResult('❌ فشل الاتصال بالخادم', 'error'); }
        finally {
            saveAccountBtn.disabled = false;
            saveAccountBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> حفظ الحساب`;
        }
    });

    function showAccountsResult(msg, type) {
        if (!accountsResult) return;
        accountsResult.textContent = msg;
        accountsResult.className   = 'accounts-result ' + type;
        accountsResult.classList.remove('hidden');
        clearTimeout(showAccountsResult._t);
        showAccountsResult._t = setTimeout(() => accountsResult.classList.add('hidden'), 4000);
    }

    window.toggleAddForm = function() {
        addAccountForm.classList.toggle('hidden');
        if (!addAccountForm.classList.contains('hidden')) accNameInput.focus();
    };

    window.toggleAccTokenVisibility = function() {
        const isPass = accTokenInput.type === 'password';
        accTokenInput.type = isPass ? 'text' : 'password';
        document.getElementById('accEyeIcon').style.opacity = isPass ? '0.4' : '1';
    };

    window.copyTokenHint = function() {
        navigator.clipboard.writeText("JSON.parse(localStorage.getItem('userToken')).value");
        showToast('✅ تم نسخ الأمر');
    };

    // Proxy editor
    window.openProxyEditor = function(id, cur) {
        document.querySelectorAll('.proxy-editor').forEach(e => e.classList.add('hidden'));
        const editor = document.getElementById(`proxy-editor-${id}`);
        if (editor) {
            editor.classList.remove('hidden');
            const inp = document.getElementById(`proxy-input-${id}`);
            if (inp) { inp.value = cur; inp.focus(); }
        }
    };
    window.closeProxyEditor = function(id) {
        const e = document.getElementById(`proxy-editor-${id}`);
        if (e) e.classList.add('hidden');
    };
    window.saveProxy = async function(id) {
        const inp   = document.getElementById(`proxy-input-${id}`);
        const proxy = inp ? inp.value.trim() : '';
        try {
            const res  = await fetch(`/dsk/accounts/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ proxy }),
            });
            const data = await res.json();
            if (res.ok && data.ok) {
                showAccountsResult(proxy ? '✅ تم حفظ البروكسي' : '✅ تم إزالة البروكسي', 'success');
                await loadAccounts();
            } else { showAccountsResult('❌ ' + (data.error || 'فشل الحفظ'), 'error'); }
        } catch { showAccountsResult('❌ خطأ في الاتصال', 'error'); }
    };
    window.clearProxy = async function(id) {
        const inp = document.getElementById(`proxy-input-${id}`);
        if (inp) inp.value = '';
        await window.saveProxy(id);
    };

    window.openSettingsTab = function() { switchTab('accounts'); };

    // ------------------------------------------------------------------ //
    // Load-balancer                                                        //
    // ------------------------------------------------------------------ //
    const balancerList      = document.getElementById('balancerList');
    const balancerBadge     = document.getElementById('balancerBadge');
    const balancerStatsRow  = document.getElementById('balancerStatsRow');
    let   balancerTimer     = null;

    async function loadBalancer() {
        try {
            const res  = await fetch('/dsk/balancer');
            const data = await res.json();
            renderBalancer(data.accounts || []);
        } catch {
            if (balancerList) balancerList.innerHTML = '<div class="empty-state"><p>فشل التحميل</p></div>';
        }
    }

    function fmtSeconds(s) {
        if (s === null || s === undefined) return '';
        const m = Math.floor(s / 60), sec = s % 60;
        return m > 0 ? `${m}د ${sec}ث` : `${sec}ث`;
    }

    function renderBalancer(accounts) {
        if (!accounts.length) {
            if (balancerList)  balancerList.innerHTML = '<div class="empty-state"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg><p>أضف حسابات لتفعيل موازن الحمل</p></div>';
            if (balancerBadge) balancerBadge.textContent = '';
            if (balancerStatsRow) balancerStatsRow.innerHTML = '';
            return;
        }

        const healthy  = accounts.filter(a => a.healthy).length;
        const total    = accounts.length;
        const totalReq = accounts.reduce((s, a) => s + a.requests, 0);

        // Badge in nav
        if (balancerBadge) {
            balancerBadge.textContent = `${healthy}/${total}`;
            balancerBadge.className   = 'balancer-badge ' + (healthy === total ? 'all-ok' : healthy === 0 ? 'all-fail' : 'partial');
        }

        // Stats row
        if (balancerStatsRow) {
            balancerStatsRow.innerHTML = `
                <div class="stat-chip">
                    <span class="stat-chip-val">${total}</span>
                    <span class="stat-chip-label">الحسابات</span>
                </div>
                <div class="stat-chip ok">
                    <span class="stat-chip-val">${healthy}</span>
                    <span class="stat-chip-label">نشط</span>
                </div>
                <div class="stat-chip ${total - healthy > 0 ? 'fail' : ''}">
                    <span class="stat-chip-val">${total - healthy}</span>
                    <span class="stat-chip-label">محجوز</span>
                </div>
                <div class="stat-chip">
                    <span class="stat-chip-val">${totalReq}</span>
                    <span class="stat-chip-label">إجمالي الطلبات</span>
                </div>`;
        }

        if (!balancerList) return;
        balancerList.innerHTML = accounts.map(acc => {
            const sc    = acc.healthy ? 'healthy' : 'quarantined';
            const label = acc.healthy ? 'نشط' : `محجوز ${acc.recovery_in !== null ? '(' + fmtSeconds(acc.recovery_in) + ')' : ''}`;
            const errHtml = (!acc.healthy && acc.error)
                ? `<div class="balancer-card-error">${escapeHtml(acc.error.substring(0, 80))}${acc.error.length > 80 ? '…' : ''}</div>` : '';
            return `
            <div class="balancer-card ${sc}">
                <div class="balancer-card-top">
                    <span class="balancer-dot ${sc}"></span>
                    <span class="balancer-card-name">${escapeHtml(acc.name)}</span>
                    <span class="balancer-status-label ${sc}">${label}</span>
                    ${acc.proxy ? `<span class="badge-proxy" title="${escapeHtml(acc.proxy)}">🔒 بروكسي</span>` : ''}
                    <div style="flex:1"></div>
                    ${!acc.healthy ? `<button class="btn-sm-accent" onclick="resetBalancerAccount('${acc.id}')">استرداد</button>` : ''}
                </div>
                <div class="balancer-card-stats">
                    <div class="balancer-stat"><span class="bstat-val">${acc.requests}</span><span class="bstat-label">طلبات</span></div>
                    <div class="balancer-stat ok"><span class="bstat-val">${acc.successes}</span><span class="bstat-label">ناجح</span></div>
                    <div class="balancer-stat ${acc.failures > 0 ? 'fail' : ''}"><span class="bstat-val">${acc.failures}</span><span class="bstat-label">فاشل</span></div>
                    <div class="balancer-stat"><span class="bstat-val">${acc.requests > 0 ? Math.round(acc.successes / acc.requests * 100) : 0}%</span><span class="bstat-label">نجاح</span></div>
                </div>
                ${errHtml}
            </div>`;
        }).join('');
    }

    window.resetBalancerAccount = async function(id) {
        await fetch(`/dsk/balancer/${id}/reset`, { method: 'POST' });
        await loadBalancer();
    };
    window.resetAllBalancer = async function() {
        await fetch('/dsk/balancer/reset-all', { method: 'POST' });
        showToast('✅ تم إعادة تشغيل جميع الحسابات');
        await loadBalancer();
    };

    function startBalancerPolling()  { loadBalancer(); clearInterval(balancerTimer); balancerTimer = setInterval(loadBalancer, 8000); }
    function stopBalancerPolling()   { clearInterval(balancerTimer); balancerTimer = null; }

    // ------------------------------------------------------------------ //
    // API Keys                                                             //
    // ------------------------------------------------------------------ //
    const keysList      = document.getElementById('keysList');
    const keyNameInput  = document.getElementById('keyNameInput');
    const genKeyBtn     = document.getElementById('genKeyBtn');
    const newKeyReveal  = document.getElementById('newKeyReveal');
    const newKeyValue   = document.getElementById('newKeyValue');
    const copyNewKeyBtn = document.getElementById('copyNewKeyBtn');
    const baseUrlText   = document.getElementById('baseUrlText');

    baseUrlText.textContent = window.location.origin + '/v1/chat/completions';

    window.copyBaseUrl = function() {
        navigator.clipboard.writeText(baseUrlText.textContent);
        showToast('✅ تم نسخ الرابط');
    };

    async function loadKeys() {
        try {
            const res  = await fetch('/dsk/keys');
            const data = await res.json();
            renderKeys(data.keys || []);
        } catch {
            if (keysList) keysList.innerHTML = '<div class="empty-state"><p>فشل تحميل المفاتيح</p></div>';
        }
    }

    function renderKeys(keys) {
        if (!keysList) return;
        if (!keys.length) {
            keysList.innerHTML = '<div class="empty-state"><p>لا توجد مفاتيح بعد</p></div>';
            return;
        }
        keysList.innerHTML = keys.map(k => `
            <div class="key-item" data-id="${k.id}">
                <div class="key-item-info">
                    <div class="key-item-name">${escapeHtml(k.name)}</div>
                    <div class="key-item-masked ltr">${escapeHtml(k.masked)}</div>
                </div>
                <button class="btn-sm-danger" onclick="deleteKey('${k.id}')" title="حذف">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6M9 6V4h6v2"/>
                    </svg>
                </button>
            </div>
        `).join('');
    }

    genKeyBtn.addEventListener('click', async () => {
        const name = keyNameInput.value.trim() || 'مفتاح جديد';
        genKeyBtn.disabled = true;
        newKeyReveal.classList.add('hidden');
        try {
            const res  = await fetch('/dsk/keys', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            const data = await res.json();
            if (data.key) {
                newKeyValue.textContent = data.key;
                newKeyReveal.classList.remove('hidden');
                copyNewKeyBtn.onclick = () => {
                    navigator.clipboard.writeText(data.key);
                    showToast('✅ تم نسخ المفتاح');
                };
                keyNameInput.value = '';
                await loadKeys();
            } else { showToast('❌ فشل إنشاء المفتاح'); }
        } catch { showToast('❌ خطأ في الاتصال'); }
        finally { genKeyBtn.disabled = false; }
    });

    window.deleteKey = async function(kid) {
        if (!confirm('هل تريد حذف هذا المفتاح؟')) return;
        try {
            const res = await fetch(`/dsk/keys/${kid}`, { method: 'DELETE' });
            if (res.ok) { showToast('🗑️ تم حذف المفتاح'); await loadKeys(); }
            else showToast('❌ فشل الحذف');
        } catch { showToast('❌ خطأ في الاتصال'); }
    };

    // ------------------------------------------------------------------ //
    // Status helpers                                                       //
    // ------------------------------------------------------------------ //
    function updateHeaderStatus(tokenSet) {
        if (tokenSet) {
            statusDot.classList.add('active');
            statusText.textContent = 'متصل';
            if (modelDot) modelDot.style.background = 'var(--success)';
            if (noTokenBanner) noTokenBanner.classList.add('hidden');
        } else {
            statusDot.classList.remove('active');
            statusText.textContent = 'لا يوجد حساب نشط';
            if (modelDot) modelDot.style.background = 'var(--text-muted)';
        }
    }

    // ------------------------------------------------------------------ //
    // Session management                                                   //
    // ------------------------------------------------------------------ //
    async function prefetchSession() {
        if (sessionId) return sessionId;
        try {
            const res  = await fetch('/dsk/session', { method: 'POST' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            sessionId = data.session_id;
            return sessionId;
        } catch (err) { sessionId = null; throw err; }
    }

    async function ensureSession() {
        if (sessionId) return true;
        try {
            await (sessionPromise || prefetchSession());
            return !!sessionId;
        } catch {
            try { await prefetchSession(); return !!sessionId; }
            catch (err) { showToast('❌ فشل إنشاء الجلسة: ' + err.message); return false; }
        }
    }

    // ------------------------------------------------------------------ //
    // Send message (test chat)                                             //
    // ------------------------------------------------------------------ //
    async function sendMessage() {
        const prompt = messageInput.value.trim();
        if (!prompt || isStreaming) return;
        if (!await ensureSession()) return;

        if (welcomeScreen) welcomeScreen.style.display = 'none';
        addUserMessage(prompt);

        messageInput.value = '';
        messageInput.style.height = 'auto';
        sendBtn.disabled = true;
        isStreaming = true;

        const thinkingEnabled = thinkingToggle.checked;
        const searchEnabled   = searchToggle.checked;

        const aiGroup       = addAIPlaceholder();
        const loadingEl     = aiGroup.querySelector('.loading-dots');
        const thinkingBlock = aiGroup.querySelector('.thinking-block');
        const thinkingBody  = aiGroup.querySelector('.thinking-body');
        const bubble        = aiGroup.querySelector('.message-bubble');
        const timerEl       = aiGroup.querySelector('.response-timer');

        let tickInterval = setInterval(() => {
            const elapsed = (performance.now() - startTime) / 1000;
            if (timerEl) timerEl.textContent = `⏱ ${elapsed.toFixed(1)}s`;
        }, 100);

        let thinkingContent = '', textContent = '';
        let hasThinking = false, hasText = false, pendingRender = false;
        const startTime = performance.now();

        function scheduleRender() {
            if (pendingRender) return;
            pendingRender = true;
            requestAnimationFrame(() => {
                pendingRender = false;
                if (hasText)     bubble.innerHTML    = formatText(textContent);
                if (hasThinking) thinkingBody.textContent = thinkingContent;
                scheduleScroll();
            });
        }

        try {
            const res = await fetch('/dsk/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: sessionId, prompt,
                    thinking_enabled: thinkingEnabled,
                    search_enabled: searchEnabled,
                    parent_message_id: parentMessageId,
                }),
            });
            if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `HTTP ${res.status}`); }

            const reader  = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer    = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const raw = line.slice(6).trim();
                    if (raw === '[DONE]') break;
                    let chunk;
                    try { chunk = JSON.parse(raw); } catch { continue; }

                    if (chunk.type === 'error') {
                        if (loadingEl.parentNode) loadingEl.remove();
                        bubble.style.display = 'block';
                        bubble.innerHTML = `<span style="color:#fca5a5">❌ ${escapeHtml(chunk.content)}</span>`;
                        scheduleScroll(); break;
                    }
                    if (chunk.type === 'thinking' && chunk.content) {
                        if (!hasThinking) { hasThinking = true; if (loadingEl.parentNode) loadingEl.remove(); thinkingBlock.style.display = 'block'; thinkingBlock.classList.add('open'); }
                        thinkingContent += chunk.content; scheduleRender();
                    }
                    if (chunk.type === 'text' && chunk.content) {
                        if (!hasText) { hasText = true; if (loadingEl.parentNode) loadingEl.remove(); bubble.style.display = 'block'; }
                        textContent += chunk.content; scheduleRender();
                    }
                    if (chunk.message_id) parentMessageId = chunk.message_id;
                }
            }
            if (hasText)     bubble.innerHTML         = formatText(textContent);
            if (hasThinking) thinkingBody.textContent = thinkingContent;

        } catch (err) {
            clearInterval(tickInterval);
            if (loadingEl.parentNode) loadingEl.remove();
            bubble.style.display = 'block';
            bubble.innerHTML = `<span style="color:#fca5a5">❌ ${escapeHtml(err.message)}</span>`;
        } finally {
            clearInterval(tickInterval);
            const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
            if (timerEl) { timerEl.textContent = `⏱ ${elapsed}s`; timerEl.classList.add('done'); }
            if (!hasText && !hasThinking) {
                if (loadingEl.parentNode) loadingEl.remove();
                bubble.style.display = 'block';
                bubble.textContent   = 'لم يتم استلام رد.';
            }
            isStreaming  = false;
            sendBtn.disabled = messageInput.value.trim() === '';
            scheduleScroll();
            sessionPromise = prefetchSession().catch(() => {});
        }
    }

    // ------------------------------------------------------------------ //
    // DOM helpers                                                          //
    // ------------------------------------------------------------------ //
    function addUserMessage(text) {
        const g = document.createElement('div');
        g.className = 'message-group user';
        g.innerHTML = `<div class="message-bubble">${escapeHtml(text)}</div>`;
        chatMessages.appendChild(g);
        scheduleScroll();
    }

    function addAIPlaceholder() {
        const g = document.createElement('div');
        g.className = 'message-group assistant';
        g.innerHTML = `
            <div class="thinking-block" style="display:none">
                <div class="thinking-header" onclick="this.parentElement.classList.toggle('open')">
                    <span>🤔</span><span>جاري التفكير...</span><span class="thinking-chevron">▼</span>
                </div>
                <div class="thinking-body"></div>
            </div>
            <div class="loading-dots"><span></span><span></span><span></span></div>
            <div class="message-bubble" style="display:none"></div>
            <div class="response-timer">⏱ 0.0s</div>`;
        chatMessages.appendChild(g);
        scheduleScroll();
        return g;
    }

    function onInputChange() {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 140) + 'px';
        sendBtn.disabled = messageInput.value.trim() === '' || isStreaming;
    }

    let scrollRaf = null;
    function scheduleScroll() {
        if (scrollRaf) return;
        scrollRaf = requestAnimationFrame(() => { chatMessages.scrollTop = chatMessages.scrollHeight; scrollRaf = null; });
    }

    function startNewChat() {
        sessionId = null; parentMessageId = null;
        chatMessages.innerHTML = '';
        if (welcomeScreen) {
            const clone = welcomeScreen.cloneNode(true);
            clone.style.display = '';
            chatMessages.appendChild(clone);
            clone.querySelectorAll('.test-sugg-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    messageInput.value = btn.dataset.prompt;
                    onInputChange(); sendMessage();
                });
            });
        }
        sessionPromise = prefetchSession().catch(() => {});
    }

    // ------------------------------------------------------------------ //
    // Text utilities                                                       //
    // ------------------------------------------------------------------ //
    function escapeHtml(str) {
        return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function formatText(text) {
        const parts = []; let lastIndex = 0;
        const re = /```(\w*)\n?([\s\S]*?)```/g; let m;
        while ((m = re.exec(text)) !== null) {
            parts.push(renderInline(text.slice(lastIndex, m.index)));
            parts.push(`<pre><code${m[1] ? ` class="language-${escapeHtml(m[1])}"` : ''}>${escapeHtml(m[2])}</code></pre>`);
            lastIndex = m.index + m[0].length;
        }
        parts.push(renderInline(text.slice(lastIndex)));
        return parts.join('');
    }

    function renderInline(text) {
        return escapeHtml(text)
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');
    }

    // ------------------------------------------------------------------ //
    // Toast                                                                //
    // ------------------------------------------------------------------ //
    let toastTimer = null;
    function showToast(msg) {
        toast.textContent = msg;
        toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
    }

    // ------------------------------------------------------------------ //
    // Event listeners                                                      //
    // ------------------------------------------------------------------ //
    messageInput.addEventListener('input', onInputChange);
    messageInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!sendBtn.disabled) sendMessage(); }
    });
    sendBtn.addEventListener('click', sendMessage);
    newChatBtn.addEventListener('click', startNewChat);

    document.querySelectorAll('.test-sugg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            messageInput.value = btn.dataset.prompt;
            onInputChange(); sendMessage();
        });
    });

    // ------------------------------------------------------------------ //
    // Init                                                                 //
    // ------------------------------------------------------------------ //
    loadAccounts();
    sessionPromise = prefetchSession().catch(() => {});
})();
