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
const TIME_BUDGET = 45000;

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

// Robinhood marks its tokenized real-world assets in the token name itself —
// "Apple • Robinhood Token", "iShares Silver Trust • Robinhood Token". That marker
// is the strongest signal we have, so it decides first; the rest is shape-matching.
function classify(symbol, name) {
  const n = (name || '').toLowerCase();
  const rwa = /•\s*robinhood token|robinhood token$|ondo tokenized/.test(n);

  if (/global dollar|usdg|usdc|usdt|dai/.test(n) || /^usd/.test((symbol || '').toLowerCase())) return 'stable';

  // funds and ETFs, whether or not they carry the marker
  if (/etf|ishares|spdr|invesco|vanguard|trust$|trust.*token|index fund/.test(n)) return 'fund';

  // private companies that aren't listed
  if (/space exploration|combinator|openai|stripe|anthropic|spacex/.test(n)) return 'private';

  // anything else Robinhood tokenized is an equity
  if (rwa) return 'equity';

  // unmarked but clearly a company
  if (/class [abc] common stock|inc\.|corp|holdings plc/.test(n)) return 'equity';

  return 'native';
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

module.exports = async (req, res) => {
  if (preflight(req, res)) return;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const started = Date.now();
  try {
    const tip = dec(await rpc('eth_blockNumber'));
    const state = await q('select last_scanned from token_state where id = 1');
    let cursor = Number(state[0]?.last_scanned || 0);
    if (!cursor || tip - cursor > 200000) cursor = tip - WINDOW;

    const from = cursor + 1;
    const to = Math.min(tip, cursor + WINDOW);
    if (from > to) {
      return res.status(200).send(JSON.stringify({ ok: true, scanned: 0, note: 'up to date', tip }, null, 2));
    }

    const logs = await rpc('eth_getLogs', [{
      fromBlock: '0x' + from.toString(16),
      toBlock: '0x' + to.toString(16),
      topics: [TRANSFER]
    }]);

    // tally per token, and per token per day
    const perToken = new Map();
    for (const log of logs) {
      const addr = log.address.toLowerCase();
      let t = perToken.get(addr);
      if (!t) { t = { count: 0, senders: new Set(), receivers: new Set() }; perToken.set(addr, t); }
      t.count++;
      if (log.topics[1]) t.senders.add(log.topics[1]);
      if (log.topics[2]) t.receivers.add(log.topics[2]);
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

    res.status(200).send(JSON.stringify({
      ok: true, from, to, tip, behind: tip - to,
      transfers: logs.length, tokensSeen: perToken.size, newTokens: learned,
      ms: Date.now() - started
    }, null, 2));
  } catch (e) {
    res.status(500).send(JSON.stringify({ ok: false, error: String(e.message || e) }, null, 2));
  }
};
