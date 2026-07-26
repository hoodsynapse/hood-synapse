# hoodsynapse — Python client

A small client for the [Hood Synapse API](https://hoodsynapse.xyz/api). Standard library
only — no dependencies, no key, no account.

## Use it

Drop `hoodsynapse.py` next to your code:

```python
from hoodsynapse import HoodSynapse

hs = HoodSynapse()

chain = hs.stats()
print(chain["latestBlock"], chain["gasPriceGwei"], "gwei")
```

Or run it directly to see it work:

```bash
python hoodsynapse.py
```

```
Robinhood Chain · chainId 4663 · mainnet
  latest block   20,133,315
  block time     0.12s
  gas price      0.050214 gwei

Index: 1,512 blocks stored, 8,612 behind the tip

Daily activity
  2026-07-26  ████████████████████████  19,829 tx
```

## Methods

| Method | Returns |
| --- | --- |
| `stats()` | Chain snapshot — block, gas, block time, L1 anchor |
| `gas()` | Gas price and base fee |
| `block(number=None)` | One block; omit the argument for the latest |
| `history(limit, before)` | Historical blocks from the index |
| `daily(days)` | Daily aggregates |
| `index_status()` | What the index holds |
| `walk_history(pages, per_page)` | Page backwards and collect blocks |

## Examples

```python
hs = HoodSynapse()

# a specific block, orbit fields already decoded
block = hs.block(20061111)
print(block["userTxCount"], "user txs")
print(block["l1BlockNumber"], block["sendRoot"])

# thirty days of activity
for day in hs.daily(days=30):
    print(day["day"], day["txs"], "txs")

# page backwards through the index
blocks = hs.walk_history(pages=3, per_page=100)
print(len(blocks), "blocks collected")
```

## Errors

Anything that fails raises `HoodSynapseError`:

```python
from hoodsynapse import HoodSynapse, HoodSynapseError

try:
    hs.block(999_999_999_999)
except HoodSynapseError as exc:
    print("no:", exc)
```

## Pointing elsewhere

```python
hs = HoodSynapse(api="http://localhost:3000/api", timeout=30)
```

Requires Python 3.8+.
