/*!
 * portfolio-analytics.js — consent-gated, site-scoped PostHog loader  (v2)
 * ---------------------------------------------------------------------------
 * v2 changes, each driven by a review finding:
 *   - The SDK is NOT requested before consent. v1 loaded it un-gated and only
 *     gated capture, which still leaks network metadata (IP, UA, Referer) to a
 *     third party. Now a visitor who has not accepted causes ZERO requests to
 *     any posthog host. Verified by test (asserts every request, not just POSTs).
 *   - The page view is the STANDARD `$pageview` event (was a custom `page_view`),
 *     so PostHog's built-in Web Analytics - sessions, paths, retention - works
 *     on the same data our own dashboards read. One event, not two.
 *   - Private routes are never reported at all (config: privatePathPrefixes).
 *   - Path PII: identifier-shaped path segments are collapsed to ':id', path is
 *     length-capped, and campaign values must match a strict token shape.
 *   - Sessions are the SDK's own session id, so session counts and retention are
 *     real session semantics rather than a proxy built from users.
 *
 * Design rules still in force:
 *   - No event, no cookie and no localStorage identity before consent.
 *   - Autocapture, pageleave, dead clicks, heatmaps, performance/web vitals,
 *     feature flags, surveys and session replay are all explicitly OFF, and the
 *     project settings disable them again server-side.
 *   - Events and properties are an explicit allowlist; before_send re-checks.
 *   - One browser identity per SITE, not per portfolio.
 *   - Consent is withdrawable and honoured immediately.
 *
 * Usage (per site, before this script):
 *   <script>
 *     window.PORTFOLIO_ANALYTICS = {
 *       projectToken: 'phc_...',            // public ingestion key, EU project
 *       site: { key: 'voyageary', label: 'voyageary.com' },
 *       allowedHosts: ['voyageary.com', 'www.voyageary.com'],
 *       privatePathPrefixes: ['/account/', '/library/']   // never reported
 *     };
 *   </script>
 *   <script defer src="/js/portfolio-analytics.js"></script>
 *
 * Public API: window.portfolioAnalytics.{ready(fn), pageview(), track(event, props),
 *             setConsent('granted'|'denied'), getConsent(), reset(), enabled}
 */
(function (window, document) {
  'use strict';

  var DEFAULTS = {
    apiHost: 'https://eu.i.posthog.com',
    assetsUrl: 'https://eu-assets.i.posthog.com/static/array.js',
    uiHost: 'https://eu.posthog.com',
    consentKey: 'pa_consent_v1',
    storagePrefix: 'pa_id_',
    schemaVersion: 2,
    debug: false,
    // A visitor who has not accepted must cause NO third-party request at all.
    loadSdkOnlyOnConsent: true,
    respectGlobalPrivacyControl: true,
    campaignParams: ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content',
                     'utm_term', 'ref', 'gclid', 'fbclid'],
    // Route prefixes that are never reported, on any event. Owner/private
    // surfaces, account and library pages, anything with a token in the path.
    privatePathPrefixes: [],
    forbiddenKeys: ['email', 'phone', 'tel', 'name', 'address', 'file', 'filename',
                    'document', 'note', 'message', 'content', 'text', 'body', 'query',
                    'search', 'password', 'token', 'key', 'iban', 'card', 'passport',
                    'latitude', 'longitude', 'lat', 'lng', 'dob', 'birth'],
    maxValueLength: 120,
    maxPathLength: 160,
  };

  // '$pageview' is the standard PostHog page view event: it is what built-in Web
  // Analytics and native sessions/retention are computed from. It is listed here
  // so that our own property allowlist still applies to it.
  var EVENT_SCHEMA = {
    $pageview: ['path', 'referrer_host', 'utm_source', 'utm_medium', 'utm_campaign', 'ref',
                '$current_url', '$pathname', '$session_id'],
    tool_opened: ['tool', 'path'],
    tool_started: ['tool', 'path'],
    tool_completed: ['tool', 'path', 'duration_ms', 'duration_kind'],
    tool_export: ['tool', 'format'],
    tool_error: ['tool', 'error_code'],
    outbound_referral: ['target_host', 'path', 'placement'],
    store_referral: ['product_handle', 'placement'],
    store_product_viewed: ['product_handle', 'currency'],
    store_cart_viewed: ['items_count', 'value', 'currency'],
    store_checkout_started: ['items_count', 'value', 'currency'],
    store_purchase: ['order_ref', 'value', 'currency', 'items_count', 'products_count'],
    claim_started: ['category'],
    claim_submitted: ['category'],
  };

  var CFG = null;
  var consentState = null;
  var pageviewSent = false;
  var sdkRequested = false;
  var sdkLoaded = false;
  var initApplied = false;   // SDK initialised
  var booted = false;        // loader finished its boot sequence
  var sdkReady = false;      // real init has run; capture is safe
  var pending = [];          // events captured between consent and init
  var noopMode = false;

  // ---------------------------------------------------------------- utilities

  function log() {
    if (CFG && CFG.debug && window.console) {
      var a = Array.prototype.slice.call(arguments);
      a.unshift('[analytics]');
      window.console.log.apply(window.console, a);
    }
  }
  function warn() {
    if (window.console && window.console.warn) {
      var a = Array.prototype.slice.call(arguments);
      a.unshift('[analytics]');
      window.console.warn.apply(window.console, a);
    }
  }
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function lsDel(k) { try { window.localStorage.removeItem(k); return true; } catch (e) { return false; } }
  function storageName() { return CFG.storagePrefix + CFG.site.key; }

  // Identifier-shaped segments (a uuid, a long hex digest, a long number) are
  // collapsed, because a path segment can identify a person or a private record
  // even though it is "only a path".
  var ID_SEGMENT = /^(?:[0-9a-f]{16,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{6,})$/i;

  function isPrivatePath(path) {
    var p = String(path || '/');
    for (var i = 0; i < CFG.privatePathPrefixes.length; i++) {
      var pre = CFG.privatePathPrefixes[i];
      if (pre && p.indexOf(pre) === 0) return true;
    }
    return false;
  }

  // Path only: no query, no fragment, no identifier-shaped segment.
  function safePath() {
    var path = String(window.location.pathname || '/');
    if (isPrivatePath(path)) return null;
    var segs = path.split('/');
    for (var i = 0; i < segs.length; i++) {
      if (segs[i] && ID_SEGMENT.test(segs[i])) segs[i] = ':id';
    }
    var out = segs.join('/');
    if (!out || out.charAt(0) !== '/') out = '/' + out;
    return out.slice(0, CFG.maxPathLength);
  }

  // Campaign params only, and only token-shaped values. A `ref=` that carries a
  // customer id or an email would otherwise sail straight through.
  function campaignProps() {
    var out = {};
    var qs;
    try { qs = new window.URLSearchParams(window.location.search); } catch (e) { return out; }
    for (var i = 0; i < CFG.campaignParams.length; i++) {
      var p = CFG.campaignParams[i];
      if (!qs.has(p)) continue;
      var v = qs.get(p);
      if (v && v.length <= 64 && /^[\w.\-]+$/.test(v)) out[p] = v;
    }
    return out;
  }

  function referrerHost() {
    try {
      if (!document.referrer) return null;
      var u = new window.URL(document.referrer);
      if (u.hostname === window.location.hostname) return null;
      return u.hostname.slice(0, 80);
    } catch (e) { return null; }
  }

  function isForbiddenKey(k) {
    var lk = String(k).toLowerCase();
    if (lk.charAt(0) === '$') return false;
    for (var i = 0; i < CFG.forbiddenKeys.length; i++) {
      if (lk.indexOf(CFG.forbiddenKeys[i]) !== -1) return true;
    }
    return false;
  }

  var EMAILISH = /[^\s@]+@[^\s@]+\.[^\s@]{2,}/;
  var LONGISH = /\s/;
  var URLISH = /^https?:\/\//i;

  function scrubUrls(props) {
    for (var k in props) {
      if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
      var v = props[k];
      if (typeof v !== 'string' || !URLISH.test(v)) continue;
      var host = null, path = '';
      try {
        var u = new window.URL(v);
        host = u.hostname;
        path = u.pathname;
      } catch (e) { props[k] = null; continue; }
      props[k] = (host === window.location.hostname)
        ? window.location.origin + safePath()
        : 'https://' + host + '/';
    }
  }

  function cleanValue(v) {
    var t = typeof v;
    if (v === null || v === undefined) return null;
    if (t === 'number') return isFinite(v) ? v : null;
    if (t === 'boolean') return v;
    if (t !== 'string') return null;
    if (v.length === 0 || v.length > CFG.maxValueLength) return null;
    if (EMAILISH.test(v)) return null;
    if (LONGISH.test(v) && v.length > 32) return null;
    return v;
  }

  function cleanProps(event, props) {
    var allowed = EVENT_SCHEMA[event];
    var out = {};
    if (!allowed) return out;
    props = props || {};
    for (var k in props) {
      if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
      if (allowed.indexOf(k) === -1) { warn('dropped property not in allowlist for "' + event + '":', k); continue; }
      if (isForbiddenKey(k)) { warn('dropped forbidden property for "' + event + '":', k); continue; }
      var cv = cleanValue(props[k]);
      if (cv !== null) out[k] = cv;
    }
    out.site = CFG.site.key;
    out.site_label = CFG.site.label;
    out.schema_version = CFG.schemaVersion;
    out.is_consented = consentState === 'granted';
    return out;
  }

  // ------------------------------------------------------------------- SDK glue

  // NOTE - deliberately NO hand-rolled stub here.
  // An earlier version pre-installed the classic posthog snippet stub (the one
  // that sets __SV=1) and then called posthog.init() after the bundle loaded.
  // That combination silently LOSES THE TOKEN: the bundle adopts the pre-existing
  // stub, replays `_i` itself, and the resulting instance ends up with our config
  // (api_host, autocapture off) but no api_key - so every ingest POST is rejected
  // with HTTP 400 "non-engage request missing event name attribute" and the
  // project stays empty while the browser looks perfectly healthy.
  // The bundle bootstraps window.posthog on its own; events captured before init
  // are buffered by `pending` and flushed by flushPending().

  function loadSdk(cb) {
    if (sdkLoaded) return cb();
    if (sdkRequested) return;              // never request the SDK twice
    sdkRequested = true;
    var s = document.createElement('script');
    s.type = 'text/javascript';
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = CFG.assetsUrl;
    s.onload = function () { sdkLoaded = true; cb(); };
    s.onerror = function () { warn('PostHog SDK failed to load from', CFG.assetsUrl); cb(); };
    var first = document.getElementsByTagName('script')[0];
    if (first && first.parentNode) first.parentNode.insertBefore(s, first);
    else document.head.appendChild(s);
  }

  function sdkInitConfig() {
    var granted = consentState === 'granted';
    return {
      api_host: CFG.apiHost,
      ui_host: CFG.uiHost,
      // The SDK is only ever requested once consent exists, so it starts opted in
      // in that case. The opt-out default remains as belt-and-braces for any path
      // that reaches init without consent.
      opt_out_capturing_by_default: !granted,
      opt_out_capturing_persistence_type: 'local_storage',
      persistence: granted ? 'localStorage' : 'memory',
      persistence_name: storageName(),
      cross_subdomain_cookie: false,
      request_batching: false,
      disable_session_recording: true,
      capture_pageview: false,          // captured explicitly, exactly once
      capture_pageleave: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      capture_performance: false,
      capture_exceptions: false,
      autocapture: false,
      advanced_disable_flags: true,
      disable_surveys: true,
      disable_toolbar: true,
      disable_external_dependency_loading: true,
      person_profiles: 'identified_only',
      mask_all_text: true,
      mask_all_element_attributes: true,
      property_denylist: CFG.forbiddenKeys,
      sanitize_properties: function (props, event) {
        if (event === '$pageview' || event === '$pageleave') {
          props.$current_url = window.location.origin + (safePath() || '/');
        }
        return props;
      },
      before_send: function (payload) {
        if (!payload || !payload.event) return payload;
        if (consentState !== 'granted') { log('before_send blocked (no consent)'); return null; }
        var name = payload.event;
        if (!EVENT_SCHEMA[name]) { warn('before_send dropped non-allowlisted event:', name); return null; }
        var sp = safePath();
        if (sp === null) { warn('before_send dropped a private-route event:', name); return null; }
        var props = payload.properties || {};
        for (var k in props) {
          if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
          if (isForbiddenKey(k)) { delete props[k]; continue; }
          var cv = cleanValue(props[k]);
          if (cv === null && props[k] !== null) delete props[k];
        }
        if (props.$current_url) props.$current_url = window.location.origin + sp;
        if (props.$pathname) props.$pathname = sp;
        if (props.path) props.path = sp;
        if (props.$referrer) props.$referrer = referrerHost() ? ('https://' + referrerHost() + '/') : null;
        scrubUrls(props);
        payload.properties = props;
        return payload;
      }
    };
  }

  // ------------------------------------------------------------------ behaviour

  function applyConsentGranted() {
    if (!window.posthog || !window.posthog.set_config) { log('SDK not ready for grant'); return; }
    try { window.posthog.set_config({ persistence: 'localStorage', persistence_name: storageName() }); }
    catch (e) { warn('set_config failed', e); }
    try { window.posthog.opt_in_capturing(); } catch (e) { warn('opt_in failed', e); }
  }

  function clearIdentityStorage() {
    lsDel(storageName());
    lsDel(storageName() + '_id');
    lsDel('ph_' + storageName());
  }

  function applyConsentDenied() {
    if (!window.posthog) return;
    try { window.posthog.opt_out_capturing(); } catch (e) {}
    try { window.posthog.reset(); } catch (e) {}
    clearIdentityStorage();
    log('consent denied/withdrawn; identity cleared');
  }

  function flushPending() {
    var q = pending;
    pending = [];
    for (var i = 0; i < q.length; i++) {
      try { window.posthog.capture(q[i][0], q[i][1]); } catch (e) { warn('flush failed', e); }
    }
  }

  function emit(name, props) {
    if (consentState !== 'granted') { log('emit suppressed (consent=' + consentState + ')'); return false; }
    if (!EVENT_SCHEMA[name]) { warn('event not in allowlist, refused:', name); return false; }
    if (safePath() === null) { warn('event refused on a private route:', name); return false; }
    var clean = cleanProps(name, props);
    log('capture', name, clean);
    // Consent is granted but the bundle may still be in flight; buffering keeps
    // the event instead of dropping it or throwing on a bare stub.
    if (!sdkReady) {
      if (pending.length < 50) pending.push([name, clean]);
      return true;
    }
    try { window.posthog.capture(name, clean); } catch (e) { warn('capture failed', e); return false; }
    return true;
  }

  function pageview() {
    if (pageviewSent) { log('duplicate pageview suppressed'); return false; }
    if (consentState !== 'granted') return false;
    var sp = safePath();
    if (sp === null) { warn('private route: no pageview reported'); return false; }
    var props = campaignProps();
    props.path = sp;
    props.$pathname = sp;
    props.$current_url = window.location.origin + sp;
    var rh = referrerHost();
    if (rh) props.referrer_host = rh;
    var ok = emit('$pageview', props);
    if (ok) pageviewSent = true;
    return ok;
  }

  // Announcements are BUFFERED as well as dispatched. The loader boots at parse
  // time, before the page's own listeners exist, so a dispatch-only design loses
  // events for anything that attaches later. The buffer is the catch-up path;
  // listeners that are already attached (the real sites' they-run-after case)
  // still get the synchronous dispatch.
  var ANNOUNCE_LOG = [];
  function announce(name, detail) {
    var rec = { name: name, detail: detail || {} };
    ANNOUNCE_LOG.push(rec);
    try {
      document.dispatchEvent(new window.CustomEvent('portfolioanalytics:' + name, { detail: rec.detail, bubbles: true }));
    } catch (e) {}
  }

  // Loads (once) and initialises the SDK, then applies whatever consent state is
  // current. Only ever called when consent has been granted at least once.
  //
  // ORDER MATTERS (cost a debugging cycle): `posthog.init` must be called AFTER
  // bundle load. Calling it earlier only queues into the stub's `_i`, and the
  // loaded bundle replaces `window.posthog` wholesale, so the queued config is
  // discarded and the SDK ends up on its own defaults (api_host us.i.posthog.com,
  // autocapture on). Events captured in the gap are buffered by us and flushed
  // after the real init.
  function startSdk(then) {
    loadSdk(function () {
      try {
        if (!window.posthog || window.posthog.__loaded !== true) {
          window.posthog.init(CFG.projectToken, sdkInitConfig());
        }
      } catch (e) { warn('init failed', e); }
      initApplied = true;
      booted = true;
      if (consentState === 'granted') applyConsentGranted();
      sdkReady = true;
      flushPending();
      if (then) then();
    });
  }

  function setConsent(value, opts) {
    if (value !== 'granted' && value !== 'denied') throw new Error('consent must be granted|denied');
    var was = consentState;
    consentState = value;
    if (value === 'granted') {
      lsSet(CFG.consentKey, 'granted');
      var finish = function () {
        applyConsentGranted();
        pageview();
        announce('consent', { consent: value });
      };
      if (sdkLoaded || initApplied) finish();
      else if (CFG.loadSdkOnlyOnConsent) {
        // First request to a third party happens HERE, after the click, never before.
        startSdk(finish);
      } else finish();
      return true;
    }
    lsSet(CFG.consentKey, 'denied');
    if (window.posthog) applyConsentDenied();
    announce('consent', { consent: value, was: was });
    return true;
  }
  function getConsent() { return consentState; }

  function reset() {
    consentState = null;
    lsDel(CFG.consentKey);
    lsDel(storageName());
    lsDel(storageName() + '_id');
    pageviewSent = false;
    if (window.posthog) {
      try { window.posthog.opt_out_capturing(); } catch (e) {}
      try { window.posthog.reset(); } catch (e) {}
    }
    announce('reset', {});
    return true;
  }

  var API = {
    ready: function (fn) {
      if (booted) { fn(API); return; }
      var tries = 0;
      var t = window.setInterval(function () {
        if (booted || ++tries > 250) { window.clearInterval(t); fn(API); }
      }, 20);
    },
    pageview: pageview,
    track: emit,
    setConsent: setConsent,
    getConsent: getConsent,
    reset: reset,
    schemaVersion: DEFAULTS.schemaVersion,
    events: EVENT_SCHEMA,
    // Catch-up for code that attaches after boot: see announce().
    announcements: ANNOUNCE_LOG,
  };

  // ------------------------------------------------------------------- bootstrap

  function boot() {
    var user = window.PORTFOLIO_ANALYTICS;
    CFG = {};
    for (var d in DEFAULTS) if (Object.prototype.hasOwnProperty.call(DEFAULTS, d)) CFG[d] = DEFAULTS[d];
    if (user) for (var u in user) if (Object.prototype.hasOwnProperty.call(user, u)) CFG[u] = user[u];
    CFG.storagePrefix = CFG.storagePrefix || 'pa_id_';
    CFG.allowedHosts = CFG.allowedHosts || [];
    CFG.privatePathPrefixes = CFG.privatePathPrefixes || [];

    window.portfolioAnalytics = API;

    // 1) Host allowlist: previews, dev servers and accidental embeds stay silent.
    var host = String(window.location.hostname || '');
    if (!CFG.allowedHosts.length || CFG.allowedHosts.indexOf(host) === -1) {
      noopMode = true;
      warn('host not in allowedHosts (' + host + '): analytics disabled on this host');
      API.ready = function (fn) { fn(API); };
      API.track = function () { return false; };
      API.pageview = function () { return false; };
      API.setConsent = function () { return false; };
      API.enabled = false;
      return;
    }
    API.enabled = true;

    // 2) Existing decision, or a privacy signal, decides before anything loads.
    var stored = lsGet(CFG.consentKey);
    if (CFG.respectGlobalPrivacyControl && window.navigator && window.navigator.globalPrivacyControl === true) {
      consentState = 'denied';
      log('Global Privacy Control detected -> denied');
    } else if (stored === 'granted' || stored === 'denied') {
      consentState = stored;
    } else {
      consentState = null;
    }

    // 3) A visitor who has not accepted causes no third-party request: the SDK
    //    script is not inserted until consent exists.
    if (consentState === 'granted') {
      startSdk(function () { pageview(); announce('ready', { site: CFG.site.key, consent: consentState }); });
      return;
    }
    if (consentState === 'denied') { booted = true; announce('ready', { site: CFG.site.key, consent: consentState }); return; }
    booted = true;                       // loader booted (the SDK is deliberately absent)
    announce('consent-required', { site: CFG.site.key, consentKey: CFG.consentKey });
    announce('ready', { site: CFG.site.key, consent: consentState });
  }

  boot();
})(window, document);
