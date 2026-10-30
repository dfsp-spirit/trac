"""Integration tests run against a disposable database, not the development one.

The tests create studies, participants and activities through the real API. The
suite is prepared by ``./test_backend_integration.sh`` (which starts a backend
against a throwaway database), or by hand: ``tests/support/database_tools.py
reset`` plus a backend that points at that database.

There is deliberately no per-test cleanup here. The seeded fixture studies
("default", "adult_pilot_de*", ...) have to survive the whole run, so deleting
all rows between tests would break the suite rather than isolate it.

A previous ``setup_db`` fixture looked like it cleaned up, but it iterated over
an empty ``SQLModel.metadata`` (``models.py`` was never imported) and silently did
nothing. Do not reintroduce a blanket delete: isolating the database is the
script's job.
"""
