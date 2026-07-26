"""
Hood Synapse — a small Python client for Robinhood Chain.

Reads live chain data and the Hood Synapse index. No key, no account.
Standard library only, so it runs anywhere Python does.

    from hoodsynapse import HoodSynapse

    hs = HoodSynapse()
    print(hs.stats()["latestBlock"])

Docs: https://hoodsynapse.xyz/docs
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

__version__ = "1.0.0"
__all__ = ["HoodSynapse", "HoodSynapseError"]

DEFAULT_API = "https://hoodsynapse.xyz/api"


class HoodSynapseError(RuntimeError):
    """Raised when the API returns an error or cannot be reached."""


class HoodSynapse:
    """Client for the Hood Synapse API.

    Args:
        api: Base URL. Point elsewhere to run against your own deployment.
        timeout: Seconds to wait per request.
    """

    def __init__(self, api: str = DEFAULT_API, timeout: float = 15.0) -> None:
        self.api = api.rstrip("/")
        self.timeout = timeout

    # ── transport ─────────────────────────────────────────────────────────
    def _get(self, path: str, **params: Any) -> Dict[str, Any]:
        query = {k: v for k, v in params.items() if v is not None}
        url = f"{self.api}{path}"
        if query:
            url += "?" + urllib.parse.urlencode(query)

        request = urllib.request.Request(
            url, headers={"Accept": "application/json", "User-Agent": f"hoodsynapse-python/{__version__}"}
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raise HoodSynapseError(f"{exc.code} from {url}") from exc
        except urllib.error.URLError as exc:
            raise HoodSynapseError(f"could not reach {url}: {exc.reason}") from exc
        except json.JSONDecodeError as exc:
            raise HoodSynapseError(f"unexpected response from {url}") from exc

        if isinstance(payload, dict) and payload.get("error"):
            raise HoodSynapseError(payload["error"])
        return payload

    # ── live chain ────────────────────────────────────────────────────────
    def stats(self) -> Dict[str, Any]:
        """Chain snapshot: latest block, gas, block time, L1 anchor."""
        return self._get("/stats")

    def gas(self) -> Dict[str, Any]:
        """Current gas price and base fee."""
        return self._get("/gas")

    def block(self, number: Optional[int] = None) -> Dict[str, Any]:
        """A single block. Omit `number` for the latest one.

        System transactions are counted separately in `userTxCount`, and the
        Arbitrum Orbit fields (l1BlockNumber, sendCount, sendRoot) come decoded.
        """
        return self._get(f"/block/{number}" if number is not None else "/block/latest")

    # ── the index ─────────────────────────────────────────────────────────
    def history(self, limit: int = 25, before: Optional[int] = None) -> List[Dict[str, Any]]:
        """Historical blocks from the Hood Synapse index, newest first.

        An RPC cannot answer this — the index exists so the past stays queryable.
        """
        return self._get("/history", limit=limit, before=before)["blocks"]

    def daily(self, days: int = 30) -> List[Dict[str, Any]]:
        """Daily aggregates: transactions, gas, block cadence."""
        return self._get("/daily", days=days)["days"]

    def index_status(self) -> Dict[str, Any]:
        """What the index currently holds, and how far behind the chain it is."""
        return self._get("/index-status")

    # ── convenience ───────────────────────────────────────────────────────
    def walk_history(self, pages: int = 5, per_page: int = 100) -> List[Dict[str, Any]]:
        """Page backwards through the index and return the blocks collected."""
        blocks: List[Dict[str, Any]] = []
        before: Optional[int] = None
        for _ in range(pages):
            page = self._get("/history", limit=per_page, before=before)
            blocks.extend(page["blocks"])
            before = page.get("nextBefore")
            if not before:
                break
        return blocks

    def __repr__(self) -> str:
        return f"HoodSynapse(api={self.api!r})"


if __name__ == "__main__":
    hs = HoodSynapse()

    chain = hs.stats()
    print(f"Robinhood Chain · chainId {chain['chainId']} · {chain['network']}")
    print(f"  latest block   {chain['latestBlock']:,}")
    print(f"  block time     {chain['blockTimeSeconds']}s")
    print(f"  gas price      {chain['gasPriceGwei']} gwei")

    index = hs.index_status()
    print(f"\nIndex: {index['blocksStored']:,} blocks stored, {index['behind']:,} behind the tip")

    days = hs.daily(days=7)
    if days:
        print("\nDaily activity")
        peak = max(day["txs"] for day in days) or 1
        for day in reversed(days):
            bar = "█" * max(1, round(day["txs"] / peak * 24))
            print(f"  {day['day']}  {bar}  {day['txs']:,} tx")
