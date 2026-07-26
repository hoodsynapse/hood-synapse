// Daily chain statistics — aggregates only an indexer can produce.
const { preflight, send, cache, meta } = require('./_lib');
const { q } = require('./_db');

module.exports = async (req, res) => {
  if (preflight(req, res)) return;
  try {
    const days = Math.min(Math.max(parseInt(req.query.days || '30', 10) || 30, 1), 365);
    const rows = await q(
      `select day, blocks, txs, user_txs, gas_used, avg_base_fee_gwei, avg_block_time_s, first_block, last_block
         from daily_stats order by day desc limit $1`, [days]);

    cache(res, 60);
    send(res, 200, {
      count: rows.length,
      days: rows.map((r) => ({
        day: typeof r.day === 'string' ? r.day : r.day.toISOString().slice(0, 10),
        blocks: Number(r.blocks),
        txs: Number(r.txs),
        userTxs: Number(r.user_txs),
        gasUsed: Number(r.gas_used),
        avgBaseFeeGwei: r.avg_base_fee_gwei == null ? null : Number(r.avg_base_fee_gwei),
        avgBlockTimeSeconds: r.avg_block_time_s == null ? null : Number(r.avg_block_time_s),
        firstBlock: r.first_block == null ? null : Number(r.first_block),
        lastBlock: r.last_block == null ? null : Number(r.last_block)
      })),
      note: 'Daily aggregates computed from the Hood Synapse index.',
      ...meta
    });
  } catch (e) {
    send(res, 500, { error: 'index unavailable', detail: String(e.message || e) });
  }
};
