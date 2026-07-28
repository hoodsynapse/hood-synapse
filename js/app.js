// Hood Synapse — landing page
// Reads the live chain and the Hood Synapse index. No key, no build step.

(function(){
  // The console used to POST to the chain's RPC straight from the visitor's browser.
  // That works from a desktop on an ordinary connection and fails on plenty of others:
  // the RPC sits behind Cloudflare, which challenges some mobile-carrier and VPN
  // addresses outright, and in-app browsers restrict cross-origin calls of their own
  // accord. When it failed the page did not degrade — it sat there reading "offline",
  // which is a claim about the chain, not about the visitor's network, and it was wrong.
  //
  // It goes through this site's own API now. One origin, one certificate, and the
  // server does the talking to the RPC, so the console works wherever the page loads.
  var $ = function(id){ return document.getElementById(id); };
  var seen = [], lastTs = null, times = [], failures = 0;

  function api(path, tries){
    tries = tries == null ? 3 : tries;
    return fetch(path, { cache: 'no-store' }).then(function(r){
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).then(function(d){
      if (d && d.error) throw new Error(d.error);
      return d;
    }).catch(function(err){
      if (tries <= 1) throw err;
      return new Promise(function(go){ setTimeout(go, (4 - tries) * 700); })
        .then(function(){ return api(path, tries - 1); });
    });
  }

  function num(h){ return parseInt(h, 16); }
  function fmt(n){ return n.toLocaleString('en-US'); }
  function ago(ts){
    var s = Math.max(0, Math.floor(Date.now()/1000 - ts));
    return s < 60 ? s + 's ago' : Math.floor(s/60) + 'm ago';
  }

  function paintBlock(b){
    var h = b.number, ts = b.timestamp;
    if (seen.indexOf(h) !== -1) return;
    seen.unshift(h);

    $('hd-block').textContent = fmt(h);
    var ncs = document.getElementById('n-core-s'); if (ncs) ncs.textContent = 'block ' + fmt(h);
    $('s-block').textContent = fmt(h);
    $('s-block-s').textContent = 'updated ' + ago(ts);

    lastTs = ts;

    var row = document.createElement('div');
    row.className = 'tfl';
    row.innerHTML =
      '<span class="ar2">&#8594;</span>' +
      '<span class="bk">#' + fmt(h) + '</span>&nbsp;&nbsp;' +
      '<span class="tx">' + (b.txCount != null ? b.txCount : 0) + ' tx</span>&nbsp;&nbsp;' +
      '<span class="hs">' + (b.hash || '').slice(0, 20) + '…</span>&nbsp;&nbsp;' +
      '<span class="tm">' + ago(ts) + '</span>';
    var f = $('feed');
    f.insertBefore(row, f.firstChild);
    while (f.children.length > 8) f.removeChild(f.lastChild);
    $('feed-status').textContent = 'live · ' + fmt(h);
  }

  function tick(){
    api('/api/block/latest').then(function(b){
      if (b && b.number) { paintBlock(b); failures = 0; }
    }).catch(function(){
      // Say what is actually known. One missed poll is not the chain going away, so
      // the last block stays on screen and only a sustained run of failures is called out.
      failures++;
      if (failures >= 3) $('feed-status').textContent = 'reconnecting…';
    });

    api('/api/stats').then(function(d){
      if (d.gasPriceGwei != null) $('s-gas').textContent = d.gasPriceGwei.toFixed(3) + ' gwei';
      if (d.blockTimeSeconds != null) $('s-time').textContent = d.blockTimeSeconds.toFixed(1) + 's';
      if (d.chainId != null) {
        $('s-chain').textContent = String(d.chainId);
        $('s-chain-s').textContent = '0x' + d.chainId.toString(16) + ' · ' + (d.network || 'mainnet');
      }
    }).catch(function(){});
  }

  tick();
  setInterval(tick, 4000);

  function drawWires(){
    var mapEl = document.getElementById('map');
    var svg = document.getElementById('wires');
    var core = document.getElementById('n-core');
    if (!mapEl || !svg || !core) return;
    if (window.innerWidth <= 600) { svg.innerHTML=''; return; }
    var mr = mapEl.getBoundingClientRect();
    var cr = core.getBoundingClientRect();
    var cx = cr.left - mr.left + cr.width/2;
    var cy = cr.top - mr.top + cr.height/2;
    var d = '';
    var nodes = document.querySelectorAll('.node[data-wire]');
    for (var i = 0; i < nodes.length; i++) {
      var r = nodes[i].getBoundingClientRect();
      var x = r.left - mr.left + r.width/2;
      var y = r.top - mr.top + r.height/2;
      var mx = (x + cx) / 2;
      d += 'M' + x + ' ' + y + ' C ' + mx + ' ' + y + ', ' + mx + ' ' + cy + ', ' + cx + ' ' + cy + ' ';
    }
    svg.setAttribute('viewBox', '0 0 ' + mr.width + ' ' + mr.height);
    svg.innerHTML = '<path d="' + d + '"/>';
  }
  drawWires();
  window.addEventListener('resize', drawWires);
  setTimeout(drawWires, 400);
})();

/* A single dropped request should not empty the page. Every fetch here retries a
   couple of times with a growing pause, and an HTTP error is treated as a failure
   rather than being parsed as if it were data. */
function getJSON(url, tries){
  tries = tries == null ? 3 : tries;
  return fetch(url).then(function(r){
    if (!r.ok) throw new Error('http ' + r.status);
    return r.json();
  }).then(function(d){
    if (d && d.error) throw new Error(d.error);
    return d;
  }).catch(function(err){
    if (tries <= 1) throw err;
    return new Promise(function(go){ setTimeout(go, (4 - tries) * 800); })
      .then(function(){ return getJSON(url, tries - 1); });
  });
}

/* ---------- index section: history + daily chart ---------- */
(function(){
  var fmt = function(n){ return Number(n).toLocaleString('en-US'); };
  function set(id, v){ var e = document.getElementById(id); if (e) e.textContent = v; }

  getJSON('/api/index-status').then(function(d){
    set('i-stored', fmt(d.blocksStored));
    set('i-behind', fmt(d.behind));
    set('idx-badge-txt', 'indexed through ' + fmt(d.lastIndexed));
  }).catch(function(){ set('idx-badge-txt', 'index unavailable'); });

  getJSON('/api/daily?days=30').then(function(d){
    var days = (d.days || []).slice().reverse();
    set('i-days', days.length);
    var box = document.getElementById('bars');
    if (!days.length) { box.innerHTML = '<div class="chart-empty">no history yet &#8212; the index just started</div>'; return; }
    var max = Math.max.apply(null, days.map(function(x){ return x.txs; })) || 1;
    box.className = 'bars' + (days.length < 8 ? ' few' : '');
    box.innerHTML = '';
    days.forEach(function(x){
      var b = document.createElement('div');
      b.className = 'bar';
      b.style.height = Math.max(3, Math.round(x.txs / max * 100)) + '%';
      b.innerHTML = '<span class="tip"><b>' + fmt(x.txs) + ' tx</b> &#183; ' + x.day +
                    '<br>' + fmt(x.blocks) + ' blocks sampled</span>';
      box.appendChild(b);
    });
    set('x-from', days[0].day);
    set('x-to', days[days.length - 1].day);
  }).catch(function(){
    var box = document.getElementById('bars');
    if (box) box.innerHTML = '<div class="chart-empty">history unavailable</div>';
  });
})();

/* ---------- tokens: what's moving on the chain ---------- */
(function(){
  var list = document.getElementById('tok-list');
  if (!list) return;
  var fmt = function(n){ return Number(n).toLocaleString('en-US'); };

  // A memecoin can trade at $0.0000005569 and a tokenized share at $332.39 in the same
  // column, so precision follows magnitude rather than a fixed number of decimals.
  function money(v){
    if (v == null || !isFinite(v)) return '—';
    if (v >= 1) return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (v >= 0.01) return '$' + v.toFixed(4);
    if (v >= 0.000001) return '$' + v.toFixed(8).replace(/0+$/, '');
    return '$' + v.toExponential(2);
  }

  function compact(v){
    if (v == null || !isFinite(v)) return '—';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(v);
  }

  function pct(v){
    if (v == null || !isFinite(v)) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
  }

  // counts, not money — same abbreviation, no dollar sign
  function count(v){
    if (v == null || !isFinite(v)) return '—';
    if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (v >= 1e4) return Math.round(v / 1e3) + 'K';
    return Number(v).toLocaleString('en-US');
  }

  function ago(ts){
    var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 90) return s + 's ago';
    if (s < 5400) return Math.round(s / 60) + 'm ago';
    if (s < 172800) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }

  // A logo only appears when the chain's explorer actually has one on record — the
  // tokenized equities carry Robinhood's own artwork, most memecoins carry nothing.
  // Everything else gets a monogram, so a missing logo never becomes a wrong one.
  function logo(t){
    var wrap = document.createElement('span');
    wrap.className = 'tok-logo ' + (t.kind || '');

    var initials = (t.symbol || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?';
    wrap.textContent = initials;

    if (t.iconUrl) {
      var img = document.createElement('img');
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('load', function(){ img.classList.add('on'); });
      img.addEventListener('error', function(){ img.remove(); });
      img.src = t.iconUrl;
      wrap.appendChild(img);   // the monogram stays underneath until the logo paints
    }
    return wrap;
  }

  // The last good payload per tab. A table that blanks itself reads as a broken site,
  // so a refresh that fails leaves the previous rows standing and says so quietly,
  // rather than replacing real data with an apology.
  var lastGood = {};
  var box = document.querySelector('.tok-box');
  var showing = null;                 // the tab the rows on screen actually belong to

  function highlight(kind){
    [].forEach.call(document.querySelectorAll('.tok-tab'), function(b){
      b.classList.toggle('on', (b.getAttribute('data-kind') || '') === (kind || ''));
    });
  }

  function render(kind){
    var key = kind || 'all';
    if (!list.querySelector('.tok-row')) {
      list.innerHTML = '<div class="tok-empty">reading the index&#8230;</div>';
    }
    if (box) box.classList.add('refreshing');

    getJSON('/api/tokens?limit=15' + (kind ? '&kind=' + kind : ''))
      .then(function(d){
        lastGood[key] = d;
        showing = key;
        highlight(kind);
        paint(d);
      })
      .catch(function(){
        var c = document.getElementById('tok-count');
        if (lastGood[key]) {
          // this tab has been seen before — show it again and say it is not fresh
          showing = key;
          highlight(kind);
          paint(lastGood[key]);
          if (c) c.textContent = c.textContent.split(' · ')[0] + ' · could not refresh, showing last reading';
        } else if (showing) {
          // never loaded this tab, but real rows are on screen from another one.
          // Leaving them under a highlighted tab they do not belong to would be a lie,
          // so the highlight goes back to whatever is actually being shown.
          highlight(showing === 'all' ? '' : showing);
          if (c) c.textContent = c.textContent.split(' · ')[0] + ' · could not load that filter';
        } else {
          list.innerHTML = '<div class="tok-empty">the index is not answering right now &#8212; try again in a moment</div>';
        }
      })
      .then(function(){ if (box) box.classList.remove('refreshing'); });
  }

  function paint(d){
      (function(){
        var counts = d.byKind || {};
        var total = Object.keys(counts).reduce(function(s,k){ return s + counts[k]; }, 0);
        var cEl = document.getElementById('tok-count');
        if (cEl) {
          // A price that stopped updating still looks like a price, so say out loud how
          // old this one is rather than letting a stalled worker read as a live market.
          var freshest = (d.tokens || []).reduce(function(m, t){
            var ts = t.marketAt ? Date.parse(t.marketAt) : 0;
            return ts > m ? ts : m;
          }, 0);
          cEl.textContent = fmt(total) + ' tokens indexed'
            + (freshest ? ' · priced ' + ago(freshest) : '');
        }

        [].forEach.call(document.querySelectorAll('.tok-tab'), function(b){
          var k = b.getAttribute('data-kind');
          var n = k ? counts[k] : total;
          if (n != null && !b.querySelector('b')) {
            var s = document.createElement('b'); s.textContent = n; b.appendChild(s);
          }
        });

        if (!d.tokens || !d.tokens.length) {
          list.innerHTML = '<div class="tok-empty">no tokens in this category yet</div>';
          return;
        }
        list.innerHTML = '';
        d.tokens.forEach(function(t, i){
          var row = document.createElement('div');
          row.className = 'tok-row';

          var cell = function(cls, text){
            var s = document.createElement('span');
            s.className = cls;
            s.textContent = text;
            return s;
          };

          // A dash in the price column looks like something failed. For these it has not:
          // the contract exists but no pool was ever created for it, so there is no market
          // and therefore no price. Saying so beats inventing one — assuming a USDC with
          // three transfers is worth a dollar would imply a market that is not there.
          if (t.priceUsd == null) {
            row.classList.add('unpriced');
            row.title = (t.symbol || 'This token') + ' has no DEX pair on Robinhood Chain.'
              + '\nThe contract exists, but nothing trades it — so it has no price here.';
          }

          row.appendChild(cell('n', i + 1));
          row.appendChild(logo(t));

          var id = document.createElement('span');
          id.className = 'tok-id';
          id.appendChild(cell('sym', t.symbol || '—'));
          id.appendChild(cell('nm', t.name || '—'));
          row.appendChild(id);

          row.appendChild(cell('tok-kind ' + (t.kind || ''), t.kind || '?'));
          row.appendChild(cell('price', money(t.priceUsd)));
          row.appendChild(cell('chg ' + (t.priceChange24h > 0 ? 'up' : t.priceChange24h < 0 ? 'down' : ''),
                                pct(t.priceChange24h)));
          row.appendChild(cell('liq', compact(t.liquidityUsd)));
          row.appendChild(cell('vol', compact(t.volume24h)));
          row.appendChild(cell('hold', t.holders == null ? '—' : fmt(t.holders)));
          row.appendChild(cell('tx', fmt(t.transfers)));

          // Eight columns cannot fit a phone without truncating every number into
          // nonsense, so on narrow screens the same figures go on their own line
          // instead. Nothing is dropped — it stacks rather than shrinks.
          row.appendChild(cell('tok-meta',
            'vol ' + compact(t.volume24h)
            + ' · ' + count(t.holders) + ' holders'
            + ' · ' + count(t.transfers) + ' transfers'
            + ' · ' + (t.kind || '?')));

          list.appendChild(row);
        });
      })();
  }

  // the highlight follows the data, not the click — render() sets it once rows land
  [].forEach.call(document.querySelectorAll('.tok-tab'), function(b){
    b.addEventListener('click', function(){ render(b.getAttribute('data-kind')); });
  });

  render('');
})();

/* ---------- pulse the live block number when it changes ---------- */
(function(){
  var watch = ['hd-block', 's-block', 'n-core-s'];
  var last = {};
  setInterval(function(){
    watch.forEach(function(id){
      var el = document.getElementById(id);
      if (!el) return;
      var v = el.textContent;
      if (last[id] !== undefined && last[id] !== v) {
        el.classList.remove('ticked');
        void el.offsetWidth;          // restart the animation
        el.classList.add('ticked');
      }
      last[id] = v;
    });
  }, 700);
})();
