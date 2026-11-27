"""Ciphertext columns: what a ``*_encrypted`` column holds and how a value is sealed.

Field-level encryption exists for one reason: the KI requires a child's first
name to be unreadable in the database, in its dumps and in the roster backup
(see ``dev_tools/plans/proxy_studies.md`` §7). Everything about the mechanism
lives here and nowhere else:

* the **naming rule** — a column whose name ends in ``_encrypted`` holds a token
  produced by this module, and no other column does. The rule is what lets a
  reader, and the CI guards, tell at a glance that a value is ciphertext.
* the **envelope** — ``v1.`` followed by base64url of
  ``nonce || ciphertext || tag``, AES-256-GCM with a random 12-byte nonce per
  value. The version prefix is not decoration: the KI encrypts the roster file
  with whatever library they like, so ``decode_incoming`` is the one seam where
  a foreign format is added later without touching a single caller.
* the **key** — one or more raw 32-byte keys from
  ``TUD_FIELD_ENCRYPTION_KEYS`` (comma-separated, hex or base64url). The first
  key encrypts, every configured key decrypts, so a rotation needs no
  migration and no downtime.

Two rules the callers must keep:

* An encrypted value is never searched, sorted, joined or exported. Ciphertext
  cannot be compared by value, and the plaintext may only exist in the few
  places that genuinely need it (``{display_name}`` in the study-config
  payload, the import validation).
* An error must never carry the token or the plaintext. The messages here name
  the problem only; the caller adds the participant id, because a decryption
  failure is reported on an admin page and in a log, and both may name the
  participant, not the child.
"""

from __future__ import annotations

import base64
import binascii
import os
from dataclasses import dataclass
from typing import Iterable, List, Optional

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

#: Environment variable holding the key list. See `.env.example`.
KEY_ENV = "TUD_FIELD_ENCRYPTION_KEYS"

#: A column name with this suffix holds ciphertext, and no other column does.
ENCRYPTED_SUFFIX = "_encrypted"

_ENVELOPE_VERSION = "v1"
_NONCE_BYTES = 12
_KEY_BYTES = 32

#: Never mentions the token or the plaintext: see the module docstring.
_UNREADABLE = (
    "The stored value could not be decrypted with the configured key. "
    "Check TUD_FIELD_ENCRYPTION_KEYS in the deployment configuration."
)


class EncryptionConfigError(RuntimeError):
    """The deployment's field-encryption key is missing or malformed.

    Raised for a configuration problem, never for a bad value, so a caller can
    answer "the server is misconfigured" instead of "this row is broken".
    """


class DecryptionError(ValueError):
    """A token could not be decrypted with any configured key.

    The message names neither the token nor any plaintext (see the module
    docstring).
    """


@dataclass(frozen=True)
class ProbeResult:
    """Outcome of trying to decrypt a sample, for the admin health check."""

    checked: int
    decrypted: int
    failed: int


def configured_keys() -> List[bytes]:
    """The deployment's keys in configuration order; the first one encrypts.

    Read from the environment on every call rather than cached: deployments
    read it once at startup anyway, and a cache would make a key change (or a
    test that sets one) silently ineffective.

    @returns The keys, possibly empty when the variable is unset.
    @raises EncryptionConfigError When the variable is set but unusable.
    """
    raw = (os.getenv(KEY_ENV) or "").strip()
    if not raw:
        return []

    keys: List[bytes] = []
    for position, item in enumerate((part.strip() for part in raw.split(",")), start=1):
        if not item:
            raise EncryptionConfigError(
                f"{KEY_ENV} contains an empty entry at position {position}."
            )
        keys.append(_decode_key(item, position))
    return keys


def encrypt_text(value: Optional[str]) -> Optional[str]:
    """Seal one value for a ``*_encrypted`` column.

    ``None``, empty and whitespace-only values mean "nothing to store" and
    become ``None``: the column holds either a token or NULL, never an empty
    string, because an empty string would be indistinguishable from a failed
    encryption.

    The text is encrypted as given. Normalizing it (Unicode form, surrounding
    whitespace) is the caller's job and belongs where the rule already lives,
    e.g. ``display_names.validate_display_name``.

    @param value The plaintext.
    @returns The token, or None.
    @raises EncryptionConfigError When no key is configured.
    """
    if value is None:
        return None
    text = str(value)
    if not text.strip():
        return None

    keys = configured_keys()
    if not keys:
        raise EncryptionConfigError(
            f"{KEY_ENV} is not configured, so encrypted values cannot be stored."
        )

    nonce = os.urandom(_NONCE_BYTES)
    sealed = AESGCM(keys[0]).encrypt(nonce, text.encode("utf-8"), None)
    return f"{_ENVELOPE_VERSION}.{_encode_b64(nonce + sealed)}"


def decrypt_text(token: Optional[str]) -> Optional[str]:
    """Open a token that was produced by :func:`encrypt_text`.

    @param token The stored ciphertext.
    @returns The plaintext, or None for a None/empty token.
    @raises DecryptionError When the token is unreadable with any key.
    @raises EncryptionConfigError When no key is configured at all.
    """
    if token is None:
        return None
    text = str(token).strip()
    if not text:
        return None

    keys = configured_keys()
    if not keys:
        raise EncryptionConfigError(
            f"{KEY_ENV} is not configured, so encrypted values cannot be read."
        )
    return _open(keys, text)


def decode_incoming(token: Optional[str]) -> Optional[str]:
    """Decrypt a value that came from outside (a roster cell), not from our table.

    Today the KI's file uses the same envelope as the database, so this is
    exactly :func:`decrypt_text`. It is a separate entry point on purpose: the
    file format is theirs to choose (§7.3 of the plan), and when it differs this
    function gains a branch on the prefix. The importer, the model and the
    guards around them stay as they are.

    @param token The ciphertext from the uploaded file.
    @returns The plaintext, or None for an empty cell.
    @raises DecryptionError When the token is unreadable.
    @raises EncryptionConfigError When no key is configured.
    """
    return decrypt_text(token)


def is_encrypted_field(name: object) -> bool:
    """Whether a column name follows the ``*_encrypted`` rule.

    Case-insensitive and whitespace-tolerant, because it is also applied to
    header names from a file.
    """
    if not isinstance(name, str):
        return False
    lowered = name.strip().lower()
    return lowered.endswith(ENCRYPTED_SUFFIX) and len(lowered) > len(ENCRYPTED_SUFFIX)


def mask(value: object) -> str:
    """A placeholder for a value that must not appear in a message or a log."""
    return "***" if value else ""


def probe(tokens: Iterable[Optional[str]]) -> ProbeResult:
    """Try to decrypt a small sample, for the admin health check (§7.6).

    Counts only: never returns, logs or raises with a token or a plaintext.
    Empty and ``None`` values are not checked, so an empty column reports
    ``checked == 0`` instead of a false alarm.

    @param tokens Ciphertext values, e.g. sampled from one column.
    @returns How many were checked, decrypted and failed.
    @raises EncryptionConfigError When no key is configured; the caller reports
        that as "not configured" rather than as a data problem.
    """
    keys = configured_keys()
    if not keys:
        raise EncryptionConfigError(
            f"{KEY_ENV} is not configured, so no value can be checked."
        )

    checked = 0
    failed = 0
    for token in tokens:
        if token is None or not str(token).strip():
            continue
        checked += 1
        try:
            _open(keys, str(token).strip())
        except DecryptionError:
            failed += 1
    return ProbeResult(checked=checked, decrypted=checked - failed, failed=failed)


def _open(keys: List[bytes], text: str) -> str:
    """Decrypt one non-empty token with the first key that fits."""
    version, separator, payload = text.partition(".")
    if not separator or version != _ENVELOPE_VERSION:
        raise DecryptionError(_UNREADABLE)

    raw = _decode_b64(payload)
    if raw is None or len(raw) <= _NONCE_BYTES:
        raise DecryptionError(_UNREADABLE)

    nonce, sealed = raw[:_NONCE_BYTES], raw[_NONCE_BYTES:]
    for key in keys:
        try:
            plaintext = AESGCM(key).decrypt(nonce, sealed, None)
        except InvalidTag:
            continue
        try:
            return plaintext.decode("utf-8")
        except UnicodeDecodeError as error:
            raise DecryptionError(_UNREADABLE) from error

    raise DecryptionError(_UNREADABLE)


def _decode_key(value: str, position: int) -> bytes:
    key = _try_base64_key(value)
    if key is None:
        key = _try_hex_key(value)
    if key is None:
        raise EncryptionConfigError(
            f"{KEY_ENV} entry {position} is not a {_KEY_BYTES}-byte key "
            "in base64url or hex."
        )
    return key


def _try_base64_key(value: str) -> Optional[bytes]:
    raw = _decode_b64(value)
    return raw if raw is not None and len(raw) == _KEY_BYTES else None


def _try_hex_key(value: str) -> Optional[bytes]:
    if len(value) != 2 * _KEY_BYTES:
        return None
    try:
        return bytes.fromhex(value)
    except ValueError:
        return None


def _encode_b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _decode_b64(text: str) -> Optional[bytes]:
    padded = text + "=" * (-len(text) % 4)
    try:
        return base64.urlsafe_b64decode(padded.encode("ascii"))
    except (binascii.Error, ValueError, UnicodeEncodeError):
        return None
