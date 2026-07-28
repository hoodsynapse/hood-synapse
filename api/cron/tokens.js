// Hood Synapse token scanner.
//
// Reads ERC-20 Transfer logs and keeps a picture of what is actually moving on
// Robinhood Chain — tokenized equities, funds, private companies, stablecoins and
// native tokens alike. Metadata is read once per token and cached.

const { rpc, dec, preflight, send } = require('../_lib');
const { q } = require('../_db');

const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const WINDOW = 250;          // blocks per scan
const MAX_NEW = 12;          // metadata lookups per run
const MAX_ICONS = 12;        // logo lookups per run, busiest tokens first
const PACE = 350;            // ms between windows — the public RPC is shared
const SCAN_BUDGET = 32000;   // stop pulling windows here, leaving room to write
const TIME_BUDGET = 45000;

// Blockscout carries an icon for most native tokens. It also carries one for every
// tokenized equity — but that one is the same generic Robinhood feather for all of
// them, which would make NVDA and AAPL indistinguishable. Per-ticker artwork for
// those lives in assets/tokens/ instead, so the generic URL is rejected here and the
// row falls back to a monogram rather than wearing the wrong logo.
const EXPLORER = 'https://robinhoodchain.blockscout.com/api/v2/tokens/';
const DEXSCREENER = 'https://api.dexscreener.com/latest/dex/tokens/';
const GENERIC = /cdn\.robinhood\.com\/ncw_assets\/logos\//;

async function fromExplorer(address) {
  const r = await fetch(EXPLORER + address, { headers: { 'User-Agent': 'hood-synapse/1.0' } });
  if (!r.ok) return null;
  const url = (await r.json()).icon_url;
  return url && !GENERIC.test(url) ? url : null;
}

// Memecoins rarely reach the explorer's icon list, but the ones with liquidity carry
// their own artwork on DexScreener. Looked up by contract address, never by symbol,
// so a token borrowing a familiar ticker cannot inherit somebody else's picture.
async function fromDexScreener(address) {
  const r = await fetch(DEXSCREENER + address, { headers: { 'User-Agent': 'hood-synapse/1.0' } });
  if (!r.ok) return null;
  const pairs = (await r.json()).pairs || [];
  for (const p of pairs) {
    const img = p.info && p.info.imageUrl;
    if (img && p.baseToken && p.baseToken.address.toLowerCase() === address.toLowerCase()) return img;
  }
  return null;
}

async function iconFor(address) {
  for (const source of [fromExplorer, fromDexScreener]) {
    try {
      const url = await source(address);
      if (url) return url;
    } catch { /* try the next source */ }
  }
  return null;
}

// ── decode ERC-20 string returns (dynamic string or bytes32) ──────────────
function decodeString(hex) {
  if (!hex || hex === '0x') return null;
  const body = hex.slice(2);
  try {
    if (body.length >= 128) {
      const len = parseInt(body.slice(64, 128), 16);
      if (len > 0 && len < 200) {
        const s = Buffer.from(body.slice(128, 128 + len * 2), 'hex').toString('utf8').replace(/\0/g, '').trim();
        if (s) return s;
      }
    }
    const s = Buffer.from(body.slice(0, 64), 'hex').toString('utf8').replace(/\0/g, '').trim();
    return s || null;
  } catch { return null; }
}

// Classification, in order of confidence.
//
// Matching the symbol alone is not enough. A ticker is not a claim anyone has to earn:
// this chain carries a "USDC" called FatCatBatRatWifHat, a "USDT" called Tether by
// Virtuals, and a "BUSD" called Toplica Milosevic's. Labelling those STABLE would lend
// this site's word to an impostor, which is worse than saying nothing.
//
// So a stablecoin has to match on both counts — the symbol AND the issuer's actual
// token name. Anything wearing the ticker without the name is treated as what it is.
const STABLE_NAMES = {
  usdg:  ['global dollar'],
  wusdg: ['wrapped global dollar'],
  susdg: ['staked global dollar'],
  usdc:  ['usd coin', 'usdc'],
  usdt:  ['tether', 'tether usd', 'tether usdt'],
  dai:   ['dai', 'dai stablecoin'],
  usds:  ['usds', 'sky dollar'],
  pyusd: ['paypal usd'],
  frax:  ['frax', 'frax usd'],
  lusd:  ['liquity usd'],
  usde:  ['usde', 'ethena usde'],
  susd:  ['susd', 'synth susd'],
  busd:  ['binance usd', 'busd'],
  tusd:  ['trueusd', 'true usd'],
  usdp:  ['pax dollar', 'paxos standard', 'usdp']
};

function isStablecoin(symbol, name) {
  const want = STABLE_NAMES[(symbol || '').trim().toLowerCase()];
  if (!want) return false;
  const n = (name || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  return want.indexOf(n) !== -1;
}

// Wrapped assets and platform tokens are chain plumbing. WETH is not a memecoin and
// neither is a protocol token, so they get their own bucket rather than being lumped
// in with the jokes.
const INFRA_SYMBOLS = new Set(['weth', 'weth9', 'weeth', 'wsteth', 'virtual', 'virtuals', 'arb']);

function classify(symbol, name) {
  const s = (symbol || '').trim().toLowerCase();
  const n = (name || '').toLowerCase();

  // liquidity-pool and vault receipts — they pair two assets, they aren't either one
  if (/\bvolatile\s*-|\bstable\s*-|\blp\b|pool token|\/|quoter|uniswap v[23]|pancake|ramses/.test(n)
      || /\//.test(symbol || '')) return 'lp';

  // stablecoins: the ticker and the issuer's own name have to agree
  if (isStablecoin(s, name)) return 'stable';

  // Robinhood marks its tokenized assets in the token name itself:
  // "Apple • Robinhood Token", "iShares Silver Trust • Robinhood Token"
  const marked = /•\s*robinhood token|robinhood token$|ondo tokenized/.test(n);

  if (marked) {
    if (/\betf\b|ishares|spdr|invesco|vanguard|\btrust\b|index/.test(n)) return 'fund';
    if (/space exploration|combinator|openai|stripe|anthropic|spacex/.test(n)) return 'private';
    return 'equity';
  }

  // unmarked but unmistakably a listed company
  if (/class [abc] common stock|\binc\.\s*$|\bcorporation\b|holdings plc/.test(n)) return 'equity';

  if (INFRA_SYMBOLS.has(s) || /^wrapped |virtuals protocol|staking token|governance token/.test(n)) return 'infra';

  // what is left on this chain is, in practice, memecoins
  return 'meme';
}

async function metadata(address) {
  const [sym, nam, dcm] = await Promise.all([
    rpc('eth_call', [{ to: address, data: '0x95d89b41' }, 'latest']).catch(() => null),
    rpc('eth_call', [{ to: address, data: '0x06fdde03' }, 'latest']).catch(() => null),
    rpc('eth_call', [{ to: address, data: '0x313ce567' }, 'latest']).catch(() => null)
  ]);
  const symbol = decodeString(sym);
  const name = decodeString(nam);
  return { symbol, name, decimals: dcm ? dec(dcm) : null, kind: classify(symbol, name) };
}

// Rows classified before the name check existed still carry the old verdict, so every
// stablecoin on record is re-examined once. Cheap: there are a couple of dozen.
let recheckedStables = false;
async function recheckStables() {
  if (recheckedStables) return;
  const rows = await q("select address, symbol, name from tokens where kind = 'stable'");
  const fake = rows.filter((r) => !isStablecoin(r.symbol, r.name));
  if (fake.length) {
    await q(
      `update tokens t set kind = 'meme', updated_at = now()
         from unnest($1::text[]) as u(addr) where t.address = u.addr`,
      [fake.map((r) => r.address)]
    );
  }
  recheckedStables = true;
  return fake.map((r) => `${r.symbol} — ${r.name}`);
}

module.exports = async (req, res) => {
  if (preflight(req, res)) return;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const started = Date.now();
  try {
    const demoted = await recheckStables();
    const tip = dec(await rpc('eth_blockNumber'));
    const state = await q('select last_scanned from token_state where id = 1');
    let cursor = Number(state[0]?.last_scanned || 0);
    if (!cursor || tip - cursor > 200000) cursor = tip - WINDOW;

    const startCursor = cursor;
    if (cursor >= tip) {
      return res.status(200).send(JSON.stringify({ ok: true, scanned: 0, note: 'up to date', tip }, null, 2));
    }

    // Robinhood Chain produces roughly 600 blocks a minute and one window covers 250,
    // so a single window per run loses ground every minute and never recovers. Keep
    // pulling windows until the time budget is spent, which outruns the chain and lets
    // the scanner close a backlog instead of drifting behind one forever.
    const perToken = new Map();
    let windows = 0, logCount = 0, stopped = null;
    while (cursor < tip && Date.now() - started < SCAN_BUDGET) {
      const from = cursor + 1;
      const to = Math.min(tip, cursor + WINDOW);

      // The public RPC rate-limits, and it is shared infrastructure — pace the loop and
      // treat a refusal as "enough for this run" rather than an error. Whatever was read
      // before the refusal is still real and still gets committed; throwing here would
      // discard a full window of transfers and leave the cursor where it started.
      let logs;
      try {
        logs = await rpc('eth_getLogs', [{
          fromBlock: '0x' + from.toString(16),
          toBlock: '0x' + to.toString(16),
          topics: [TRANSFER]
        }]);
      } catch (e) {
        stopped = String(e.message || e);
        break;
      }

      for (const log of logs) {
        const addr = log.address.toLowerCase();
        let t = perToken.get(addr);
        if (!t) { t = { count: 0, senders: new Set(), receivers: new Set() }; perToken.set(addr, t); }
        t.count++;
        if (log.topics[1]) t.senders.add(log.topics[1]);
        if (log.topics[2]) t.receivers.add(log.topics[2]);
      }

      logCount += logs.length;
      cursor = to;
      windows++;
      if (cursor < tip) await new Promise((s) => setTimeout(s, PACE));
    }
    const to = cursor;

    if (!windows) {
      return res.status(200).send(JSON.stringify(
        { ok: true, scanned: 0, note: 'upstream busy, nothing read', detail: stopped, tip }, null, 2));
    }

    // which of these are new to us? fetch metadata only for those
    const addrs = [...perToken.keys()];
    const known = addrs.length
      ? (await q('select address from tokens where address = any($1)', [addrs])).map((r) => r.address)
      : [];
    const unknown = addrs.filter((a) => !known.includes(a));

    let learned = 0;
    for (const addr of unknown) {
      if (learned >= MAX_NEW || Date.now() - started > TIME_BUDGET) break;
      const m = await metadata(addr);
      await q(
        `insert into tokens (address, symbol, name, decimals, kind)
         values ($1,$2,$3,$4,$5) on conflict (address) do nothing`,
        [addr, m.symbol, m.name, m.decimals, m.kind]
      );
      learned++;
    }

    // one round trip each, not one per token
    const day = new Date().toISOString().slice(0, 10);
    const entries = [...perToken.entries()];
    const addrList = entries.map(([a]) => a);
    const counts = entries.map(([, t]) => t.count);
    const senders = entries.map(([, t]) => t.senders.size);
    const receivers = entries.map(([, t]) => t.receivers.size);

    await q(
      `update tokens t set transfers = t.transfers + u.n, last_seen = now(), updated_at = now()
         from unnest($1::text[], $2::bigint[]) as u(addr, n)
        where t.address = u.addr`,
      [addrList, counts]
    );

    await q(
      `insert into token_daily (address, day, transfers, senders, receivers)
       select u.addr, $2::date, u.n, u.s, u.r
         from unnest($1::text[], $3::bigint[], $4::int[], $5::int[]) as u(addr, n, s, r)
       on conflict (address, day) do update set
         transfers = token_daily.transfers + excluded.transfers,
         senders = greatest(token_daily.senders, excluded.senders),
         receivers = greatest(token_daily.receivers, excluded.receivers),
         updated_at = now()`,
      [addrList, day, counts, senders, receivers]
    );

    await q('update token_state set last_scanned = $1, updated_at = now() where id = 1', [to]);

    // logos, busiest first, a few per run — the backlog drains on its own
    let icons = 0;
    if (Date.now() - started < TIME_BUDGET) {
      const todo = await q(
        'select address from tokens where icon_checked_at is null order by transfers desc limit $1',
        [MAX_ICONS]
      );
      if (todo.length) {
        const found = await Promise.all(todo.map((r) => iconFor(r.address)));
        await q(
          `update tokens t set icon_url = u.icon, icon_checked_at = now()
             from unnest($1::text[], $2::text[]) as u(addr, icon)
            where t.address = u.addr`,
          [todo.map((r) => r.address), found]
        );
        icons = found.filter(Boolean).length;
      }
    }

    res.status(200).send(JSON.stringify({
      ok: true, from: startCursor + 1, to, tip, behind: tip - to, windows, stopped,
      demotedFakeStables: demoted && demoted.length ? demoted : undefined,
      transfers: logCount, tokensSeen: perToken.size, newTokens: learned, iconsFound: icons,
      ms: Date.now() - started
    }, null, 2));
  } catch (e) {
    res.status(500).send(JSON.stringify({ ok: false, error: String(e.message || e) }, null, 2));
  }
};
