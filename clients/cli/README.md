# hoodsynapse

Robinhood Chain from your terminal. No key, no account, no middleman.

```bash
npx hoodsynapse stats
```

```
  Robinhood Chain  ·  chainId 4663 · mainnet

  latest block       20,080,419
  block time         0.12s
  gas price          0.050336 gwei
  base fee           0.050178 gwei
  L1 anchor          25,618,713
  txs in block       5
```

## Install

Run it directly:

```bash
npx hoodsynapse <command>
```

Or install globally:

```bash
npm install -g hoodsynapse
```

## Commands

| Command | What it does |
| --- | --- |
| `stats` | Chain snapshot — latest block, gas, block time |
| `gas` | Gas breakdown, including why priority fees are zero here |
| `block [n\|latest]` | A single block, with Arbitrum Orbit fields decoded |
| `blocks` | Recent blocks from the Hood Synapse index |
| `tokens [kind]` | Tokens by activity with price, liquidity and holders |
| `daily` | Daily activity, drawn as a chart in your terminal |
| `status` | How far the index reaches, and how far behind the tip |
| `help` | Usage |

`tokens` takes a category: `rwa`, `equity`, `fund`, `private`, `stable`, `meme` or `infra`.
Price is the on-chain DEX price from the deepest pair on this chain, not a reference
exchange quote — read the liquidity column beside it.

## Options

| Flag | Effect |
| --- | --- |
| `--json` | Raw JSON, ready to pipe into `jq` |
| `--limit <n>` | Rows for `blocks` (default 10) |
| `--days <n>` | Days for `daily` (default 14) |

## Examples

```bash
# what the chain is doing right now
npx hoodsynapse stats

# a specific block, orbit internals included
npx hoodsynapse tokens rwa
```

```bash
npx hoodsynapse block 20061111

# a month of activity as a terminal chart
npx hoodsynapse daily --days 30

# pipe anything into jq
npx hoodsynapse blocks --json | jq '.blocks[0].userTxCount'
```

## What's behind it

`stats`, `gas` and `block` read Robinhood Chain live. `blocks`, `daily` and `status`
come from the Hood Synapse index — a database we maintain, which is how history and
daily aggregates exist at all. An RPC only answers for the present.

Robinhood Chain produces roughly 10 blocks per second, so the indexer samples every
100th block and rolls those samples into daily aggregates. Statistics are accurate and
representative; per-block history is a sample, not a complete archive. `status` always
tells you exactly what the index holds.

Nothing here asks for trust. Check any number against the chain.

## Links

- Web — <https://hoodsynapse.xyz>
- Docs — <https://hoodsynapse.xyz/docs>
- API — <https://hoodsynapse.xyz/api>

## Notes

Uses the public Hood Synapse API by default. Point it elsewhere with `HOODSYNAPSE_API`.
Requires Node 18+.

MIT © Hood Synapse
