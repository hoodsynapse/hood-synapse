#!/usr/bin/env node
/**
 * Hood Synapse MCP server.
 *
 * Gives an AI agent read access to Robinhood Chain: live blocks and gas,
 * tokenized real-world assets (NVIDIA, Tesla, SpaceX, S&P 500), memecoins,
 * and the daily history an RPC cannot return.
 *
 * No key, no account. Everything it reports is verifiable against the chain.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const API = process.env.HOODSYNAPSE_API || 'https://hoodsynapse.xyz/api';
const VERSION = '1.0.0';

async function get(path) {
  const res = await fetch(`${API}${path}`, {
    headers: { accept: 'application/json', 'user-agent': `hoodsynapse-mcp/${VERSION}` }
  });
  const body = await res.json().catch(() => null);
  if (!body) throw new Error(`unexpected response from ${path}`);
  if (!res.ok || body.error) throw new Error(body.error || `request failed (${res.status})`);
  return body;
}

const n = (x) => (x == null ? '—' : Number(x).toLocaleString('en-US'));

// ── tools ─────────────────────────────────────────────────────────────────
const tools = [
  {
    name: 'get_chain_stats',
    description:
      'Current state of Robinhood Chain: latest block, block time, gas price and the Ethereum L1 block it is anchored to. Use this for "what is the chain doing right now".',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const d = await get('/stats');
      return [
        `Robinhood Chain — chainId ${d.chainId}, ${d.network}`,
        ``,
        `Latest block:  ${n(d.latestBlock)}`,
        `Block time:    ${d.blockTimeSeconds}s`,
        `Gas price:     ${d.gasPriceGwei} gwei`,
        `Base fee:      ${d.baseFeePerGasGwei} gwei`,
        `L1 anchor:     ${n(d.l1BlockNumber)}`,
        `Txs in block:  ${d.txCountLatestBlock}`,
        `As of:         ${d.blockTimestampISO}`
      ].join('\n');
    }
  },
  {
    name: 'list_tokens',
    description:
      'Tokens on Robinhood Chain ranked by transfer activity. Filter with kind: "rwa" for all real-world assets, "equity" for tokenized stocks (NVIDIA, Tesla, Apple), "fund" for ETFs (S&P 500, silver), "private" for private companies (SpaceX), "stable" for stablecoins, "native" for chain-native tokens and memecoins.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['rwa', 'equity', 'fund', 'private', 'stable', 'native'], description: 'Category filter. Omit for all tokens.' },
        limit: { type: 'number', description: 'How many to return (1–200, default 20).' }
      }
    },
    run: async ({ kind, limit = 20 }) => {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (kind) qs.set('kind', kind);
      const d = await get(`/tokens?${qs}`);
      const head = kind ? `${kind.toUpperCase()} tokens` : 'Tokens';
      const lines = d.tokens.map(
        (t, i) => `${String(i + 1).padStart(2)}. ${(t.symbol || '?').padEnd(10)} ${(t.kind || '').padEnd(8)} ${n(t.transfers).padStart(8)} transfers   ${t.name || ''}`
      );
      return [
        `${head} on Robinhood Chain, by activity`,
        `Indexed: ${JSON.stringify(d.byKind)}`,
        ``,
        ...lines,
        ``,
        d.note
      ].join('\n');
    }
  },
  {
    name: 'get_block',
    description:
      'One block from Robinhood Chain, with Arbitrum Orbit fields decoded (l1BlockNumber, sendCount, sendRoot) and ArbOS system transactions counted separately from user transactions. Omit number for the latest block.',
    inputSchema: {
      type: 'object',
      properties: { number: { type: 'number', description: 'Block number in decimal. Omit for latest.' } }
    },
    run: async ({ number }) => {
      const d = await get(number != null ? `/block/${number}` : '/block/latest');
      return [
        `Block ${n(d.number)}`,
        ``,
        `Hash:          ${d.hash}`,
        `Time:          ${d.timestampISO}`,
        `Transactions:  ${d.txCount} (${d.userTxCount} user, ${d.txCount - d.userTxCount} system)`,
        `Gas used:      ${n(d.gasUsed)}`,
        `Base fee:      ${d.baseFeePerGasGwei} gwei`,
        ``,
        `Orbit fields`,
        `  l1BlockNumber: ${n(d.l1BlockNumber)}`,
        `  sendCount:     ${n(d.sendCount)}`,
        `  sendRoot:      ${d.sendRoot}`
      ].join('\n');
    }
  },
  {
    name: 'get_daily_activity',
    description:
      'Daily chain statistics from the Hood Synapse index — transactions, gas and block cadence per day. This is history an RPC cannot return. Use it for trends over time.',
    inputSchema: {
      type: 'object',
      properties: { days: { type: 'number', description: 'How many days back (1–365, default 14).' } }
    },
    run: async ({ days = 14 }) => {
      const d = await get(`/daily?days=${days}`);
      if (!d.days.length) return 'The index has no daily statistics yet.';
      const peak = Math.max(...d.days.map((x) => x.txs)) || 1;
      const rows = [...d.days].reverse().map((x) => {
        const bar = '█'.repeat(Math.max(1, Math.round((x.txs / peak) * 20)));
        return `${x.day}  ${bar.padEnd(20)} ${n(x.txs).padStart(9)} tx   ${x.avgBlockTimeSeconds ?? '—'}s blocks`;
      });
      return [`Daily activity on Robinhood Chain (${d.count} day(s) indexed)`, ``, ...rows].join('\n');
    }
  },
  {
    name: 'get_index_status',
    description:
      'What the Hood Synapse index currently holds and how far behind the chain it is. Useful for judging how complete an answer about history can be.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const d = await get('/index-status');
      return [
        `Hood Synapse index`,
        ``,
        `Chain tip:     ${n(d.chainTip)}`,
        `Last indexed:  ${n(d.lastIndexed)}`,
        `Behind:        ${n(d.behind)} blocks`,
        `Blocks stored: ${n(d.blocksStored)}`,
        `Range:         ${n(d.range.from)} → ${n(d.range.to)}`,
        ``,
        d.note
      ].join('\n');
    }
  },
  {
    name: 'get_gas',
    description: 'Gas price and base fee on Robinhood Chain, including why priority fees are zero on this network.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const d = await get('/gas');
      return [
        `Gas on Robinhood Chain (block ${n(d.atBlock)})`,
        ``,
        `Gas price:         ${d.gasPriceGwei} gwei`,
        `Base fee:          ${d.baseFeePerGasGwei} gwei`,
        `Max priority fee:  ${d.maxPriorityFeePerGasGwei} gwei`,
        ``,
        d.note
      ].join('\n');
    }
  }
];

// ── server ────────────────────────────────────────────────────────────────
const server = new Server(
  { name: 'hoodsynapse', version: VERSION },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = tools.find((t) => t.name === request.params.name);
  if (!tool) {
    return { content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }], isError: true };
  }
  try {
    const text = await tool.run(request.params.arguments ?? {});
    return { content: [{ type: 'text', text }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `Hood Synapse: ${err.message}` }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
