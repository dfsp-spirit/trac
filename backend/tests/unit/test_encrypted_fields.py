"""The ``*_encrypted`` field-encryption seam.

Two properties carry the whole design and are easy to break by accident:

* a token is unreadable without the key and says nothing about its plaintext,
* a failure never leaks the token or the plaintext into a message or a log,
  because decryption errors are reported on an admin page and in logs.
"""

import base64

import pytest

from o_timeusediary_backend import encrypted_fields as ef
from o_timeusediary_backend.settings import TUDBackendSettings

#: 32 bytes; keep in sync with the test value in backend/.env.example.
TEST_KEY = "dHJhYy11bml0LXRlc3Qta2V5LTMyYnl0ZXMtcGFkISE="

#: A different 32-byte key, for the wrong-key and rotation cases.
OTHER_KEY = "dHJhYy1vdGhlci10ZXN0LWtleS0zMmJ5dGVzISEhISE="

#: Unicode letters, decomposed characters and a name at the length limit.
NAMES = [
    "Tim",
    "Änne",
    "José",
    "李雷",
    "J. R. R.",
    "A" * 50,
]


def _set_keys(monkeypatch, *keys):
    monkeypatch.setenv(ef.KEY_ENV, ",".join(keys))


@pytest.fixture
def keyed(monkeypatch):
    _set_keys(monkeypatch, TEST_KEY)
    return TEST_KEY


def test_other_key_is_a_valid_32_byte_key():
    """The second constant has to be usable, or the tests prove nothing."""
    assert len(base64.urlsafe_b64decode(OTHER_KEY)) == 32
    assert OTHER_KEY != TEST_KEY


@pytest.mark.parametrize("name", NAMES)
def test_roundtrip(keyed, name):
    token = ef.encrypt_text(name)

    assert token != name
    assert name not in token
    assert ef.decrypt_text(token) == name


def test_token_is_versioned_and_bounded(keyed):
    """Worst case: 50 code points of 4-byte UTF-8 characters.

    That is 200 bytes of plaintext, 12 bytes nonce and 16 bytes tag, i.e. 228
    bytes base64 - larger than the 255 characters a naive column bound would
    assume, which is why the column is ``String(512)`` (migration 0025).
    """
    widest = "\U00020000" * 50
    token = ef.encrypt_text(widest)

    assert token.startswith("v1.")
    assert ef.decrypt_text(token) == widest
    assert len(token) <= 512


def test_same_plaintext_seals_to_different_tokens(keyed):
    """A random nonce per value: no equality search, no pattern in the column."""
    first = ef.encrypt_text("Tim")
    second = ef.encrypt_text("Tim")

    assert first != second
    assert ef.decrypt_text(first) == ef.decrypt_text(second) == "Tim"


@pytest.mark.parametrize("value", [None, "", "   "])
def test_nothing_to_store_becomes_null(keyed, value):
    assert ef.encrypt_text(value) is None
    assert ef.decrypt_text(value) is None


def test_wrong_key_raises_without_leaking(monkeypatch):
    _set_keys(monkeypatch, TEST_KEY)
    token = ef.encrypt_text("Tim")
    _set_keys(monkeypatch, OTHER_KEY)

    with pytest.raises(ef.DecryptionError) as error:
        ef.decrypt_text(token)

    message = str(error.value)
    assert "Tim" not in message
    assert token not in message
    assert ef.KEY_ENV in message


def test_rotation_reads_the_old_token_with_the_new_key_first(monkeypatch):
    """Prepended key encrypts, all keys decrypt - no migration needed."""
    _set_keys(monkeypatch, TEST_KEY)
    old_token = ef.encrypt_text("Tim")

    _set_keys(monkeypatch, OTHER_KEY, TEST_KEY)

    assert ef.decrypt_text(old_token) == "Tim"
    # New values are sealed with the first key, so they no longer read without it.
    new_token = ef.encrypt_text("Tom")
    _set_keys(monkeypatch, TEST_KEY)
    with pytest.raises(ef.DecryptionError):
        ef.decrypt_text(new_token)


def test_unknown_envelope_version_is_rejected(keyed):
    with pytest.raises(ef.DecryptionError):
        ef.decrypt_text("v9.bm90LWEtdG9rZW4")


def test_tampered_token_is_rejected(keyed):
    token = ef.encrypt_text("Tim")
    version, _, payload = token.partition(".")
    flipped = payload[:-2] + ("AA" if payload[-2:] != "AA" else "BB")

    with pytest.raises(ef.DecryptionError):
        ef.decrypt_text(f"{version}.{flipped}")


def test_garbage_is_rejected_without_echoing_it(keyed):
    with pytest.raises(ef.DecryptionError) as error:
        ef.decrypt_text("v1.!!!not-base64!!!")

    assert "not-base64" not in str(error.value)


def test_missing_key_is_a_configuration_error(monkeypatch):
    monkeypatch.delenv(ef.KEY_ENV, raising=False)

    with pytest.raises(ef.EncryptionConfigError):
        ef.encrypt_text("Tim")

    with pytest.raises(ef.EncryptionConfigError):
        ef.decrypt_text("v1.AAAA")

    with pytest.raises(ef.EncryptionConfigError):
        ef.probe([("p1", "v1.AAAA")])


@pytest.mark.parametrize(
    "raw",
    [
        ",",  # two empty entries
        f"{TEST_KEY},",  # trailing separator
        "too-short",
        "0" * 63,  # 63 hex characters
        base64.urlsafe_b64encode(b"x" * 16).decode(),  # valid base64, wrong size
    ],
)
def test_malformed_key_list_is_rejected(monkeypatch, raw):
    monkeypatch.setenv(ef.KEY_ENV, raw)

    with pytest.raises(ef.EncryptionConfigError) as error:
        ef.configured_keys()

    assert ef.KEY_ENV in str(error.value)


def test_hex_keys_are_accepted(monkeypatch):
    hex_key = "0123456789abcdef" * 4
    _set_keys(monkeypatch, hex_key)

    token = ef.encrypt_text("Tim")

    _set_keys(monkeypatch, base64.urlsafe_b64encode(bytes.fromhex(hex_key)).decode())
    assert ef.decrypt_text(token) == "Tim"


def test_unpadded_base64_key_is_accepted(monkeypatch):
    _set_keys(monkeypatch, TEST_KEY.rstrip("="))

    assert ef.decrypt_text(ef.encrypt_text("Tim")) == "Tim"


def test_keys_keep_configuration_order(monkeypatch):
    _set_keys(monkeypatch, TEST_KEY, OTHER_KEY)

    keys = ef.configured_keys()

    assert keys[0] == base64.urlsafe_b64decode(TEST_KEY)
    assert keys[1] == base64.urlsafe_b64decode(OTHER_KEY)


@pytest.mark.parametrize(
    "name, expected",
    [
        ("subject_name_encrypted", True),
        ("SUBJECT_NAME_ENCRYPTED", True),
        (" subject_name_encrypted ", True),
        ("display_name", False),
        ("encrypted", False),
        ("_encrypted", False),
        (None, False),
        (42, False),
    ],
)
def test_is_encrypted_field(name, expected):
    assert ef.is_encrypted_field(name) is expected


def test_mask_never_returns_the_value():
    assert ef.mask("Tim") == "***"
    assert ef.mask("") == ""
    assert ef.mask(None) == ""


def test_probe_counts_and_skips_empty_values(monkeypatch):
    _set_keys(monkeypatch, TEST_KEY)
    good = ef.encrypt_text("Tim")
    _set_keys(monkeypatch, OTHER_KEY)
    unreadable = ef.encrypt_text("Tim")

    _set_keys(monkeypatch, TEST_KEY)
    result = ef.probe(
        [("p1", good), ("p2", unreadable), ("p3", None), ("p4", "")]
    )

    assert result == ef.ProbeResult(
        checked=2, decrypted=1, failed=1, failed_ids=("p2",)
    )


def test_probe_on_an_empty_sample_reports_nothing_checked(keyed):
    assert ef.probe([]) == ef.ProbeResult(
        checked=0, decrypted=0, failed=0, failed_ids=()
    )


def test_decode_incoming_uses_the_same_envelope_for_now(keyed):
    """The KI's file format is open; this is the one place that will change."""
    token = ef.encrypt_text("Tim")

    assert ef.decode_incoming(token) == "Tim"
    assert ef.decode_incoming(None) is None


def test_settings_delegates_and_validates(monkeypatch):
    settings = TUDBackendSettings()

    monkeypatch.delenv(ef.KEY_ENV, raising=False)
    assert settings.field_encryption_keys == []
    settings.validate_field_encryption_keys()  # absent is allowed

    _set_keys(monkeypatch, TEST_KEY)
    assert settings.field_encryption_keys == [base64.urlsafe_b64decode(TEST_KEY)]

    monkeypatch.setenv(ef.KEY_ENV, "broken")
    with pytest.raises(ef.EncryptionConfigError):
        settings.validate_field_encryption_keys()
