"""Source guards for SQL that only works on PostgreSQL.

The manual DBMS matrix workflow runs the integration suite against SQL Server and
MariaDB too, but it is triggered by hand, so a PostgreSQL-only predicate can ship
unnoticed. These guards make the class of mistake fail in the regular unit suite:

* ``column.is_(True)`` / ``column.is_(False)`` render ``IS 1`` / ``IS 0`` on a
  backend without a native boolean type, which SQL Server rejects as a syntax
  error ("Incorrect syntax near '0'"). ``== true()`` / ``== false()`` stay
  portable and keep the same NULL semantics.

``.is_(None)`` is fine and deliberately not flagged.
"""

import re
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[2]
SRC = BACKEND_ROOT / "src" / "o_timeusediary_backend"

BOOLEAN_IS = re.compile(r"\.is_\(\s*(?:True|False)\s*\)")


def _python_sources() -> list[Path]:
    return sorted(p for p in SRC.rglob("*.py") if "__pycache__" not in p.parts)


def test_no_boolean_is_predicates():
    offenders = []
    for path in _python_sources():
        source = path.read_text(encoding="utf-8")
        lines = source.splitlines()
        for match in BOOLEAN_IS.finditer(source):
            line_number = source[: match.start()].count("\n") + 1
            line = lines[line_number - 1]
            column = match.start() - (source.rfind("\n", 0, match.start()) + 1)
            # A comment may name the construct it warns about.
            if "#" in line[:column]:
                continue
            offenders.append(f"{path.name}:{line_number}")

    assert offenders == [], (
        "`.is_(True)`/`.is_(False)` breaks on backends without a boolean type "
        "(SQL Server renders `IS 0`); use `== true()` / `== false()` instead: "
        + ", ".join(offenders)
    )
