"""Delimiter detection and structure checks for admin file uploads."""

import pytest

from o_timeusediary_backend.tabular_files import (
    DelimitedUploadError,
    find_header,
    parse_delimited_upload,
)


def test_parses_comma_separated_with_ignored_columns():
    parsed = parse_delimited_upload(b"pid,name\ninvite_a,Alice\ninvite_b,Bob\n")

    assert parsed.headers == ["pid", "name"]
    assert parsed.format == "csv"
    assert parsed.rows == [
        (2, {"pid": "invite_a", "name": "Alice"}),
        (3, {"pid": "invite_b", "name": "Bob"}),
    ]


def test_parses_tab_separated():
    parsed = parse_delimited_upload(b"pid\tname\ninvite_a\tAlice\n")

    assert parsed.format == "tsv"
    assert parsed.rows == [(2, {"pid": "invite_a", "name": "Alice"})]


def test_parses_semicolon_separated_excel_export():
    parsed = parse_delimited_upload("pid;note\ninvite_a;2,5\n".encode())

    assert parsed.format == "csv"
    assert parsed.headers == ["pid", "note"]
    assert parsed.rows == [(2, {"pid": "invite_a", "note": "2,5"})]


def test_tab_wins_over_a_comma_inside_the_header():
    parsed = parse_delimited_upload(b"pid\tgroup,name\ninvite_a\tx,y\n")

    assert parsed.format == "tsv"
    assert parsed.headers == ["pid", "group,name"]


def test_tolerates_utf8_bom_and_crlf():
    parsed = parse_delimited_upload("\ufeffpid\r\ninvite_a\r\n".encode("utf-8"))

    assert parsed.headers == ["pid"]
    assert parsed.rows == [(2, {"pid": "invite_a"})]


def test_handles_a_single_column_file():
    parsed = parse_delimited_upload(b"pid\ninvite_a\ninvite_b\n")

    assert parsed.headers == ["pid"]
    assert [row["pid"] for _, row in parsed.rows] == ["invite_a", "invite_b"]


def test_quoted_values_keep_the_delimiter():
    parsed = parse_delimited_upload(b'pid,note\ninvite_a,"a, b"\n')

    assert parsed.rows == [(2, {"pid": "invite_a", "note": "a, b"})]


def test_skips_blank_lines():
    parsed = parse_delimited_upload(b"pid\n\ninvite_a\n\n")

    assert parsed.rows == [(3, {"pid": "invite_a"})]


@pytest.mark.parametrize(
    "raw,message",
    [
        (b"", "empty"),
        (b"\n \n", "empty"),
        (b"\xff\xfe\x00", "UTF-8"),
        (b"pid,pid\ninvite_a,invite_b\n", "more than once"),
        (b"pid,\ninvite_a,x\n", "empty column name"),
        (b"pid,name\ninvite_a\n", "columns"),
    ],
)
def test_rejects_unusable_files(raw, message):
    with pytest.raises(DelimitedUploadError) as excinfo:
        parse_delimited_upload(raw)

    assert message.lower() in str(excinfo.value).lower()


def test_missing_pid_column_is_reported_with_the_found_columns():
    parsed = parse_delimited_upload(b"name\nAlice\n")

    with pytest.raises(DelimitedUploadError) as excinfo:
        find_header(parsed.headers, "pid")

    assert "no 'pid' column" in str(excinfo.value)
    assert "name" in str(excinfo.value)


def test_file_with_only_a_header_line_parses_to_zero_rows():
    parsed = parse_delimited_upload(b"pid,group\n")

    assert parsed.headers == ["pid", "group"]
    assert parsed.rows == []


def test_find_header_is_case_insensitive_and_strips():
    assert find_header([" PID ", "name"], "pid") == "PID"

    with pytest.raises(DelimitedUploadError) as excinfo:
        find_header(["name"], "pid")
    assert "name" in str(excinfo.value)
