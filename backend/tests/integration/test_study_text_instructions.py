"""Integration tests for study_text_instructions in study-config."""

import os

import httpx
import pytest

from o_timeusediary_backend.settings import settings


BASE_SCHEME = os.getenv("TUD_BASE_SCHEME", "http://localhost:3000")
BASE_URL = f"{BASE_SCHEME}/" + settings.rootpath.strip("/")


@pytest.mark.asyncio
async def test_study_config_returns_custom_instructions_for_15yearolds():
    """The 15yearolds study has custom study_text_instructions — verify they are returned."""
    study_name_short = "15yearolds"

    async with httpx.AsyncClient(timeout=30.0) as client:
        url = f"{BASE_URL}/api/studies/{study_name_short}/study-config?lang=en"
        response = await client.get(url)

    assert (
        response.status_code == 200
    ), f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    assert (
        "study_text_instructions" in data
    ), f"study-config response missing 'study_text_instructions' key. Keys: {list(data.keys())}"

    instructions = data["study_text_instructions"]
    assert isinstance(
        instructions, str
    ), f"study_text_instructions should be a string, got {type(instructions)}: {instructions!r}"
    assert (
        "CUSTOM 15-YEAR-OLD" in instructions
    ), f"Expected custom instructions marker, got: {instructions!r}"
    assert "How to fill out your diary" in instructions


@pytest.mark.asyncio
async def test_study_config_returns_null_instructions_for_default_study():
    """The 'default' study has no study_text_instructions — verify null is returned."""
    study_name_short = "default"

    async with httpx.AsyncClient(timeout=30.0) as client:
        url = f"{BASE_URL}/api/studies/{study_name_short}/study-config?lang=en"
        response = await client.get(url)

    assert (
        response.status_code == 200
    ), f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    assert (
        "study_text_instructions" in data
    ), f"study-config response missing 'study_text_instructions' key. Keys: {list(data.keys())}"

    instructions = data["study_text_instructions"]
    assert (
        instructions is None
    ), f"Expected null study_text_instructions for default study, got: {instructions!r}"
