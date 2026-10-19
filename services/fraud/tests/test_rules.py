from datetime import datetime, timezone

from app.rules import History, Transfer, score

NOON_TORONTO = datetime(2026, 10, 18, 16, 0, tzinfo=timezone.utc)


def transfer(cents: int, to: str = "liam-chq", at: datetime = NOON_TORONTO) -> Transfer:
    return Transfer("t1", "maya", to, "Liam", cents, at)


def test_small_transfer_to_a_new_recipient_passes():
    v = score(transfer(2_500), History())
    assert v.decision == "PASS"
    assert v.score == 20
    assert v.reasons == ["First transfer to Liam"]


def test_known_recipient_and_normal_amount_scores_zero():
    v = score(transfer(2_500), History(transfer_count=5, total_cents=20_000, known_recipients=frozenset({"liam-chq"})))
    assert v.score == 0
    assert v.reasons == []


def test_large_round_transfer_to_a_new_recipient_is_held():
    v = score(transfer(1_200_000), History())
    assert v.decision == "HOLD"
    assert v.score == 70
    assert "Large amount ($12,000.00)" in v.reasons
    assert "Round amount" in v.reasons


def test_amount_far_above_the_customers_average():
    history = History(transfer_count=4, total_cents=40_000, known_recipients=frozenset({"liam-chq"}))
    v = score(transfer(50_000), history)
    assert v.reasons == ["5.0x this customer's average transfer"]
    assert v.score == 30


def test_rapid_fire_transfers_trip_velocity():
    v = score(transfer(1_000), History(recent_transfers=3, known_recipients=frozenset({"liam-chq"})))
    assert v.reasons == ["4 transfers in 2 minutes"]


def test_late_night_in_toronto():
    two_am_toronto = datetime(2026, 10, 18, 6, 0, tzinfo=timezone.utc)
    v = score(transfer(2_500, at=two_am_toronto), History(known_recipients=frozenset({"liam-chq"})))
    assert v.reasons == ["Sent at 2:00 AM Toronto time"]


def test_score_is_capped_at_100():
    history = History(transfer_count=3, total_cents=3_000, recent_transfers=5)
    two_am = datetime(2026, 10, 18, 6, 0, tzinfo=timezone.utc)
    assert score(transfer(2_000_000, at=two_am), history).score == 100
