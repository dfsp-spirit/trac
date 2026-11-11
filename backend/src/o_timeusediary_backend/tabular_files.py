"""Parsing of delimited-text uploads from the admin area.

The admin uploads CSV and TSV files that people produce in Excel, Numbers or a
text editor, so the parser has to be forgiving about encoding and line endings
and strict about structure: a wrong delimiter silently produces one garbage
column, which is worse than an error message.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from io import StringIO
from typing import Dict, List, Tuple

# Ordered by preference when a header line contains the same number of
# occurrences: tabs are never ambiguous, semicolons are what German Excel writes
# for CSV, and plain commas are the last resort.
CANDIDATE_DELIMITERS: Tuple[str, ...] = ("\t", ";", ",")

# Delimiter -> format name reported to the admin.
FORMAT_BY_DELIMITER = {"\t": "tsv", ";": "csv", ",": "csv"}


class DelimitedUploadError(ValueError):
    """The uploaded file cannot be read as a delimited table."""


@dataclass
class ParsedDelimitedFile:
    """A parsed upload: its columns, its data rows and how they were read.

    ``rows`` holds ``(line_number, {column: value})`` pairs, keyed by the stripped
    header names, so an error can point at the line the admin sees in an editor.
    """

    headers: List[str]
    rows: List[Tuple[int, Dict[str, str]]]
    delimiter: str

    @property
    def format(self) -> str:
        return FORMAT_BY_DELIMITER[self.delimiter]


def parse_delimited_upload(raw: bytes) -> ParsedDelimitedFile:
    """Parse an uploaded CSV/TSV file.

    @param raw Uploaded bytes, expected to be UTF-8 (a BOM is tolerated).
    @returns The parsed table.
    @raises DelimitedUploadError When the file is not UTF-8 text, is empty, has
        no header line, repeats or omits a column name, or has a row whose
        column count differs from the header.
    """
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise DelimitedUploadError(
            "The file is not valid UTF-8 text. Save it as CSV UTF-8 or TSV and try again."
        ) from error

    if not text.strip():
        raise DelimitedUploadError("The file is empty.")

    delimiter = _detect_delimiter(text)
    reader = csv.reader(StringIO(text, newline=""), delimiter=delimiter)

    headers: List[str] = []
    rows: List[Tuple[int, Dict[str, str]]] = []

    for cells in reader:
        line_number = reader.line_num
        if not headers:
            if not _has_content(cells):
                continue
            headers = [cell.strip() for cell in cells]
            _validate_headers(headers, line_number)
            continue
        if not _has_content(cells):
            continue
        if len(cells) != len(headers):
            raise DelimitedUploadError(
                f"Line {line_number} has {len(cells)} columns, "
                f"but the header has {len(headers)}."
            )
        rows.append((line_number, dict(zip(headers, cells))))

    return ParsedDelimitedFile(headers=headers, rows=rows, delimiter=delimiter)


def find_header(headers: List[str], name: str) -> str:
    """Return the actual header spelling for ``name``, or raise.

    Column names are matched case-insensitively and ignoring surrounding
    whitespace, because that is how a spreadsheet user types them.
    """
    wanted = name.strip().lower()
    for header in headers:
        if header.strip().lower() == wanted:
            return header.strip()
    raise DelimitedUploadError(
        f"The file has no '{name}' column. Found columns: {', '.join(headers)}."
    )


def _has_content(cells: List[str]) -> bool:
    return any((cell or "").strip() for cell in cells)


def _validate_headers(headers: List[str], line_number: int) -> None:
    seen: set[str] = set()
    for header in headers:
        if not header:
            raise DelimitedUploadError(
                f"Line {line_number} has an empty column name; every column needs a header."
            )
        key = header.lower()
        if key in seen:
            raise DelimitedUploadError(
                f"The header contains the column '{header}' more than once."
            )
        seen.add(key)


def _detect_delimiter(text: str) -> str:
    """Pick the delimiter from the header line only.

    The header defines the columns, and unlike the data rows it never contains
    free text with commas in it.
    """
    header_line = _first_content_line(text)
    counts = {
        delimiter: header_line.count(delimiter) for delimiter in CANDIDATE_DELIMITERS
    }
    best = max(CANDIDATE_DELIMITERS, key=lambda delimiter: counts[delimiter])
    # A single-column file contains no delimiter at all; comma keeps it readable.
    return best if counts[best] > 0 else ","


def _first_content_line(text: str) -> str:
    for line in text.splitlines():
        if line.strip():
            return line
    return ""
