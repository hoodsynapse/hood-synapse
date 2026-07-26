// Hood Synapse — landing page
// Reads the live chain and the Hood Synapse index. No key, no build step.

(function(){
  var RPC = 'https://rpc.mainnet.chain.robinhood.com';
  var $ = function(id){ return document.getElementById(id); };
  var seen = [], lastTs = null, times = [];

  function call(method, params){
    return fetch(RPC, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({jsonrpc:'2.0', method:method, params:params||[], id:1})
    }).then(function(r){ return r.json(); }).then(function(j){ return j.result; });
  }

  function num(h){ return parseInt(h, 16); }
  function fmt(n){ return n.toLocaleString('en-US'); }
  function ago(ts){
    var s = Math.max(0, Math.floor(Date.now()/1000 - ts));
    return s < 60 ? s + 's ago' : Math.floor(s/60) + 'm ago';
  }

  function paintBlock(b){
    var h = num(b.number), ts = num(b.timestamp);
    if (seen.indexOf(h) !== -1) return;
    seen.unshift(h);

    $('hd-block').textContent = fmt(h);
    var ncs = document.getElementById('n-core-s'); if (ncs) ncs.textContent = 'block ' + fmt(h);
    $('s-block').textContent = fmt(h);
    $('s-block-s').textContent = 'updated ' + ago(ts);

    if (lastTs !== null && ts > lastTs) {
      times.unshift(ts - lastTs);
      times = times.slice(0, 12);
      var avg = times.reduce(function(a,b){return a+b;},0) / times.length;
      $('s-time').textContent = avg.toFixed(1) + 's';
    }
    lastTs = ts;

    var row = document.createElement('div');
    row.className = 'tfl';
    row.innerHTML =
      '<span class="ar2">&#8594;</span>' +
      '<span class="bk">#' + fmt(h) + '</span>&nbsp;&nbsp;' +
      '<span class="tx">' + (b.transactions ? b.transactions.length : 0) + ' tx</span>&nbsp;&nbsp;' +
      '<span class="hs">' + (b.hash || '').slice(0, 20) + '…</span>&nbsp;&nbsp;' +
      '<span class="tm">' + ago(ts) + '</span>';
    var f = $('feed');
    f.insertBefore(row, f.firstChild);
    while (f.children.length > 8) f.removeChild(f.lastChild);
    $('feed-status').textContent = 'live · ' + fmt(h);
  }

  function tick(){
    call('eth_getBlockByNumber', ['latest', false]).then(function(b){
      if (b) paintBlock(b);
    }).catch(function(){ $('feed-status').textContent = 'reconnecting…'; });

    call('eth_gasPrice').then(function(g){
      if (g) $('s-gas').textContent = (num(g)/1e9).toFixed(3) + ' gwei';
    }).catch(function(){});
  }

  call('eth_chainId').then(function(c){
    if (c) {
      $('s-chain').textContent = String(num(c));
      $('s-chain-s').textContent = c + ' · mainnet';
    }
  }).catch(function(){ $('s-chain').textContent = 'offline'; });

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

/* ---------- index section: history + daily chart ---------- */
(function(){
  var fmt = function(n){ return Number(n).toLocaleString('en-US'); };
  function set(id, v){ var e = document.getElementById(id); if (e) e.textContent = v; }

  fetch('/api/index-status').then(function(r){ return r.json(); }).then(function(d){
    if (d.error) throw new Error(d.error);
    set('i-stored', fmt(d.blocksStored));
    set('i-behind', fmt(d.behind));
    set('idx-badge-txt', 'indexed through ' + fmt(d.lastIndexed));
  }).catch(function(){ set('idx-badge-txt', 'index unavailable'); });

  fetch('/api/daily?days=30').then(function(r){ return r.json(); }).then(function(d){
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
