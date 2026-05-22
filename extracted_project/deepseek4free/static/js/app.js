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
        });
    });

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
            const res = await fetch('/api/keys');
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
            const res = await fetch('/api/keys', {
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
            const res = await fetch(`/api/keys/${kid}`, { method: 'DELETE' });
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
    sessionPromise = prefetchSession();

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
            const res = await fetch('/api/session', { method: 'POST' });
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
        } catch (err) {
            showToast('❌ فشل إنشاء الجلسة: ' + err.message);
            return false;
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

        // Live ticking counter
        let tickInterval = setInterval(() => {
            const elapsed = (performance.now() - startTime) / 1000;
            timerEl.textContent = `⏱ ${elapsed.toFixed(1)}s`;
        }, 100);

        let thinkingContent = '';
        let textContent     = '';
        let hasThinking     = false;
        let hasText         = false;
        let pendingRender   = false;  // RAF gate
        const startTime     = performance.now();

        // Batched DOM update via requestAnimationFrame
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
            const res = await fetch('/api/chat', {
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
                buffer = lines.pop(); // keep incomplete line

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

            // Final render to ensure last batch is applied
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

            // Pre-fetch session for next message immediately
            sessionPromise = prefetchSession();
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

    // Debounced scroll — avoids layout thrashing during fast streaming
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

        // Pre-fetch a new session immediately
        sessionPromise = prefetchSession();
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
        // Process code blocks before escaping other HTML
        const parts = [];
        let lastIndex = 0;
        const codeBlockRe = /```(\w*)\n?([\s\S]*?)```/g;
        let match;

        while ((match = codeBlockRe.exec(text)) !== null) {
            // Plain text before the code block
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
