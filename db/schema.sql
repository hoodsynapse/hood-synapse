-- Hood Synapse — indexer schema (Robinhood Chain mainnet, chainId 4663)

-- ── blocks ────────────────────────────────────────────────────────────────
create table if not exists blocks (
  number            bigint       primary key,
  hash              text         not null,
  parent_hash       text,
  ts                timestamptz  not null,
  tx_count          int          not null default 0,
  user_tx_count     int          not null default 0,
  gas_used          bigint,
  base_fee_gwei     numeric(20,9),
  l1_block_number   bigint,
  send_count        bigint,
  send_root         text,
  indexed_at        timestamptz  not null default now()
);
create index if not exists blocks_ts_idx     on blocks (ts desc);
create index if not exists blocks_number_idx on blocks (number desc);

-- ── daily aggregates (the moat: history RPC can't give you) ───────────────
create table if not exists daily_stats (
  day               date         primary key,
  blocks            bigint       not null default 0,
  txs               bigint       not null default 0,
  user_txs          bigint       not null default 0,
  gas_used          numeric      not null default 0,
  avg_base_fee_gwei numeric(20,9),
  avg_block_time_s  numeric(10,3),
  first_block       bigint,
  last_block        bigint,
  updated_at        timestamptz  not null default now()
);

-- ── indexer bookkeeping ───────────────────────────────────────────────────
create table if not exists indexer_state (
  id                int          primary key default 1,
  last_indexed      bigint       not null default 0,
  total_blocks      bigint       not null default 0,
  updated_at        timestamptz  not null default now(),
  constraint one_row check (id = 1)
);
insert into indexer_state (id, last_indexed) values (1, 0) on conflict (id) do nothing;

-- ── daily rollup helper ───────────────────────────────────────────────────
create or replace function refresh_daily(day_in date) returns void as $$
begin
  insert into daily_stats (day, blocks, txs, user_txs, gas_used, avg_base_fee_gwei, first_block, last_block, avg_block_time_s, updated_at)
  select
    day_in,
    count(*),
    coalesce(sum(tx_count),0),
    coalesce(sum(user_tx_count),0),
    coalesce(sum(gas_used),0),
    round(avg(base_fee_gwei), 9),
    min(number),
    max(number),
    case when count(*) > 1
      then round(extract(epoch from (max(ts) - min(ts)))::numeric / nullif(count(*) - 1, 0), 3)
      else null end,
    now()
  from blocks
  where ts >= day_in::timestamptz and ts < (day_in + 1)::timestamptz
  on conflict (day) do update set
    blocks = excluded.blocks,
    txs = excluded.txs,
    user_txs = excluded.user_txs,
    gas_used = excluded.gas_used,
    avg_base_fee_gwei = excluded.avg_base_fee_gwei,
    first_block = excluded.first_block,
    last_block = excluded.last_block,
    avg_block_time_s = excluded.avg_block_time_s,
    updated_at = now();
end;
$$ language plpgsql;
