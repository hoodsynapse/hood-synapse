// Hood Synapse — developer reference
// Reads the live chain and the Hood Synapse index. No key, no build step.

(function(){
  var RPC='https://rpc.mainnet.chain.robinhood.com';
  function call(m,p){return fetch(RPC,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',method:m,params:p||[],id:1})}).then(function(r){return r.json();}).then(function(j){return j.result;});}
  function tick(){ call('eth_blockNumber').then(function(h){
    if(h) document.getElementById('hb').textContent=parseInt(h,16).toLocaleString('en-US');
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
