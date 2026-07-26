const { rpc, cleanBlock, preflight, send, cache, meta } = require('../_lib');

module.exports = async (req, res) => {
  if (preflight(req, res)) return;
  const raw = String(req.query.number || '');
  if (!/^\d+$/.test(raw)) {
    return send(res, 400, { error: 'invalid block number', hint: 'use a decimal number, e.g. /api/block/15000000' });
  }
  try {
    const b = await rpc('eth_getBlockByNumber', ['0x' + Number(raw).toString(16), true]);
    if (!b) return send(res, 404, { error: 'block not found', number: Number(raw) });
    cache(res, 86400);
    send(res, 200, { ...cleanBlock(b, true), ...meta });
  } catch (e) {
    send(res, 502, { error: 'upstream RPC unavailable', detail: String(e.message || e) });
  }
};
