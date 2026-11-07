/* =========================================================
   shared.js — أدوات مشتركة: الأمان، الجلسة، الساعة، الرسائل
   ========================================================= */
(function () {
    'use strict';

    // حماية من تضمين الصفحة داخل إطار في موقع آخر (Clickjacking)
    if (window.top !== window.self) {
        try { window.top.location.href = window.self.location.href; } catch (e) { /* ممنوع */ }
        document.documentElement.textContent = '';
        return;
    }

    /* ---------- تخزين آمن (لا يتعطل إذا كان التخزين ممنوعاً) ---------- */
    function makeStore(area) {
        return {
            get: function (k) { try { return window[area].getItem(k); } catch (e) { return null; } },
            set: function (k, v) { try { window[area].setItem(k, v); return true; } catch (e) { return false; } },
            remove: function (k) { try { window[area].removeItem(k); } catch (e) { /* تجاهل */ } }
        };
    }
    var local = makeStore('localStorage');
    var tab = makeStore('sessionStorage');

    /* ---------- الجلسة (تُحذف تلقائياً بإغلاق التبويب) ---------- */
    var SESSION_KEY = 'shabaka.session';

    function clamp(v, max) {
        var n = Number(v);
        return isFinite(n) ? Math.min(Math.max(n, 0), max) : 0;
    }

    // تنظيف أي بيانات جلسة قبل استخدامها: أرقام فقط وضمن حدود معقولة
    function sanitizeSession(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var s = {
            startedAt: clamp(raw.startedAt, 8.64e15) || Date.now(),
            totalSeconds: clamp(raw.totalSeconds, 31536000),
            totalMB: clamp(raw.totalMB, 1e7),
            usedMB: clamp(raw.usedMB, 1e7)
        };
        if (s.totalSeconds <= 0) return null;
        s.usedMB = Math.min(s.usedMB, s.totalMB);
        return s;
    }

    var session = {
        sanitize: sanitizeSession,
        save: function (s) {
            var clean = sanitizeSession(s);
            if (!clean) return false;
            return tab.set(SESSION_KEY, JSON.stringify(clean));
        },
        load: function () {
            var s = null;
            try { s = sanitizeSession(JSON.parse(tab.get(SESSION_KEY))); } catch (e) { s = null; }
            if (!s) { tab.remove(SESSION_KEY); return null; }
            if (Date.now() - s.startedAt >= s.totalSeconds * 1000) { tab.remove(SESSION_KEY); return null; }
            return s;
        },
        clear: function () { tab.remove(SESSION_KEY); }
    };

    /* ---------- رسالة تُعرض بعد الانتقال بين الصفحات ---------- */
    var FLASH_KEY = 'shabaka.flash';
    var flash = {
        set: function (msg, type) { tab.set(FLASH_KEY, JSON.stringify({ msg: String(msg), type: type || 'ok' })); },
        take: function () {
            var f = null;
            try { f = JSON.parse(tab.get(FLASH_KEY)); } catch (e) { f = null; }
            tab.remove(FLASH_KEY);
            return f && typeof f.msg === 'string' ? f : null;
        }
    };

    /* ---------- الرسائل المنبثقة (textContent فقط، لا HTML) ---------- */
    var toastTimer = null;
    var toast = {
        show: function (msg, type) {
            var el = document.getElementById('toast');
            if (!el) return;
            el.textContent = msg;
            el.className = 'toast' + (type === 'warn' ? ' toast--warn' : type === 'error' ? ' toast--error' : '');
            void el.offsetWidth;
            el.classList.add('is-visible');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(function () { el.classList.remove('is-visible'); }, 3500);
        }
    };

    /* ---------- التاريخ والوقت (بأرقام لاتينية لتتوافق مع باقي الصفحة) ---------- */
    var dateFmt = new Intl.DateTimeFormat('ar-YE-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    var timeFmt = new Intl.DateTimeFormat('ar-YE-u-nu-latn', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    function startClock() {
        var d = document.querySelector('[data-date]');
        var t = document.querySelector('[data-time]');
        if (!d && !t) return;
        function tick() {
            var now = new Date();
            if (d) d.textContent = dateFmt.format(now);
            if (t) t.textContent = timeFmt.format(now);
        }
        tick();
        setInterval(tick, 1000);
    }


    /* ---------- بانر الإعلانات: تتابع تلقائي + تنقل يدوي (نقاط/أسهم/سحب/كيبورد) ---------- */
    function initHero() {
        var hero = document.querySelector('.hero');
        if (!hero) return;

        // صورة ناقصة: يظهر الشكل البديل بدل الأيقونة المكسورة
        Array.prototype.forEach.call(hero.querySelectorAll('img'), function (img) {
            var box = img.parentNode;
            function miss() { box.classList.add('is-missing'); }
            img.addEventListener('error', miss);
            if (img.complete && img.naturalWidth === 0) miss();
        });

        var slides = Array.prototype.slice.call(hero.querySelectorAll('.slide'));
        var L = slides.length;
        var stage = hero.querySelector('.hero__stage');
        var dotsBox = document.getElementById('heroDots');
        var dots = [], index = 0, timer = null;
        var hovering = false, kbFocus = false;   // يتوقف التقليب أثناء الإشارة بالفأرة أو التنقل بالكيبورد
        var DELAY = 2000;   // مدة بقاء كل إعلان (بالملي ثانية)

        function paint() {
            slides.forEach(function (s, n) {
                var rel = (n - index + L) % L;          // 0 = الحالي، 1 = التالي، L-1 = السابق
                s.classList.toggle('is-active', rel === 0);
                s.classList.toggle('is-before', L > 2 && rel === L - 1);
            });
            dots.forEach(function (d, n) { d.setAttribute('aria-current', String(n === index)); });
        }
        function show(i) { index = (i + L) % L; paint(); }
        function stop() { clearInterval(timer); timer = null; }
        function start() {
            if (timer || L < 2 || hovering || kbFocus || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
            timer = setInterval(function () { if (!document.hidden) show(index + 1); }, DELAY);
        }
        function go(i) { show(i); stop(); start(); }

        if (L < 2) { show(0); return; }

        if (dotsBox) {
            slides.forEach(function (s, n) {
                var b = document.createElement('button');
                b.type = 'button';
                b.setAttribute('aria-label', 'الإعلان ' + (n + 1) + ' من ' + L);
                b.addEventListener('click', function () { go(n); });
                dotsBox.appendChild(b);
                dots.push(b);
            });
        }

        // الأسهم (العربية: السابق يمين، التالي يسار)
        var prev = hero.querySelector('.hero__nav--prev');
        var next = hero.querySelector('.hero__nav--next');
        if (prev) prev.addEventListener('click', function () { go(index - 1); });
        if (next) next.addEventListener('click', function () { go(index + 1); });

        // السحب باللمس أو الفأرة: السحب لليمين = التالي، لليسار = السابق
        var sx = 0, sy = 0, tracking = false;
        stage.addEventListener('pointerdown', function (e) { sx = e.clientX; sy = e.clientY; tracking = true; });
        stage.addEventListener('pointerup', function (e) {
            if (!tracking) return;
            tracking = false;
            var dx = e.clientX - sx, dy = e.clientY - sy;
            if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2) go(dx > 0 ? index + 1 : index - 1);
        });
        stage.addEventListener('pointercancel', function () { tracking = false; });

        // لوحة المفاتيح
        hero.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowLeft') { go(index + 1); }
            else if (e.key === 'ArrowRight') { go(index - 1); }
        });

        hero.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') { hovering = true; stop(); } });
        hero.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') { hovering = false; start(); } });
        hero.addEventListener('focusin', function (e) {
            kbFocus = !!(e.target.matches && e.target.matches(':focus-visible'));
            if (kbFocus) stop();
        });
        hero.addEventListener('focusout', function () { kbFocus = false; start(); });

        var notice = hero.querySelector('.hero__notice');
        if (notice) notice.addEventListener('click', function () {
            toast.show(notice.getAttribute('data-message') || '', 'warn');
        });

        show(0);
        start();
    }

    /* ---------- الخط: يُحمَّل بعد ظهور الصفحة حتى لا يعطّلها إذا كان الإنترنت مغلقاً ---------- */
    function loadFont() {
        var l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = 'https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap';
        document.head.appendChild(l);
    }
    if (document.readyState === 'complete') loadFont();
    else window.addEventListener('load', loadFont);

    window.Shabaka = Object.freeze({
        local: local,
        tab: tab,
        session: session,
        flash: flash,
        toast: toast,
        startClock: startClock
    });

    startClock();
    initHero();
})();
