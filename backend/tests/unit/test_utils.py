
import pytest
from datetime import time
from o_timeusediary_backend.utils import get_time_for_minutes_from_midnight


class TestGetTimeForMinutesFromMidnight:
    """Test suite for get_time_for_minutes_from_midnight function."""

    def test_basic_minutes_conversion(self):
        """Test converting basic minutes values to time objects."""
        # Test midnight (0 minutes)
        result = get_time_for_minutes_from_midnight(0)
        assert result == time(0, 0)

        # Test 1 hour (60 minutes)
        result = get_time_for_minutes_from_midnight(60)
        assert result == time(1, 0)

        # Test 1 hour 30 minutes (90 minutes)
        result = get_time_for_minutes_from_midnight(90)
        assert result == time(1, 30)

        # Test noon (720 minutes)
        result = get_time_for_minutes_from_midnight(720)
        assert result == time(12, 0)

        # Test 1 minute before midnight (1439 minutes)
        result = get_time_for_minutes_from_midnight(1439)
        assert result == time(23, 59)

    def test_wrap_around_24_hours(self):
        """Test that minutes exceeding 24 hours wrap around correctly."""
        # 24 hours exactly (1440 minutes) should wrap to midnight
        result = get_time_for_minutes_from_midnight(1440)
        assert result == time(0, 0)

        # 25 hours (1500 minutes) should wrap to 1:00 AM (60 minutes)
        result = get_time_for_minutes_from_midnight(1500)
        assert result == time(1, 0)

        # 48 hours (2880 minutes) should wrap to midnight
        result = get_time_for_minutes_from_midnight(2880)
        assert result == time(0, 0)

        # 49 hours 30 minutes (2970 minutes) should wrap to 1:30 AM
        result = get_time_for_minutes_from_midnight(2970)
        assert result == time(1, 30)

    def test_large_minutes_values(self):
        """Test with very large minutes values."""
        # 1000 hours (60000 minutes) should wrap correctly
        result = get_time_for_minutes_from_midnight(60000)
        # 60000 % 1440 = 960 minutes = 16:00
        assert result == time(16, 0)

        # 1 million minutes
        result = get_time_for_minutes_from_midnight(1000000)
        # 1000000 % 1440 = 640 minutes = 10:40
        assert result == time(10, 40)

    def test_boundary_values(self):
        """Test boundary conditions."""
        # Minimum value
        result = get_time_for_minutes_from_midnight(0)
        assert result == time(0, 0)

        # Last minute of the day
        result = get_time_for_minutes_from_midnight(1439)
        assert result == time(23, 59)

        # First minute of next day (should wrap to midnight)
        result = get_time_for_minutes_from_midnight(1440)
        assert result == time(0, 0)

    def test_negative_minutes(self):
        """Test with negative minutes values."""
        # -60 minutes (should be 23:00)
        result = get_time_for_minutes_from_midnight(-60)
        assert result == time(23, 0)

        # -1 minute (should be 23:59)
        result = get_time_for_minutes_from_midnight(-1)
        assert result == time(23, 59)

        # -1440 minutes (should be midnight)
        result = get_time_for_minutes_from_midnight(-1440)
        assert result == time(0, 0)

        # -1500 minutes (should be 22:00)
        result = get_time_for_minutes_from_midnight(-1500)
        # -1500 % 1440 = 1380 minutes = 23:00
        assert result == time(23, 0)

    def test_quarter_hour_increments(self):
        """Test various quarter-hour increments."""
        test_cases = [
            (15, time(0, 15)),   # 15 minutes
            (30, time(0, 30)),   # 30 minutes
            (45, time(0, 45)),   # 45 minutes
        ]

        for minutes, expected in test_cases:
            result = get_time_for_minutes_from_midnight(minutes)
            assert result == expected, f"Failed for {minutes} minutes"

