#!/usr/bin/env python3
"""Hard budget guard + local usage ledger for Google Places API (New) calls.

Why this exists: Google Maps Platform bills per **SKU**, and since March 2025 each SKU
has its own *free monthly allowance* (no pooling, no rollover, per calendar month).
Past the allowance every call costs real money, so "stay inside the free tier" cannot
depend on an operator remembering a threshold — every API call in the data pipeline goes
through :meth:`PlacesBudget.spend`, which refuses the call that would cross the line.

    SKU             SKU name (Google)              Free / month    After the free allowance
    text_search     Text Search (Pro)              5,000           $32 / 1,000
    nearby_search   Nearby Search (Pro)            5,000           $32 / 1,000
    details         Place Details (Enterprise)     1,000           $20 / 1,000   <-- binding
    photo           Place Details Photos           1,000           $7  / 1,000

The SKU tier is set by the **highest-tier field in the field mask**, not by the endpoint
name. TEXT_SEARCH_MASK asks only for identity, name, address, type and location, so the
highest field it contains is `displayName` — Pro — and searches get the 5,000 allowance.
DETAILS_MASK asks for `rating`, `userRatingCount`, `regularOpeningHours`, `websiteUri` and
`nationalPhoneNumber`, all Enterprise, so details gets 1,000. That asymmetry is deliberate:
discovery is just looking, and the listing content comes from details.

Getting this table wrong in either direction has a cost. In September 2026 it said 5,000
for details while the mask was Enterprise, so the guard saw nothing wrong as 1,306 details
calls went past the real 1,000 allowance and cost ~$6. Re-derive these numbers from the
masks and https://developers.google.com/maps/documentation/places/web-service/data-fields
before changing either one — and change the mask and the cap in the same commit.

The ledger lives at ``data/usage-ledger.json`` (git-ignored, machine-local, like the rest
of ``data/``) and is rewritten after *every* counted call, so a killed or timed-out run
never loses usage. It is the source of truth for "how much of this month's free tier is
left"; the run resumes on the first day of the next calendar month.

Read it on its own:

    python3 scripts/places_budget.py

Programmatic use::

    budget = PlacesBudget()
    budget.spend("details")          # raises BudgetExhausted instead of overspending
    print(budget.remaining("photo"))
"""

from __future__ import annotations

import json
import os
import tempfile
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Dict, Optional

PROJECT_DIR = Path(__file__).resolve().parent.parent
LEDGER_PATH = PROJECT_DIR / "data" / "usage-ledger.json"

# Free monthly allowance per SKU (Google Maps Platform, per-SKU free tier since Mar 2025).
#
# These values are a function of the FIELD MASKS in broaden.py, not of the endpoints:
# a request bills at the highest tier any one of its fields belongs to.
#   * text_search / nearby_search use TEXT_SEARCH_MASK, whose highest field is
#     displayName (Pro)  -> Pro allowance, 5,000/month.
#   * details uses DETAILS_MASK, which asks for rating / userRatingCount /
#     regularOpeningHours / websiteUri / nationalPhoneNumber (all Enterprise)
#     -> Enterprise allowance, 1,000/month. This is the pipeline's binding constraint.
#   * photo is its own SKU, 1,000/month.
# If you change a mask, change the matching cap here in the same commit. Getting this
# wrong in the other direction is how this project spent ~$6 in September 2026: the
# caps said 5,000 where the masks said Enterprise.
FREE_MONTHLY_CAPS: Dict[str, int] = {
    "text_search": 5000,
    "nearby_search": 5000,
    "details": 1000,
    "photo": 1000,
}

SKU_LABELS: Dict[str, str] = {
    "text_search": "Text Search (Pro)",
    "nearby_search": "Nearby Search (Pro)",
    "details": "Place Details (Enterprise)",
    "photo": "Place Details Photos",
}

# Cost per 1,000 calls once the free allowance is used up.
PAID_RATES_PER_1000: Dict[str, float] = {
    "text_search": 32.0,
    "nearby_search": 32.0,
    "details": 20.0,
    "photo": 7.0,
}

MONTH_OVERRIDE_ENV = "PLACES_BUDGET_MONTH"  # testing / backfill only
LEDGER_MAX_RUNS = 200


class BudgetExhausted(RuntimeError):
    """Raised *before* a call that would push a SKU past its free monthly allowance."""

    def __init__(self, sku: str, used: int, cap: int, month: str):
        self.sku = sku
        self.used = used
        self.cap = cap
        self.month = month
        self.resume_month = next_month(month)
        super().__init__(
            f"{SKU_LABELS.get(sku, sku)} budget exhausted: {used:,}/{cap:,} free calls "
            f"used in {month}. Refusing to spend (would go over the free tier). "
            f"Resume on/after {self.resume_month}."
        )


class QuotaBlocked(RuntimeError):
    """Raised when Google itself blocks a call (console per-SKU quota / 429)."""


def current_month() -> str:
    """Current calendar month as ``YYYY-MM`` (local time), or the testing override."""
    override = os.environ.get(MONTH_OVERRIDE_ENV)
    if override:
        return override
    return date.today().strftime("%Y-%m")


def next_month(month: str) -> str:
    year, mon = (int(part) for part in month.split("-"))
    if mon == 12:
        return f"{year + 1}-01"
    return f"{year}-{mon + 1:02d}"


def _empty_ledger() -> dict:
    return {"version": 1, "updated_at": None, "months": {}, "runs": []}


def load_ledger(path: Path) -> dict:
    """Read the ledger. A missing file starts empty; an unreadable one is fatal.

    Refusing to run on a corrupt ledger is deliberate: without it we cannot know how
    much of the free allowance is already spent, and guessing is how you get a bill.
    """
    path = Path(path)
    if not path.exists():
        return _empty_ledger()
    try:
        data = json.loads(path.read_text())
    except (ValueError, OSError) as exc:
        raise RuntimeError(
            f"usage ledger {path} is unreadable ({exc}). Inspect/repair it (or move it "
            f"aside and re-create it with the true counts) before spending API calls — "
            f"running without a ledger risks exceeding the free tier."
        )
    if not isinstance(data, dict) or "months" not in data:
        raise RuntimeError(f"usage ledger {path} has an unexpected shape; refusing to run.")
    data.setdefault("version", 1)
    data.setdefault("runs", [])
    return data


class PlacesBudget:
    """Per-SKU monthly call guard backed by a JSON ledger."""

    def __init__(
        self,
        ledger_path: Optional[Path] = None,
        caps: Optional[Dict[str, int]] = None,
        month: Optional[str] = None,
        headroom: int = 0,
    ):
        self.ledger_path = Path(ledger_path or LEDGER_PATH)
        self.month = month or current_month()
        self.headroom = max(0, int(headroom))
        self.caps = dict(FREE_MONTHLY_CAPS)
        if caps:
            for sku, value in caps.items():
                if sku not in self.caps:
                    raise ValueError(f"unknown SKU {sku!r}; known: {sorted(self.caps)}")
                # Overrides may only *lower* a cap — never raise it above the free tier.
                self.caps[sku] = max(0, min(self.caps[sku], int(value)))
        self.ledger = load_ledger(self.ledger_path)
        self._ensure_month()

    # ── internal ──────────────────────────────────────────────────────────
    def _ensure_month(self) -> None:
        month_data = self.ledger["months"].setdefault(self.month, {})
        for sku in self.caps:
            month_data.setdefault(sku, 0)
        month_data.setdefault("updated_at", None)

    def _touch(self) -> None:
        self.ledger["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        self.ledger["months"][self.month]["updated_at"] = self.ledger["updated_at"]

    def save(self) -> None:
        """Atomically write the ledger (tmp file + rename) so a crash cannot truncate it."""
        self.ledger_path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(self.ledger, indent=2, ensure_ascii=False) + "\n"
        fd, tmp_name = tempfile.mkstemp(
            dir=str(self.ledger_path.parent), prefix=".usage-ledger-", suffix=".tmp"
        )
        try:
            with os.fdopen(fd, "w") as fh:
                fh.write(payload)
            os.replace(tmp_name, self.ledger_path)
        except BaseException:
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
            raise

    # ── read side ─────────────────────────────────────────────────────────
    def used(self, sku: str) -> int:
        return int(self.ledger["months"][self.month].get(sku, 0))

    def effective_cap(self, sku: str) -> int:
        return max(0, self.caps[sku] - self.headroom)

    def remaining(self, sku: str) -> int:
        return max(0, self.effective_cap(sku) - self.used(sku))

    def can_spend(self, sku: str, n: int = 1) -> bool:
        return self.used(sku) + n <= self.effective_cap(sku)

    def check(self, sku: str, n: int = 1) -> None:
        """Raise :class:`BudgetExhausted` if `n` calls to `sku` would break the free tier."""
        if not self.can_spend(sku, n):
            raise BudgetExhausted(sku, self.used(sku), self.effective_cap(sku), self.month)

    # ── write side ────────────────────────────────────────────────────────
    def spend(self, sku: str, n: int = 1) -> None:
        """Count `n` calls against `sku` and persist. Call this *before* the request.

        Counting before the call is deliberate: if the process dies mid-request the call
        still shows in the ledger, so the guard can only ever be conservative.
        """
        self.check(sku, n)
        self.ledger["months"][self.month][sku] = self.used(sku) + n
        self._touch()
        self.save()

    def record_run(self, phase: str, deltas: Dict[str, int], note: str = "") -> None:
        """Append an audit line: what a run actually cost, per SKU."""
        entry = {
            "phase": phase,
            "month": self.month,
            "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "deltas": {sku: int(v) for sku, v in deltas.items() if v},
            "note": note,
        }
        runs = self.ledger.setdefault("runs", [])
        runs.append(entry)
        del runs[:-LEDGER_MAX_RUNS]
        self.save()

    # ── reporting ─────────────────────────────────────────────────────────
    def month_totals(self) -> Dict[str, int]:
        return {sku: self.used(sku) for sku in FREE_MONTHLY_CAPS}

    def summary_lines(self) -> list:
        lines = [
            f"Google Places free tier — {self.month}"
            + (f"  (headroom {self.headroom} call(s))" if self.headroom else "")
        ]
        for sku in ("text_search", "nearby_search", "details", "photo"):
            used = self.used(sku)
            cap = self.effective_cap(sku)
            rate = PAID_RATES_PER_1000[sku]
            extra = f"  (over the free tier: ${rate * max(0, used - cap) / 1000:.2f})" if used > cap else ""
            lines.append(
                f"  {sku:<14} {used:>6,} / {cap:<6,} used   {self.remaining(sku):>6,} left"
                f"   free {FREE_MONTHLY_CAPS[sku]:,}/mo, then ${rate}/1,000{extra}"
            )
        lines.append(f"  ledger: {self.ledger_path}")
        lines.append(f"  next free allowance (new calendar month): {next_month(self.month)}")
        return lines

    def paid_projection(self, planned: Dict[str, int]) -> float:
        """USD this run would add, given the calls planned -- 0.0 while inside the free tier."""
        total = 0.0
        for sku, n in planned.items():
            used = self.used(sku)
            cap = self.effective_cap(sku)
            billable = max(0, used + n - cap)
            total += billable * PAID_RATES_PER_1000[sku] / 1000.0
        return total


def parse_caps(spec: Optional[str]) -> Dict[str, int]:
    """Parse ``--caps 'details=20,photo=5'`` (lowering-only CLI override for tests/demo)."""
    if not spec:
        return {}
    caps: Dict[str, int] = {}
    for chunk in spec.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        sku, _, value = chunk.partition("=")
        sku = sku.strip()
        if sku not in FREE_MONTHLY_CAPS:
            raise ValueError(f"unknown SKU {sku!r} in --caps; known: {sorted(FREE_MONTHLY_CAPS)}")
        caps[sku] = int(value)
    return caps


def _main() -> int:
    budget = PlacesBudget()
    print("\n".join(budget.summary_lines()))
    runs = budget.ledger.get("runs", [])[-10:]
    if runs:
        print("\nlast runs (local ledger):")
        for entry in runs:
            deltas = ", ".join(f"{k}={v}" for k, v in entry.get("deltas", {}).items()) or "no calls"
            print(f"  {entry.get('at')}  {entry.get('phase'):<10} {deltas}")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
