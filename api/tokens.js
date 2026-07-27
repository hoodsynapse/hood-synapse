// What's actually moving on Robinhood Chain — tokenized equities, funds,
// private companies, stablecoins and native tokens, ranked by activity.
const { preflight, send, cache, meta } = require('./_lib');
const { q } = require('./_db');

module.exports = async (req, res) => {
  if (preflight(req, res)) return;
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || '25', 10) || 25, 1), 200);
    const kind = req.query.kind || null;      // equity | fund | private | stable | native

    // 'rwa' is the umbrella Robinhood itself uses: equities, funds and private companies
    const RWA = ['equity', 'fund', 'private'];
    const rows = kind === 'rwa'
      ? await q(`select address, symbol, name, decimals, kind, transfers, last_seen
                   from tokens where kind = any($1) order by transfers desc limit $2`, [RWA, limit])
      : kind
      ? await q(`select address, symbol, name, decimals, kind, transfers, last_seen
                   from tokens where kind = $1 order by transfers desc limit $2`, [kind, limit])
      : await q(`select address, symbol, name, decimals, kind, transfers, last_seen
                   from tokens order by transfers desc limit $1`, [limit]);

    const counts = await q('select kind, count(*)::int c from tokens group by kind');

    cache(res, 20);
    send(res, 200, {
      count: rows.length,
      byKind: (() => {
        const m = Object.fromEntries(counts.map((r) => [r.kind || 'unknown', r.c]));
        m.rwa = (m.equity || 0) + (m.fund || 0) + (m.private || 0);
        return m;
      })(),
      tokens: rows.map((r) => ({
        address: r.address,
        symbol: r.symbol,
        name: r.name,
        decimals: r.decimals,
        kind: r.kind,
        transfers: Number(r.transfers),
        lastSeen: r.last_seen
      })),
      note: 'Transfer counts come from the Hood Synapse index and grow as the scanner runs. Kinds are inferred from on-chain token names.',
      ...meta
    });
  } catch (e) {
    send(res, 500, { error: 'index unavailable', detail: String(e.message || e) });
  }
};
