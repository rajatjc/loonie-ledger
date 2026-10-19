"""Fraud scoring rules.

Pure functions with no I/O, so every rule is easy to test and to explain to a
reviewer. Each rule that fires adds points and a human-readable reason.
"""

from dataclasses import dataclass, field
from datetime import datetime
from zoneinfo import ZoneInfo

HOLD_THRESHOLD = 60
TORONTO = ZoneInfo("America/Toronto")


@dataclass(frozen=True)
class History:
    """What we know about the sender before this transfer."""

    transfer_count: int = 0
    total_cents: int = 0
    known_recipients: frozenset[str] = frozenset()
    recent_transfers: int = 0  # in the velocity window, excluding this one

    @property
    def average_cents(self) -> float:
        return self.total_cents / self.transfer_count if self.transfer_count else 0.0


@dataclass(frozen=True)
class Transfer:
    transfer_id: str
    from_customer: str
    to_account: str
    to_name: str
    amount_cents: int
    sent_at: datetime


@dataclass
class Verdict:
    score: int = 0
    reasons: list[str] = field(default_factory=list)

    @property
    def decision(self) -> str:
        return "HOLD" if self.score >= HOLD_THRESHOLD else "PASS"

    def add(self, points: int, reason: str) -> None:
        self.score = min(100, self.score + points)
        self.reasons.append(reason)


RULES = [
    {"id": "new_recipient", "points": 20, "description": "First transfer to this recipient"},
    {"id": "large_amount", "points": 40, "description": "$10,000 or more (20 points from $3,000)"},
    {"id": "unusual_amount", "points": 30, "description": "More than 3x the sender's average, after 3+ transfers"},
    {"id": "velocity", "points": 30, "description": "3 or more transfers in the last 2 minutes"},
    {"id": "round_amount", "points": 10, "description": "Round thousands, often used to stay under limits"},
    {"id": "late_night", "points": 10, "description": "Sent between midnight and 5 AM Toronto time"},
]


def money(cents: int) -> str:
    return f"${cents / 100:,.2f}"


def score(t: Transfer, h: History) -> Verdict:
    v = Verdict()
    if t.to_account not in h.known_recipients:
        v.add(20, f"First transfer to {t.to_name}")
    if t.amount_cents >= 1_000_000:
        v.add(40, f"Large amount ({money(t.amount_cents)})")
    elif t.amount_cents >= 300_000:
        v.add(20, f"Above-average amount ({money(t.amount_cents)})")
    if h.transfer_count >= 3 and t.amount_cents > 3 * h.average_cents:
        v.add(30, f"{t.amount_cents / h.average_cents:.1f}x this customer's average transfer")
    if h.recent_transfers >= 3:
        v.add(30, f"{h.recent_transfers + 1} transfers in 2 minutes")
    if t.amount_cents >= 100_000 and t.amount_cents % 100_000 == 0:
        v.add(10, "Round amount")
    local = t.sent_at.astimezone(TORONTO)
    if local.hour < 5:
        v.add(10, f"Sent at {local.strftime('%-I:%M %p')} Toronto time")
    return v
