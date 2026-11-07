/* =========================================================
   script.js — منطق صفحة تسجيل الدخول
   ========================================================= */
(function () {
    'use strict';
    var S = window.Shabaka;
    if (!S) return;

    /* ---------- الإعدادات (عدّلها من هنا فقط) ---------- */
    var CONFIG = Object.freeze({
        // عنوان التحقق من الكرت في السيرفر، مثال: '/api/login'
        // اتركه فارغاً = وضع تجريبي يقبل أي رقم من 16 خانة (للتجربة فقط)
        authEndpoint: '',
        cardLength: 12,
        maxAttempts: 5,          // عدد المحاولات الخاطئة قبل الإيقاف المؤقت
        lockSeconds: 60,         // مدة الإيقاف الأولى (تتضاعف مع التكرار)
        requestTimeoutMs: 10000,
        savedCardDays: 7,        // مدة الاحتفاظ بالكرت المحفوظ
        dashboardUrl: 'dashboard.html'
    });

    // إذا كانت هناك جلسة فعالة، انتقل مباشرة إلى اللوحة
    if (S.session.load()) {
        location.replace(CONFIG.dashboardUrl);
        return;
    }

    var form = document.getElementById('loginForm');
    var input = document.getElementById('cardNumber');
    var group = document.getElementById('cardGroup');
    var countEl = document.getElementById('cardCount');
    var errorEl = document.getElementById('cardError');
    var saveBox = document.getElementById('saveCard');
    var loginBtn = document.getElementById('loginBtn');
    var progress = document.getElementById('progress');

    var busy = false;
    var lockTimer = null;
    var wasLocked = false;

    /* ---------- أدوات الإدخال ---------- */
    // تحويل الأرقام العربية والفارسية إلى لاتينية ثم إبقاء الأرقام فقط
    function toDigits(str) {
        return String(str)
            .replace(/[\u0660-\u0669]/g, function (d) { return d.charCodeAt(0) - 0x0660; })
            .replace(/[\u06F0-\u06F9]/g, function (d) { return d.charCodeAt(0) - 0x06F0; })
            .replace(/\D/g, '')
            .slice(0, CONFIG.cardLength);
    }
    function groupDigits(d) { return d.replace(/(\d{4})(?=\d)/g, '$1 '); }

    function setError(msg) {
        errorEl.textContent = msg || '';
        input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    }

    function updateCardUI(d) {
        group.classList.toggle('is-valid', d.length === CONFIG.cardLength);
        countEl.textContent = d.length + ' من ' + CONFIG.cardLength + ' رقماً';
    }

    input.addEventListener('input', function () {
        var pos = input.selectionStart == null ? input.value.length : input.selectionStart;
        var before = toDigits(input.value.slice(0, pos)).length;
        var d = toDigits(input.value);
        var text = groupDigits(d);
        input.value = text;

        // إعادة المؤشر إلى مكانه الصحيح بعد إضافة المسافات
        var caret = 0, seen = 0;
        while (caret < text.length && seen < Math.min(before, d.length)) {
            if (text.charAt(caret) !== ' ') seen++;
            caret++;
        }
        try { input.setSelectionRange(caret, caret); } catch (e) { /* تجاهل */ }

        updateCardUI(d);
        if (errorEl.textContent && lockRemaining() === 0) setError('');
    });

    /* ---------- الكرت المحفوظ (اختياري، ينتهي تلقائياً) ---------- */
    var SAVED_KEY = 'shabaka.card';

    function loadSavedCard() {
        var o = null;
        try { o = JSON.parse(S.local.get(SAVED_KEY)); } catch (e) { o = null; }
        if (!o || typeof o.v !== 'string' || !/^\d+$/.test(o.v) || o.v.length !== CONFIG.cardLength || !(o.exp > Date.now())) {
            S.local.remove(SAVED_KEY);
            return;
        }
        input.value = groupDigits(o.v);
        saveBox.checked = true;
        updateCardUI(o.v);
    }
    function persistCard(d) {
        if (saveBox.checked) {
            S.local.set(SAVED_KEY, JSON.stringify({ v: d, exp: Date.now() + CONFIG.savedCardDays * 864e5 }));
        } else {
            S.local.remove(SAVED_KEY);
        }
    }
    saveBox.addEventListener('change', function () { if (!saveBox.checked) S.local.remove(SAVED_KEY); });

    /* ---------- الحد من المحاولات الخاطئة (حماية من التخمين) ---------- */
    var LOCK_KEY = 'shabaka.lock';

    function readLock() {
        var o = null;
        try { o = JSON.parse(S.local.get(LOCK_KEY)); } catch (e) { o = null; }
        return { fails: Number(o && o.fails) || 0, locks: Number(o && o.locks) || 0, until: Number(o && o.until) || 0 };
    }
    function writeLock(l) { S.local.set(LOCK_KEY, JSON.stringify(l)); }
    function lockRemaining() { return Math.max(0, Math.ceil((readLock().until - Date.now()) / 1000)); }

    function registerFailure() {
        var l = readLock();
        l.fails += 1;
        if (l.fails >= CONFIG.maxAttempts) {
            var secs = Math.min(CONFIG.lockSeconds * Math.pow(2, l.locks), 900);
            l.until = Date.now() + secs * 1000;
            l.locks += 1;
            l.fails = 0;
        }
        writeLock(l);
    }

    function refreshLock() {
        clearTimeout(lockTimer);
        var r = lockRemaining();
        if (r > 0) {
            wasLocked = true;
            loginBtn.disabled = true;
            setError('تم إيقاف المحاولات مؤقتاً بسبب كثرة الأخطاء. حاول بعد ' + r + ' ثانية.');
            lockTimer = setTimeout(refreshLock, 1000);
        } else if (wasLocked) {
            wasLocked = false;
            setError('');
            if (!busy) loginBtn.disabled = false;
        }
    }

    /* ---------- تسجيل الدخول ---------- */
    function demoSession() {
        // بيانات تجريبية للعرض فقط — في الإنتاج يرسلها السيرفر
        return { startedAt: Date.now(), totalSeconds: 3 * 3600, totalMB: 2048, usedMB: 0 };
    }

    function signIn(card) {
        if (!CONFIG.authEndpoint) {
            return new Promise(function (resolve) {
                setTimeout(function () { resolve({ ok: true, session: demoSession() }); }, 1000);
            });
        }
        var ctrl = new AbortController();
        var timer = setTimeout(function () { ctrl.abort(); }, CONFIG.requestTimeoutMs);
        return fetch(CONFIG.authEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            cache: 'no-store',
            signal: ctrl.signal,
            body: JSON.stringify({
                card: card,
                cardType: document.getElementById('cardType').value,
                speed: document.getElementById('speedType').value
            })
        }).then(function (res) {
            if (res.status === 429) return { ok: false, reason: 'rate' };
            if (res.status >= 500) return { ok: false, reason: 'server' };
            if (!res.ok) return { ok: false, reason: 'invalid' };
            return res.json().then(function (data) {
                var s = data && data.ok ? S.session.sanitize(data.session) : null;
                return s ? { ok: true, session: s } : { ok: false, reason: 'invalid' };
            }, function () {
                return { ok: false, reason: 'server' };
            });
        }).catch(function () {
            return { ok: false, reason: 'network' };
        }).then(function (r) {
            clearTimeout(timer);
            return r;
        });
    }

    function setBusy(on) {
        busy = on;
        loginBtn.disabled = on || lockRemaining() > 0;
        loginBtn.textContent = on ? 'جاري التحقق...' : 'دخول';
        progress.hidden = !on;
        progress.classList.toggle('is-running', on);
        progress.classList.remove('is-done');
    }

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (busy) return;
        if (lockRemaining() > 0) { refreshLock(); return; }

        var d = toDigits(input.value);
        if (d.length === 0) {
            setError('أدخل رقم الكرت للمتابعة.');
            input.focus();
            return;
        }
        if (d.length !== CONFIG.cardLength) {
            setError('رقم الكرت ناقص: أدخلت ' + d.length + ' من ' + CONFIG.cardLength + ' رقماً.');
            input.focus();
            return;
        }

        setError('');
        setBusy(true);

        signIn(d).then(function (result) {
            if (result.ok) {
                writeLock({ fails: 0, locks: 0, until: 0 });
                persistCard(d);
                S.session.save(result.session);
                progress.classList.remove('is-running');
                progress.classList.add('is-done');
                S.toast.show('تم تسجيل الدخول بنجاح');
                setTimeout(function () { location.replace(CONFIG.dashboardUrl); }, 900);
                return;
            }

            setBusy(false);
            if (result.reason === 'network') {
                setError('تعذر الاتصال بالشبكة. تحقق من الاتصال وحاول مرة أخرى.');
            } else if (result.reason === 'server') {
                setError('الخدمة غير متاحة حالياً. حاول بعد قليل.');
            } else if (result.reason === 'rate') {
                setError('محاولات كثيرة في وقت قصير. انتظر قليلاً ثم حاول مرة أخرى.');
            } else {
                registerFailure();
                setError('رقم الكرت غير صحيح أو منتهي. تأكد منه وحاول مرة أخرى.');
            }
            refreshLock();
            input.focus();
        });
    });

    /* ---------- أقسام الخدمات (نقاط البيع / QR / الأسعار) ---------- */
    var tiles = Array.prototype.slice.call(document.querySelectorAll('.tile'));

    function setPanel(tile, open) {
        var panel = document.getElementById(tile.getAttribute('aria-controls'));
        if (!panel) return;
        tile.setAttribute('aria-expanded', String(open));
        panel.classList.toggle('is-open', open);
        panel.inert = !open;
    }
    function closeAll() { tiles.forEach(function (t) { setPanel(t, false); }); }

    tiles.forEach(function (tile) {
        tile.addEventListener('click', function () {
            var wasOpen = tile.getAttribute('aria-expanded') === 'true';
            closeAll();
            if (!wasOpen) setPanel(tile, true);
        });
    });
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        var active = tiles.filter(function (t) { return t.getAttribute('aria-expanded') === 'true'; })[0];
        if (active) { closeAll(); active.focus(); }
    });

    /* ---------- صورة QR (تظهر رسالة بديلة إن لم توجد الصورة) ---------- */
    var qrImg = document.getElementById('qrImage');
    var qrEmpty = document.getElementById('qrEmpty');
    function showQrFallback() { qrImg.hidden = true; qrEmpty.hidden = false; }
    qrImg.addEventListener('error', showQrFallback);
    if (qrImg.complete && qrImg.naturalWidth === 0) showQrFallback();

    /* ---------- بدء التشغيل ---------- */
    loadSavedCard();
    refreshLock();
    var note = S.flash.take();
    if (note) S.toast.show(note.msg, note.type);
})();
