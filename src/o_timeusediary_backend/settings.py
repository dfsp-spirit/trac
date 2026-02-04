import os
from dotenv import load_dotenv
import json

load_dotenv()   # load .env file in working directory if it exists



class TUDBackendSettings:
    def __init__(self):
        # Backend-specific settings
        self.debug = True if os.getenv("TUD_DEBUG", "false").lower() == "true" else False
        self.studies_config_path: str = os.getenv("TUD_STUDIES_CONFIG_PATH", "studies_config.json") # Backend file with studies configuration
        self.print_db_contents_on_startup = True if os.getenv("TUD_REPORT_DB_CONTENTS_ON_STARTUP", "false").lower() == "true" else False

    # Environment-dependent settings as properties
    @property
    def database_url(self):
        db_url = os.getenv("TUD_DATABASE_URL")
        if not db_url:
            raise ValueError("TUD_DATABASE_URL environment variable is not set.")
        return db_url

    @property
    def allowed_origins(self):
        origins = json.loads(os.getenv("TUD_ALLOWED_ORIGINS", "[]"))
        if not origins:
            raise ValueError("TUD_ALLOWED_ORIGINS environment variable is not set. Please set a JSON array of allowed origins.")
        return origins

    @property
    def rootpath(self):
        return os.getenv("TUD_ROOTPATH", "/")

    @property
    def admin_username(self):
        username = os.getenv("TUD_API_ADMIN_USERNAME")
        if not username:
            raise ValueError("TUD_API_ADMIN_USERNAME environment variable is not set.")
        return username

    @property
    def admin_password(self):
        password = os.getenv("TUD_API_ADMIN_PASSWORD")
        if not password:
            raise ValueError("TUD_API_ADMIN_PASSWORD environment variable is not set.")
        return password


settings = TUDBackendSettings()

