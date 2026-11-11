#!/bin/bash
#
# Drop (delete) the PostgreSQL database used by the TUD backend web app.
#
# By default only the database is dropped. The application role is a
# cluster-level object that the disposable test database
# (<TUD_DATABASE_NAME>_test, see README_DEVELOPMENT.md) depends on: it usually
# owns that database and the tables in it, so DROP ROLE fails with "role ...
# cannot be dropped because some objects depend on it" and an all-in-one drop
# stops halfway - leaving no database but a role without the grants it needs for
# the next one. Re-running database/create_tud_db.sh recreates or repairs the
# role, so dropping it is not part of a normal reset.
#
# Pass --drop-role to remove the role as well. That only works once nothing else
# depends on it; the script reports what is in the way instead of failing after
# the database is already gone.
#
# This is a development setup script and is not intended for production use. It assumes that:
#  1) you are developing on your local machine, and not using Docker
#  2) you have sudo access to the postgres user
#  3) the database server is running on the same machine
#  4) peer authentication is enabled in postgres for local connections
#
# Usage: in the repo root, as a user with sudo access to the postgres system user, run:
#
#    ./database/drop_tud_db.sh backend/.env
#    ./database/drop_tud_db.sh backend/.env --drop-role
#

usage() {
    cat <<'USAGE'
Usage: ./database/drop_tud_db.sh [ENV_FILE] [--drop-role]

  ENV_FILE      Path to the .env file with the TUD_DATABASE_* settings (default: .env)
  --drop-role   Also drop the database role. Refused while another database still
                depends on it - the disposable test database usually does.
USAGE
}

echo "=== Drop database of the TUD backend web app, deleting all user data ==="
echo "NOTE: This script is for development use only. It is not intended for production use."
echo "The TUD_DATABASE_NAME read from the .env file is the one that will be dropped by this script,"
echo "not the superuser credentials that will be used by this script to connect to the postgres server."
echo ""

DEFAULT_ENV_PATH=".env"
ENV_PATH=""
DROP_ROLE=false

for arg in "$@"; do
    case "$arg" in
        --drop-role)
            DROP_ROLE=true
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        -*)
            echo "ERROR: unknown option '$arg'."
            usage
            exit 1
            ;;
        *)
            if [ -n "$ENV_PATH" ]; then
                echo "ERROR: unexpected argument '$arg'."
                usage
                exit 1
            fi
            ENV_PATH="$arg"
            ;;
    esac
done

ENV_PATH="${ENV_PATH:-$DEFAULT_ENV_PATH}"

if [ ! -f "$ENV_PATH" ]; then
    echo "ERROR: .env file not found at path: '$ENV_PATH'"
    echo "Please create it first or specify a custom path:"
    echo "  ./database/drop_tud_db.sh /path/to/your/.env"
    exit 1
fi

echo "Loading configuration from env file: '$ENV_PATH'"
source "$ENV_PATH"


TUD_DATABASE_HOST=${TUD_DATABASE_HOST:-localhost}
TUD_DATABASE_PORT=${TUD_DATABASE_PORT:-5432}

# After sourcing the .env file, validate required variables
if [ -z "$TUD_DATABASE_NAME" ] || [ -z "$TUD_DATABASE_USER" ]; then
    echo "ERROR: Missing required database configuration in '.env' file."
    echo "Please ensure TUD_DATABASE_NAME and TUD_DATABASE_USER are set."
    exit 1
fi

# Guards: a typo in .env must never turn into a dropped system database.
case "$TUD_DATABASE_NAME" in
    postgres|template0|template1)
        echo "ERROR: refusing to drop the system database '$TUD_DATABASE_NAME'."
        echo "       Check TUD_DATABASE_NAME in '$ENV_PATH'."
        exit 1
        ;;
esac

echo "Loaded env vars from '.env' file or defaults:"
echo " TUD_DATABASE_HOST='$TUD_DATABASE_HOST'"
echo " TUD_DATABASE_PORT='$TUD_DATABASE_PORT'"
echo " TUD_DATABASE_NAME='$TUD_DATABASE_NAME'"
echo " TUD_DATABASE_USER='$TUD_DATABASE_USER'"
## End of env file handling

if [ "$TUD_DATABASE_HOST" = "localhost" ] || [ "$TUD_DATABASE_HOST" = "127.0.0.1" ]; then
    echo "Dropping database on localhost..."
else
    echo "ERROR: Remote database hosts are not supported by this drop database script."
    exit 1
fi

if [ "$DROP_ROLE" = true ]; then
    echo "WARNING: This will permanently delete the postgresql database '$TUD_DATABASE_NAME' and the role '$TUD_DATABASE_USER'!"
else
    echo "WARNING: This will permanently delete the postgresql database '$TUD_DATABASE_NAME' on localhost and all its data!"
    echo "         The role '$TUD_DATABASE_USER' is kept - './database/create_tud_db.sh' reuses or repairs it."
fi
read -p "Are you sure you want to continue? (y/N): " confirm

if [[ $confirm != [yY] && $confirm != [yY][eE][sS] ]]; then
    echo "Operation cancelled."
    exit 0
fi

echo "Dropping database '$TUD_DATABASE_NAME'..."

# ON_ERROR_STOP makes psql stop and exit non-zero on the first failing
# statement. WITHOUT (FORCE) leftover sessions (a running dev backend, an open
# psql window) make DROP DATABASE fail; with it they are terminated first.
if sudo -u postgres psql -v ON_ERROR_STOP=1 -v db="$TUD_DATABASE_NAME" << 'SQL_EOF'
SELECT format('DROP DATABASE IF EXISTS %I WITH (FORCE)', :'db')\gexec
SQL_EOF
then
    echo "Database '$TUD_DATABASE_NAME' dropped."
else
    echo "ERROR: Failed to drop database '$TUD_DATABASE_NAME'. Check the error messages above."
    exit 1
fi

if [ "$DROP_ROLE" != true ]; then
    echo "Role '$TUD_DATABASE_USER' kept. It is shared with the disposable test database and is"
    echo "reused by './database/create_tud_db.sh'. Pass --drop-role to remove it as well."
    exit 0
fi

# A role cannot be dropped while another database depends on it. Report that
# instead of failing after the database is already gone: the disposable test
# database is usually the blocker, and dropping the role would break the suites.
owned_databases=$(sudo -u postgres psql -X -tA -v ON_ERROR_STOP=1 -v dbuser="$TUD_DATABASE_USER" << 'SQL_EOF'
SELECT datname
FROM pg_database
WHERE datdba = (SELECT oid FROM pg_roles WHERE rolname = :'dbuser')
ORDER BY datname;
SQL_EOF
)

if [ -n "$owned_databases" ]; then
    echo "ERROR: role '$TUD_DATABASE_USER' still owns other databases, so it cannot be dropped:"
    printf '%s\n' "$owned_databases" | while IFS= read -r owned_database; do
        if [ -n "$owned_database" ]; then
            echo "         $owned_database"
        fi
    done
    echo "       This is expected for the disposable test database. Either keep the role"
    echo "       (run this script without --drop-role) or hand those databases to another"
    echo "       role and remove the objects the role owns in them first:"
    echo "         sudo -u postgres psql -c 'ALTER DATABASE <name> OWNER TO postgres'"
    echo "         sudo -u postgres psql -d <name> -c 'DROP OWNED BY $TUD_DATABASE_USER'"
    exit 1
fi

echo "Dropping role '$TUD_DATABASE_USER'..."

if sudo -u postgres psql -v ON_ERROR_STOP=1 -v dbuser="$TUD_DATABASE_USER" << 'SQL_EOF'
DROP ROLE IF EXISTS :"dbuser";
SQL_EOF
then
    echo "Role '$TUD_DATABASE_USER' dropped."
else
    echo "ERROR: Failed to drop role '$TUD_DATABASE_USER'. Check the error messages above."
    echo "       Remove the objects it owns in other databases first, for example:"
    echo "         sudo -u postgres psql -d <name> -c 'DROP OWNED BY $TUD_DATABASE_USER'"
    exit 1
fi
