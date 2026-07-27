-- Hood Synapse — token index
-- Robinhood Chain carries tokenized equities, ETFs and private companies
-- alongside native tokens. This tracks what is actually moving.

create table if not exists tokens (
  address       text        primary key,
  symbol        text,
  name          text,
  decimals      int,
  kind          text,                     -- equity | fund | private | stable | native
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  transfers     bigint      not null default 0,
  updated_at    timestamptz not null default now()
);
create index if not exists tokens_transfers_idx on tokens (transfers desc);
create index if not exists tokens_last_seen_idx on tokens (last_seen desc);

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

-- indexer bookkeeping for the token scanner (separate cursor from the block indexer)
create table if not exists token_state (
  id            int         primary key default 1,
  last_scanned  bigint      not null default 0,
  updated_at    timestamptz not null default now(),
  constraint token_state_one_row check (id = 1)
);
insert into token_state (id, last_scanned) values (1, 0) on conflict (id) do nothing;
