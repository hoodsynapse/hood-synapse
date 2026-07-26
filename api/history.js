// Historical blocks — served from our own index, not the RPC.
const { preflight, send, cache, meta } = require('./_lib');
const { q } = require('./_db');

module.exports = async (req, res) => {
  if (preflight(req, res)) return;
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || '25', 10) || 25, 1), 200);
    const before = req.query.before ? parseInt(req.query.before, 10) : null;

    const rows = before
      ? await q(`select number, hash, ts, tx_count, user_tx_count, gas_used, base_fee_gwei, l1_block_number
                   from blocks where number < $1 order by number desc limit $2`, [before, limit])
      : await q(`select number, hash, ts, tx_count, user_tx_count, gas_used, base_fee_gwei, l1_block_number
                   from blocks order by number desc limit $1`, [limit]);

    cache(res, 5);
    send(res, 200, {
      count: rows.length,
      blocks: rows.map((r) => ({
        number: Number(r.number),
        hash: r.hash,
        timestampISO: r.ts,
        txCount: r.tx_count,
        userTxCount: r.user_tx_count,
        gasUsed: r.gas_used == null ? null : Number(r.gas_used),
        baseFeePerGasGwei: r.base_fee_gwei == null ? null : Number(r.base_fee_gwei),
        l1BlockNumber: r.l1_block_number == null ? null : Number(r.l1_block_number)
      })),
      nextBefore: rows.length ? Number(rows[rows.length - 1].number) : null,
      note: 'Served from the Hood Synapse index — historical data the raw RPC cannot return.',
      ...meta
    });
  } catch (e) {
    send(res, 500, { error: 'index unavailable', detail: String(e.message || e) });
  }
};
