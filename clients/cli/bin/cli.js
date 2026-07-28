#!/usr/bin/env node
'use strict';

// hoodsynapse — read Robinhood Chain from your terminal.
// No key, no account. Every number here is verifiable against the chain.

const API = process.env.HOODSYNAPSE_API || 'https://hoodsynapse.xyz/api';

// ── tiny ansi helpers (respect NO_COLOR / non-tty) ────────────────────────
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const y = c('38;5;190');   // brand yellow-green
const dim = c('2');
const bold = c('1');
const red = c('31');
const green = c('32');

const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);

// A memecoin trades at $0.0000005 and a tokenized share at $332.39 in the same
// column, so precision follows magnitude rather than a fixed number of decimals.
function money(v) {
  if (v == null || !isFinite(v)) return '—';
  if (v >= 1) return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (v >= 0.01) return '$' + v.toFixed(4);
  if (v >= 0.000001) return '$' + v.toFixed(8).replace(/0+$/, '');
  return '$' + v.toExponential(2);
}

function compact(v) {
  if (v == null || !isFinite(v)) return '—';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(v);
}

function die(msg) {
  console.error(red('error: ') + msg);
  process.exit(1);
}

async function get(path) {
  let res;
  try {
    res = await fetch(API + path, { headers: { accept: 'application/json' } });
  } catch (e) {
    die(`could not reach ${API} (${e.message})`);
  }
  let body;
  try {
    body = await res.json();
  } catch {
    die(`unexpected response from ${API}${path}`);
  }
  if (!res.ok || body.error) die(body.error || `request failed (${res.status})`);
  return body;
}

// ── flags ─────────────────────────────────────────────────────────────────
function flags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      out[k] = v === undefined ? (args[i + 1] && !args[i + 1].startsWith('-') ? args[++i] : true) : v;
    } else out._.push(a);
  }
  return out;
}

const emit = (obj, f) => (f.json ? console.log(JSON.stringify(obj, null, 2)) : null);

// ── commands ──────────────────────────────────────────────────────────────
const commands = {
  async stats(f) {
    const d = await get('/stats');
    if (f.json) return emit(d, f);
    console.log('');
    console.log(bold('  Robinhood Chain') + dim(`  ·  chainId ${d.chainId} · ${d.network}`));
    console.log('');
    console.log(`  ${pad('latest block', 18)} ${y(num(d.latestBlock))}`);
    console.log(`  ${pad('block time', 18)} ${d.blockTimeSeconds}s`);
    console.log(`  ${pad('gas price', 18)} ${d.gasPriceGwei} gwei`);
    console.log(`  ${pad('base fee', 18)} ${d.baseFeePerGasGwei} gwei`);
    console.log(`  ${pad('L1 anchor', 18)} ${num(d.l1BlockNumber)}`);
    console.log(`  ${pad('txs in block', 18)} ${d.txCountLatestBlock}`);
    console.log('');
    console.log(dim(`  ${d.blockTimestampISO}`));
    console.log('');
  },

  async gas(f) {
    const d = await get('/gas');
    if (f.json) return emit(d, f);
    console.log('');
    console.log(bold('  Gas') + dim(`  ·  at block ${num(d.atBlock)}`));
    console.log('');
    console.log(`  ${pad('gas price', 20)} ${y(d.gasPriceGwei + ' gwei')}`);
    console.log(`  ${pad('base fee', 20)} ${d.baseFeePerGasGwei} gwei`);
    console.log(`  ${pad('max priority fee', 20)} ${d.maxPriorityFeePerGasGwei} gwei`);
    console.log('');
    console.log(dim('  ' + d.note));
    console.log('');
  },

  async block(f) {
    const arg = f._[0];
    const d = await get(arg && arg !== 'latest' ? `/block/${arg}` : '/block/latest');
    if (f.json) return emit(d, f);
    console.log('');
    console.log(bold('  Block ') + y(num(d.number)));
    console.log('');
    console.log(`  ${pad('hash', 18)} ${dim(d.hash)}`);
    console.log(`  ${pad('time', 18)} ${d.timestampISO}`);
    console.log(`  ${pad('transactions', 18)} ${d.txCount} ${dim(`(${d.userTxCount} user, ${d.txCount - d.userTxCount} system)`)}`);
    console.log(`  ${pad('gas used', 18)} ${num(d.gasUsed)}`);
    console.log(`  ${pad('base fee', 18)} ${d.baseFeePerGasGwei} gwei`);
    console.log(dim('  ── orbit ──────────────────────────────'));
    console.log(`  ${pad('l1BlockNumber', 18)} ${num(d.l1BlockNumber)}`);
    console.log(`  ${pad('sendCount', 18)} ${num(d.sendCount)}`);
    console.log(`  ${pad('sendRoot', 18)} ${dim(String(d.sendRoot || '').slice(0, 26) + '…')}`);
    console.log('');
  },

  async blocks(f) {
    const limit = f.limit || 10;
    const d = await get(`/history?limit=${encodeURIComponent(limit)}`);
    if (f.json) return emit(d, f);
    if (!d.blocks || !d.blocks.length) {
      console.log(dim('\n  no indexed blocks yet\n'));
      return;
    }
    console.log('');
    console.log(bold('  Indexed blocks') + dim(`  ·  ${d.count} shown`));
    console.log('');
    console.log(dim(`  ${pad('BLOCK', 14)}${pad('TX', 8)}${pad('USER', 8)}${pad('GAS', 12)}TIME`));
    for (const b of d.blocks) {
      const t = String(b.timestampISO).replace('T', ' ').slice(0, 19);
      console.log(`  ${pad(y(num(b.number)), useColor ? 25 : 14)}${pad(b.txCount, 8)}${pad(b.userTxCount, 8)}${pad(num(b.gasUsed), 12)}${dim(t)}`);
    }
    console.log('');
    console.log(dim(`  next page: hoodsynapse blocks --before ${d.nextBefore}`));
    console.log('');
  },

  async daily(f) {
    const days = f.days || 14;
    const d = await get(`/daily?days=${encodeURIComponent(days)}`);
    if (f.json) return emit(d, f);
    if (!d.days || !d.days.length) {
      console.log(dim('\n  no daily statistics yet — the index just started\n'));
      return;
    }
    const max = Math.max(...d.days.map((x) => x.txs)) || 1;
    console.log('');
    console.log(bold('  Daily activity') + dim(`  ·  ${d.count} day(s) from the index`));
    console.log('');
    for (const x of [...d.days].reverse()) {
      const w = Math.max(1, Math.round((x.txs / max) * 28));
      console.log(`  ${dim(x.day)}  ${y('█'.repeat(w))}${dim('·'.repeat(28 - w))}  ${pad(num(x.txs), 10)}${dim('tx')}`);
    }
    console.log('');
    console.log(dim('  sampled every 100th block · aggregates are representative'));
    console.log('');
  },

  async tokens(f) {
    const kind = f.kind || f._[0] || null;
    const limit = f.limit || 15;
    const d = await get(`/tokens?limit=${limit}` + (kind ? `&kind=${kind}` : ''));
    if (f.json) return emit(d, f);

    console.log('');
    console.log(bold('  Tokens by activity') + dim(`  ·  ${num(d.count)} shown${kind ? ` · ${kind}` : ''}`));
    console.log('');
    console.log(dim(`  ${pad('', 10)}${rpad('PRICE', 13)}${rpad('24H', 9)}${rpad('LIQUIDITY', 12)}${rpad('HOLDERS', 10)}  NAME`));

    for (const t of d.tokens) {
      const chg = t.priceChange24h;
      const chgTxt = chg == null ? '—' : (chg > 0 ? '+' : '') + chg.toFixed(1) + '%';
      const paint = chg == null ? dim : chg > 0 ? green : red;
      console.log(
        '  ' + y(pad(t.symbol || '?', 8))
        + rpad(money(t.priceUsd), 13)
        + paint(rpad(chgTxt, 9))
        + rpad(compact(t.liquidityUsd), 12)
        + rpad(t.holders == null ? '—' : num(t.holders), 10)
        + '  ' + dim(String(t.name || '').slice(0, 38))
      );
    }

    console.log('');
    console.log(dim('  Price is the on-chain DEX price from the deepest pair on this chain,'));
    console.log(dim('  not a reference exchange quote. Read liquidity beside it.'));
    console.log('');
  },

  async status(f) {
    const d = await get('/index-status');
    if (f.json) return emit(d, f);
    const healthy = d.behind < 5000;
    console.log('');
    console.log(bold('  Hood Synapse index'));
    console.log('');
    console.log(`  ${pad('chain tip', 18)} ${num(d.chainTip)}`);
    console.log(`  ${pad('last indexed', 18)} ${y(num(d.lastIndexed))}`);
    console.log(`  ${pad('behind', 18)} ${healthy ? green(num(d.behind)) : red(num(d.behind))} ${dim('blocks')}`);
    console.log(`  ${pad('blocks stored', 18)} ${num(d.blocksStored)}`);
    console.log(`  ${pad('range', 18)} ${num(d.range.from)} → ${num(d.range.to)}`);
    console.log('');
    console.log(dim('  ' + d.note));
    console.log('');
  },

  help() {
    console.log(`
  ${bold('hoodsynapse')} ${dim('— Robinhood Chain from your terminal')}

  ${bold('USAGE')}
    hoodsynapse <command> [options]

  ${bold('COMMANDS')}
    ${y('stats')}              chain snapshot — block, gas, block time
    ${y('gas')}                gas breakdown
    ${y('block')} [n|latest]   a single block, orbit fields included
    ${y('blocks')}             recent blocks from the index
    ${y('tokens')} [kind]      tokens by activity, with price and liquidity
    ${y('daily')}              daily activity chart
    ${y('status')}             how far the index reaches
    ${y('help')}               this screen

  ${bold('OPTIONS')}
    --json             raw JSON output
    --limit <n>        rows for ${dim('blocks')} / ${dim('tokens')}
    --kind <k>         rwa · equity · fund · private · stable · meme · infra
    --days <n>         days for ${dim('daily')} ${dim('(default 14)')}

  ${bold('EXAMPLES')}
    ${dim('$')} npx hoodsynapse stats
    ${dim('$')} npx hoodsynapse tokens rwa
    ${dim('$')} npx hoodsynapse block 20061111
    ${dim('$')} npx hoodsynapse daily --days 30
    ${dim('$')} npx hoodsynapse blocks --json | jq '.blocks[0]'

  ${dim('No key. No account. Verify anything at https://hoodsynapse.xyz')}
`);
  }
};

// ── entry ─────────────────────────────────────────────────────────────────
(async () => {
  const argv = process.argv.slice(2);
  const cmd = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'help';
  const f = flags(argv.slice(1));

  if (argv.includes('--version') || argv.includes('-v')) {
    console.log(require('../package.json').version);
    return;
  }

  const run = commands[cmd];
  if (!run) {
    console.error(red(`unknown command: ${cmd}`));
    commands.help();
    process.exit(1);
  }
  await run(f);
})().catch((e) => die(e.message || String(e)));
