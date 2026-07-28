// Hood Synapse — $SYNAPSE page.
// The token has not launched, so the only live thing here is the header block number.

(function () {
  var el = document.getElementById('hd-block');
  if (!el) return;

  // via this site's API, not the chain's RPC — see js/app.js for why
  function tick() {
    fetch('/api/stats', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.latestBlock) el.textContent = d.latestBlock.toLocaleString('en-US');
      })
      .catch(function () {});
  }

  tick();
  setInterval(tick, 4000);
})();
