import os
from dotenv import load_dotenv
import json

load_dotenv()  # load .env file in working directory if it exists


class TUDBackendSettings:
    def __init__(self):
        # Backend-specific settings
        self.debug = (
            True if os.getenv("TUD_DEBUG", "false").lower() == "true" else False
        )
        self.studies_config_path: str = os.getenv(
            "TUD_STUDIES_CONFIG_PATH", "studies_config.json"
        )  # Backend file with studies configuration
        self.print_db_contents_on_startup = (
            True
            if os.getenv("TUD_REPORT_DB_CONTENTS_ON_STARTUP", "false").lower() == "true"
            else False
        )

    # Environment-dependent settings as properties
    @property
    def database_url(self):
        """Get the database URL for the application, something like 'postgresql://user:password@localhost/dbname'."""
        db_url = os.getenv("TUD_DATABASE_URL")
        if not db_url:
            raise ValueError(
                "TUD_DATABASE_URL environment variable is not set. Please set it when starting the application or use an .env file in the startup directory."
            )
        return db_url

    @property
    def allowed_origins(self):
        """Get the list of allowed origins for CORS. Should be set to a JSON array like '["http://localhost:3000", "https://example.com"]'.

        Raises:
            ValueError: If the TUD_ALLOWED_ORIGINS environment variable is not set or is empty.

        Returns:
            list: A list of allowed origins.
        """
        origins = json.loads(os.getenv("TUD_ALLOWED_ORIGINS", "[]"))
        if not origins:
            raise ValueError(
                "TUD_ALLOWED_ORIGINS environment variable is not set. Please set a JSON array of allowed origins."
            )
        return origins

    @property
    def rootpath(self):
        """Get the root path for the application, i.e., the path part of the URL where the application is hosted.
           Defaults to '/' if not set. If you have configured your webserver to server the backend
           at http://yourdomain.com/tud_backend, you would set this to '/tud_backend'.

        Returns:
            str: The root path of the application.
        """
        return os.getenv("TUD_ROOTPATH", "/")

    @property
    def frontend_url(self) -> str:
        """Get the frontend base URL used for participant-facing links.

        Prefers `TUD_FRONTEND_URL` and falls back to the first configured CORS origin.
        The returned URL has no trailing slash.
        """
        frontend_url = (os.getenv("TUD_FRONTEND_URL") or "").strip()
        if frontend_url:
            return frontend_url.rstrip("/")

        first_allowed_origin = self.allowed_origins[0]
        return str(first_allowed_origin).rstrip("/")

    @property
    def admin_username(self):
        """Get the first configured admin username (backward-compatible single-admin accessor)."""
        return self.admin_usernames[0]

    @property
    def admin_password(self):
        """Get the first configured admin password (backward-compatible single-admin accessor)."""
        return self.admin_passwords[0]

    def _parse_admin_env_var(self, env_name: str) -> list[str]:
        """Parse an admin credential env var as either a single string or a JSON list of strings."""
        raw_value = os.getenv(env_name)
        if not raw_value:
            raise ValueError(f"{env_name} environment variable is not set.")

        value = raw_value.strip()
        if not value:
            raise ValueError(f"{env_name} environment variable is empty.")

        if value.startswith("["):
            try:
                parsed_value = json.loads(value)
            except json.JSONDecodeError as exc:
                raise ValueError(
                    f"{env_name} must be a valid JSON list of non-empty strings."
                ) from exc

            if not isinstance(parsed_value, list) or not parsed_value:
                raise ValueError(
                    f"{env_name} must be a non-empty JSON list of strings."
                )

            if not all(isinstance(item, str) and item.strip() for item in parsed_value):
                raise ValueError(
                    f"{env_name} JSON list must contain only non-empty strings."
                )

            return parsed_value

        return [value]

    @property
    def admin_usernames(self) -> list[str]:
        """Get admin usernames as a list parsed from `TUD_API_ADMIN_USERNAME`."""
        return self._parse_admin_env_var("TUD_API_ADMIN_USERNAME")

    @property
    def admin_passwords(self) -> list[str]:
        """Get admin passwords as a list parsed from `TUD_API_ADMIN_PASSWORD`."""
        return self._parse_admin_env_var("TUD_API_ADMIN_PASSWORD")

    @property
    def admin_credentials(self) -> list[tuple[str, str]]:
        """Get admin credentials as `(username, password)` pairs.

        Raises:
            ValueError: If the number of usernames and passwords does not match.
        """
        usernames = self.admin_usernames
        passwords = self.admin_passwords
        if len(usernames) != len(passwords):
            raise ValueError(
                "TUD_API_ADMIN_USERNAME and TUD_API_ADMIN_PASSWORD must contain the same number of entries."
            )
        return list(zip(usernames, passwords))

    def _parse_scientists_env_var(self) -> list[dict]:
        """Parse the optional ``TUD_API_SCIENTISTS`` variable into scientist definitions.

        The variable holds a JSON list of objects, each providing a ``name``, a
        ``password`` and an optional list of additionally granted study short
        names::

            [{"name": "alice", "password": "...", "studies": ["study_a"]}]

        Scientists may manage the studies they own (see ``Study.owner_usernames``)
        plus the studies granted here. Returns an empty list when the variable is
        unset or empty, so deployments without scientists keep working unchanged.
        """
        raw_value = os.getenv("TUD_API_SCIENTISTS")
        if not raw_value or not raw_value.strip():
            return []

        try:
            parsed_value = json.loads(raw_value)
        except json.JSONDecodeError as exc:
            raise ValueError(
                "TUD_API_SCIENTISTS must be a valid JSON list of scientist objects."
            ) from exc

        if not isinstance(parsed_value, list):
            raise ValueError(
                "TUD_API_SCIENTISTS must be a JSON list of scientist objects."
            )

        scientists: list[dict] = []
        for index, entry in enumerate(parsed_value):
            if not isinstance(entry, dict):
                raise ValueError(
                    f"TUD_API_SCIENTISTS entry #{index} must be an object with 'name', "
                    "'password' and an optional 'studies' list."
                )

            name = entry.get("name")
            if not isinstance(name, str) or not name.strip():
                raise ValueError(
                    f"TUD_API_SCIENTISTS entry #{index} must define a non-empty string 'name'."
                )
            name = name.strip()

            password = entry.get("password")
            if not isinstance(password, str) or not password.strip():
                raise ValueError(
                    f"TUD_API_SCIENTISTS scientist '{name}' must define a non-empty string 'password'."
                )

            studies_value = entry.get("studies")
            if studies_value is None:
                studies_value = []
            if not isinstance(studies_value, list) or not all(
                isinstance(item, str) and item.strip() for item in studies_value
            ):
                raise ValueError(
                    f"TUD_API_SCIENTISTS scientist '{name}' field 'studies' must be a "
                    "JSON list of non-empty study name_short strings."
                )

            scientists.append(
                {
                    "name": name,
                    "password": password,
                    "studies": [item.strip() for item in studies_value],
                }
            )

        names = [scientist["name"] for scientist in scientists]
        duplicate_names = sorted({name for name in names if names.count(name) > 1})
        if duplicate_names:
            raise ValueError(
                f"TUD_API_SCIENTISTS contains duplicate scientist names: {duplicate_names}"
            )

        return scientists

    @property
    def scientists(self) -> list[dict]:
        """Get the configured scientists from ``TUD_API_SCIENTISTS`` (empty when unset)."""
        return self._parse_scientists_env_var()

    @property
    def scientist_names(self) -> list[str]:
        """Get the usernames of all configured scientists."""
        return [scientist["name"] for scientist in self.scientists]

    @property
    def scientist_credentials(self) -> list[tuple[str, str]]:
        """Get scientist credentials as ``(username, password)`` pairs."""
        return [
            (scientist["name"], scientist["password"]) for scientist in self.scientists
        ]

    @property
    def scientist_study_grants(self) -> dict[str, list[str]]:
        """Get scientist username -> additionally granted study name_short list."""
        return {
            scientist["name"]: list(scientist["studies"])
            for scientist in self.scientists
        }

    def validate_auth_configuration(self) -> None:
        """Fail fast on inconsistent admin/scientist configuration.

        Called during application startup so that a broken configuration shows
        up as a clear error instead of surprising authentication failures at
        request time.

        Raises:
            ValueError: If admin credentials are inconsistent or if a username is
                configured both as super admin and as scientist.
        """
        admin_credentials = self.admin_credentials
        scientist_credentials = self.scientist_credentials

        overlapping_names = sorted(
            {username for username, _ in admin_credentials}
            & {username for username, _ in scientist_credentials}
        )
        if overlapping_names:
            raise ValueError(
                "Usernames must not be configured both as super admin "
                "(TUD_API_ADMIN_USERNAME) and as scientist (TUD_API_SCIENTISTS): "
                f"{overlapping_names}"
            )

    @property
    def admin_audit_log_file(self) -> str:
        """Path to persistent admin action audit log file."""
        return os.getenv("TUD_ADMIN_AUDIT_LOG_FILE", "admin_actions.log")

    @property
    def admin_audit_log_max_bytes(self) -> int:
        """Maximum size (bytes) before rotating audit log file."""
        value = os.getenv("TUD_ADMIN_AUDIT_LOG_MAX_BYTES", str(5 * 1024 * 1024))
        return int(value)

    @property
    def admin_audit_log_backup_count(self) -> int:
        """Number of rotated audit log backups to keep."""
        value = os.getenv("TUD_ADMIN_AUDIT_LOG_BACKUP_COUNT", "10")
        return int(value)

    @property
    def external_task_hmac_secrets(self) -> dict[str, str]:
        """HMAC shared secrets for external task callback signing, keyed by reference name.

        Reads `TUD_EXTERNAL_TASK_HMAC_SECRETS` as a JSON object mapping
        reference names to hex-encoded secret strings.  Returns an empty
        dict when the variable is unset so that callers can simply check
        membership.
        """
        raw = (os.getenv("TUD_EXTERNAL_TASK_HMAC_SECRETS") or "").strip()
        if not raw:
            return {}
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(
                "TUD_EXTERNAL_TASK_HMAC_SECRETS must be a valid JSON object."
            ) from exc
        if not isinstance(parsed, dict):
            raise ValueError(
                "TUD_EXTERNAL_TASK_HMAC_SECRETS must be a JSON object (key → secret)."
            )
        for key, value in parsed.items():
            if not isinstance(key, str) or not key.strip():
                raise ValueError(
                    "TUD_EXTERNAL_TASK_HMAC_SECRETS keys must be non-empty strings."
                )
            if not isinstance(value, str) or not value.strip():
                raise ValueError(
                    f"TUD_EXTERNAL_TASK_HMAC_SECRETS value for '{key}' must be a non-empty string."
                )
        return dict(parsed)


settings = TUDBackendSettings()
