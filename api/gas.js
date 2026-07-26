const { rpc, dec, gwei, preflight, send, cache, meta } = require('./_lib');

module.exports = async (req, res) => {
  if (preflight(req, res)) return;
  try {
    const [gasPrice, block, priority] = await Promise.all([
      rpc('eth_gasPrice'),
      rpc('eth_getBlockByNumber', ['latest', false]),
      rpc('eth_maxPriorityFeePerGas')
    ]);
    cache(res, 4);
    send(res, 200, {
      gasPriceWei: dec(gasPrice),
      gasPriceGwei: gwei(gasPrice),
      baseFeePerGasGwei: gwei(block.baseFeePerGas),
      maxPriorityFeePerGasGwei: gwei(priority),
      note: 'Priority fee is 0 on Robinhood Chain — ordering is handled by the sequencer, tipping buys nothing.',
      atBlock: dec(block.number),
      ...meta
    });
  } catch (e) {
    send(res, 502, { error: 'upstream RPC unavailable', detail: String(e.message || e) });
  }
};
