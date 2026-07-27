# hoodsynapse-mcp

An MCP server that gives AI agents read access to **Robinhood Chain** — live blocks,
tokenized real-world assets, memecoins, and the history an RPC can't return.

No key. No account. Everything it reports is verifiable against the chain.

## Why

Agents that touch a chain need data they can trust. Robinhood Chain carries tokenized
equities (NVIDIA, Tesla, Apple), ETFs (S&P 500, silver), private companies (SpaceX) and
native memecoins — but a raw RPC answers only for the present, in hex.

This server hands an agent the clean version, plus the history.

## Install

Add it to your MCP client config:

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

For Claude Desktop that file is:

- macOS — `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows — `%APPDATA%\Claude\claude_desktop_config.json`

Restart the client and the tools appear.

## Tools

| Tool | What the agent gets |
| --- | --- |
| `get_chain_stats` | Latest block, block time, gas, L1 anchor |
| `list_tokens` | Tokens by activity — filter `rwa`, `equity`, `fund`, `private`, `stable`, `native` |
| `get_block` | One block, Orbit fields decoded, system txs separated |
| `get_daily_activity` | Daily transactions and block cadence, drawn as a chart |
| `get_index_status` | What the index holds and how far behind the chain it is |
| `get_gas` | Gas price, base fee, and why priority fees are zero here |

## What an agent can answer with this

- *"What real-world assets trade on Robinhood Chain?"* → NVIDIA, GameStop, Alphabet, SpaceX, iShares Silver, Strategy, Apple, Tesla, S&P 500 …
- *"How busy is the chain today versus last week?"*
- *"What's block 20,401,056 and how much gas did it burn?"*
- *"Is the index current enough to trust this answer?"*

Sample output from `list_tokens({ kind: "rwa" })`:

```
RWA tokens on Robinhood Chain, by activity

 1. NVDA       equity      1,555 transfers   NVIDIA • Robinhood Token
 2. GME        equity      1,484 transfers   GameStop • Robinhood Token
 3. GOOGL      equity        752 transfers   Alphabet Class A • Robinhood Token
 4. SPCX       private       749 transfers   Space Exploration Technologies Corp.
 5. SLV        fund          560 transfers   iShares Silver Trust • Robinhood Token
```

## How the data gets there

Live values (`get_chain_stats`, `get_block`, `get_gas`) come straight from the chain's
public RPC. History (`get_daily_activity`, `list_tokens`) comes from the Hood Synapse
index — a database that samples the chain continuously, because Robinhood Chain produces
around 10 blocks per second and an RPC keeps no past.

`get_index_status` always reports the index's real coverage, so an agent can tell the
difference between "no activity" and "not indexed yet".

## Configuration

| Variable | Purpose |
| --- | --- |
| `HOODSYNAPSE_API` | Point at another deployment. Defaults to `https://hoodsynapse.xyz/api`. |

Requires Node 18+.

## Links

- Web — <https://hoodsynapse.xyz>
- Docs — <https://hoodsynapse.xyz/docs>
- CLI — [`hoodsynapse`](https://www.npmjs.com/package/hoodsynapse)
- Source — <https://github.com/hoodsynapse/hood-synapse>

---

Hood Synapse is an independent project. Not affiliated with, endorsed by, or sponsored by
Robinhood Markets, Inc.

MIT
