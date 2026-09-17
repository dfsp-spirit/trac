"""Admin authentication and study-scope authorization.

Two kinds of administrators exist:

* **Super admins** are configured via ``TUD_API_ADMIN_USERNAME`` /
  ``TUD_API_ADMIN_PASSWORD`` and may manage every study.
* **Scientists** are configured via ``TUD_API_SCIENTISTS`` and may manage only
  the studies they own (``Study.owner_usernames``) plus the studies explicitly
  granted to them in their ``TUD_API_SCIENTISTS`` entry. Within those studies
  they have the full powers of an admin (including deleting the study).

Study scope is enforced centrally in :func:`require_admin_identity`, which every
admin route depends on - directly, or indirectly through the
backwards-compatible :func:`verify_admin`. For admin routes whose path contains
a study name, the study is looked up and access is denied with HTTP 403 when the
authenticated scientist may not manage it. Because the check lives in that
shared dependency, admin routes added later are protected automatically.

Routes that identify their study through a query parameter or request body
(e.g. participant management and the runtime-config export) check access
explicitly with :func:`ensure_can_access_study` / :func:`ensure_study_scope`.

This is accident-prevention isolation for trusted internal users, not a security
boundary: see the "Study ownership and scientist accounts" section in README.md.
"""

from __future__ import annotations

import logging
import re
import secrets
from dataclasses import dataclass, field
from typing import Literal, Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from sqlmodel import Session, select

from ..database import get_session
from ..models import Study
from ..settings import settings

logger = logging.getLogger(__name__)

ADMIN_AUTH_REALM = "TRAC Administration"
security = HTTPBasic(realm=ADMIN_AUTH_REALM)

ROLE_SUPER_ADMIN = "super_admin"
ROLE_SCIENTIST = "scientist"

# Admin route paths that carry a study short name. Patterns (instead of an
# explicit route list) are used so that new study-scoped routes are covered
# automatically.
_STUDY_SCOPED_PATH_PATTERNS = (
    re.compile(r"^/api/admin/studies/(?P<study_name_short>[^/]+)"),
    re.compile(r"^/api/admin/export/(?P<study_name_short>[^/]+)/activities"),
    re.compile(r"^/admin/study/(?P<study_name_short>[^/]+)"),
)

# Paths that match the patterns above but are not study-scoped: they create a
# new study, so there is no existing owner to check against.
_NON_STUDY_PATHS = frozenset({"import-config", "create-from-files"})


@dataclass(frozen=True)
class AdminIdentity:
    """An authenticated administrator and the studies she may manage."""

    username: str
    role: Literal["super_admin", "scientist"]
    granted_study_names: frozenset[str] = field(default_factory=frozenset)

    @property
    def is_super_admin(self) -> bool:
        """Whether this identity may manage every study."""
        return self.role == ROLE_SUPER_ADMIN

    def can_access_study(self, study: Study) -> bool:
        """Whether this identity may manage the given study."""
        if self.is_super_admin:
            return True
        if self.username in (study.owner_usernames or []):
            return True
        return study.name_short in self.granted_study_names


def _study_access_denied(study_name_short: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={
            "code": "study_access_denied",
            "message": (
                f"You do not have access to study '{study_name_short}'. "
                "Ask a super admin to add you as an owner of this study."
            ),
        },
    )


def ensure_can_access_study(identity: AdminIdentity, study: Study) -> None:
    """Raise HTTP 403 when the identity may not manage the given study."""
    if not identity.can_access_study(study):
        logger.warning(
            "Admin '%s' (role=%s) denied access to study '%s'.",
            identity.username,
            identity.role,
            study.name_short,
        )
        raise _study_access_denied(study.name_short)


def ensure_study_scope(
    identity: AdminIdentity,
    session: Session,
    study_name_short: Optional[str],
) -> None:
    """Raise HTTP 403 when the identity may not manage the named study.

    Used by admin routes that identify their study outside the URL path. A study
    that does not exist is ignored here so the route can report its own 404.
    """
    if identity.is_super_admin or not study_name_short:
        return

    study = session.exec(
        select(Study).where(Study.name_short == study_name_short)
    ).first()
    if study is None:
        return

    ensure_can_access_study(identity, study)


def resolve_admin_identity(credentials: HTTPBasicCredentials) -> AdminIdentity:
    """Resolve HTTP Basic credentials into an :class:`AdminIdentity`.

    Super admins are checked first, so a username configured in both lists is
    treated as super admin (``validate_auth_configuration`` rejects that
    overlap at startup).

    Raises:
        HTTPException: 401 when the credentials are not valid.
    """
    for expected_username, expected_password in settings.admin_credentials:
        correct_username = secrets.compare_digest(
            credentials.username, expected_username
        )
        correct_password = secrets.compare_digest(
            credentials.password, expected_password
        )
        if correct_username and correct_password:
            logger.info(
                "Admin '%s' authenticated successfully (role=%s).",
                credentials.username,
                ROLE_SUPER_ADMIN,
            )
            return AdminIdentity(username=credentials.username, role=ROLE_SUPER_ADMIN)

    study_grants = settings.scientist_study_grants
    for expected_username, expected_password in settings.scientist_credentials:
        correct_username = secrets.compare_digest(
            credentials.username, expected_username
        )
        correct_password = secrets.compare_digest(
            credentials.password, expected_password
        )
        if correct_username and correct_password:
            logger.info(
                "Scientist '%s' authenticated successfully (role=%s).",
                credentials.username,
                ROLE_SCIENTIST,
            )
            return AdminIdentity(
                username=credentials.username,
                role=ROLE_SCIENTIST,
                granted_study_names=frozenset(
                    study_grants.get(credentials.username, [])
                ),
            )

    logger.info(
        "Failed admin authentication attempt for user '%s'", credentials.username
    )
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid admin credentials",
        headers={"WWW-Authenticate": f'Basic realm="{ADMIN_AUTH_REALM}"'},
    )


def _study_name_from_request_path(request: Request) -> Optional[str]:
    """Extract the study short name from an admin request path, if any."""
    path = request.scope.get("path") or ""

    root_path = (settings.rootpath or "/").rstrip("/")
    if root_path and root_path != "/" and path.startswith(root_path):
        path = path[len(root_path) :] or "/"

    for pattern in _STUDY_SCOPED_PATH_PATTERNS:
        match = pattern.match(path)
        if match:
            study_name_short = match.group("study_name_short")
            if study_name_short in _NON_STUDY_PATHS:
                return None
            return study_name_short

    return None


def enforce_admin_study_scope(
    request: Request,
    identity: AdminIdentity,
    session: Session,
) -> None:
    """Deny study-scoped admin requests from scientists without access.

    Studies that do not exist are left to the route handler, which reports the
    usual 404, so that missing studies and foreign studies can be told apart by
    their status code.
    """
    if identity.is_super_admin:
        return

    study_name_short = _study_name_from_request_path(request)
    if not study_name_short:
        return

    study = session.exec(
        select(Study).where(Study.name_short == study_name_short)
    ).first()
    if study is None:
        return

    ensure_can_access_study(identity, study)


def require_admin_identity(
    request: Request,
    credentials: HTTPBasicCredentials = Depends(security),
    session: Session = Depends(get_session),
) -> AdminIdentity:
    """Authenticate the caller and enforce study scope for the requested path.

    This is the single entry point for admin authorization: every admin route
    depends on it, directly or through :func:`verify_admin`.
    """
    identity = resolve_admin_identity(credentials)
    enforce_admin_study_scope(request, identity, session)
    return identity


def require_super_admin(
    identity: AdminIdentity = Depends(require_admin_identity),
) -> AdminIdentity:
    """Require a super admin, raising HTTP 403 for scientists."""
    if not identity.is_super_admin:
        logger.warning(
            "Admin '%s' (role=%s) denied access to a super-admin-only endpoint.",
            identity.username,
            identity.role,
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "super_admin_required",
                "message": "This action is restricted to super admins.",
            },
        )
    return identity


def verify_admin(identity: AdminIdentity = Depends(require_admin_identity)) -> str:
    """Verify admin credentials using HTTP Basic Auth.

    Kept as the endpoint dependency for backwards compatibility: it returns the
    authenticated username, which the admin routes use for logging and audit
    entries. Authorization (study scope) is enforced by
    :func:`require_admin_identity`.

    @param identity: Resolved admin identity from the shared auth dependency.
    @return: The username of the authenticated admin.
    """
    return identity.username
