/* =========================================================
   contacts.js — يبني روابط واتساب الرسمية (wa.me) من config.js
   ========================================================= */
(function () {
    'use strict';
    var cfg = window.SHABAKA_CONTACTS || {};
    var links = document.querySelectorAll('[data-dev]');

    function buildLink(phone) {
        var cc = String(cfg.countryCode || '').replace(/\D/g, '');
        var n = String(phone || '').replace(/\D/g, '').replace(/^0+/, '');
        if (!n) return null;
        if (cc && n.indexOf(cc) !== 0) n = cc + n;
        if (n.length < 8 || n.length > 15) return null;

        var url = 'https://wa.me/' + n;
        var msg = String(cfg.message || '').trim();
        if (msg) url += '?text=' + encodeURIComponent(msg);
        return url;
    }

    Array.prototype.forEach.call(links, function (a) {
        var url = buildLink(cfg[a.getAttribute('data-dev')]);
        if (url) {
            a.href = url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
        } else {
            a.classList.add('is-disabled');   // رقم ناقص أو غير صحيح: لا رابط
            a.setAttribute('aria-disabled', 'true');
        }
    });
})();
