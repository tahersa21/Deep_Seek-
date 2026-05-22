(() => {
    // ------------------------------------------------------------------ //
    // State                                                                //
    // ------------------------------------------------------------------ //
    let sessionId = null;
    let isStreaming = false;
    let parentMessageId = null;
    let sessionPromise = null;

    // ------------------------------------------------------------------ //
    // DOM refs                                                             //
    // ------------------------------------------------------------------ //
    const chatMessages   = document.getElementById('chatMessages');
    const messageInput   = document.getElementById('messageInput');
    const sendBtn        = document.getElementById('sendBtn');
    const newChatBtn     = document.getElementById('newChatBtn');
    const thinkingToggle = document.getElementById('thinkingToggle');
    const searchToggle   = document.getElementById('searchToggle');
    const sidebarToggle  = document.getElementById('sidebarToggle');
    const sidebar        = document.getElementById('sidebar');
    const welcomeScreen  = document.getElementById('welcomeScreen');
    const toast          = document.getElementById('toast');
    const noTokenBanner  = document.getElementById('noTokenBanner');
    const statusDot      = document.getElementById('statusDot');
    const statusText     = document.getElementById('statusText');
    const modelDot       = document.getElementById('modelDot');

    // ------------------------------------------------------------------ //
    // Sidebar tabs                                                         //
    // ------------------------------------------------------------------ //
    document.querySelectorAll('.sidebar-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.add('hidden'));
            tab.classList.add('active');
            const panel = document.getElementById('panel-' + tab.dataset.tab);
            if (panel) panel.classList.remove('hidden');
            if (tab.dataset.tab === 'api') loadKeys();
            if (tab.dataset.tab === 'settings') { loadAccounts(); startBalancerPolling(); }
            else stopBalancerPolling();
        });
    });

    // ------------------------------------------------------------------ //
    // Accounts management                                                  //
    // ------------------------------------------------------------------ //
    const accountsList    = document.getElementById('accountsList');
    const accountsResult  = document.getElementById('accountsResult');
    const addAccountForm  = document.getElementById('addAccountForm');
    const accNameInput    = document.getElementById('accNameInput');
    const accTokenInput   = document.getElementById('accTokenInput');
    const accProxyInput   = document.getElementById('accProxyInput');
    const saveAccountBtn  = document.getElementById('saveAccountBtn');

    async function loadAccounts() {
        try {
            const res = await fetch('/dsk/accounts');
            const data = await res.json();
            renderAccounts(data.accounts || []);
            updateHeaderStatus(data.accounts && data.accounts.some(a => a.active));
        } catch {
            accountsList.innerHTML = '<div class="accounts-empty">فشل تحميل الحسابات</div>';
        }
    }

    function renderAccounts(accounts) {
        if (!accounts.length) {
            accountsList.innerHTML = '<div class="accounts-empty">لا توجد حسابات — أضف حسابك الأول</div>';
            noTokenBanner.classList.remove('hidden');
            updateHeaderStatus(false);
            return;
        }

        const hasActive = accounts.some(a => a.active);
        updateHeaderStatus(hasActive);

        accountsList.innerHTML = accounts.map(acc => `
            <div class="account-item ${acc.active ? 'is-active' : ''}" id="acc-${acc.id}">
                <span class="account-item-indicator"></span>
                <div class="account-item-info">
                    <div class="account-item-name">
                        ${escapeHtml(acc.name)}
                        ${acc.active ? '<span class="account-active-badge">نشط</span>' : ''}
                        ${acc.proxy ? '<span class="account-proxy-badge" title="${escapeHtml(acc.proxy)}">🔒 بروكسي</span>' : ''}
                    </div>
                    <div class="account-item-masked">${escapeHtml(acc.masked)}</div>
                    ${acc.proxy ? `<div class="account-item-proxy" dir="ltr">${escapeHtml(acc.proxy)}</div>` : ''}
                </div>
                <div class="account-item-actions">
                    ${!acc.active ? `<button class="acc-activate-btn" onclick="activateAccount('${acc.id}', '${escapeHtml(acc.name)}')">تفعيل</button>` : ''}
                    <button class="acc-proxy-btn" onclick="openProxyEditor('${acc.id}', '${escapeHtml(acc.proxy || '')}')" title="تعيين بروكسي">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
                        </svg>
                    </button>
                    <button class="acc-delete-btn" onclick="removeAccount('${acc.id}')" title="حذف">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                            <path d="M10 11v6M14 11v6M9 6V4h6v2"/>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="proxy-editor hidden" id="proxy-editor-${acc.id}">
                <input type="text" class="token-input proxy-editor-input" id="proxy-input-${acc.id}"
                    placeholder="http://host:port  أو  socks5://host:port"
                    value="${escapeHtml(acc.proxy || '')}"
                    dir="ltr" style="text-align:left; font-size:11px"
                >
                <div class="proxy-editor-actions">
                    <button class="save-token-btn" style="font-size:11px; padding:4px 10px" onclick="saveProxy('${acc.id}')">حفظ</button>
                    <button class="delete-token-btn" style="font-size:11px; padding:4px 10px" onclick="closeProxyEditor('${acc.id}')">إلغاء</button>
                    ${acc.proxy ? `<button class="delete-token-btn" style="font-size:11px; padding:4px 10px; color:var(--error)" onclick="clearProxy('${acc.id}')">حذف البروكسي</button>` : ''}
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
                sessionId = null;
                sessionPromise = prefetchSession().catch(() => {});
            } else {
                showAccountsResult('❌ فشل تفعيل الحساب', 'error');
            }
        } catch {
            showAccountsResult('❌ خطأ في الاتصال', 'error');
        }
    };

    window.removeAccount = async function(id) {
        if (!confirm('هل تريد حذف هذا الحساب؟')) return;
        try {
            const res = await fetch(`/dsk/accounts/${id}`, { method: 'DELETE' });
            if (res.ok) {
                showAccountsResult('🗑️ تم حذف الحساب', 'success');
                await loadAccounts();
                sessionId = null;
            } else {
                showAccountsResult('❌ فشل حذف الحساب', 'error');
            }
        } catch {
            showAccountsResult('❌ خطأ في الاتصال', 'error');
        }
    };

    window.openProxyEditor = function(id, currentProxy) {
        document.querySelectorAll('.proxy-editor').forEach(el => el.classList.add('hidden'));
        const editor = document.getElementById(`proxy-editor-${id}`);
        if (editor) {
            editor.classList.remove('hidden');
            const inp = document.getElementById(`proxy-input-${id}`);
            if (inp) { inp.value = currentProxy; inp.focus(); }
        }
    };

    window.closeProxyEditor = function(id) {
        const editor = document.getElementById(`proxy-editor-${id}`);
        if (editor) editor.classList.add('hidden');
    };

    window.saveProxy = async function(id) {
        const inp = document.getElementById(`proxy-input-${id}`);
        const proxy = inp ? inp.value.trim() : '';
        try {
            const res = await fetch(`/dsk/accounts/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ proxy }),
            });
            const data = await res.json();
            if (res.ok && data.ok) {
                showAccountsResult(proxy ? '✅ تم حفظ البروكسي' : '✅ تم إزالة البروكسي', 'success');
                await loadAccounts();
            } else {
                showAccountsResult('❌ ' + (data.error || 'فشل الحفظ'), 'error');
            }
        } catch {
            showAccountsResult('❌ خطأ في الاتصال', 'error');
        }
    };

    window.clearProxy = async function(id) {
        const inp = document.getElementById(`proxy-input-${id}`);
        if (inp) inp.value = '';
        await window.saveProxy(id);
    };

    saveAccountBtn.addEventListener('click', async () => {
        const name  = accNameInput.value.trim() || 'حساب جديد';
        const token = accTokenInput.value.trim();
        const proxy = accProxyInput ? accProxyInput.value.trim() : '';
        if (!token) {
            showAccountsResult('يرجى إدخال التوكن', 'error');
            return;
        }
        saveAccountBtn.disabled = true;
        saveAccountBtn.textContent = 'جارٍ الحفظ...';
        try {
            const res = await fetch('/dsk/accounts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, token, proxy }),
            });
            const data = await res.json();
            if (res.ok && data.ok) {
                showAccountsResult('✅ ' + data.message, 'success');
                accNameInput.value = '';
                accTokenInput.value = '';
                addAccountForm.classList.add('hidden');
                await loadAccounts();
                if (data.active) {
                    sessionId = null;
                    sessionPromise = prefetchSession().catch(() => {});
                }
            } else {
                showAccountsResult('❌ ' + (data.error || 'حدث خطأ'), 'error');
            }
        } catch {
            showAccountsResult('❌ فشل الاتصال بالخادم', 'error');
        } finally {
            saveAccountBtn.disabled = false;
            saveAccountBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> حفظ الحساب`;
        }
    });

    function showAccountsResult(msg, type) {
        accountsResult.textContent = msg;
        accountsResult.className = 'accounts-result ' + type;
        accountsResult.classList.remove('hidden');
        clearTimeout(showAccountsResult._t);
        showAccountsResult._t = setTimeout(() => accountsResult.classList.add('hidden'), 4000);
    }

    window.toggleAddForm = function() {
        addAccountForm.classList.toggle('hidden');
        if (!addAccountForm.classList.contains('hidden')) {
            accNameInput.focus();
        }
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

    // ------------------------------------------------------------------ //
    // Load-balancer status                                                //
    // ------------------------------------------------------------------ //
    const balancerList  = document.getElementById('balancerList');
    const balancerBadge = document.getElementById('balancerBadge');
    let balancerTimer   = null;

    async function loadBalancer() {
        try {
            const res  = await fetch('/dsk/balancer');
            const data = await res.json();
            renderBalancer(data.accounts || []);
        } catch {
            if (balancerList) balancerList.innerHTML = '<div class="balancer-empty">فشل التحميل</div>';
        }
    }

    function fmtSeconds(s) {
        if (s === null || s === undefined) return '';
        const m = Math.floor(s / 60), sec = s % 60;
        return m > 0 ? `${m}د ${sec}ث` : `${sec}ث`;
    }

    function renderBalancer(accounts) {
        if (!accounts.length) {
            if (balancerList) balancerList.innerHTML = '<div class="balancer-empty">أضف حسابات لتفعيل موازن الحمل</div>';
            if (balancerBadge) balancerBadge.textContent = '';
            return;
        }
        const healthy = accounts.filter(a => a.healthy).length;
        if (balancerBadge) {
            balancerBadge.textContent = `${healthy}/${accounts.length} نشط`;
            balancerBadge.className = 'balancer-badge ' + (healthy === accounts.length ? 'all-ok' : healthy === 0 ? 'all-fail' : 'partial');
        }
        if (!balancerList) return;
        balancerList.innerHTML = accounts.map(acc => {
            const statusClass = acc.healthy ? 'healthy' : 'quarantined';
            const statusLabel = acc.healthy ? 'نشط' : `محجوز ${acc.recovery_in !== null ? '(' + fmtSeconds(acc.recovery_in) + ')' : ''}`;
            const errorHtml   = (!acc.healthy && acc.error)
                ? `<div class="balancer-item-error" title="${escapeHtml(acc.error)}">${escapeHtml(acc.error.substring(0, 60))}${acc.error.length > 60 ? '…' : ''}</div>`
                : '';
            return `
            <div class="balancer-item ${statusClass}">
                <span class="balancer-dot ${statusClass}"></span>
                <div class="balancer-item-body">
                    <div class="balancer-item-name">
                        ${escapeHtml(acc.name)}
                        <span class="balancer-status-label ${statusClass}">${statusLabel}</span>
                    </div>
                    <div class="balancer-item-stats">
                        <span title="الطلبات">📥 ${acc.requests}</span>
                        <span title="نجح">✅ ${acc.successes}</span>
                        <span title="فشل">❌ ${acc.failures}</span>
                        ${acc.proxy ? '<span title="بروكسي">🔒</span>' : ''}
                    </div>
                    ${errorHtml}
                </div>
                ${!acc.healthy ? `<button class="balancer-reset-btn" onclick="resetBalancerAccount('${acc.id}')">استرداد</button>` : ''}
            </div>`;
        }).join('');
    }

    window.resetBalancerAccount = async function(id) {
        await fetch(`/dsk/balancer/${id}/reset`, { method: 'POST' });
        await loadBalancer();
    };

    window.resetAllBalancer = async function() {
        await fetch('/dsk/balancer/reset-all', { method: 'POST' });
        showAccountsResult('✅ تم إعادة تشغيل جميع الحسابات', 'success');
        await loadBalancer();
    };

    // Auto-refresh balancer every 10s while settings tab is open
    function startBalancerPolling()  { loadBalancer(); balancerTimer = setInterval(loadBalancer, 10000); }
    function stopBalancerPolling()   { clearInterval(balancerTimer); balancerTimer = null; }

    window.openSettingsTab = function() {
        document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.add('hidden'));
        const tab = document.querySelector('.sidebar-tab[data-tab="settings"]');
        const panel = document.getElementById('panel-settings');
        if (tab) tab.classList.add('active');
        if (panel) panel.classList.remove('hidden');
        if (sidebar.classList.contains('collapsed')) sidebar.classList.remove('collapsed');
        loadAccounts();
        startBalancerPolling();
    };

    function updateHeaderStatus(tokenSet) {
        if (tokenSet) {
            statusDot.classList.add('active');
            statusText.textContent = 'متصل';
            modelDot.style.background = 'var(--success)';
            noTokenBanner.classList.add('hidden');
        } else {
            statusDot.classList.remove('active');
            statusText.textContent = 'لا يوجد حساب نشط';
            modelDot.style.background = 'var(--error)';
            noTokenBanner.classList.remove('hidden');
        }
    }

    // ------------------------------------------------------------------ //
    // API Key management                                                   //
    // ------------------------------------------------------------------ //
    const keysList      = document.getElementById('keysList');
    const genKeyBtn     = document.getElementById('genKeyBtn');
    const keyNameInput  = document.getElementById('keyNameInput');
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
            const res = await fetch('/dsk/keys');
            const data = await res.json();
            renderKeys(data.keys || []);
        } catch {
            keysList.innerHTML = '<div class="keys-empty">فشل تحميل المفاتيح</div>';
        }
    }

    function renderKeys(keys) {
        if (!keys.length) {
            keysList.innerHTML = '<div class="keys-empty">لا توجد مفاتيح بعد</div>';
            return;
        }
        keysList.innerHTML = keys.map(k => `
            <div class="key-item" data-id="${k.id}">
                <div class="key-item-info">
                    <div class="key-item-name">${escapeHtml(k.name)}</div>
                    <div class="key-item-masked">${escapeHtml(k.masked)}</div>
                </div>
                <button class="key-delete-btn" onclick="deleteKey('${k.id}')" title="حذف">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
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
            const res = await fetch('/dsk/keys', {
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
            } else {
                showToast('❌ فشل إنشاء المفتاح');
            }
        } catch {
            showToast('❌ خطأ في الاتصال');
        } finally {
            genKeyBtn.disabled = false;
        }
    });

    window.deleteKey = async function(kid) {
        if (!confirm('هل تريد حذف هذا المفتاح؟')) return;
        try {
            const res = await fetch(`/dsk/keys/${kid}`, { method: 'DELETE' });
            if (res.ok) {
                showToast('🗑️ تم حذف المفتاح');
                await loadKeys();
            } else {
                showToast('❌ فشل الحذف');
            }
        } catch {
            showToast('❌ خطأ في الاتصال');
        }
    };

    // ------------------------------------------------------------------ //
    // Initialisation                                                       //
    // ------------------------------------------------------------------ //
    loadAccounts();
    sessionPromise = prefetchSession().catch(() => {});

    // ------------------------------------------------------------------ //
    // Event listeners                                                      //
    // ------------------------------------------------------------------ //
    messageInput.addEventListener('input', onInputChange);
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!sendBtn.disabled) sendMessage();
        }
    });

    sendBtn.addEventListener('click', sendMessage);
    newChatBtn.addEventListener('click', startNewChat);
    sidebarToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));

    document.querySelectorAll('.suggestion-card').forEach(card => {
        card.addEventListener('click', () => {
            messageInput.value = card.dataset.prompt;
            onInputChange();
            sendMessage();
        });
    });

    // ------------------------------------------------------------------ //
    // Session management                                                   //
    // ------------------------------------------------------------------ //
    async function prefetchSession() {
        if (sessionId) return sessionId;
        try {
            const res = await fetch('/dsk/session', { method: 'POST' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            sessionId = data.session_id;
            return sessionId;
        } catch (err) {
            sessionId = null;
            throw err;
        }
    }

    async function ensureSession() {
        if (sessionId) return true;
        try {
            await (sessionPromise || prefetchSession());
            return !!sessionId;
        } catch {
            try {
                await prefetchSession();
                return !!sessionId;
            } catch (err) {
                showToast('❌ فشل إنشاء الجلسة: ' + err.message);
                return false;
            }
        }
    }

    // ------------------------------------------------------------------ //
    // Send message                                                         //
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
            timerEl.textContent = `⏱ ${elapsed.toFixed(1)}s`;
        }, 100);

        let thinkingContent = '';
        let textContent     = '';
        let hasThinking     = false;
        let hasText         = false;
        let pendingRender   = false;
        const startTime     = performance.now();

        function scheduleRender() {
            if (pendingRender) return;
            pendingRender = true;
            requestAnimationFrame(() => {
                pendingRender = false;
                if (hasText) bubble.innerHTML = formatText(textContent);
                if (hasThinking) thinkingBody.textContent = thinkingContent;
                scheduleScroll();
            });
        }

        try {
            const res = await fetch('/dsk/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: sessionId,
                    prompt,
                    thinking_enabled: thinkingEnabled,
                    search_enabled: searchEnabled,
                    parent_message_id: parentMessageId,
                }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `HTTP ${res.status}`);
            }

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
                        scheduleScroll();
                        break;
                    }

                    if (chunk.type === 'thinking' && chunk.content) {
                        if (!hasThinking) {
                            hasThinking = true;
                            if (loadingEl.parentNode) loadingEl.remove();
                            thinkingBlock.style.display = 'block';
                            thinkingBlock.classList.add('open');
                        }
                        thinkingContent += chunk.content;
                        scheduleRender();
                    }

                    if (chunk.type === 'text' && chunk.content) {
                        if (!hasText) {
                            hasText = true;
                            if (loadingEl.parentNode) loadingEl.remove();
                            bubble.style.display = 'block';
                        }
                        textContent += chunk.content;
                        scheduleRender();
                    }

                    if (chunk.message_id) parentMessageId = chunk.message_id;
                }
            }

            if (hasText) bubble.innerHTML = formatText(textContent);
            if (hasThinking) thinkingBody.textContent = thinkingContent;

        } catch (err) {
            clearInterval(tickInterval);
            if (loadingEl.parentNode) loadingEl.remove();
            bubble.style.display = 'block';
            bubble.innerHTML = `<span style="color:#fca5a5">❌ ${escapeHtml(err.message)}</span>`;
        } finally {
            clearInterval(tickInterval);
            const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
            timerEl.textContent = `⏱ ${elapsed}s`;
            timerEl.classList.add('done');

            if (!hasText && !hasThinking) {
                if (loadingEl.parentNode) loadingEl.remove();
                bubble.style.display = 'block';
                bubble.textContent = 'لم يتم استلام رد.';
            }
            isStreaming = false;
            sendBtn.disabled = messageInput.value.trim() === '';
            scheduleScroll();

            sessionPromise = prefetchSession().catch(() => {});
        }
    }

    // ------------------------------------------------------------------ //
    // DOM helpers                                                          //
    // ------------------------------------------------------------------ //
    function addUserMessage(text) {
        const group = document.createElement('div');
        group.className = 'message-group user';
        group.innerHTML = `<div class="message-bubble">${escapeHtml(text)}</div>`;
        chatMessages.appendChild(group);
        scheduleScroll();
    }

    function addAIPlaceholder() {
        const group = document.createElement('div');
        group.className = 'message-group assistant';
        group.innerHTML = `
            <div class="thinking-block" style="display:none">
                <div class="thinking-header" onclick="this.parentElement.classList.toggle('open')">
                    <span>🤔</span>
                    <span>جاري التفكير...</span>
                    <span class="thinking-chevron">▼</span>
                </div>
                <div class="thinking-body"></div>
            </div>
            <div class="loading-dots"><span></span><span></span><span></span></div>
            <div class="message-bubble" style="display:none"></div>
            <div class="response-timer">⏱ 0.0s</div>`;
        chatMessages.appendChild(group);
        scheduleScroll();
        return group;
    }

    function onInputChange() {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 180) + 'px';
        sendBtn.disabled = messageInput.value.trim() === '' || isStreaming;
    }

    let scrollRaf = null;
    function scheduleScroll() {
        if (scrollRaf) return;
        scrollRaf = requestAnimationFrame(() => {
            chatMessages.scrollTop = chatMessages.scrollHeight;
            scrollRaf = null;
        });
    }

    function startNewChat() {
        sessionId = null;
        parentMessageId = null;
        chatMessages.innerHTML = '';

        if (welcomeScreen) {
            const clone = welcomeScreen.cloneNode(true);
            clone.style.display = '';
            chatMessages.appendChild(clone);
            clone.querySelectorAll('.suggestion-card').forEach(card => {
                card.addEventListener('click', () => {
                    messageInput.value = card.dataset.prompt;
                    onInputChange();
                    sendMessage();
                });
            });
        }

        sessionPromise = prefetchSession().catch(() => {});
    }

    // ------------------------------------------------------------------ //
    // Text utilities                                                       //
    // ------------------------------------------------------------------ //
    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatText(text) {
        const parts = [];
        let lastIndex = 0;
        const codeBlockRe = /```(\w*)\n?([\s\S]*?)```/g;
        let match;

        while ((match = codeBlockRe.exec(text)) !== null) {
            parts.push(renderInline(text.slice(lastIndex, match.index)));
            const lang = escapeHtml(match[1] || '');
            const code = escapeHtml(match[2]);
            parts.push(`<pre><code${lang ? ` class="language-${lang}"` : ''}>${code}</code></pre>`);
            lastIndex = match.index + match[0].length;
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
})();
