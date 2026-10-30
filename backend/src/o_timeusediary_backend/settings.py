import os
from dotenv import load_dotenv
import json
from typing import Optional
from urllib.parse import urlparse, urlunparse

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
    def imprint_url(self) -> Optional[str]:
        """Server-wide imprint ("Impressum") link shown to participants.

        These two are deployment facts, not study configuration: every study on
        this server points at the same institution pages. The client renders them
        in the footer (desktop) and the menu, unless the study sets
        `hide_server_wide_links`. Empty means "not configured" and nothing is
        rendered, rather than a dead link.
        """
        return (os.getenv("TUD_IMPRINT_URL") or "").strip() or None

    @property
    def privacy_url(self) -> Optional[str]:
        """Server-wide data-protection link. See `imprint_url`."""
        return (os.getenv("TUD_PRIVACY_URL") or "").strip() or None

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
    def frontend_new_url(self) -> str:
        """Get the base URL of the rewritten frontend (`frontend_new/`).

        Prefers `TUD_FRONTEND_NEW_URL`. Without it, the URL is derived from
        `frontend_url` by swapping its final path segment `report` for
        `report-new`, which is where the rewrite is served next to the old app.
        The returned URL has no trailing slash.
        """
        explicit_url = (os.getenv("TUD_FRONTEND_NEW_URL") or "").strip()
        if explicit_url:
            return explicit_url.rstrip("/")

        parsed = urlparse(self.frontend_url)
        path = parsed.path.rstrip("/")
        if path.rsplit("/", 1)[-1] == "report":
            path = f"{path[: -len('report')]}report-new"
        else:
            path = f"{path}/report-new"
        return urlunparse(parsed._replace(path=path))

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

    def _parse_named_accounts_env_var(
        self,
        env_name: str,
        account_label: str,
        *,
        allow_studies: bool,
    ) -> list[dict]:
        """Parse a JSON-list credential variable into account definitions.

        Every entry is an object with a non-empty ``name`` and ``password``.
        With ``allow_studies`` an optional ``studies`` list of study
        ``name_short`` values is part of the schema as well.

        Returns an empty list when the variable is unset or empty, so
        deployments that do not use these accounts keep working unchanged.

        @param env_name Name of the environment variable to read.
        @param account_label Singular label used in the error messages.
        @param allow_studies Whether entries may carry a "studies" list.
        @returns The parsed account dictionaries in configuration order.
        """
        raw_value = os.getenv(env_name)
        if not raw_value or not raw_value.strip():
            return []

        try:
            parsed_value = json.loads(raw_value)
        except json.JSONDecodeError as exc:
            raise ValueError(
                f"{env_name} must be a valid JSON list of {account_label} objects."
            ) from exc

        if not isinstance(parsed_value, list):
            raise ValueError(
                f"{env_name} must be a JSON list of {account_label} objects."
            )

        fields_hint = (
            "'name', 'password' and an optional 'studies' list"
            if allow_studies
            else "'name' and 'password'"
        )
        allowed_keys = (
            {"name", "password", "studies"} if allow_studies else {"name", "password"}
        )

        accounts: list[dict] = []
        for index, entry in enumerate(parsed_value):
            if not isinstance(entry, dict):
                raise ValueError(
                    f"{env_name} entry #{index} must be an object with {fields_hint}."
                )

            # Reject unknown keys instead of ignoring them: a mistaken field
            # (e.g. a 'studies' list on an account type that has no study scope)
            # would otherwise silently leave the account with more access than
            # the operator intended.
            unknown_keys = sorted(set(entry) - allowed_keys)
            if unknown_keys:
                raise ValueError(
                    f"{env_name} entry #{index} has unsupported field(s): "
                    f"{', '.join(unknown_keys)}. Allowed: "
                    f"{', '.join(sorted(allowed_keys))}."
                )

            name = entry.get("name")
            if not isinstance(name, str) or not name.strip():
                raise ValueError(
                    f"{env_name} entry #{index} must define a non-empty string 'name'."
                )
            name = name.strip()

            password = entry.get("password")
            if not isinstance(password, str) or not password.strip():
                raise ValueError(
                    f"{env_name} {account_label} '{name}' must define a non-empty string 'password'."
                )

            account = {"name": name, "password": password}

            if allow_studies:
                studies_value = entry.get("studies")
                if studies_value is None:
                    studies_value = []
                if not isinstance(studies_value, list) or not all(
                    isinstance(item, str) and item.strip() for item in studies_value
                ):
                    raise ValueError(
                        f"{env_name} {account_label} '{name}' field 'studies' must be a "
                        "JSON list of non-empty study name_short strings."
                    )
                account["studies"] = [item.strip() for item in studies_value]

            accounts.append(account)

        names = [account["name"] for account in accounts]
        duplicate_names = sorted({name for name in names if names.count(name) > 1})
        if duplicate_names:
            raise ValueError(
                f"{env_name} contains duplicate {account_label} names: {duplicate_names}"
            )

        return accounts

    def _parse_scientists_env_var(self) -> list[dict]:
        """Parse the optional ``TUD_API_SCIENTISTS`` variable into scientist definitions.

        The variable holds a JSON list of objects, each providing a ``name``, a
        ``password`` and an optional list of additionally granted study short
        names::

            [{"name": "alice", "password": "...", "studies": ["study_a"]}]

        Scientists may manage the studies they own (see ``Study.owner_usernames``)
        plus the studies granted here.
        """
        return self._parse_named_accounts_env_var(
            "TUD_API_SCIENTISTS", "scientist", allow_studies=True
        )

    def _parse_backup_users_env_var(self) -> list[dict]:
        """Parse the optional ``TUD_API_BACKUP_USERS`` variable into backup accounts.

        The variable holds a JSON list of objects with a ``name`` and a
        ``password``::

            [{"name": "backup_bot", "password": "..."}]

        Backup accounts are read-only and server-wide: they may only call the
        data-extraction endpoints, so they have no study scope and their entries
        carry no ``studies`` list.
        """
        return self._parse_named_accounts_env_var(
            "TUD_API_BACKUP_USERS", "backup user", allow_studies=False
        )

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

    @property
    def backup_users(self) -> list[dict]:
        """Get the configured backup accounts from ``TUD_API_BACKUP_USERS``."""
        return self._parse_backup_users_env_var()

    @property
    def backup_names(self) -> list[str]:
        """Get the usernames of all configured backup accounts."""
        return [user["name"] for user in self.backup_users]

    @property
    def backup_credentials(self) -> list[tuple[str, str]]:
        """Get backup credentials as ``(username, password)`` pairs."""
        return [(user["name"], user["password"]) for user in self.backup_users]

    def validate_auth_configuration(self) -> None:
        """Fail fast on inconsistent admin/scientist/backup configuration.

        Called during application startup so that a broken configuration shows
        up as a clear error instead of surprising authentication failures at
        request time.

        Raises:
            ValueError: If admin credentials are inconsistent or if a username is
                configured under more than one account type.
        """
        admin_credentials = self.admin_credentials
        scientist_credentials = self.scientist_credentials
        backup_credentials = self.backup_credentials

        def _overlapping_usernames(
            left: list[tuple[str, str]], right: list[tuple[str, str]]
        ) -> list[str]:
            return sorted(
                {username for username, _ in left} & {username for username, _ in right}
            )

        overlapping_names = _overlapping_usernames(
            admin_credentials, scientist_credentials
        )
        if overlapping_names:
            raise ValueError(
                "Usernames must not be configured both as super admin "
                "(TUD_API_ADMIN_USERNAME) and as scientist (TUD_API_SCIENTISTS): "
                f"{overlapping_names}"
            )

        # A name configured under two account types would silently get whichever
        # role the credential lookup happens to test first, so reject it here.
        overlapping_names = _overlapping_usernames(
            admin_credentials, backup_credentials
        )
        if overlapping_names:
            raise ValueError(
                "Usernames must not be configured both as super admin "
                "(TUD_API_ADMIN_USERNAME) and as backup user (TUD_API_BACKUP_USERS): "
                f"{overlapping_names}"
            )

        overlapping_names = _overlapping_usernames(
            scientist_credentials, backup_credentials
        )
        if overlapping_names:
            raise ValueError(
                "Usernames must not be configured both as scientist "
                "(TUD_API_SCIENTISTS) and as backup user (TUD_API_BACKUP_USERS): "
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
