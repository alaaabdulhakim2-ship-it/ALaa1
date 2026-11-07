/* =========================================================
   dashboard.js — منطق لوحة المستخدم
   ========================================================= */
(function () {
    'use strict';
    var S = window.Shabaka;
    if (!S) return;

    /* ---------- روابط الأزرار (ضع الروابط الحقيقية هنا) ---------- */
    var LINKS = Object.freeze({
        rest: '',   // رابط الاستراحة
        live: '',   // رابط البث المباشر
        app: ''     // رابط تحميل التطبيق
    });
    var LOGIN_URL = 'index.html';

    /* ---------- حماية الصفحة: لا دخول بدون جلسة ---------- */
    function leave(msg, type) {
        S.session.clear();
        S.flash.set(msg, type);
        location.replace(LOGIN_URL);
    }

    var session = S.session.load();
    if (!session) { leave('سجّل الدخول أولاً للوصول إلى اللوحة.', 'warn'); return; }

    // عند الرجوع بزر "رجوع" بعد الخروج (الصفحة المحفوظة في الذاكرة) نعيد التحقق
    window.addEventListener('pageshow', function (e) {
        if (e.persisted && !S.session.load()) leave('انتهت الجلسة، سجّل الدخول من جديد.', 'warn');
    });

    /* ---------- التنسيق ---------- */
    var nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
    function pad(n) { return (n < 10 ? '0' : '') + n; }

    function clock(sec) {
        var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
        return pad(h) + ':' + pad(m) + ':' + pad(s);
    }
    function hoursWord(n) { return n === 1 ? 'ساعة' : n === 2 ? 'ساعتان' : n <= 10 ? 'ساعات' : 'ساعة'; }
    function minutesWord(n) { return n === 1 ? 'دقيقة' : n === 2 ? 'دقيقتان' : n <= 10 ? 'دقائق' : 'دقيقة'; }

    function remainingText(sec) {
        var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
        if (h === 0 && m === 0) return 'أقل من دقيقة';
        var parts = [];
        if (h > 0) parts.push((h <= 2 ? '' : h + ' ') + hoursWord(h));
        if (m > 0) parts.push((m <= 2 ? '' : m + ' ') + minutesWord(m));
        return parts.join(' و ');
    }

    /* ---------- العرض ---------- */
    var el = {
        balance: document.getElementById('balance'),
        remain: document.getElementById('balRemain'),
        total: document.getElementById('balTotal'),
        gauge: document.getElementById('gauge'),
        timeLeft: document.getElementById('timeLeft'),
        timeUsed: document.getElementById('timeUsed'),
        dataUsed: document.getElementById('dataUsed')
    };
    var timer = null;

    function render() {
        var elapsed = Math.floor((Date.now() - session.startedAt) / 1000);
        var left = session.totalSeconds - elapsed;
        if (left <= 0) { clearInterval(timer); leave('انتهى وقت الكرت. سجّل الدخول بكرت جديد.', 'warn'); return; }

        var remainMB = Math.max(session.totalMB - session.usedMB, 0);
        var pct = session.totalMB > 0 ? Math.round((remainMB / session.totalMB) * 100) : 0;

        el.remain.textContent = nf.format(remainMB);
        el.total.textContent = nf.format(session.totalMB);
        el.timeLeft.textContent = remainingText(left);
        el.timeUsed.textContent = clock(elapsed);
        el.dataUsed.textContent = nf.format(session.usedMB) + ' ميجابايت';

        el.gauge.firstElementChild.style.setProperty('--p', pct + '%');
        el.gauge.setAttribute('aria-valuenow', String(pct));
        el.balance.classList.toggle('is-low', pct <= 15);
    }

    render();
    timer = setInterval(render, 1000);

    /* ---------- أزرار الروابط (http / https فقط) ---------- */
    Array.prototype.forEach.call(document.querySelectorAll('[data-link]'), function (btn) {
        btn.addEventListener('click', function () {
            var url = LINKS[btn.getAttribute('data-link')];
            var ok = false;
            try { ok = /^https?:$/.test(new URL(url, location.href).protocol) && !!url; } catch (e) { ok = false; }
            if (!ok) { S.toast.show('هذا الرابط غير متاح حالياً', 'warn'); return; }
            window.open(url, '_blank', 'noopener,noreferrer');
        });
    });

    /* ---------- تسجيل الخروج ---------- */
    var logoutBtn = document.getElementById('logoutBtn');
    logoutBtn.addEventListener('click', function () {
        logoutBtn.disabled = true;
        logoutBtn.textContent = 'جاري تسجيل الخروج...';
        clearInterval(timer);
        leave('تم تسجيل الخروج بنجاح', 'ok');
    });
})();
