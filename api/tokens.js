// What's actually moving on Robinhood Chain — tokenized equities, funds,
// private companies, stablecoins and native tokens, ranked by activity.
//
// Anyone can deploy a token wearing a familiar symbol. There are three contracts
// called "USDG / Global Dollar" on this chain and only one of them carries real
// volume. So the default view keeps one contract per symbol — the busiest — and
// reports how many symbols are contested. Pass ?all=true to see every contract.
const { preflight, send, cache, meta } = require('./_lib');
const { q } = require('./_db');

const RWA = ['equity', 'fund', 'private'];

// 'native' was the old name for what is now 'meme'. Callers still using it keep working.
const ALIAS = { native: 'meme' };

// ?history=0x… returns one token's daily market series instead of the ranked list.
// open is the first price recorded that day and is never rewritten; close is the most
// recent. samples says how many readings a day is built from — a day with two samples
// is a thinner statement than one with a thousand, so it is reported rather than hidden.
async function history(req, res) {
  const address = String(req.query.history).toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) {
    return send(res, 400, { error: 'history expects a contract address' });
  }
  const days = Math.min(Math.max(parseInt(req.query.days || '90', 10) || 90, 1), 365);

  const [token, series] = await Promise.all([
    q('select address, symbol, name, kind, icon_url from tokens where address = $1', [address]),
    q(`select day, open_usd, high_usd, low_usd, close_usd, liquidity_usd, volume_24h, samples
         from token_market_daily where address = $1
        order by day desc limit $2`, [address, days])
  ]);
  if (!token.length) return send(res, 404, { error: 'token not indexed' });

  cache(res, 60);
  const n = (v) => (v == null ? null : Number(v));
  send(res, 200, {
    token: {
      address: token[0].address, symbol: token[0].symbol, name: token[0].name,
      kind: token[0].kind, iconUrl: token[0].icon_url
    },
    days: series.length,
    series: series.reverse().map((r) => ({
      day: r.day, open: n(r.open_usd), high: n(r.high_usd), low: n(r.low_usd),
      close: n(r.close_usd), liquidityUsd: n(r.liquidity_usd), volume24h: n(r.volume_24h),
      samples: r.samples
    })),
    note: 'Daily market history recorded by Hood Synapse from DEX pairs on Robinhood Chain. History starts the day this token was first priced — there is no backfill, because the prices before that were never recorded anywhere we can read.',
    ...meta
  });
}

module.exports = async (req, res) => {
  if (preflight(req, res)) return;
  try {
    if (req.query.history) return await history(req, res);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '25', 10) || 25, 1), 200);
    const raw = req.query.kind || null;       // rwa | equity | fund | private | stable | meme | infra | lp
    const kind = raw ? (ALIAS[raw] || raw) : null;
    const all = req.query.all === 'true' || req.query.all === '1';

    const where = kind === 'rwa' ? 'where kind = any($1)' : kind ? 'where kind = $1' : '';
    const params = kind === 'rwa' ? [RWA] : kind ? [kind] : [];

    // one row per symbol, busiest contract wins; unnamed tokens keep their own row
    const deduped = `
      select distinct on (coalesce(lower(symbol), address))
             address, symbol, name, decimals, kind, icon_url, transfers, last_seen,
             price_usd, price_change_24h, liquidity_usd, volume_24h, holders, market_at
        from tokens ${where}
       order by coalesce(lower(symbol), address), transfers desc`;

    const everything = `
      select address, symbol, name, decimals, kind, icon_url, transfers, last_seen,
             price_usd, price_change_24h, liquidity_usd, volume_24h, holders, market_at
        from tokens ${where}`;

    const rows = await q(
      `select * from (${all ? everything : deduped}) t
        order by transfers desc limit $${params.length + 1}`,
      [...params, limit]
    );

    const [counts, contested] = await Promise.all([
      q('select kind, count(*)::int c from tokens group by kind'),
      q(`select count(*)::int c from (
           select lower(symbol) s from tokens where symbol is not null
            group by lower(symbol) having count(*) > 1
         ) d`)
    ]);

    cache(res, 20);
    send(res, 200, {
      count: rows.length,
      byKind: (() => {
        const m = Object.fromEntries(counts.map((r) => [r.kind || 'unknown', r.c]));
        m.rwa = (m.equity || 0) + (m.fund || 0) + (m.private || 0);
        return m;
      })(),
      contestedSymbols: Number(contested[0]?.c || 0),
      tokens: rows.map((r) => ({
        address: r.address,
        symbol: r.symbol,
        name: r.name,
        decimals: r.decimals,
        kind: r.kind,
        iconUrl: r.icon_url,
        transfers: Number(r.transfers),
        // on-chain DEX price — read liquidity alongside it before trusting it
        priceUsd: r.price_usd == null ? null : Number(r.price_usd),
        priceChange24h: r.price_change_24h == null ? null : Number(r.price_change_24h),
        liquidityUsd: r.liquidity_usd == null ? null : Number(r.liquidity_usd),
        volume24h: r.volume_24h == null ? null : Number(r.volume_24h),
        holders: r.holders == null ? null : Number(r.holders),
        marketAt: r.market_at,
        lastSeen: r.last_seen
      })),
      note: all
        ? 'Every indexed contract, including tokens that reuse a familiar symbol. Check the address before trusting a name.'
        : 'One contract per symbol — the busiest one. Others reusing the same symbol are hidden; pass ?all=true to see them. Transfer counts accumulate from when the scanner first saw a token.',
      priceNote: 'priceUsd is the on-chain DEX price from the deepest pair on Robinhood Chain, not a reference exchange quote. liquidityUsd is summed across every pair — a tokenized equity trading against a few thousand dollars of depth can sit far from its off-chain price, so read the two together.',
      ...meta
    });
  } catch (e) {
    send(res, 500, { error: 'index unavailable', detail: String(e.message || e) });
  }
};
