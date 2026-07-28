// Hood Synapse — developer reference
// Reads the live chain and the Hood Synapse index. No key, no build step.

(function(){
  // Read through this site's API rather than posting to the chain's RPC from the
  // visitor's browser: that RPC sits behind Cloudflare, which refuses some mobile and
  // in-app-browser connections, and a blank block number reads as a dead site.
  function tick(){ fetch('/api/stats',{cache:'no-store'}).then(function(r){return r.json();})
    .then(function(d){
      if(d && d.latestBlock) document.getElementById('hb').textContent=d.latestBlock.toLocaleString('en-US');
    }).catch(function(){}); }
  tick(); setInterval(tick,5000);

  var links=[].slice.call(document.querySelectorAll('.rail a'));
  var secs=links.map(function(a){return document.querySelector(a.getAttribute('href'));});
  function spy(){
    var i=0;
    for(var k=0;k<secs.length;k++){ if(secs[k]&&secs[k].getBoundingClientRect().top<160) i=k; }
    links.forEach(function(a,n){ a.classList.toggle('on', n===i); });
  }
  spy(); window.addEventListener('scroll',spy,{passive:true});
})();
