const RPC = 'https://rpc.mainnet.chain.robinhood.com';

async function rpc(method, params = []) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 })
  });
  if (!r.ok) throw new Error('upstream rpc http ' + r.status);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

// Anyone can deploy a contract, so anyone can return junk from decimals(). parseInt
// turns that junk into NaN, which JSON quietly renders as null but Postgres rejects
// outright — one bad contract was enough to halt the token scanner indefinitely.
// Unparseable means unknown, and unknown is null everywhere.
const num = (v) => (Number.isFinite(v) ? v : null);
const dec = (h) => (h == null ? null : num(parseInt(h, 16)));
const gwei = (h) => (h == null ? null : num(Number((parseInt(h, 16) / 1e9).toFixed(6))));

// ArbOS internal bookkeeping txs — filtered out of userTxCount
function isSystemTx(t) {
  if (typeof t === 'string') return false;
  const sys = ['0x6a', '0x6b', '0x64', '0x65', '0x66'];
  if (sys.includes(t.type)) return true;
  return !!t.from && t.from === t.to && t.from.startsWith('0x00000000000000000000000000000000000a4b');
}

function cleanBlock(b, txsExpanded) {
  const txs = b.transactions || [];
  const userTxCount = txsExpanded ? txs.filter((t) => !isSystemTx(t)).length : null;
  return {
    number: dec(b.number),
    hash: b.hash,
    parentHash: b.parentHash,
    timestamp: dec(b.timestamp),
    timestampISO: new Date(dec(b.timestamp) * 1000).toISOString(),
    txCount: txs.length,
    userTxCount,
    gasUsed: dec(b.gasUsed),
    baseFeePerGasGwei: gwei(b.baseFeePerGas),
    l1BlockNumber: dec(b.l1BlockNumber),
    sendCount: dec(b.sendCount),
    sendRoot: b.sendRoot,
    txHashes: txsExpanded ? txs.map((t) => t.hash) : txs
  };
}

function send(res, status, body) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Powered-By', 'Hood Synapse');
  res.status(status).send(JSON.stringify(body, null, 2));
}

function cache(res, seconds) {
  res.setHeader('Cache-Control', `public, s-maxage=${seconds}, stale-while-revalidate=${seconds * 4}`);
}

function preflight(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.status(204).end();
    return true;
  }
  return false;
}

const meta = { source: 'Robinhood Chain public RPC', provider: 'Hood Synapse', docs: 'https://hoodsynapse.xyz/docs' };

module.exports = { rpc, dec, gwei, cleanBlock, isSystemTx, send, cache, preflight, meta };
