const { send, cache, preflight, meta } = require('./_lib');

module.exports = async (req, res) => {
  if (preflight(req, res)) return;
  cache(res, 3600);
  send(res, 200, {
    name: 'Hood Synapse API',
    description: 'Clean JSON over Robinhood Chain mainnet. Open CORS, no key required.',
    chainId: 4663,
    network: 'mainnet',
    endpoints: {
      'GET /api': 'this index',
      'GET /api/stats': 'chain snapshot — latest block, gas, block time',
      'GET /api/gas': 'gas breakdown',
      'GET /api/block/latest': 'latest block, cleaned + system txs identified',
      'GET /api/block/{number}': 'block by number (decimal)',
      'GET /api/history': 'historical blocks from our own index (?limit, ?before)',
      'GET /api/daily': 'daily chain statistics (?days)',
      'GET /api/index-status': 'how far the Hood Synapse index reaches',
      'GET /api/tokens': 'tokens ranked by activity, with on-chain price, liquidity, volume and holders (?limit, ?kind=rwa|equity|fund|private|stable|meme|infra)',
      'GET /api/tokens?history={address}': 'daily open/high/low/close for one token (?days)'
    },
    index: {
      note: 'Hood Synapse runs its own indexer over Robinhood Chain. The chain produces ~10 blocks/second, so the index samples every 100th block and rolls them into daily aggregates.',
      gives: ['history the RPC cannot return', 'daily statistics', 'a record that grows over time']
    },
    ...meta
  });
};
