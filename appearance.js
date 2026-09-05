// Device appearance only. Never read or write the financial state (bgt_v7).
// Loaded synchronously in <head> so saved colors apply before the first paint.
(function () {
  'use strict';
  var KEY = 'bgt_appearance_v1';
  var keys = ['bg','card','card-2','well','hair','hair-strong','text','text-2','text-3','accent','blue','purple','spent','bills','savings'];
  var palettes = {
    earth: {
      light: ['#f6f3ed','#fffdf8','#e9edde','#f0eee6','#dedfd3','#c3c8b8','#2d352c','#58634f','#646c60','#3c5138','#8c573c','#685b73','#a0a394','#c49575','#b3c596'],
      dark: ['#171c17','#202820','#2b3529','#1c231c','#394436','#52634d','#edf1e7','#c1cbb8','#a3af9c','#b3c596','#d8aa8e','#c4afd1','#6a7c62','#c49575','#a4bd89']
    },
    sand: {
      light: ['#f8f1e8','#fffaf3','#eee1d1','#f2e9dc','#e2d4c4','#c8b7a4','#3d3028','#68564a','#6e5c4f','#8b5135','#8b5135','#75546f','#b5a08a','#bc805b','#b0bd91'],
      dark: ['#211a16','#2c231e','#3a2e25','#261e19','#4c3b2f','#6f5745','#f5ebe0','#d2c0ae','#bda793','#e2b091','#e2b091','#d6b1cc','#89715b','#cd9a76','#a8b88b']
    },
    ocean: {
      light: ['#eff5f4','#fbfefd','#e0ece9','#e7efed','#d1dfda','#aabfb8','#263d3b','#47635f','#526861','#235f70','#235f70','#655b83','#91aaa6','#bc9478','#89b6a4'],
      dark: ['#142023','#1c2b2e','#253a3e','#18262a','#354c50','#507075','#e8f2f1','#b5cecb','#93b3af','#91c6d8','#91c6d8','#bdb3de','#5d8587','#c6a082','#84bca7']
    },
    plum: {
      light: ['#f6f1f6','#fefbff','#ece1ef','#f0e9f2','#dfd2e3','#c6b3ce','#3d3043','#66526e','#6b5874','#71517e','#71517e','#71517e','#b39ebb','#bc927e','#a5b990'],
      dark: ['#211a26','#2c2433','#3b2e43','#261e2c','#4d3d57','#6f567d','#f3eaf7','#d0bfd9','#b8a1c4','#cfb0de','#cfb0de','#cfb0de','#8c759b','#c39a88','#afc294']
    },
    graphite: {
      light: ['#f2f3f4','#ffffff','#e5e8eb','#ebedf0','#d6dbe0','#b8c0c9','#2d343c','#515e6a','#56636e','#414b56','#50647a','#71617e','#9da8b3','#b29883','#9eb5a8'],
      dark: ['#191c20','#24282d','#30363e','#1e2227','#3c444e','#5d6977','#edf0f4','#c0c8d2','#a4afbd','#bdc8d4','#b6c4d0','#c5b4d4','#788594','#bfa18a','#a2baac']
    }
  };
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var listeners = [];
  function valid(value) {
    value = value && typeof value === 'object' ? value : {};
    return { mode: ['light','dark','system'].indexOf(value.mode) >= 0 ? value.mode : 'light',
      tone: Object.prototype.hasOwnProperty.call(palettes, value.tone) ? value.tone : 'earth' };
  }
  function read() {
    try { return valid(JSON.parse(localStorage.getItem(KEY))); } catch (e) { return valid(null); }
  }
  var preference = read();
  function resolvedMode() { return preference.mode === 'system' ? (media && media.matches ? 'dark' : 'light') : preference.mode; }
  function colors(tone, mode) {
    var p = valid({tone:tone, mode:mode}), dark = p.mode === 'dark', result = {};
    keys.forEach(function(key,i) { result[key] = palettes[p.tone][dark ? 'dark' : 'light'][i]; });
    result['accent-fg'] = dark ? '#182018' : '#fffdf8';
    result.green = dark ? '#a6cfad' : '#326446';
    if (p.tone === 'earth' && !dark) result.green = '#476044';
    result.red = dark ? '#ff9c8f' : '#ad3d2d';
    result.orange = dark ? '#e3bc83' : '#76572f';
    result.yellow = dark ? '#deca86' : '#735916';
    result.teal = dark ? '#98c8bd' : '#446b64';
    result.pink = dark ? '#e0aeac' : '#874e40';
    result.indigo = dark ? '#bdbda0' : '#595c40';
    result.mint = dark ? '#a5cbbb' : '#41644f';
    result.flexible = result.green;
    return result;
  }
  function apply() {
    var mode = resolvedMode(), c = colors(preference.tone, mode), root = document.documentElement;
    Object.keys(c).forEach(function(key) { root.style.setProperty('--'+key, c[key]); });
    ['green','blue','red','orange','purple','teal'].forEach(function(key) {
      var hex = c[key].slice(1);
      root.style.setProperty('--'+key+'-rgb', [0,2,4].map(function(i){return parseInt(hex.slice(i,i+2),16);}).join(','));
    });
    root.style.colorScheme = mode;
    root.setAttribute('data-mode', mode);
    root.setAttribute('data-tone', preference.tone);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', c.bg);
    var scheme = document.querySelector('meta[name="color-scheme"]');
    if (scheme) scheme.setAttribute('content', mode);
    listeners.forEach(function(fn) { fn(); });
  }
  window.BudgetAppearance = {
    get: function() { return {mode:preference.mode, tone:preference.tone, resolved:resolvedMode()}; },
    colors: colors,
    set: function(mode,tone) {
      var next = valid({mode:mode,tone:tone});
      // Commit preference before applying it. A failed write keeps the old UI.
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch(e) { return false; }
      preference = next; apply(); return true;
    },
    subscribe: function(fn) { listeners.push(fn); }
  };
  if (media) {
    var change = function() { if(preference.mode === 'system') apply(); };
    if (media.addEventListener) media.addEventListener('change', change);
    else if (media.addListener) media.addListener(change);
  }
  window.addEventListener('storage', function(event) {
    if (event.key === KEY || event.key === null) { preference = read(); apply(); }
  });
  apply();
})();
