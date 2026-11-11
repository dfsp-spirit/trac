"""Dialect behaviour of the shared admin download helper.

`tabular_export` is the single place that decides delimiter, media type and
filename extension for a delimited-text download, so it is tested directly
instead of once per route.
"""

import csv
import io

import pytest
from fastapi import HTTPException

from o_timeusediary_backend.api import EXPORT_DIALECTS, export_csv, tabular_export
from o_timeusediary_backend.formats import (
    EXPORT_SCHEMA_VERSION,
    EXPORT_SCHEMA_VERSION_HEADER,
)


def _rows(response):
    delimiter = "\t" if response.media_type == "text/tab-separated-values" else ","
    return list(csv.reader(io.StringIO(response.body.decode()), delimiter=delimiter))


@pytest.mark.parametrize(
    "format,delimiter,media_type,extension",
    [
        ("csv", ",", "text/csv", "csv"),
        ("tsv", "\t", "text/tab-separated-values", "tsv"),
    ],
)
def test_tabular_export_uses_the_dialect_of_the_requested_format(
    format, delimiter, media_type, extension
):
    response = tabular_export(
        ["pid", "invitation_link"],
        [["invite_a", "https://example.test/index.html?pid=invite_a"]],
        filename_base="study_invitation_links",
        format=format,
    )

    assert EXPORT_DIALECTS[format] == (delimiter, media_type, extension)
    assert response.media_type == media_type
    assert response.headers["content-type"] == f"{media_type}; charset=utf-8"
    assert (
        response.headers["content-disposition"]
        == f'attachment; filename="study_invitation_links.{extension}"'
    )
    assert response.headers[EXPORT_SCHEMA_VERSION_HEADER] == str(EXPORT_SCHEMA_VERSION)
    assert "cache-control" not in response.headers
    assert _rows(response) == [
        ["pid", "invitation_link"],
        ["invite_a", "https://example.test/index.html?pid=invite_a"],
    ]


def test_tabular_export_quotes_a_value_containing_the_delimiter():
    response = tabular_export(
        ["pid", "note"],
        [["invite_a", "a\tb"]],
        filename_base="study",
        format="tsv",
    )

    assert _rows(response)[1] == ["invite_a", "a\tb"]


def test_tabular_export_can_mark_a_response_non_cacheable():
    response = tabular_export(
        ["pid"], [["invite_a"]], filename_base="study", no_store=True
    )

    assert response.headers["cache-control"] == "no-store"


def test_tabular_export_can_omit_the_header_row():
    response = tabular_export(["pid"], [], filename_base="study", write_header=False)

    assert response.body == b""


def test_export_csv_still_sorts_columns_alphabetically():
    response = export_csv(
        [{"pid": "invite_a", "assigned_token": "tok"}], "study_participants_tokens"
    )

    assert _rows(response) == [
        ["assigned_token", "pid"],
        ["tok", "invite_a"],
    ]
    assert response.headers["content-disposition"].endswith(
        'filename="study_participants_tokens.csv"'
    )


def test_export_csv_writes_an_empty_file_when_allowed():
    response = export_csv([], "extract", allow_empty=True)

    assert response.body == b""


def test_export_csv_refuses_an_empty_result_by_default():
    with pytest.raises(HTTPException) as excinfo:
        export_csv([], "extract")

    assert excinfo.value.status_code == 404
