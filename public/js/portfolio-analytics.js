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
    // --- active engagement -------------------------------------------------
    // "Active time" = the page is VISIBLE, the window has FOCUS, and there was
    // real interaction within idleTimeoutMs. Hidden, unfocused or idle time is
    // excluded rather than counted. No input value is ever read.
    engagementTickMs: 1000,
    idleTimeoutMs: 30000,
    minEngagementMs: 1000,
  };

  // '$pageview' is the standard PostHog page view event: it is what built-in Web
  // Analytics and native sessions/retention are computed from. It is listed here
  // so that our own property allowlist still applies to it.
  var EVENT_SCHEMA = {
    $pageview: ['path', 'referrer_host', 'utm_source', 'utm_medium', 'utm_campaign', 'ref',
                '$current_url', '$pathname', '$session_id',
                'session_index', 'is_returning_browser'],
    // Active engagement for one page view. engaged_ms counts only visible +
    // focused + non-idle time; visible_ms counts visible time regardless of idle.
    // Never carries input, text or element content.
    engagement_time: ['path', 'engaged_ms', 'visible_ms', 'idle_timeout_ms', 'end_reason'],
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

  // Properties the SDK itself may attach for a request to remain routable and attributable.
  // Enumerated explicitly: this is a FINAL-BOUNDARY allowlist, so nothing is permitted merely
  // because its name starts with '$'. Identity / session / device / routing fields only -
  // never content, input, element text, or search terms.
  var SDK_PROPS = [
    'token', 'distinct_id', '$session_id', '$window_id', '$device_id', '$pageview_id',
    '$lib', '$lib_version', '$insert_id', '$time', '$sent_at', '$geoip_disable',
    '$current_url', '$pathname', '$host', '$referrer', '$referring_domain',
    '$browser', '$browser_version', '$os', '$os_version', '$device_type', '$device',
    '$screen_height', '$screen_width', '$viewport_height', '$viewport_width',
    '$process_person_profile', '$is_identified'
    // NOTE: the $session_entry_* fields are deliberately NOT allowlisted. Nothing in this
    // instrumentation reads them (no insight, dashboard or schema entry references them), and
    // $session_entry_pathname could carry an identifier-shaped path segment that before_send
    // does not rewrite. Not permitting what nothing needs is the smaller surface.
  ];
  var SDK_PROP_SET = {};
  for (var _spi = 0; _spi < SDK_PROPS.length; _spi++) SDK_PROP_SET[SDK_PROPS[_spi]] = true;

  // Fields the loader attaches to EVERY event (baseProps()): the site key/label and the schema
  // version. They are mandatory, not optional, so the final-boundary allowlist must permit them.
  var COMMON_PROPS = ['site', 'site_label', 'schema_version'];

  // The properties this event may carry: SDK routing/identity fields, the loader's mandatory
  // fields, and the event's own schema entries.
  function allowedPropSetFor(name) {
    var set = {};
    var k;
    for (k in SDK_PROP_SET) {
      if (Object.prototype.hasOwnProperty.call(SDK_PROP_SET, k)) set[k] = true;
    }
    for (var c = 0; c < COMMON_PROPS.length; c++) set[COMMON_PROPS[c]] = true;
    var schema = EVENT_SCHEMA[name] || [];
    for (var i = 0; i < schema.length; i++) set[schema[i]] = true;
    return set;
  }

  var CFG = null;
  var consentState = null;
  var pageviewSent = false;
  var sdkRequested = false;
  var sdkLoaded = false;
  var sdkLoading = false;    // a fetch of the SDK asset is in flight
  var sdkFailed = false;     // the LAST fetch failed; readiness is not claimed
  var sdkAttempts = 0;       // bounded retries (review finding: failure was reported as success)
  var sdkMaxAttempts = 3;
  var initApplied = false;   // SDK initialised
  var booted = false;        // loader finished its boot sequence
  var sdkReady = false;      // real init has run; capture is safe
  var pending = [];          // events captured between consent and init
  var noopMode = false;
  var engaged = null;        // active-engagement accumulator (null until consented)

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

  // Consent governs EVERY open tab, not only the one where the click happened. Another tab on this
  // origin writes the decision to localStorage, which fires a 'storage' event here, so adopt it:
  // on a withdrawal clear the queue, stop engagement and opt the SDK out (without writing back,
  // since the value already came from storage - writing would risk a loop).
  window.addEventListener('storage', function (e) {
    if (!e) return;
    // Only THIS origin's localStorage drives the consent lifecycle: this handler must never act on
    // a sessionStorage notification (or any other storage area), which is not the decision store.
    if (e.storageArea && e.storageArea !== window.localStorage) return;
    // localStorage.clear() reports key === null, so a clear used to be ignored entirely. The
    // decision is GONE afterwards and absence is not permission, so a clear IS revocation: discard
    // the queue, stop engagement and tear the SDK down. Without this branch, a tab that buffered an
    // event before another tab cleared storage would flush it after a later regrant, because the
    // final-boundary guard cannot tell which consent period the buffered event came from.
    if (e.key === null) {
      consentState = currentPersistedState();
      pending = [];
      stopEngagement();
      if (window.posthog) applyConsentDenied();
      announce('consent', { consent: consentState, was: 'granted', source: 'other-tab-clear' });
      log('consent decision cleared in another tab ->', consentState);
      return;
    }
    if (e.key !== CFG.consentKey) return;
    if (e.newValue === 'denied' || e.newValue === null) {
      consentState = e.newValue === null ? null : 'denied';
      pending = [];
      stopEngagement();
      if (window.posthog) applyConsentDenied();
      announce('consent', { consent: consentState, was: 'granted', source: 'other-tab' });
      log('consent changed in another tab ->', consentState);
      return;
    }
    if (e.newValue === 'granted') {
      // Reconcile against the CURRENT persisted decision: a storage event describes a change that
      // happened, and a withdrawal may already be stored by the time this notification runs. Trust
      // the stored value, not the notification's payload.
      if (!persistedGrantIsValid()) {
        consentState = currentPersistedState();
        pending = [];
        stopEngagement();
        if (window.posthog) applyConsentDenied();
        announce('consent', { consent: consentState, was: 'granted', source: 'other-tab-stale' });
        log('stale grant notification ignored; storage no longer grants');
        return;
      }
      consentState = 'granted';
      // Respect a grant made elsewhere if the SDK is already here. This tab does not initiate an
      // SDK request on someone else's click; a later navigation handles that.
      if (window.posthog) applyConsentGranted();
      announce('consent', { consent: 'granted', source: 'other-tab' });
      log('consent granted in another tab');
    }
  });

  // ONE consent-validity rule shared by initialisation, activation and sending: collection is
  // permitted only while an AFFIRMATIVE persisted grant exists. 'denied' and a REMOVED key are both
  // revocation (reset() deletes the key), and an absent decision is not permission.
  function persistedGrantIsValid() {
    return lsGet(CFG.consentKey) === 'granted';
  }

  // Fail closed to the decision storage actually holds, rather than trusting a stale in-memory one.
  function currentPersistedState() {
    var v = lsGet(CFG.consentKey);
    return v === 'granted' ? 'granted' : (v === 'denied' ? 'denied' : null);
  }
  function storageName() { return CFG.storagePrefix + CFG.site.key; }

  // Identifier-shaped segments (a uuid, a long hex digest, a long number) are
  // collapsed, because a path segment can identify a person or a private record
  // even though it is "only a path".
  var ID_SEGMENT = /^(?:[0-9a-f]{16,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{6,})$/i;

  function isPrivatePath(path) {
    var p = String(path || '/');
    for (var i = 0; i < CFG.privatePathPrefixes.length; i++) {
      var pre = CFG.privatePathPrefixes[i];
      if (!pre) continue;
      // Match the route ROOT exactly, or a slash-delimited DESCENDANT of it. The configured
      // trailing slash names descendants; the bare root is private too, because routes are
      // canonicalised without a trailing slash (e.g. '/library' serves the library root).
      // A different route sharing leading characters ('/library-news') must NOT match, so this
      // is a boundary test, never a bare prefix test.
      var root = pre.charAt(pre.length - 1) === '/' ? pre.slice(0, -1) : pre;
      if (p === root || p.indexOf(root + '/') === 0) return true;
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
    // cb(true) = the asset is loaded and the SDK is usable; cb(false) = it could not be fetched
    // (bounded retries exhausted). The distinction matters: the previous version called the SAME
    // callback on error, so startSdk() went on to claim readiness and a later acceptance took the
    // "already initialised" path instead of retrying - analytics stayed broken for that document
    // while every lifecycle flag said it was fine (independent review, round 13).
    if (sdkLoaded) return cb(true);
    if (sdkLoading) return;                     // a fetch is already in flight
    if (sdkFailed && sdkAttempts >= sdkMaxAttempts) return cb(false);
    sdkLoading = true;
    sdkRequested = true;
    sdkAttempts += 1;
    var s = document.createElement('script');
    s.type = 'text/javascript';
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = CFG.assetsUrl;
    s.onload = function () { sdkLoading = false; sdkLoaded = true; sdkFailed = false; cb(true); };
    s.onerror = function () {
      sdkLoading = false;
      sdkFailed = true;
      warn('PostHog SDK failed to load from ' + CFG.assetsUrl +
           ' (attempt ' + sdkAttempts + ' of ' + sdkMaxAttempts + ')');
      // Never the success callback: the caller must not claim readiness. A later explicit
      // acceptance retries, until the attempt bound is reached.
      cb(false);
    };
    var first = document.getElementsByTagName('script')[0];
    if (first && first.parentNode) first.parentNode.insertBefore(s, first);
    else document.head.appendChild(s);
  }

  function sdkInitConfig() {
    // Derived from the PERSISTED decision, NEVER from this tab's in-memory consentState. Another
    // tab may have withdrawn while this tab's SDK request was outstanding, and initialisation must
    // not be the step that enables persistence or opts the SDK in for a grant that no longer
    // exists. Reading the persisted value here is what makes "reconciled before init" true rather
    // than aspirational: a stale in-memory grant can no longer configure persistence.
    //
    // Persistence stays localStorage for a genuine grant, deliberately: the loader uses the SDK's
    // session id as the session boundary, so memory persistence would make every reload look like a
    // new session (the suite's J2 covers exactly that).
    var granted = lsGet(CFG.consentKey) === 'granted';
    return {
      api_host: CFG.apiHost,
      ui_host: CFG.uiHost,
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
      // NO property_denylist here on purpose. posthog-js applies it while building
      // the request, and an entry like 'key' matches the transport's own `api_key`
      // field - so the envelope reaches the ingest endpoint with no routing token
      // and every POST is rejected with HTTP 400 ("non-engage request missing event
      // name attribute") while the browser looks perfectly healthy. Our own
      // allowlist in cleanProps() plus before_send() below are the enforced path;
      // see probe_apikey_ablation.mjs for the ablation that proved it.
      sanitize_properties: function (props, event) {
        if (event === '$pageview' || event === '$pageleave') {
          props.$current_url = window.location.origin + (safePath() || '/');
        }
        return props;
      },
      before_send: function (payload) {
        if (!payload || !payload.event) return payload;
        // Sending is governed by the same rule: an affirmative PERSISTED grant must exist, so a
        // stale in-memory grant (or a decision removed in another tab) cannot transmit.
        if (consentState !== 'granted' || !persistedGrantIsValid()) {
          log('before_send blocked (no persisted consent)');
          return null;
        }
        var name = payload.event;
        if (!EVENT_SCHEMA[name]) { warn('before_send dropped non-allowlisted event:', name); return null; }
        var sp = safePath();
        if (sp === null) { warn('before_send dropped a private-route event:', name); return null; }
        var props = payload.properties || {};
        // Final-boundary allowlist: anything not permitted for THIS event is removed here, so a
        // property injected after cleanProps() - or by a direct SDK capture() - cannot reach the
        // wire. This is what makes the banner's "never sees search terms / input" claim true of
        // the transmitted payload and not merely of our own wrapper.
        var allowed = allowedPropSetFor(name);
        for (var k in props) {
          if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
          // A reserved routing field: the exact configured PUBLIC ingestion token survives
          // verbatim (not an application secret; deleting it makes the request unstorable).
          // Any other value is dropped. There is no blanket exemption for "$" keys.
          if (k === 'token') {
            if (props[k] !== CFG.projectToken) { warn('before_send dropped a non-matching routing token'); delete props[k]; }
            continue;
          }
          if (!allowed[k]) { warn('before_send dropped non-allowlisted property:', k); delete props[k]; continue; }
          if (isForbiddenKey(k)) { delete props[k]; continue; }
          var cv = cleanValue(props[k]);
          if (cv === null && props[k] !== null) delete props[k];
        }
        if (props.$current_url) props.$current_url = window.location.origin + sp;
        if (props.$pathname) props.$pathname = sp;
        if (props.path) props.path = sp;
        if (props.$referrer) props.$referrer = referrerHost() ? ('https://' + referrerHost() + '/') : null;
        // Structural guard for this whole class: a property whose NAME names a path must not
        // leave the boundary unsanitised. $pathname/path are rewritten above; any other
        // *pathname field is DROPPED rather than rewritten, because substituting the current
        // path would misrepresent the session's entry point.
        for (var pk in props) {
          if (!Object.prototype.hasOwnProperty.call(props, pk)) continue;
          if (pk === '$pathname' || pk === 'path') continue;
          if (/pathname$/i.test(pk)) {
            warn('before_send dropped an unsanitised path property:', pk);
            delete props[pk];
          }
        }
        scrubUrls(props);
        payload.properties = props;
        return payload;
      }
    };
  }

  // ------------------------------------------------------- active engagement
  //
  // Time is counted only while ALL of these hold: the document is visible, the
  // window has focus, and the visitor interacted within idleTimeoutMs. A tab left
  // open in the background, a minimised window or an untouched page contributes
  // ZERO. Nothing typed, clicked-on or scrolled-past is recorded - the listeners
  // only stamp a timestamp, so no form value, file name or element content can be
  // captured by construction.
  var ENGAGEMENT_INTERACTION = ['pointerdown', 'keydown', 'scroll', 'touchstart', 'wheel'];
  var engagementSent = false;

  function isFocused() {
    try { return document.hasFocus(); } catch (e) { return true; }
  }

  function startEngagement() {
    if (engaged) return;
    engaged = { engagedMs: 0, visibleMs: 0, lastInteraction: Date.now(), lastTick: Date.now() };

    function markInteraction() { if (engaged) engaged.lastInteraction = Date.now(); }
    for (var i = 0; i < ENGAGEMENT_INTERACTION.length; i++) {
      document.addEventListener(ENGAGEMENT_INTERACTION[i], markInteraction, { passive: true, capture: true });
    }

    engaged.timer = window.setInterval(function () {
      if (!engaged) return;
      var now = Date.now();
      var delta = now - engaged.lastTick;
      engaged.lastTick = now;
      if (delta < 0) return;
      if (!document.hidden) {
        engaged.visibleMs += delta;
        if (isFocused() && (now - engaged.lastInteraction) < CFG.idleTimeoutMs) {
          engaged.engagedMs += delta;
        }
      }
    }, CFG.engagementTickMs);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) flushEngagement('hidden');
    });
    window.addEventListener('pagehide', function () { flushEngagement('unload'); });
  }

  function stopEngagement() {
    if (!engaged) return;
    if (engaged.timer) window.clearInterval(engaged.timer);
    engaged = null;
    engagementSent = true;   // withdrawal: nothing further is reported
  }

  function flushEngagement(reason) {
    if (!engaged || engagementSent) return;
    var path = safePath();
    if (path === null) { stopEngagement(); return; }
    // A tick may not have run since the last interaction; settle the accumulator.
    var now = Date.now();
    var delta = now - engaged.lastTick;
    if (delta > 0 && !document.hidden) {
      engaged.visibleMs += delta;
      if (isFocused() && (now - engaged.lastInteraction) < CFG.idleTimeoutMs) engaged.engagedMs += delta;
    }
    engaged.lastTick = now;

    if (engaged.engagedMs < CFG.minEngagementMs) return;   // no noise for a bounce

    emit('engagement_time', {
      path: path,
      engaged_ms: Math.round(engaged.engagedMs),
      visible_ms: Math.round(engaged.visibleMs),
      idle_timeout_ms: CFG.idleTimeoutMs,
      end_reason: reason,
    });
    // One engagement event per page load: a later hide/show must not re-report the
    // same, cumulative time as if it were new time.
    engagementSent = true;
  }

  // ---------------------------------------------------------- repeat visitors
  //
  // A "returning measured browser" means a PRIOR, SEPARATE session on this site -
  // not a reload and not a second tab in the same session. The SDK's own session id
  // is the session boundary, and only a small counter plus the last session id are
  // persisted, namespaced per site, written only after consent.
  function sessionIndex() {
    var idxKey = storageName() + '_sessions';
    var curKey = storageName() + '_session_cur';
    var sid = null;
    try { sid = window.posthog.get_session_id(); } catch (e) {}
    if (!sid) return { index: 1, returning: false };
    var count = parseInt(lsGet(idxKey) || '0', 10);
    if (!isFinite(count) || count < 0) count = 0;
    var last = lsGet(curKey);
    if (last !== sid) {
      count += 1;
      lsSet(idxKey, String(count));
      lsSet(curKey, sid);
    }
    return { index: count, returning: count > 1 };
  }

  // ------------------------------------------------------------------ behaviour

  function applyConsentGranted() {
    // THE guarded activation boundary: every caller (explicit consent, SDK completion, storage
    // notification, boot) funnels through here, so activation never depends on each caller
    // remembering to check the persisted decision. A storage event reports a CHANGE, not the
    // current value - so by the time a queued "granted" notification is processed, storage may
    // already say otherwise. Refuse, and fail closed.
    if (!persistedGrantIsValid()) {
      consentState = currentPersistedState();
      pending = [];
      stopEngagement();
      if (window.posthog && window.posthog.opt_out_capturing) {
        try { window.posthog.opt_out_capturing(); } catch (e) {}
      }
      log('applyConsentGranted refused: no affirmative persisted grant');
      return false;
    }
    if (!window.posthog || !window.posthog.set_config) { log('SDK not ready for grant'); return false; }
    // A fresh consent period may report engagement again. stopEngagement() latches engagementSent
    // so the withdrawn period can never report more, and nothing ever cleared it - so acceptance
    // after a withdrawal (or after reset()) left engagement measurement permanently suppressed.
    // Only cleared when there is NO accumulator, so an already-running period keeps its
    // one-event-per-period property and no previously accumulated time is ever revived.
    if (!engaged) engagementSent = false;
    try { window.posthog.set_config({ persistence: 'localStorage', persistence_name: storageName() }); }
    catch (e) { warn('set_config failed', e); }
    try { window.posthog.opt_in_capturing(); } catch (e) { warn('opt_in failed', e); }
    return true;
  }

  function clearIdentityStorage() {
    lsDel(storageName());
    lsDel(storageName() + '_id');
    // Repeat-visitor bookkeeping is site-scoped identity too, so withdrawal must
    // clear it: leaving the session counter behind would keep recognising a visitor
    // who asked to be forgotten.
    lsDel(storageName() + '_sessions');
    lsDel(storageName() + '_session_cur');
    lsDel('ph_' + storageName());
  }

  function applyConsentDenied() {
    // Discard anything buffered while the SDK was loading. Consent governs each event's lifetime,
    // not merely the browser's consent state at send time: without this, withdrawing and then
    // accepting again before the SDK has loaded would flush activity captured during the revoked
    // period (see the held-SDK lifecycle regression, E21/E22).
    pending = [];
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
    if (pageviewSent) {
      log('duplicate pageview suppressed');
      // The PAGEVIEW is once per page load, but ENGAGEMENT must still (re)start: after a withdrawal
      // and a fresh acceptance in the same load the pageview is legitimately already sent, yet
      // engagement measurement has to resume (round-13 finding 4). startEngagement() is a no-op
      // while an accumulator exists, so this cannot create a second timer.
      if (consentState === 'granted') startEngagement();
      return false;
    }
    if (consentState !== 'granted') return false;
    var sp = safePath();
    if (sp === null) { warn('private route: no pageview reported'); return false; }
    var props = campaignProps();
    props.path = sp;
    props.$pathname = sp;
    props.$current_url = window.location.origin + sp;
    var rh = referrerHost();
    if (rh) props.referrer_host = rh;
    // Repeat-visitor measurement: a prior SEPARATE session on this site, not a
    // reload (the SDK's session id is the boundary, so a reload stays session 1).
    var si = sessionIndex();
    props.session_index = si.index;
    props.is_returning_browser = si.returning;
    var ok = emit('$pageview', props);
    if (ok) pageviewSent = true;
    startEngagement();          // also when the pageview was suppressed as a duplicate
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
    loadSdk(function (loaded) {
      if (loaded === false) {
        // The asset could not be fetched (or the bounded retries are exhausted). Claim NOTHING:
        // initApplied/sdkReady stay false so no caller can conclude the SDK is usable, buffered
        // events stay buffered, and a later explicit acceptance retries the fetch. Reporting
        // failure as readiness is exactly what the round-13 review found (findings 3).
        sdkReady = false;
        initApplied = false;
        booted = true;
        announce('sdk', { state: 'failed', attempts: sdkAttempts, max: sdkMaxAttempts });
        log('SDK unavailable; capture stays disabled until a retry succeeds');
        if (then) then(false);
        return;
      }
      sdkFailed = false;
      // ONE authoritative consent gate BEFORE INITIALISATION. Another tab on this origin may have
      // persisted a denial while this tab's SDK request was outstanding and this tab has not yet
      // processed its storage event. This must run before posthog.init() is constructed, because
      // init's own configuration is consent-dependent: settling it afterwards would enable
      // persistence first and reconcile second. The config is also fail-closed now, so this gate
      // and the configuration agree instead of relying on their order.
      if (consentState === 'granted' && !persistedGrantIsValid()) {
        // 'denied' OR a removed key (reset() elsewhere): both revoke. Absence is not permission.
        consentState = currentPersistedState();
        pending = [];
        stopEngagement();
        log('no persisted grant; any in-memory grant revoked before initialisation');
      }
      try {
        if (!window.posthog || window.posthog.__loaded !== true) {
          window.posthog.init(CFG.projectToken, sdkInitConfig());
        }
      } catch (e) { warn('init failed', e); }
      initApplied = true;
      booted = true;
      if (consentState === 'granted' && persistedGrantIsValid()) {
        applyConsentGranted();
        flushPending();
      } else if (window.posthog) {
        // Consent does not hold: ensure the SDK cannot collect anything, whatever its defaults.
        applyConsentDenied();
      }
      // sdkReady means "the SDK is initialised, so calling capture is safe" - it is NOT a statement
      // about consent, which opt_in/opt_out and before_send() enforce. Setting it only in the
      // granted branch left a denied page with sdkReady false forever, so events emitted after a
      // LATER grant buffered and were never flushed. The positive controls caught exactly that.
      sdkReady = true;
      announce('sdk', { state: 'initialized', attempts: sdkAttempts });
      if (then) then(true);
    });
  }

  function setConsent(value, opts) {
    if (value !== 'granted' && value !== 'denied') throw new Error('consent must be granted|denied');
    var was = consentState;
    consentState = value;
    if (value === 'granted') {
      lsSet(CFG.consentKey, 'granted');
      var finish = function () {
        // The PERSISTED decision is authoritative, because another tab on this origin may have
        // withdrawn while this tab's SDK request was outstanding. Re-read it here rather than
        // trusting this tab's in-memory state, and fail closed if it no longer grants.
        if (consentState !== 'granted' || !persistedGrantIsValid()) {
          // Consent was withdrawn - here or in another tab. Applying the stale grant would opt the
          // SDK back in and enable persistence after a refusal, so opt it OUT instead, discard
          // anything buffered, and announce nothing about a grant that no longer holds.
          consentState = currentPersistedState();
          pending = [];
          if (window.posthog) applyConsentDenied();
          return;
        }
        applyConsentGranted();
        pageview();
        announce('consent', { consent: value });
      };
      if (sdkLoaded && initApplied) finish();
      else if (CFG.loadSdkOnlyOnConsent) {
        // First request to a third party happens HERE, after the click, never before. If the fetch
        // fails, the decision is still announced - it IS stored - but the analytics path is NOT
        // applied and no readiness is claimed; a later acceptance retries the fetch (bounded).
        startSdk(function (ok) {
          if (ok) finish();
          else announce('consent', { consent: value, sdk: 'failed' });
        });
      } else finish();
      return true;
    }
    lsSet(CFG.consentKey, 'denied');
    // Withdrawal stops collection immediately: no final engagement event is sent.
    stopEngagement();
    // Discard buffered events UNCONDITIONALLY. This must not depend on whether the SDK has loaded:
    // the denied branch below only opts the SDK out `if (window.posthog)`, so clearing the queue
    // inside that helper left it intact whenever the SDK was still loading, and a later re-grant
    // flushed activity captured during the revoked period. Consent governs each event's lifetime.
    pending = [];
    if (window.posthog) applyConsentDenied();
    announce('consent', { consent: value, was: was });
    return true;
  }
  function getConsent() { return consentState; }

  function reset() {
    // Same reason as applyConsentDenied(): a reset must not leave the previous grant's buffered
    // activity available to a later grant.
    pending = [];
    consentState = null;
    lsDel(CFG.consentKey);
    lsDel(storageName());
    lsDel(storageName() + '_id');
    lsDel(storageName() + '_sessions');
    lsDel(storageName() + '_session_cur');
    pageviewSent = false;
    stopEngagement();
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
    // Introspection for the regression suite and for on-page debugging: readiness is a claim, so it
    // must be observable. `ready` true always implies `loaded` and `initApplied` true - that
    // implication is what the SDK-failure regression asserts.
    sdkState: function () {
      return {
        requested: sdkRequested, loading: sdkLoading, loaded: sdkLoaded, failed: sdkFailed,
        attempts: sdkAttempts, maxAttempts: sdkMaxAttempts,
        initApplied: initApplied, ready: sdkReady,
      };
    },
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
      startSdk(function (ok) {
        // Only report the pageview when the SDK is actually usable; 'ready' is still announced, with
        // an honest sdk state, so a page whose SDK failed is not told the loader is collecting.
        if (ok) pageview();
        announce('ready', { site: CFG.site.key, consent: consentState, sdk: ok ? 'initialized' : 'failed' });
      });
      return;
    }
    if (consentState === 'denied') { booted = true; announce('ready', { site: CFG.site.key, consent: consentState }); return; }
    booted = true;                       // loader booted (the SDK is deliberately absent)
    announce('consent-required', { site: CFG.site.key, consentKey: CFG.consentKey });
    announce('ready', { site: CFG.site.key, consent: consentState });
  }

  boot();
})(window, document);
