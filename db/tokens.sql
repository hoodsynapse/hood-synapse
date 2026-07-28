-- Hood Synapse — token index
-- Robinhood Chain carries tokenized equities, ETFs and private companies
-- alongside native tokens. This tracks what is actually moving.

create table if not exists tokens (
  address         text        primary key,
  symbol          text,
  name            text,
  decimals        int,
  kind            text,                   -- equity | fund | private | stable | native | lp
  icon_url        text,                   -- official logo, or null; never guessed
  icon_checked_at timestamptz,            -- null means the icon pass hasn't looked yet
  price_usd        numeric,               -- on-chain DEX price, deepest pair
  price_change_24h numeric,
  liquidity_usd    numeric,               -- summed across every pair
  volume_24h       numeric,
  pair_count       int,
  holders          int,                   -- from the chain explorer, rotated
  holders_at       timestamptz,
  market_at        timestamptz,           -- when a price was last actually read
  market_checked_at timestamptz,          -- when the pass last tried, success or not
  first_seen      timestamptz not null default now(),
  last_seen       timestamptz not null default now(),
  transfers       bigint      not null default 0,
  updated_at      timestamptz not null default now()
);
create index if not exists tokens_transfers_idx on tokens (transfers desc);
create index if not exists tokens_last_seen_idx on tokens (last_seen desc);
create index if not exists tokens_icon_todo_idx on tokens (transfers desc) where icon_checked_at is null;
create index if not exists tokens_liquidity_idx on tokens (liquidity_usd desc nulls last);
create index if not exists tokens_market_todo_idx on tokens (market_at asc nulls first);

-- rolling activity, one row per token per day
create table if not exists token_daily (
  address       text        not null,
  day           date        not null,
  transfers     bigint      not null default 0,
  senders       int         not null default 0,
  receivers     int         not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (address, day)
);
create index if not exists token_daily_day_idx on token_daily (day desc, transfers desc);

-- Daily market history.
--
-- The tokens table only ever holds the latest price. This is the part that cannot be
-- backfilled: a price that was not recorded on the day it happened is gone, and no
-- API sells it back. One row per token per day, built from every market pass.
create table if not exists token_market_daily (
  address       text        not null,
  day           date        not null,
  open_usd      numeric,                  -- first price seen that day, never rewritten
  high_usd      numeric,
  low_usd       numeric,
  close_usd     numeric,                  -- most recent price that day
  liquidity_usd numeric,
  volume_24h    numeric,
  samples       int         not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (address, day)
);
create index if not exists token_market_daily_day_idx on token_market_daily (day desc);

-- indexer bookkeeping for the token scanner (separate cursor from the block indexer)
create table if not exists token_state (
  id            int         primary key default 1,
  last_scanned  bigint      not null default 0,
  updated_at    timestamptz not null default now(),
  constraint token_state_one_row check (id = 1)
);
insert into token_state (id, last_scanned) values (1, 0) on conflict (id) do nothing;
