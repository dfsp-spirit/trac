#!/bin/bash
#
# Create - or repair - the PostgreSQL database and role used by the TUD backend.
#
# The script is idempotent and safe to re-run: it creates the role when it is
# missing, resets an existing role to the credentials and attributes from the
# .env file, creates the database only when it does not exist, and (re-)applies
# the grants every time. Re-running it is therefore the supported way to recover
# from a half-finished setup - for example after a drop run that stopped at
# "role ... cannot be dropped because some objects depend on it" and left a new
# database without grants.
#
# The role is a cluster-level object shared with the disposable test database
# (<TUD_DATABASE_NAME>_test, see README_DEVELOPMENT.md), which is why
# database/drop_tud_db.sh keeps the role by default.
#
# This script does NOT create any tables or relations: run `tud db upgrade`
# afterwards. The PostgreSQL server must be running and accessible.
#
# This is a development setup script and is not intended for production use. It assumes that:
#  1) you are developing on your local machine, and not using Docker
#  2) you have sudo access to the postgres user
#  3) the database server is running on the same machine
#  4) peer authentication is enabled in postgres for local connections
#
# Usage: in the repo root, as a user with sudo access to the postgres system user, run:
#
#    ./database/create_tud_db.sh backend/.env
#

echo "=== Database setup for TUD backend ==="
echo " This script creates or repairs the database and database user with the password specified in the .env file."
echo " It requires sudo access to the 'postgres' user on a local PostgreSQL server."
echo " Re-running it is safe: an existing role is reset to the .env credentials and the grants are re-applied."
echo "Note that the TUD_DATABASE_USER and TUD_DATABASE_PASSWORD read from the .env file are the ones that will be created by this script,"
echo "not the superuser credentials that will be used by this script to connect to the postgres server."
echo ""


# Default .env location
DEFAULT_ENV_PATH=".env"

# Allow custom .env path
ENV_PATH="${1:-$DEFAULT_ENV_PATH}"

if [ ! -f "$ENV_PATH" ]; then
    echo "ERROR: .env file not found at path: '$ENV_PATH'"
    echo "Please create it first or specify a custom path:"
    echo "  ./database/create_tud_db.sh /path/to/your/.env"
    exit 1
fi

echo "Loading configuration from env file: '$ENV_PATH'"
source "$ENV_PATH"


TUD_DATABASE_HOST=${TUD_DATABASE_HOST:-localhost}
TUD_DATABASE_PORT=${TUD_DATABASE_PORT:-5432}

# After sourcing the .env file, validate required variables
if [ -z "$TUD_DATABASE_NAME" ] || [ -z "$TUD_DATABASE_USER" ] || [ -z "$TUD_DATABASE_PASSWORD" ]; then
    echo "ERROR: Missing required database configuration in '.env' file."
    echo "Please ensure TUD_DATABASE_NAME, TUD_DATABASE_USER, and TUD_DATABASE_PASSWORD are set."
    echo "Note that the TUD_DATABASE_USER and TUD_DATABASE_PASSWORD are the ones that will be created by this script,"
    echo "not the superuser credentials that will be used by this script to connect to the postgres server."
    exit 1
fi

# Guards: a typo in .env must never turn into a change to a system object.
case "$TUD_DATABASE_NAME" in
    postgres|template0|template1)
        echo "ERROR: refusing to set up the system database '$TUD_DATABASE_NAME'."
        echo "       Set TUD_DATABASE_NAME in '$ENV_PATH' to the database this app should use."
        exit 1
        ;;
esac

if [ "$TUD_DATABASE_USER" = "postgres" ]; then
    echo "ERROR: refusing to use the 'postgres' superuser as the application role."
    echo "       Set TUD_DATABASE_USER in '$ENV_PATH' to a dedicated role."
    exit 1
fi

echo "Loaded env vars from '.env' file and defaults:"
echo " TUD_DATABASE_HOST='$TUD_DATABASE_HOST'"
echo " TUD_DATABASE_PORT='$TUD_DATABASE_PORT'"
echo " TUD_DATABASE_NAME='$TUD_DATABASE_NAME'"
echo " TUD_DATABASE_USER='$TUD_DATABASE_USER'"
## End of env file handling

# Quote the password once, for use inside the SQL script below: doubling every
# single quote keeps an apostrophe in the password harmless. The value travels on
# stdin, never on the command line, so it does not show up in the process list.
sql_password="'${TUD_DATABASE_PASSWORD//\'/\'\'}'"

echo "Setting up PostgreSQL database '${TUD_DATABASE_NAME}' and user '${TUD_DATABASE_USER}' as specified in the .env file..."

if [ "$TUD_DATABASE_HOST" = "localhost" ] || [ "$TUD_DATABASE_HOST" = "127.0.0.1" ]; then
    echo "Using peer auth as system user postgres for local database server at host '$TUD_DATABASE_HOST'..."
    # ON_ERROR_STOP makes psql stop and exit non-zero on the first failing
    # statement, so a half-applied setup cannot report success.
    #
    # Names go through psql variables (:'db' as a literal, :"db" as an
    # identifier) and CREATEd objects are guarded by a WHERE NOT EXISTS check, so
    # every step below is a no-op when it already ran. CREATE DATABASE and
    # CREATE ROLE have no IF NOT EXISTS, hence the \gexec form.
    sudo -u postgres psql -v ON_ERROR_STOP=1 \
        -v db="$TUD_DATABASE_NAME" \
        -v dbuser="$TUD_DATABASE_USER" << SQL_EOF
-- Create the role when it is missing. The password is set by the ALTER ROLE
-- below, which keeps it out of this format() string: a literal inside a string
-- literal would need different escaping than a plain SQL literal.
SELECT format(
    'CREATE ROLE %I WITH LOGIN NOCREATEDB NOCREATEROLE NOSUPERUSER NOREPLICATION',
    :'dbuser'
)
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'dbuser')\gexec

-- Always reset password and attributes, so a role left over from an earlier run
-- is repaired instead of making the CREATE ROLE above fail.
ALTER ROLE :"dbuser" WITH LOGIN PASSWORD ${sql_password}
    NOCREATEDB
    NOCREATEROLE
    NOSUPERUSER
    NOREPLICATION;

-- Create the database only when it is missing.
SELECT format('CREATE DATABASE %I', :'db')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'db')\gexec

-- Revoke all default privileges from PUBLIC in this database
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;

GRANT CONNECT ON DATABASE :"db" TO :"dbuser";
\connect :"db"

-- Lock down the public schema completely
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO :"dbuser";

-- Grant app privileges. These are no-ops on a fresh database and repair the
-- grants when tables from an earlier setup already exist.
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO :"dbuser";
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO :"dbuser";
-- Defaults for objects the bootstrap superuser creates later, for example when
-- migrations are applied as postgres instead of the application role.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO :"dbuser";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO :"dbuser";
SQL_EOF
    CREATE_EXIT_CODE=$?
else
    echo "ERROR: Remote database hosts are not supported by this setup script."
    exit 1
fi

if [ "$CREATE_EXIT_CODE" -ne 0 ]; then
    echo "ERROR: Failed to set up database or user. Check the error messages above."
    exit 1
fi

echo "Database setup complete."