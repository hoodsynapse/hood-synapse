// Hood Synapse indexer.
//
// Robinhood Chain produces ~10 blocks per second (~864k/day), and the public RPC
// rate-limits sustained bulk reads. Indexing every block is not workable on this
// tier, so we sample the chain at a fixed stride and roll the samples into daily
// aggregates. The sample is dense enough for accurate statistics and gives us the
// one thing an RPC can never return: history.

const { rpc, dec, gwei, isSystemTx } = require('../_lib');
const { q } = require('../_db');

const STRIDE = 100;      // sample every Nth block
const BATCH = 10;        // parallel RPC calls per wave
const WAVES = 30;        // waves per run -> up to 300 samples (~30k blocks of span)
const TIME_BUDGET = 45000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getBlock(n, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try {
      const b = await rpc('eth_getBlockByNumber', ['0x' + n.toString(16), true]);
      if (b) return b;
    } catch { /* rate limited or transient — back off and retry once */ }
    await sleep(250);
  }
  return null;
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const started = Date.now();
  try {
    const tip = dec(await rpc('eth_blockNumber'));
    const state = await q('select last_indexed from indexer_state where id = 1');
    let cursor = Number(state[0]?.last_indexed || 0);

    // start at the tip on a cold start; if we drift far behind, rejoin near the tip
    if (!cursor || tip - cursor > 500000) cursor = tip - STRIDE;

    const days = new Set();
    let indexed = 0, attempted = 0;

    for (let w = 0; w < WAVES; w++) {
      if (Date.now() - started > TIME_BUDGET) break;

      const nums = [];
      for (let i = 1; i <= BATCH; i++) {
        const n = cursor + i * STRIDE;
        if (n > tip) break;
        nums.push(n);
      }
      if (!nums.length) break;

      attempted += nums.length;
      const blocks = await Promise.all(nums.map((n) => getBlock(n)));

      const rows = [];
      for (const b of blocks) {
        if (!b) continue;
        const txs = b.transactions || [];
        const ts = new Date(dec(b.timestamp) * 1000);
        days.add(ts.toISOString().slice(0, 10));
        rows.push([
          dec(b.number), b.hash, b.parentHash, ts, txs.length,
          txs.filter((t) => !isSystemTx(t)).length,
          dec(b.gasUsed), gwei(b.baseFeePerGas),
          dec(b.l1BlockNumber), dec(b.sendCount), b.sendRoot
        ]);
      }

      if (rows.length) {
        const vals = [], params = [];
        rows.forEach((r, i) => {
          const o = i * 11;
          vals.push(`($${o+1},$${o+2},$${o+3},$${o+4},$${o+5},$${o+6},$${o+7},$${o+8},$${o+9},$${o+10},$${o+11})`);
          params.push(...r);
        });
        await q(
          `insert into blocks
             (number, hash, parent_hash, ts, tx_count, user_tx_count, gas_used, base_fee_gwei, l1_block_number, send_count, send_root)
           values ${vals.join(',')}
           on conflict (number) do nothing`, params);
        indexed += rows.length;
      }

      cursor = nums[nums.length - 1];
      await sleep(120);   // stay under the public RPC's burst limit
    }

    for (const d of days) await q('select refresh_daily($1::date)', [d]);

    await q(
      `update indexer_state set last_indexed = $1, total_blocks = total_blocks + $2, updated_at = now() where id = 1`,
      [cursor, indexed]
    );

    res.status(200).send(JSON.stringify({
      ok: true, sampled: indexed, attempted, stride: STRIDE,
      cursor, tip, behind: tip - cursor, days: [...days], ms: Date.now() - started
    }, null, 2));
  } catch (e) {
    res.status(500).send(JSON.stringify({ ok: false, error: String(e.message || e) }, null, 2));
  }
};
