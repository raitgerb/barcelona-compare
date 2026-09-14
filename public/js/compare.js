/**
 * /compare — renders the side-by-side table from localStorage selection.
 * Fetches full data from /data/businesses.json (build-time static, CDN-cached).
 */
(function () {
  'use strict';
  var KEY = 'bc_compare_v1';
  var root = document.getElementById('compare-root');
  if (!root) return;

  var DOC_LANG = document.documentElement.lang;
  var lang = (DOC_LANG === 'en' || DOC_LANG === 'ca') ? DOC_LANG : 'es';
  var base = lang === 'es' ? '' : '/' + lang;
  var T = lang === 'en'
    ? { rating: 'Rating', reviews: 'Reviews', price: 'Price', hours: 'Hours', langs: 'Languages',
        services: 'Services', contact: 'Contact', empty: 'Nothing selected yet.',
        emptyHint: 'Browse nail salons or massages and tick "Compare" on the ones you like.',
        closed: 'Closed', today: 'Today', view: 'View', browseNails: 'Browse nail salons',
        browseMassage: 'Browse massage centers', noData: 'Could not load business data.',
        remove: 'Remove' }
    : lang === 'ca'
    ? { rating: 'Valoració', reviews: 'Ressenyes', price: 'Preu', hours: 'Horari', langs: 'Idiomes',
        services: 'Serveis', contact: 'Contacte', empty: 'Encara no has seleccionat res.',
        emptyHint: 'Explora salons de manicura o massatges i marca «Comparar» als que t\'interessin.',
        closed: 'Tancat', today: 'Avui', view: 'Veure', browseNails: 'Veure salons de manicura',
        browseMassage: 'Veure centres de massatge', noData: 'No s\'han pogut carregar les dades.',
        remove: 'Treure' }
    : { rating: 'Valoración', reviews: 'Reseñas', price: 'Precio', hours: 'Horario', langs: 'Idiomas',
        services: 'Servicios', contact: 'Contacto', empty: 'Todavía no has seleccionado nada.',
        emptyHint: 'Explora salones de uñas o masajes y marca «Comparar» en los que te interesen.',
        closed: 'Cerrado', today: 'Hoy', view: 'Ver', browseNails: 'Ver salones de uñas',
        browseMassage: 'Ver centros de masaje', noData: 'No se pudieron cargar los datos.',
        remove: 'Quitar' };

  var DAY_KEYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  var DAYS = lang === 'en'
    ? ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
    : lang === 'ca'
    ? ['Dl','Dt','Dc','Dj','Dv','Ds','Dg']
    : ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function getSel() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; }
  }

  function setSel(items) {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) {}
  }

  function todayKey() {
    // Barcelona weekday regardless of viewer timezone
    var parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', weekday: 'short' }).formatToParts(new Date());
    var wd = parts.filter(function (p) { return p.type === 'weekday'; })[0].value;
    var map = { Mon: 'monday', Tue: 'tuesday', Wed: 'wednesday', Thu: 'thursday', Fri: 'friday', Sat: 'saturday', Sun: 'sunday' };
    return map[wd];
  }

  function detailPath(b) {
    return base + (b.cat === 'nails' ? '/nails/' + b.slug + '/' : '/massage/' + b.slug + '/');
  }
  function imgPath(b) {
    return '/images/' + b.cat + '/' + b.slug + '-0.jpg';
  }

  function starsHtml(rating) {
    var full = Math.round(rating);
    var out = '';
    for (var i = 1; i <= 5; i++) {
      out += '<span class="' + (i <= full ? 'text-amber-400' : 'text-stone-300') + '">★</span>';
    }
    return out;
  }

  function render(data, sel) {
    if (!sel.length) {
      root.innerHTML =
        '<div class="text-center py-16 bg-white rounded-xl border border-stone-200">' +
        '<p class="text-lg text-stone-700">' + T.empty + '</p>' +
        '<p class="text-sm text-stone-500 mt-1">' + T.emptyHint + '</p>' +
        '<div class="mt-6 flex gap-3 justify-center">' +
        '<a href="' + base + '/nails/" class="px-4 py-2 rounded-xl bg-accent-nails text-white text-sm font-medium">' + T.browseNails + '</a>' +
        '<a href="' + base + '/massage/" class="px-4 py-2 rounded-xl bg-accent-massage text-white text-sm font-medium">' + T.browseMassage + '</a>' +
        '</div></div>';
      return;
    }

    var items = sel.map(function (s) { return data[s.slug]; }).filter(Boolean);
    if (!items.length) {
      root.innerHTML = '<p class="text-stone-500">' + T.noData + '</p>';
      return;
    }

    var tk = todayKey();
    var cols = items.map(function (b, idx) {
      var openToday = b.hours && b.hours[tk] ? b.hours[tk] : T.closed;
      var hoursRows = DAY_KEYS.map(function (d, i) {
        var h = (b.hours && b.hours[d]) || '—';
        var isToday = d === tk;
        return '<div class="flex justify-between text-xs py-0.5' + (isToday ? ' font-semibold text-stone-900' : ' text-stone-500') + '">' +
          '<span>' + DAYS[i] + '</span><span>' + esc(h) + '</span></div>';
      }).join('');

      var servicesHtml = (b.services && b.services.length)
        ? b.services.slice(0, 6).map(function (s) {
            return '<span class="inline-block text-[11px] px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 mr-1 mb-1">' + esc(s) + '</span>';
          }).join('')
        : '<span class="text-xs text-stone-400">—</span>';

      return '' +
      '<div class="bg-white rounded-2xl border border-stone-200 overflow-hidden flex flex-col" data-col="' + idx + '">' +
        ' <a href="' + imgPath(b) + '" target="_blank" rel="noopener">' +
        '<img src="' + imgPath(b) + '" alt="' + esc(b.name) + '" class="w-full h-40 object-cover" loading="lazy" onerror="this.style.display=\'none\'"></a>' +
        '<div class="p-5 flex-1">' +
          '<h2 class="font-bold text-stone-900 leading-snug"><a href="' + detailPath(b) + '" class="hover:underline">' + esc(b.name) + '</a></h2>' +
          '<p class="text-xs text-stone-500 mt-1">' + esc(b.nb) + '</p>' +
          '<div class="flex items-center gap-1.5 mt-3">' + starsHtml(b.rating) +
            '<span class="text-sm font-bold text-stone-800 ml-1">' + (b.rating || '—') + '</span>' +
            '<span class="text-xs text-stone-400">(' + b.reviews + ')</span></div>' +
          '<dl class="mt-4 space-y-3 text-sm">' +
            '<div><dt class="text-[11px] uppercase tracking-wider text-stone-400 font-medium">' + T.price + '</dt>' +
              '<dd class="text-stone-800 font-medium">' + esc(b.price || '—') + '</dd></div>' +
            '<div><dt class="text-[11px] uppercase tracking-wider text-stone-400 font-medium">' + T.hours + ' · ' + T.today + '</dt>' +
              '<dd class="text-stone-800">' + esc(openToday) + '</dd></div>' +
            '<div><dt class="text-[11px] uppercase tracking-wider text-stone-400 font-medium">' + T.langs + '</dt>' +
              '<dd class="text-stone-800">' + ((b.langs && b.langs.length) ? esc(b.langs.join(', ')) : '—') + '</dd></div>' +
            '<div><dt class="text-[11px] uppercase tracking-wider text-stone-400 font-medium">' + T.services + '</dt>' +
              '<dd class="mt-1">' + servicesHtml + '</dd></div>' +
            '<div><dt class="text-[11px] uppercase tracking-wider text-stone-400 font-medium">' + T.contact + '</dt>' +
              '<dd class="space-y-1">' +
              (b.phone ? '<a href="tel:' + esc(b.phone.replace(/\s/g,'')) + '" class="block text-brand-600 hover:underline">📞 ' + esc(b.phone) + '</a>' : '') +
              (b.site ? '<a href="' + esc(b.site) + '" target="_blank" rel="noopener" class="block text-brand-600 hover:underline">🌐 ' + T.view + '</a>' : '') +
              '</dd></div>' +
          '</dl>' +
          '<details class="mt-4"><summary class="text-xs text-stone-500 hover:text-stone-700 cursor-pointer">' + T.hours + '</summary>' +
            '<div class="mt-2 space-y-0.5">' + hoursRows + '</div></details>' +
        '</div>' +
        '<button class="cmp-remove m-4 mt-0 text-xs text-stone-400 hover:text-red-600" data-slug="' + esc(b.slug) + '">✕ ' + T.remove + '</button>' +
      '</div>';
    }).join('');

    root.innerHTML =
      '<div class="grid gap-4" style="grid-template-columns: repeat(' + Math.min(items.length, 4) + ', minmax(240px, 1fr));">' +
      cols + '</div>';

    root.querySelectorAll('.cmp-remove').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var slug = btn.getAttribute('data-slug');
        setSel(getSel().filter(function (i) { return i.slug !== slug; }));
        render(data, getSel());
      });
    });
  }

  fetch('/data/businesses.json')
    .then(function (r) { return r.json(); })
    .then(function (list) {
      var data = {};
      list.forEach(function (b) { data[b.slug] = b; });
      render(data, getSel());
      window.addEventListener('storage', function (e) {
        if (e.key === KEY) render(data, getSel());
      });
    })
    .catch(function () {
      root.innerHTML = '<p class="text-stone-500">' + T.noData + '</p>';
    });
})();
