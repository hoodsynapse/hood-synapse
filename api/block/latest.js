const { rpc, cleanBlock, preflight, send, cache, meta } = require('../_lib');

module.exports = async (req, res) => {
  if (preflight(req, res)) return;
  try {
    const b = await rpc('eth_getBlockByNumber', ['latest', true]);
    cache(res, 3);
    send(res, 200, { ...cleanBlock(b, true), ...meta });
  } catch (e) {
    send(res, 502, { error: 'upstream RPC unavailable', detail: String(e.message || e) });
  }
};
