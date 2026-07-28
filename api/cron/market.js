// Hood Synapse market pass.
//
// Transfer counts say a token is busy. They do not say what it is worth, and a trader
// opening this page wants a price. DEX pairs on Robinhood Chain carry both, so this
// walks the busiest tokens and records price, liquidity and 24h volume for each.
//
// The price recorded here is the on-chain DEX price, not a reference exchange quote.
// For a tokenized equity sitting in a thin pool the two can drift apart, which is
// exactly why liquidity is stored alongside it and shown next to it — a price with
// $9 of depth behind it should not read the same as one with $900k.

const { preflight } = require('../_lib');
const { q } = require('../_db');

const DEXSCREENER = 'https://api.dexscreener.com/latest/dex/tokens/';
const EXPLORER = 'https://robinhoodchain.blockscout.com/api/v2/tokens/';
const BATCH = 8;             // concurrent lookups
const LIVE = 110;            // busiest tokens, refreshed every run
const PER_KIND = 15;         // plus the top of each category — every tab's first page
const MAX = 190;             // total per run; the remainder works the backlog
const PACE = 220;            // ms between batches — the price source is shared and
                             // starts refusing everything when a run bursts past it
const HOLDERS_PER_RUN = 24;  // the explorer answers in ~1.2s, so holders rotate
const TIME_BUDGET = 45000;

const depth = (p) => Number((p.liquidity || {}).usd || 0);

// Holder count comes from the chain's own explorer. It is only read for the tokens
// that actually get shown — asking a public explorer about ten thousand dead contracts
// every minute would be rude and would buy nothing.
async function holdersFor(address) {
  try {
    const r = await fetch(EXPLORER + address, { headers: { 'User-Agent': 'hood-synapse/1.0' } });
    if (!r.ok) return null;
    const n = parseInt((await r.json()).holders_count, 10);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

// Throws when the source refuses; returns null when the token simply has no pair.
// Collapsing the two hid a rate-limit behind what looked like a chain full of
// unpriced tokens, so they are reported apart.
async function marketFor(address) {
  const r = await fetch(DEXSCREENER + address, { headers: { 'User-Agent': 'hood-synapse/1.0' } });
  if (!r.ok) throw new Error('price source http ' + r.status);
  const all = (await r.json()).pairs || [];
  const me = address.toLowerCase();

  const asBase = all.filter((p) => p.baseToken && p.baseToken.address.toLowerCase() === me);
  const asQuote = all.filter((p) => p.quoteToken && p.quoteToken.address.toLowerCase() === me);

  // A pair quotes the price of its base token. WETH is the busiest token on this chain
  // and is never a base — everything trades against it. Its price is recovered from a
  // pair it quotes: the base costs priceUsd in dollars and priceNative in this token,
  // so this token is worth priceUsd / priceNative.
  let price = null, change24h = null;
  if (asBase.length) {
    const deepest = asBase.reduce((a, b) => (depth(b) > depth(a) ? b : a));
    price = Number(deepest.priceUsd);
    change24h = Number((deepest.priceChange || {}).h24 ?? 0);
  } else if (asQuote.length) {
    const deepest = asQuote.reduce((a, b) => (depth(b) > depth(a) ? b : a));
    const usd = Number(deepest.priceUsd);
    const native = Number(deepest.priceNative);
    if (isFinite(usd) && isFinite(native) && native > 0) price = usd / native;
    // the base token's 24h move is not this token's, so it is left unknown
  }
  if (!isFinite(price) || price <= 0) return null;

  // liquidity and volume count every pair the token sits in, either side
  const involved = asBase.length ? asBase : asQuote;
  return {
    price,
    change24h,
    liquidity: involved.reduce((s, p) => s + depth(p), 0),
    volume24h: involved.reduce((s, p) => s + Number((p.volume || {}).h24 || 0), 0),
    pairs: involved.length
  };
}

// The market columns are added on first run rather than by hand, so a fresh database
// only ever needs db/tokens.sql applied and this endpoint hit.
let ready = false;
async function ensureColumns() {
  if (ready) return;
  for (const col of [
    'price_usd numeric', 'price_change_24h numeric', 'liquidity_usd numeric',
    'volume_24h numeric', 'pair_count int', 'holders int', 'holders_at timestamptz',
    'market_at timestamptz', 'market_checked_at timestamptz'
  ]) {
    await q(`alter table tokens add column if not exists ${col}`);
  }
  await q('create index if not exists tokens_liquidity_idx on tokens (liquidity_usd desc nulls last)');
  await q('create index if not exists tokens_market_todo_idx on tokens (market_checked_at asc nulls first)');
  await q(`create table if not exists token_market_daily (
             address text not null, day date not null,
             open_usd numeric, high_usd numeric, low_usd numeric, close_usd numeric,
             liquidity_usd numeric, volume_24h numeric,
             samples int not null default 0, updated_at timestamptz not null default now(),
             primary key (address, day))`);
  await q('create index if not exists token_market_daily_day_idx on token_market_daily (day desc)');

  // An earlier version stamped market_at on every attempt, so tokens that have never
  // had a price still carry a timestamp saying when they were "priced". That reads as
  // a stale price rather than as no market at all. No price means no time to report.
  await q('update tokens set market_at = null where price_usd is null and market_at is not null');
  ready = true;
}

module.exports = async (req, res) => {
  if (preflight(req, res)) return;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const started = Date.now();
  try {
    await ensureColumns();
    // Two queues, not one. Ordering a single query by "never checked first" would
    // refresh the busiest tokens once and then spend days walking ten thousand dead
    // contracts while the prices on the front page went stale. So the visible set is
    // always refreshed, and whatever budget is left goes to the backlog.
    // The second queue is "stalest first, never-priced counting as infinitely stale".
    // Restricting it to market_at is null would empty out once every token had been
    // seen once, and from then on the tail would keep serving prices frozen at
    // whatever minute they were first read.
    // "Live" has to mean everything the site can actually put on screen, and the site
    // filters by category. Ranking by transfers alone left SPY and QQQ hours stale —
    // they sit thousands of places down the global list, but they are on the first
    // page of the Funds tab. So the live set is the busiest overall plus the top of
    // every category, which is what a visitor can reach in one click.
    const [live, perKind, backlog] = await Promise.all([
      q('select address from tokens order by transfers desc limit $1', [LIVE]),
      q(`select address from (
           select address, kind, transfers,
                  row_number() over (partition by kind order by transfers desc) rn
             from tokens
         ) t where rn <= $1 order by rn, transfers desc`, [PER_KIND]),
      q('select address from tokens order by market_checked_at asc nulls first limit $1', [MAX - LIVE])
    ]);
    const seenAddr = new Set();
    // MAX caps the whole run, not just the backlog slice — three queues summed to well
    // over it and the run outran the price source, which answers by refusing everything
    // for a while. Order matters because of that cap: the per-category heads go first,
    // since they are the smallest set and the one that guarantees no tab shows a stale
    // page. Putting them behind the global top left Funds and Stablecoins to be trimmed
    // off the end, which is exactly how they ended up hours old.
    const rows = [...perKind, ...live, ...backlog]
      .filter((r) => !seenAddr.has(r.address) && seenAddr.add(r.address))
      .slice(0, MAX);

    // Holders come from the explorer, which answers in about a second — asking for all
    // 140 shown tokens every run ate the whole budget and left most prices unrefreshed.
    // A holder count barely moves minute to minute, so it rotates instead: the stalest
    // couple of dozen each run, the whole shown set covered every few minutes.
    const dueForHolders = await q(
      `select address from tokens
        where address = any($1) order by holders_at asc nulls first limit $2`,
      [live.map((r) => r.address), HOLDERS_PER_RUN]
    );
    const shown = new Set(dueForHolders.map((r) => r.address));

    const day = new Date().toISOString().slice(0, 10);
    let priced = 0, checked = 0, holdersFound = 0, refusedTotal = 0, noPair = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      if (Date.now() - started > TIME_BUDGET) break;
      const batch = rows.slice(i, i + BATCH);
      let refused = 0;
      const [found, holders] = await Promise.all([
        Promise.all(batch.map((r) => marketFor(r.address).catch(function(){ refused++; return null; }))),
        Promise.all(batch.map((r) => (shown.has(r.address) ? holdersFor(r.address) : Promise.resolve(null))))
      ]);

      // A refusal from the price source is not news about the token. Writing the null
      // through would blank a good price every time DexScreener rate-limited, and the
      // table would empty itself at random. The last real reading stays until a real
      // reading replaces it, and market_at only moves when something was actually read
      // — so the "priced Xm ago" label keeps telling the truth about staleness.
      await q(
        `update tokens t set
           price_usd        = coalesce(u.price, t.price_usd),
           price_change_24h = case when u.price is not null then u.chg else t.price_change_24h end,
           liquidity_usd    = coalesce(u.liq, t.liquidity_usd),
           volume_24h       = coalesce(u.vol, t.volume_24h),
           pair_count       = coalesce(u.pairs, t.pair_count),
           holders          = coalesce(u.holders, t.holders),
           holders_at       = case when u.holders is not null then now() else t.holders_at end,
           market_at        = case when u.price is not null then now() else t.market_at end,
           market_checked_at = now()
         from unnest($1::text[], $2::numeric[], $3::numeric[], $4::numeric[], $5::numeric[], $6::int[], $7::int[])
              as u(addr, price, chg, liq, vol, pairs, holders)
        where t.address = u.addr`,
        [
          batch.map((r) => r.address),
          found.map((m) => (m ? m.price : null)),
          found.map((m) => (m ? m.change24h : null)),
          found.map((m) => (m ? m.liquidity : null)),
          found.map((m) => (m ? m.volume24h : null)),
          found.map((m) => (m ? m.pairs : null)),
          holders
        ]
      );
      holdersFound += holders.filter((h) => h != null).length;

      // Same reading, written a second time as history. open_usd is deliberately not
      // touched on conflict: the first price of the day stays the open no matter how
      // many times the pass runs afterwards.
      const withPrice = batch
        .map((r, j) => ({ addr: r.address, m: found[j] }))
        .filter((x) => x.m);

      if (withPrice.length) {
        await q(
          `insert into token_market_daily
             (address, day, open_usd, high_usd, low_usd, close_usd, liquidity_usd, volume_24h, samples)
           select u.addr, $2::date, u.price, u.price, u.price, u.price, u.liq, u.vol, 1
             from unnest($1::text[], $3::numeric[], $4::numeric[], $5::numeric[]) as u(addr, price, liq, vol)
           on conflict (address, day) do update set
             high_usd      = greatest(token_market_daily.high_usd, excluded.close_usd),
             low_usd       = least(token_market_daily.low_usd, excluded.close_usd),
             close_usd     = excluded.close_usd,
             liquidity_usd = excluded.liquidity_usd,
             volume_24h    = excluded.volume_24h,
             samples       = token_market_daily.samples + 1,
             updated_at    = now()`,
          [
            withPrice.map((x) => x.addr),
            day,
            withPrice.map((x) => x.m.price),
            withPrice.map((x) => x.m.liquidity),
            withPrice.map((x) => x.m.volume24h)
          ]
        );
      }

      checked += batch.length;
      priced += found.filter(Boolean).length;
      refusedTotal += refused;
      noPair += found.length - found.filter(Boolean).length - refused;
      if (i + BATCH < rows.length) await new Promise((go) => setTimeout(go, PACE));
    }

    // Some impostors copy the issuer's name as well as its ticker — there are six
    // contracts on this chain calling themselves "Global Dollar". A name check cannot
    // separate those, but the market can: a dollar stablecoin quoted at $0.002 is not
    // holding a peg, it is wearing a costume. The band is wide on purpose, so a coin
    // genuinely under stress keeps its category and only the absurd gets demoted.
    const unpegged = await q(
      `update tokens set kind = 'meme', updated_at = now()
        where kind = 'stable' and price_usd is not null
          and (price_usd < 0.5 or price_usd > 2.0)
      returning symbol, name, price_usd`
    );

    const hist = await q('select count(*)::int c from token_market_daily where day = $1', [day]);
    res.status(200).send(JSON.stringify({
      ok: true, checked, priced, noPair, refused: refusedTotal, holdersFound,
      demotedUnpegged: unpegged.length ? unpegged.map((r) => `${r.symbol} ${Number(r.price_usd).toFixed(4)} — ${r.name}`) : undefined,
      historyRowsToday: hist[0].c, ms: Date.now() - started
    }, null, 2));
  } catch (e) {
    res.status(500).send(JSON.stringify({ ok: false, error: String(e.message || e) }, null, 2));
  }
};
