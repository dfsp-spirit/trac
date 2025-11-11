
from sqlmodel import SQLModel, create_engine, Session
import os

import logging
logger = logging.getLogger(__name__)

from .settings import settings


engine = create_engine(settings.database_url)

def create_db_and_tables():
    logger.info("Creating TUD database and tables...")
    SQLModel.metadata.create_all(engine)

def get_session():
    with Session(engine) as session:
        yield session