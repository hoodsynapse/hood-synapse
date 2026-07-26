// Transparency endpoint — how far our index reaches, verifiable against the chain.
const { rpc, dec, preflight, send, cache, meta } = require('./_lib');
const { q } = require('./_db');

module.exports = async (req, res) => {
  if (preflight(req, res)) return;
  try {
    const [state, span, tipHex] = await Promise.all([
      q('select last_indexed, total_blocks, updated_at from indexer_state where id = 1'),
      q('select count(*)::bigint c, min(number) lo, max(number) hi, min(ts) t0, max(ts) t1 from blocks'),
      rpc('eth_blockNumber')
    ]);

    const s = state[0] || {};
    const sp = span[0] || {};
    const tip = dec(tipHex);
    const lastIndexed = Number(s.last_indexed || 0);

    cache(res, 10);
    send(res, 200, {
      chainTip: tip,
      lastIndexed,
      behind: tip - lastIndexed,
      blocksStored: Number(sp.c || 0),
      range: { from: sp.lo == null ? null : Number(sp.lo), to: sp.hi == null ? null : Number(sp.hi) },
      coverage: { firstSeen: sp.t0 ? new Date(sp.t0).toISOString() : null, lastSeen: sp.t1 ? new Date(sp.t1).toISOString() : null },
      lastRun: s.updated_at ? new Date(s.updated_at).toISOString() : null,
      note: 'Hood Synapse maintains its own index of Robinhood Chain. Check any block here against the chain.',
      ...meta
    });
  } catch (e) {
    send(res, 500, { error: 'index unavailable', detail: String(e.message || e) });
  }
};
