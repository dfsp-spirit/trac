"""Schema versions of the JSON files TRAC reads and writes.

Three format families are versioned, each with a single integer:

``STUDIES_CONFIG_SCHEMA_VERSION``
    ``studies_config.json`` - the study definition, both as a plain import file
    and as the re-importable part of the runtime-config export.

``ACTIVITIES_SCHEMA_VERSION``
    The activities file (``{"general": ..., "timeline": ...}``).

``EXPORT_SCHEMA_VERSION``
    Everything the admin exports for analysis or archiving: the JSON envelope of
    ``/api/admin/export/...`` and ``/api/admin/{studies,participants,activities}``,
    and the CSV and TSV variants of those (as a response header, never in-band).

Versions are integers, not semantic versions: what matters is whether a reader
can parse the file, and a format has no meaningful "patch" level. A format that
only gains optional fields does not need a bump, because the key/value reading
policy below already allows additions; the version changes when a reader of the
old version would misinterpret the file.

Reading policy - identical for every format:

* the key is absent      -> treated as version 1 (no file written before the key
                            existed is rejected)
* equal to supported     -> parsed
* lower than supported   -> parsed only if a reader for the old shape exists
* higher than supported  -> rejected, with a message naming both versions

Silently accepting a newer file is never allowed: the activities parser ignores
unknown fields, so accepting one would drop data without a trace.

Writing policy: always emit the key, even at version 1, so a consumer can tell a
versioned file from a pre-versioning one.
"""

from __future__ import annotations

from typing import Any, Mapping, Optional

STUDIES_CONFIG_SCHEMA_VERSION = 1
ACTIVITIES_SCHEMA_VERSION = 1
EXPORT_SCHEMA_VERSION = 1

# Response header that carries the export schema version for delimited-text
# downloads, which cannot hold it in-band without breaking naive readers.
EXPORT_SCHEMA_VERSION_HEADER = "X-Export-Schema-Version"

FORMAT_LABELS = {
    "studies_config": "studies_config",
    "activities": "activities file",
    "export": "data export",
}


class UnsupportedSchemaVersionError(ValueError):
    """A file declares a schema version this server cannot read."""

    def __init__(self, format_key: str, declared: int, supported: int) -> None:
        self.format_key = format_key
        self.declared = declared
        self.supported = supported
        label = FORMAT_LABELS.get(format_key, format_key)
        if declared > supported:
            message = (
                f"This {label} was written by a newer TRAC "
                f"(schema version {declared}; this server supports {supported}). "
                "Upgrade the server, or export the file again from a TRAC whose "
                f"schema version is {supported} or lower."
            )
        else:
            message = (
                f"This {label} uses schema version {declared}, which this server "
                f"no longer supports (oldest readable: {supported}). Re-create the "
                "file with a current TRAC."
            )
        super().__init__(message)


def coerce_schema_version(value: Any) -> int:
    """Validate a raw ``schema_version`` value and return it as an int.

    Written for use in a pydantic ``mode="before"`` validator: pydantic coerces
    ``True`` to ``1`` in lax mode, which would let a boolean pass as a schema
    version, so the raw value is checked here first.

    @param value Raw JSON value of a ``schema_version`` key.
    @returns The version as a positive int.
    @raises ValueError When the value is not a positive integer.
    """
    # bool is an int subclass, but `true` is not a schema version.
    if isinstance(value, bool):
        raise ValueError("schema_version must be a positive integer, got a boolean.")
    if isinstance(value, str) and value.strip().isdigit():
        value = int(value.strip())
    if not isinstance(value, int) or value < 1:
        raise ValueError(f"schema_version must be a positive integer, got {value!r}.")
    return value


def read_schema_version(
    payload: Mapping[str, Any], format_key: str, *, default: int = 1
) -> int:
    """Return the ``schema_version`` declared in ``payload``, or ``default``.

    @param payload Parsed JSON object that may carry ``schema_version``.
    @param format_key One of the keys of ``FORMAT_LABELS``.
    @param default Version assumed when the key is absent.
    @returns The declared schema version as an int.
    @raises ValueError When the value is not a positive integer.
    """
    if not isinstance(payload, Mapping):
        return default

    declared = payload.get("schema_version")
    if declared is None:
        return default

    return coerce_schema_version(declared)


def ensure_supported_schema_version(
    payload: Mapping[str, Any],
    format_key: str,
    supported: int,
    *,
    oldest_readable: Optional[int] = None,
) -> int:
    """Validate the declared version of ``payload`` against what this server reads.

    @param payload Parsed JSON object that may carry ``schema_version``.
    @param format_key One of the keys of ``FORMAT_LABELS``.
    @param supported The version this server writes.
    @param oldest_readable Oldest version a reader migration still accepts;
        defaults to ``supported`` (only the current shape is understood).
    @returns The declared version, after validation.
    @raises UnsupportedSchemaVersionError When the version is outside the range.
    """
    oldest = oldest_readable if oldest_readable is not None else supported
    declared = read_schema_version(payload, format_key)
    if declared < oldest or declared > supported:
        raise UnsupportedSchemaVersionError(format_key, declared, supported)
    return declared
