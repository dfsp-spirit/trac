from datetime import datetime, timedelta, timezone

from o_timeusediary_backend.participant_sessions import (
    hash_session_token,
    session_is_expired,
)


def test_hash_session_token_is_stable_and_not_the_token():
    token = "a-random-cookie-token"
    hashed = hash_session_token(token)
    assert hashed == hash_session_token(token)
    assert hashed != token
    assert len(hashed) == 64


def test_a_zero_timeout_never_expires():
    now = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
    assert not session_is_expired(now - timedelta(days=365), 0, now)


def test_session_expires_at_the_timeout_boundary():
    now = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
    assert session_is_expired(now - timedelta(minutes=30), 30, now)
    assert not session_is_expired(
        now - timedelta(minutes=30) + timedelta(seconds=1), 30, now
    )


def test_naive_database_timestamps_are_compared_as_utc():
    now = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
    naive_last_seen = datetime(2026, 1, 1, 11, 20)
    assert session_is_expired(naive_last_seen, 30, now)
