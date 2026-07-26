const { rpc, dec, gwei, preflight, send, cache, meta } = require('./_lib');

module.exports = async (req, res) => {
  if (preflight(req, res)) return;
  try {
    const SPAN = 25;
    const latest = await rpc('eth_getBlockByNumber', ['latest', false]);
    const n = dec(latest.number);
    const [older, gasPrice] = await Promise.all([
      rpc('eth_getBlockByNumber', ['0x' + (n - SPAN).toString(16), false]),
      rpc('eth_gasPrice')
    ]);
    const blockTime = Number(((dec(latest.timestamp) - dec(older.timestamp)) / SPAN).toFixed(2));

    cache(res, 4);
    send(res, 200, {
      chainId: 4663,
      network: 'mainnet',
      latestBlock: n,
      blockTimestampISO: new Date(dec(latest.timestamp) * 1000).toISOString(),
      blockTimeSeconds: blockTime,
      gasPriceGwei: gwei(gasPrice),
      baseFeePerGasGwei: gwei(latest.baseFeePerGas),
      l1BlockNumber: dec(latest.l1BlockNumber),
      txCountLatestBlock: (latest.transactions || []).length,
      ...meta
    });
  } catch (e) {
    send(res, 502, { error: 'upstream RPC unavailable', detail: String(e.message || e) });
  }
};
