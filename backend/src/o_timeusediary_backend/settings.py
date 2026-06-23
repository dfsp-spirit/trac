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
