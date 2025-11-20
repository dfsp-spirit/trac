import os
from dotenv import load_dotenv
import json

load_dotenv()   # load .env file in working directory if it exists



class TUDBackendSettings:
    def __init__(self):
        # Backend-specific settings
        self.debug = True if os.getenv("TUD_DEBUG", "false").lower() == "true" else False
        self.studies_config_path: str = os.getenv("TUD_STUDIES_CONFIG_PATH", "studies_config.json")

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


settings = TUDBackendSettings()

