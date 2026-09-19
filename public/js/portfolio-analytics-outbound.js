/*!
 * portfolio-analytics-outbound.js — outbound referral tracking for the
 * portfolio-analytics loader.
 * ---------------------------------------------------------------------------
 * Optional companion to portfolio-analytics.js. It adds ONE delegated click
 * listener and emits a single `outbound_referral` event when a visitor follows
 * a link to a different host (a shop, a phone/WhatsApp/maps link, a partner).
 *
 * Why a separate file: the loader is the consent gate and is verified by
 * ../tests/run_consent_tests.mjs. Keeping this additive means that verified file
 * stays byte-identical, and a site that does not want click tracking simply does
 * not include this script.
 *
 * What it never does:
 *   - never reads form fields, file names, or page text
 *   - never sends the full URL, only the target HOST and the page path
 *   - never sends anything at all before consent (the loader's own gate refuses)
 *   - never blocks or delays the click: it reports and lets navigation proceed
 *
 * Properties are limited to the loader's own allowlist for outbound_referral:
 *   target_host, path, placement
 */
(function (window, document) {
  'use strict';

  var MAX_HOST = 80;

  function targetHost(href) {
    try {
      var u = new window.URL(href, window.location.href);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      if (u.hostname === window.location.hostname) return null;   // internal link
      return u.hostname.slice(0, MAX_HOST);
    } catch (e) {
      return null;
    }
  }

  function placementFor(el) {
    // Explicit, author-controlled placement label only. Never derived from the
    // link text or href, which could contain something identifying.
    var n = el;
    for (var i = 0; i < 4 && n; i++) {
      if (n.getAttribute) {
        var p = n.getAttribute('data-pa-placement');
        if (p) return String(p).replace(/[^\w.\-]/g, '').slice(0, 40);
      }
      n = n.parentElement;
    }
    return 'link';
  }

  function onClick(e) {
    if (e.defaultPrevented) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var el = e.target;
    while (el && el.tagName !== 'A') el = el.parentElement;
    if (!el || !el.getAttribute) return;
    var href = el.getAttribute('href');
    if (!href) return;
    var host = targetHost(href);
    if (!host) return;
    var api = window.portfolioAnalytics;
    if (!api || !api.track) return;
    try {
      api.track('outbound_referral', {
        target_host: host,
        path: String(window.location.pathname || '/').slice(0, 200),
        placement: placementFor(el),
      });
    } catch (err) {
      /* reporting must never break navigation */
    }
  }

  // Capture phase would fire before a handler could cancel; bubble is right here
  // because a prevented click means the visitor did not actually leave.
  document.addEventListener('click', onClick, false);
})(window, document);
