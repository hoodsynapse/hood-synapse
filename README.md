<p align="center">
  <img src="assets/og.jpg" alt="Hood Synapse" width="100%">
</p>

<h1 align="center">Hood Synapse</h1>

<p align="center">
  Live data, an indexer, an API, a CLI and an MCP server for <b>Robinhood Chain</b>.<br>
  Tokenized equities, RWAs and memecoins — readable by people and agents alike.<br>
  No key. No account. No middleman.
</p>

<p align="center">
  <a href="https://hoodsynapse.xyz">Website</a> ·
  <a href="https://hoodsynapse.xyz/docs">Docs</a> ·
  <a href="https://hoodsynapse.xyz/api">API</a> ·
  <a href="https://www.npmjs.com/package/hoodsynapse">npm</a>
</p>

---

## Try it in one line

```bash
npx hoodsynapse stats
```

```
  Robinhood Chain  ·  chainId 4663 · mainnet

  latest block       20,107,926
  block time         0.12s
  gas price          0.052024 gwei
  base fee           0.050336 gwei
  L1 anchor          25,618,941
  txs in block       12
```

## What this is

Robinhood Chain is fast and new, and the tooling around it is thin. Hood Synapse fills
that gap with three things:

- **A clean HTTP API** over the chain — decimal numbers instead of hex, ISO timestamps,
  ArbOS system transactions identified and counted separately. Open CORS, no key.
- **Our own index** — an RPC only answers for the present. We keep a database of the
  chain so history and daily statistics exist at all.
- **A CLI** — the same data from your terminal, including a chart.

Every number is verifiable against the chain. Nothing here asks for trust.

## API

Base: `https://hoodsynapse.xyz/api`

| Endpoint | Returns |
| --- | --- |
| `GET /api` | endpoint index |
| `GET /api/stats` | chain snapshot — block, gas, block time |
| `GET /api/gas` | gas breakdown |
| `GET /api/block/latest` | latest block, cleaned |
| `GET /api/block/{n}` | any block by decimal number |
| `GET /api/history` | historical blocks from our index |
| `GET /api/daily` | daily chain statistics |
| `GET /api/index-status` | how far the index reaches |
| `GET /api/tokens` | tokens by activity (`?kind=rwa\|equity\|fund\|private\|stable\|native`) |

```bash
curl https://hoodsynapse.xyz/api/daily?days=30
```

## CLI

```bash
npx hoodsynapse stats            # chain snapshot
npx hoodsynapse gas              # gas breakdown
npx hoodsynapse block 20061111   # one block, orbit fields decoded
npx hoodsynapse blocks           # recent indexed blocks
npx hoodsynapse daily            # activity chart in your terminal
npx hoodsynapse status           # what the index holds
```

Add `--json` to any command to pipe into `jq`.

## Clients

| Client | Use it |
| --- | --- |
| **CLI** | `npx hoodsynapse stats` — [npm](https://www.npmjs.com/package/hoodsynapse) · [source](clients/cli) |
| **MCP** (AI agents) | `npx hoodsynapse-mcp` — [npm](https://www.npmjs.com/package/hoodsynapse-mcp) · [source](clients/mcp) |
| **Python** | [`clients/python`](clients/python) — standard library only, no dependencies |
| **Anything else** | Plain HTTP + JSON. `curl`, `fetch`, `requests` — it all works. |

```python
from hoodsynapse import HoodSynapse

hs = HoodSynapse()
print(hs.stats()["latestBlock"])
```

## For AI agents

Hood Synapse ships an MCP server, so any agent that speaks the Model Context Protocol can
read the chain directly:

```json
{
  "mcpServers": {
    "hoodsynapse": {
      "command": "npx",
      "args": ["-y", "hoodsynapse-mcp"]
    }
  }
}
```

Tools exposed: `get_chain_stats`, `list_tokens`, `get_block`, `get_daily_activity`,
`get_index_status`, `get_gas`. An agent can then answer things like *"what real-world
assets trade on Robinhood Chain?"* — and check its own coverage before it answers.

## What's on this chain

Robinhood Chain carries tokenized real-world assets alongside native tokens:

| | Examples |
| --- | --- |
| **Equities** | NVIDIA, Tesla, Apple, Amazon, Alphabet, GameStop, Meta, Strategy |
| **Funds** | SPDR S&P 500, Invesco QQQ, iShares Silver |
| **Private** | SpaceX |
| **Stablecoins** | Global Dollar (USDG) |
| **Native** | memecoins and chain-native tokens |

```bash
curl https://hoodsynapse.xyz/api/tokens?kind=rwa
```

## How the index works

Robinhood Chain produces roughly **10 blocks per second** (~864k per day), and the public
RPC rate-limits sustained bulk reads. Indexing every block is not workable at that rate, so
the indexer **samples every 100th block** and rolls those samples into daily aggregates.

That means daily statistics are accurate and representative, while per-block history is a
sample rather than a complete archive. `GET /api/index-status` always reports exactly what
the index holds — check it against the chain any time.

## Network

| | |
| --- | --- |
| Chain ID | `4663` (`0x1237`) |
| RPC | `https://rpc.mainnet.chain.robinhood.com` |
| Explorer | `https://robinhoodchain.blockscout.com` |
| Gas token | ETH |
| Stack | Arbitrum Orbit (Nitro), settles to Ethereum |

## Repository layout

```
api/                serverless functions (the HTTP API + indexer)
  _lib.js           RPC helpers, response shaping
  _db.js            database pool
  cron/             the indexer
clients/cli/        the npx CLI
clients/mcp/        MCP server for AI agents
clients/python/     Python client, standard library only
css/                stylesheets
js/                 browser scripts
db/schema.sql       tables and the daily rollup
assets/             brand assets
index.html          landing page
docs.html           developer reference
```

## Running it yourself

The API needs one environment variable:

```
DATABASE_URL=postgresql://...
```

Apply `db/schema.sql` to that database, then deploy. The indexer is a plain HTTP endpoint
(`/api/cron`) — hit it on a schedule and it walks the chain forward.

---

Hood Synapse is an independent project. Not affiliated with, endorsed by, or sponsored by
Robinhood Markets, Inc.

MIT
