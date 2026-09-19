/*!
 * portfolio-analytics.js — consent-gated, site-scoped PostHog loader
 * ---------------------------------------------------------------------------
 * STATUS: prepared for deployment. NOT deployed. Requires a real PostHog EU
 * project token (see ../ONBOARDING.md step 1). Nothing here contains a token.
 *
 * Design rules (each one is exercised by ../tests/run_consent_tests.mjs):
 *   - No data leaves the browser before consent. The SDK is loaded (PostHog's
 *     own guidance: do not gate the snippet behind consent — gate capture),
 *     initialised opted-out by default with memory-only persistence, and no
 *     event is captured until setConsent('granted').
 *   - Autocapture, pageleave, dead clicks, heatmaps, performance/Web Vitals,
 *     feature flags and session replay are all explicitly OFF. Replay is OFF
 *     by policy, not by masking.
 *   - Events are an explicit allowlist with an explicit property allowlist.
 *     Anything else is refused, and a final before_send guard re-checks.
 *   - Private form contents, files, filenames, notes, message bodies, contact
 *     lists, travel details and URLs with query payloads are never sent: the
 *     page path is stripped to pathname + an allowlist of campaign params.
 *   - One browser identity per SITE, not per portfolio: identity storage is
 *     namespaced per site key and cross-subdomain cookies are off, so the
 *     single free-tier PostHog project cannot link a visitor across sites.
 *   - Consent is withdrawable and honoured immediately.
 *
 * Usage (per site, before this script):
 *   <script>
 *     window.PORTFOLIO_ANALYTICS = {
 *       projectToken: 'phc_...',            // public ingestion key, EU project
 *       site: { key: 'voyageary', label: 'voyageary.com' },
 *       allowedHosts: ['voyageary.com', 'www.voyageary.com']
 *     };
 *   </script>
 *   <script defer src="/js/portfolio-analytics.js"></script>
 *
 * Public API: window.portfolioAnalytics.{ready(function), pageview(), track(event, props),
 *             setConsent('granted'|'denied'), getConsent(), reset()}
 */
(function (window, document) {
  'use strict';

  var DEFAULTS = {
    apiHost: 'https://eu.i.posthog.com',
    assetsUrl: 'https://eu-assets.i.posthog.com/static/array.js',
    uiHost: 'https://eu.posthog.com',
    consentKey: 'pa_consent_v1',
    schemaVersion: 1,
    debug: false,
    // Global Privacy Control / Do-Not-Track style signals are honoured as a refusal.
    respectGlobalPrivacyControl: true,
    // Query parameters that may survive into the page path property. Everything
    // else (?q=…, ?file=…, ?address=…, search terms, tokens) is dropped.
    campaignParams: ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content',
                     'utm_term', 'ref', 'gclid', 'fbclid'],
    // Property keys that must never reach the analytics backend, matched
    // case-insensitively as substrings.
    forbiddenKeys: ['email', 'phone', 'tel', 'name', 'address', 'file', 'filename',
                    'document', 'note', 'message', 'content', 'text', 'body', 'query',
                    'search', 'password', 'token', 'key', 'iban', 'card', 'passport',
                    'latitude', 'longitude', 'lat', 'lng', 'dob', 'birth'],
    // Value-shape guards applied to every property value.
    maxValueLength: 120,
  };

  var EVENT_SCHEMA = {
    page_view: ['path', 'referrer_host', 'utm_source', 'utm_medium', 'utm_campaign', 'ref'],
    tool_opened: ['tool', 'path'],
    tool_started: ['tool', 'path'],
    tool_completed: ['tool', 'path', 'duration_ms'],
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
  var GLOBAL_PROPS = ['site', 'site_label', 'schema_version', 'page_path', 'is_consented'];

  var CFG = null;
  var consentState = null;      // 'granted' | 'denied' | null
  var pageviewSent = false;
  var sdkLoaded = false;
  var initApplied = false;
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

  function lsGet(k) {
    try { return window.localStorage.getItem(k); } catch (e) { return null; }
  }
  function lsSet(k, v) {
    try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; }
  }
  function lsDel(k) {
    try { window.localStorage.removeItem(k); return true; } catch (e) { return false; }
  }

  function storageName() {
    return CFG.storagePrefix + CFG.site.key;
  }

  // Path without query string, fragment, or anything identifying.
  function safePath() {
    var path = String(window.location.pathname || '/');
    return path.slice(0, 200);
  }

  // Campaign params only; never the raw query string.
  function campaignProps() {
    var out = {};
    var qs;
    try { qs = new window.URLSearchParams(window.location.search); } catch (e) { return out; }
    for (var i = 0; i < CFG.campaignParams.length; i++) {
      var p = CFG.campaignParams[i];
      if (qs.has(p)) {
        var v = qs.get(p);
        // loose sanitisation: these are campaign tokens, not free text
        if (v && /^[\w.\-]{1,64}$/.test(v)) out[p] = v;
      }
    }
    return out;
  }

  // External referrer host only — never the full referrer URL (it can carry
  // search terms and identifiers).
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
    for (var i = 0; i < CFG.forbiddenKeys.length; i++) {
      if (lk.indexOf(CFG.forbiddenKeys[i]) !== -1) return true;
    }
    return false;
  }

  var EMAILISH = /[^\s@]+@[^\s@]+\.[^\s@]{2,}/;
  var LONGISH = /\s/;   // any whitespace suggests free text, not a token
  var URLISH = /^https?:\/\//i;

  // The SDK attaches its own automatic properties ($current_url, $initial_current_url,
  // $referrer, ...). Those carry the RAW query string, so every URL-shaped value is
  // rewritten here regardless of which event it belongs to: same-host URLs keep
  // origin + path, external URLs are reduced to their origin.
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
        ? window.location.origin + path
        : 'https://' + host + '/';
    }
  }

  function cleanValue(v) {
    var t = typeof v;
    if (v === null || v === undefined) return null;
    if (t === 'number') return isFinite(v) ? v : null;
    if (t === 'boolean') return v;
    if (t !== 'string') return null;                 // no objects, arrays, DOM nodes
    if (v.length === 0 || v.length > CFG.maxValueLength) return null;
    if (EMAILISH.test(v)) return null;               // never ship an address
    if (LONGISH.test(v) && v.length > 32) return null; // free-text-looking value
    return v;
  }

  function cleanProps(event, props) {
    var allowed = EVENT_SCHEMA[event];
    var out = {};
    if (!allowed) return out;
    props = props || {};
    for (var k in props) {
      if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
      if (allowed.indexOf(k) === -1) {
        warn('dropped property not in allowlist for "' + event + '":', k);
        continue;
      }
      if (isForbiddenKey(k)) {
        warn('dropped forbidden property for "' + event + '":', k);
        continue;
      }
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

  var SDK_STUB_METHODS = ('init capture register register_once register_for_session unregister '
    + 'unregister_for_session getFeatureFlag getFeatureFlagResult isFeatureEnabled reloadFeatureFlags '
    + 'on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys canRenderSurvey '
    + 'identify setPersonProperties group resetGroups reset get_distinct_id getGroups get_session_id '
    + 'set_config startSessionRecording stopSessionRecording sessionRecordingStarted '
    + 'captureException get_property getSessionProperty createPersonProfile opt_in_capturing '
    + 'opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing '
    + 'debug').split(' ');

  function installStub() {
    if (window.posthog && window.posthog.__SV) return;
    var ph = window.posthog = window.posthog || [];
    ph._i = ph._i || [];
    ph.init = function (token, config, name) {
      ph._i.push([token, config, name]);
    };
    for (var i = 0; i < SDK_STUB_METHODS.length; i++) {
      (function (m) {
        ph[m] = function () {
          ph._i.push([m].concat(Array.prototype.slice.call(arguments)));
        };
      })(SDK_STUB_METHODS[i]);
    }
    ph.__SV = 1;
  }

  function loadSdk(cb) {
    if (sdkLoaded) return cb();
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
    return {
      api_host: CFG.apiHost,
      ui_host: CFG.uiHost,
      // ---- collection is OFF until consent ----
      opt_out_capturing_by_default: true,
      opt_out_capturing_persistence_type: 'local_storage',
      // no cookies/localStorage identity until consent
      persistence: 'memory',
      // Honoured at INIT time only (the SDK computes its storage key once), so the
      // site-scoped identity key must be set here and not via set_config later.
      persistence_name: storageName(),
      cross_subdomain_cookie: false,
      // Send on capture instead of on a batch flush: deterministic short path,
      // no events sitting in a queue when consent is withdrawn.
      request_batching: false,
      disable_session_recording: true,
      capture_pageview: false,          // captured explicitly, exactly once
      capture_pageleave: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      capture_performance: false,
      capture_exceptions: false,
      autocapture: false,
      advanced_disable_flags: true,     // no /flags round-trip; no flags/surveys/replay
      disable_surveys: true,
      disable_toolbar: true,
      disable_external_dependency_loading: true,
      person_profiles: 'identified_only',
      mask_all_text: true,              // belt-and-braces if anything auto-captures
      mask_all_element_attributes: true,
      property_denylist: CFG.forbiddenKeys,
      sanitize_properties: function (props, event) {
        if (event === '$pageview' || event === '$pageleave') {
          // The SDK's own pageview is disabled; if it ever fires, make it safe.
          props.$current_url = window.location.origin + safePath();
        }
        return props;
      },
      before_send: function (payload) {
        if (!payload || !payload.event) return payload;
        if (consentState !== 'granted') { log('before_send blocked (no consent)'); return null; }
        var name = payload.event;
        if (name.charAt(0) !== '$' && !EVENT_SCHEMA[name]) {
          warn('before_send dropped non-allowlisted event:', name);
          return null;
        }
        var props = payload.properties || {};
        for (var k in props) {
          if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
          if (isForbiddenKey(k)) { delete props[k]; continue; }
          var cv = cleanValue(props[k]);
          if (cv === null && props[k] !== null) delete props[k];
        }
        if (props.$current_url) props.$current_url = window.location.origin + safePath();
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
    log('consent granted; persistence ->', storageName());
  }

  function clearIdentityStorage() {
    lsDel(storageName());
    lsDel(storageName() + '_id');
    // the SDK prefixes persistence_name with "ph_" when it creates its key
    lsDel('ph_' + storageName());
  }

  function applyConsentDenied() {
    if (!window.posthog) return;
    try { window.posthog.opt_out_capturing(); } catch (e) { /* noop */ }
    try { window.posthog.reset(); } catch (e) { /* noop */ }
    clearIdentityStorage();
    log('consent denied/withdrawn; identity cleared');
  }

  function emit(name, props) {
    if (consentState !== 'granted') { log('emit suppressed (consent=' + consentState + ')'); return false; }
    if (name.charAt(0) !== '$' && !EVENT_SCHEMA[name]) {
      warn('event not in allowlist, refused:', name);
      return false;
    }
    var clean = cleanProps(name, props);
    log('capture', name, clean);
    try { window.posthog.capture(name, clean); } catch (e) { warn('capture failed', e); return false; }
    return true;
  }

  function pageview() {
    if (pageviewSent) { log('duplicate page_view suppressed'); return false; }
    if (consentState !== 'granted') return false;
    var props = campaignProps();
    props.path = safePath();
    var rh = referrerHost();
    if (rh) props.referrer_host = rh;
    var ok = emit('page_view', props);
    if (ok) pageviewSent = true;
    return ok;
  }

  // Announcements bubble from `document`, so listeners on either document or
  // window receive them (an event dispatched on `window` never reaches document).
  function announce(name, detail) {
    try {
      document.dispatchEvent(new window.CustomEvent('portfolioanalytics:' + name, { detail: detail || {}, bubbles: true }));
    } catch (e) { /* older browsers */ }
  }

  function setConsent(value, opts) {
    if (value !== 'granted' && value !== 'denied') throw new Error('consent must be granted|denied');
    consentState = value;
    if (value === 'granted') {
      lsSet(CFG.consentKey, 'granted');
      applyConsentGranted();
      pageview();
    } else {
      lsSet(CFG.consentKey, 'denied');
      applyConsentDenied();
    }
    announce('consent', { consent: value });
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
      if (sdkLoaded && initApplied) { fn(API); return; }
      var t = window.setInterval(function () {
        if (sdkLoaded && initApplied) { window.clearInterval(t); fn(API); }
      }, 20);
    },
    pageview: pageview,
    track: emit,
    setConsent: setConsent,
    getConsent: getConsent,
    reset: reset,
    schemaVersion: DEFAULTS.schemaVersion,
    events: EVENT_SCHEMA
  };

  // ------------------------------------------------------------------- bootstrap

  function boot() {
    var user = window.PORTFOLIO_ANALYTICS;
    CFG = {};
    for (var d in DEFAULTS) if (Object.prototype.hasOwnProperty.call(DEFAULTS, d)) CFG[d] = DEFAULTS[d];
    if (user) for (var u in user) if (Object.prototype.hasOwnProperty.call(user, u)) CFG[u] = user[u];
    CFG.storagePrefix = CFG.storagePrefix || 'pa_id_';
    CFG.allowedHosts = CFG.allowedHosts || [];

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

    // 3) Load and initialise the SDK. Per PostHog's guidance the snippet is NOT
    //    gated behind consent; capture is. Initial state is opted out.
    installStub();
    loadSdk(function () {
      try {
        // The stub queued init and the SDK replays it on load; only init here if
        // it has not already been initialised (avoids a double-init warning).
        // NOTE: no instance name is passed on purpose. posthog.init(token, cfg, 'name')
        // creates a NAMED instance (posthog.name.capture), leaving window.posthog
        // itself uninitialised - every call would queue forever and never send.
        if (!window.posthog || window.posthog.__loaded !== true) {
          window.posthog.init(CFG.projectToken, sdkInitConfig());
        }
        initApplied = true;
      } catch (e) { warn('init failed', e); initApplied = true; }
      if (consentState === 'granted') {
        applyConsentGranted();
        pageview();
      } else if (consentState === 'denied') {
        applyConsentDenied();
      } else {
        announce('consent-required', { site: CFG.site.key, consentKey: CFG.consentKey });
      }
      announce('ready', { site: CFG.site.key, consent: consentState });
    });
  }

  boot();
})(window, document);
