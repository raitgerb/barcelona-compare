/**
 * Barcelona Compare — shared client runtime for listing pages.
 * Powers: instant search, open-now badges, photo-less sorting, compare tray.
 * Zero dependencies. Loaded on /nails, /massage and paginated children.
 */

interface Hours { [day: string]: string }
interface Biz {
  slug: string; name: string; nb: string; price: string; rating: number;
  reviews: number; photos: 0 | 1; hours?: Hours; services?: string[];
}
interface CompareItem { slug: string; name: string; cat: string; img: string }

(function () {
  'use strict';

  // ---------- i18n ----------
  // `lang` on <html> is set by BaseLayout (es | en | ca).
  var DOC_LANG = document.documentElement.lang;
  var LANG = (DOC_LANG === 'en' || DOC_LANG === 'ca') ? DOC_LANG : 'es';
  var COMPARE_PATH = LANG === 'es' ? '/compare/' : '/' + LANG + '/compare/';
  var L = (LANG === 'en')
    ? {
        open: 'Open now', closed: 'Closed', compare: 'Compare', addCmp: 'Add to compare',
        trayEmpty: 'Pick 2–4 salons to compare', clear: 'Clear', view: 'Compare →',
        removed: 'Removed', noRes: 'No matches', searchPh: 'Search name, street, service…',
        min2: 'Select at least 2', max4: 'Maximum 4', today: 'Today',
        matches: 'matches', sameCategory: 'Compare salons of the same category',
        days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      }
    : LANG === 'ca'
    ? {
        open: 'Obert ara', closed: 'Tancat', compare: 'Comparar', addCmp: 'Afegir a la comparació',
        trayEmpty: 'Tria 2–4 salons per comparar', clear: 'Buida', view: 'Comparar →',
        removed: 'Eliminat', noRes: 'Sense resultats', searchPh: 'Cerca nom, carrer, servei…',
        min2: 'Selecciona almenys 2', max4: 'Màxim 4', today: 'Avui',
        matches: 'coincidències', sameCategory: 'Compara negocis de la mateixa categoria',
        days: ['Dl', 'Dt', 'Dc', 'Dj', 'Dv', 'Ds', 'Dg']
      }
    : {
        open: 'Abierto ahora', closed: 'Cerrado', compare: 'Comparar', addCmp: 'Añadir a comparación',
        trayEmpty: 'Elige 2–4 salones para comparar', clear: 'Vaciar', view: 'Comparar →',
        removed: 'Eliminado', noRes: 'Sin resultados', searchPh: 'Busca nombre, calle, servicio…',
        min2: 'Selecciona al menos 2', max4: 'Máximo 4', today: 'Hoy',
        matches: 'coincidencias', sameCategory: 'Compara negocios de la misma categoría',
        days: ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
      };
  var DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  // ---------- open-now logic ----------
  function parseRange(range: string): [number, number] | null {
    var m = range.match(/(\d{1,2}):?(\d{2})?\s*-\s*(\d{1,2}):?(\d{2})?/);
    if (!m) return null;
    return [parseInt(m[1], 10) * 60 + parseInt(m[2] || '0', 10),
            parseInt(m[3], 10) * 60 + parseInt(m[4] || '0', 10)];
  }

  function isOpenNow(hours?: Hours): boolean | null {
    if (!hours || !Object.keys(hours).length) return null;
    // Barcelona time (Europe/Madrid), robust across DST via Intl
    var now = new Date();
    var fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit',
      weekday: 'short', hour12: false
    });
    var parts: any = {};
    fmt.formatToParts(now).forEach(function (p) { parts[p.type] = p.value; });
    var dayMap: any = { Mon: 'monday', Tue: 'tuesday', Wed: 'wednesday', Thu: 'thursday', Fri: 'friday', Sat: 'saturday', Sun: 'sunday' };
    var todayKey = dayMap[parts.weekday];
    var mins = parseInt(parts.hour, 10) * 60 + parseInt(parts.minute, 10);
    var range = hours[todayKey] ? parseRange(hours[todayKey]) : null;
    if (!range) return false;
    var open = mins >= range[0] && mins < range[1];
    return open;
  }

  // ---------- compare tray state ----------
  var KEY = 'bc_compare_v1';
  function load(): CompareItem[] {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; }
  }
  function save(items: CompareItem[]) {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) { /* private mode */ }
  }

  function ensureTray() {
    if (document.getElementById('bc-compare-tray')) return;
    var tray = document.createElement('div');
    tray.id = 'bc-compare-tray';
    tray.className = 'fixed bottom-0 inset-x-0 z-40 translate-y-full transition-transform duration-200';
    tray.innerHTML =
      '<div class="max-w-6xl mx-auto m-3 rounded-2xl bg-stone-900 text-white shadow-2xl px-4 py-3 flex items-center gap-3">' +
      '  <div id="bc-tray-items" class="flex-1 flex items-center gap-2 overflow-x-auto"></div>' +
      '  <button id="bc-tray-clear" class="text-xs text-stone-400 hover:text-white whitespace-nowrap">' + L.clear + '</button>' +
      '  <a id="bc-tray-go" href="' + COMPARE_PATH + '" class="px-4 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium whitespace-nowrap">' + L.view + '</a>' +
      '</div>';
    document.body.appendChild(tray);
    tray.querySelector('#bc-tray-clear')!.addEventListener('click', function () {
      save([]); renderTray(); syncCheckboxes();
    });
  }

  function trayEl(): HTMLElement { return document.getElementById('bc-compare-tray')!; }

  function renderTray() {
    var items = load();
    var tray = document.getElementById('bc-compare-tray');
    if (!tray) return;
    if (items.length === 0) { tray.classList.add('translate-y-full'); return; }
    tray.classList.remove('translate-y-full');
    var holder = document.getElementById('bc-tray-items')!;
    holder.innerHTML = '';
    items.forEach(function (it) {
      var chip = document.createElement('span');
      chip.className = 'inline-flex items-center gap-1.5 bg-stone-800 rounded-full pl-1 pr-2 py-1 text-xs';
      chip.innerHTML =
        '<img src="' + it.img + '" class="w-7 h-7 rounded-full object-cover" onerror="this.style.display=\'none\'">' +
        '<span class="max-w-[140px] truncate">' + esc(it.name) + '</span>' +
        '<button aria-label="' + L.removed + '" class="text-stone-400 hover:text-white" data-slug="' + esc(it.slug) + '">✕</button>';
      chip.querySelector('button')!.addEventListener('click', function () { toggle(it, true); });
      holder.appendChild(chip);
    });
    var go = document.getElementById('bc-tray-go') as HTMLAnchorElement;
    if (items.length >= 2) {
      go.textContent = L.view + ' (' + items.length + ')';
      go.classList.remove('opacity-50', 'pointer-events-none');
      go.setAttribute('aria-disabled', 'false');
    } else {
      go.textContent = L.min2;
      go.classList.add('opacity-50', 'pointer-events-none');
      go.setAttribute('aria-disabled', 'true');
    }
  }

  function toggle(item: CompareItem, forceRemove?: boolean) {
    var items = load();
    var idx = items.findIndex(function (i) { return i.slug === item.slug; });
    if (idx >= 0) {
      items.splice(idx, 1);
    } else if (!forceRemove) {
      if (items.length >= 4) { flash(L.max4); return; }
      // Keep one category per comparison — nails vs massage makes no sense side by side
      if (items.length > 0 && items[0].cat !== item.cat) { flashCategory(); return; }
      items.push(item);
    }
    save(items); renderTray(); syncCheckboxes();
  }

  function flashCategory() {
    var tray = trayEl();
    var note = document.createElement('div');
    note.className = 'absolute -top-9 left-1/2 -translate-x-1/2 bg-stone-800 text-white text-xs px-3 py-1.5 rounded-lg shadow';
    note.textContent = L.sameCategory;
    tray.querySelector('div')!.appendChild(note);
    setTimeout(function () { note.remove(); }, 2200);
  }

  var flashTimer: any;
  function flash(msg: string) {
    var tray = trayEl();
    var note = document.createElement('div');
    note.className = 'absolute -top-9 left-1/2 -translate-x-1/2 bg-stone-800 text-white text-xs px-3 py-1.5 rounded-lg shadow';
    note.textContent = msg;
    tray.querySelector('div')!.appendChild(note);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { note.remove(); }, 2200);
  }

  function esc(s: string): string {
    return s.replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string;
    });
  }

  // ---------- card wiring ----------
  function buildSearchIndex(card: HTMLElement): string {
    var bizName = card.dataset.name || '';
    var parts = [bizName, card.dataset.nb || '', card.dataset.address || ''];
    try {
      var svc = JSON.parse(card.dataset.services || '[]');
      parts = parts.concat(svc);
    } catch (e) { /* noop */ }
    return parts.join(' ').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // accent-insensitive
  }

  function syncCheckboxes() {
    var items = load();
    document.querySelectorAll<HTMLInputElement>('.bc-compare-check').forEach(function (cb) {
      cb.checked = items.some(function (i) { return i.slug === cb.dataset.slug; });
    });
  }

  function init() {
    ensureTray();
    renderTray();

    var cards = Array.from(document.querySelectorAll<HTMLElement>('.listing-card'));

    // --- open-now badges + compare checkboxes + search index ---
    var searchIndex = new Map<HTMLElement, string>();
    cards.forEach(function (card) {
      // open-now
      var hours: Hours | undefined;
      try { hours = JSON.parse(card.dataset.hours || 'null') || undefined; } catch (e) {}
      var openState = isOpenNow(hours);
      if (openState !== null && card.dataset.photos === '1') {
        var badge = document.createElement('span');
        badge.className = openState
          ? 'absolute top-2 left-2 z-10 text-[11px] font-medium px-2 py-0.5 rounded-full bg-green-600/95 text-white shadow'
          : 'absolute top-2 left-2 z-10 text-[11px] font-medium px-2 py-0.5 rounded-full bg-stone-700/85 text-white shadow';
        badge.textContent = openState ? L.open : L.closed;
        card.insertBefore(badge, card.firstChild);
      }
      // search index
      searchIndex.set(card, buildSearchIndex(card));

      // compare checkbox
      var check = document.createElement('label');
      check.className = 'bc-compare-wrap absolute top-2 right-2 z-10 flex items-center gap-1 bg-white/95 rounded-full px-2 py-1 shadow text-[11px] font-medium text-stone-700 cursor-pointer select-none';
      check.innerHTML = '<input type="checkbox" class="bc-compare-check accent-brand-500 w-3.5 h-3.5" data-slug="' + esc(card.dataset.slug || '') + '">' +
        '<span>' + L.compare + '</span>';
      card.insertBefore(check, card.firstChild);
      // The card is one big <a>; swallow clicks on the checkbox area so it
      // toggles locally instead of navigating to the detail page.
      //
      // Checkbox-in-label semantics:
      //  - Direct click on the INPUT: native toggle already applied by the
      //    browser BEFORE this handler runs. Do NOT preventDefault — that
      //    would revert the toggle. Just stopPropagation and read state.
      //  - Click on the LABEL TEXT: preventDefault kills the label→input
      //    forwarded click (avoids double-toggle AND <a> navigation), then
      //    flip the checkbox ourselves.
      check.addEventListener('click', function (e) {
        var cb = check.querySelector('input') as HTMLInputElement;
        if ((e.target as HTMLElement).tagName === 'INPUT') {
          e.stopPropagation(); // keep the surrounding <a> from activating
          toggle({
            slug: card.dataset.slug || '',
            name: card.dataset.name || '',
            cat: card.dataset.cat || '',
            img: card.querySelector('img') ? (card.querySelector('img') as HTMLImageElement).src : ''
          }, false);
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        cb.checked = !cb.checked;
        toggle({
          slug: card.dataset.slug || '',
          name: card.dataset.name || '',
          cat: card.dataset.cat || '',
          img: card.querySelector('img') ? (card.querySelector('img') as HTMLImageElement).src : ''
        }, false);
      });
    });
    syncCheckboxes();

    // --- instant search ---
    var searchInput = document.getElementById('bc-search') as HTMLInputElement | null;
    var resultCount = document.getElementById('bc-result-count');
    var baseCount = resultCount ? resultCount.textContent : '';
    var gridEl = document.getElementById('listing-grid');
    if (searchInput && gridEl) {
      var noRes = document.getElementById('no-results');
      var applySearch = function () {
        var q = searchInput!.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        var terms = q.split(/\s+/).filter(Boolean);
        var shown = 0;
        cards.forEach(function (card) {
          var hay = searchIndex.get(card) || '';
          var match = terms.every(function (t) { return hay.indexOf(t) !== -1; });
          card.classList.toggle('hidden', !match);
          if (match) shown++;
        });
        if (resultCount) resultCount.textContent = q ? shown + ' ' + L.matches : baseCount;
        if (noRes) noRes.classList.toggle('hidden', shown > 0);
      };
      searchInput.addEventListener('input', applySearch);
    }

    // --- sort: photo-less to bottom (applies to initial rating sort) ---
    if (!searchInput && gridEl) {
      var sorted = Array.from(gridEl.children) as HTMLElement[];
      var withPhotos = sorted.filter(function (c) { return c.dataset.photos === '1'; });
      var noPhotos = sorted.filter(function (c) { return c.dataset.photos !== '1'; });
      if (noPhotos.length && withPhotos.length) {
        gridEl.innerHTML = '';
        withPhotos.concat(noPhotos).forEach(function (c) { gridEl!.appendChild(c); });
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
