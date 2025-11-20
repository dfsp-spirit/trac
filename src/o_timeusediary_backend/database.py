# database.py
from sqlmodel import SQLModel, create_engine, Session, select, delete
from typing import Generator
from .models import Study, StudyEntryName, TimeuseEntry
from .settings import settings
from .studies_config import load_studies_config
import logging

logger = logging.getLogger(__name__)

engine = create_engine(settings.database_url)


def create_db_and_tables(do_report_contents: bool = False):
    SQLModel.metadata.create_all(engine)
    create_default_studies(settings.studies_config_path)
    if do_report_contents:
        report_on_db_contents()

def report_on_db_contents():
    """Report on existing studies and their entry names in the database"""
    logger.info("Reporting on database contents:")
    with Session(engine) as session:
        studies = session.exec(select(Study)).all()
        if not studies:
            logger.info("No studies found in the database.")
            return

        for study in studies:
            logger.info(f"Study: {study.name} (short: {study.name_short}, id: {study.id})")
            entry_names = session.exec(
                select(StudyEntryName).where(StudyEntryName.study_id == study.id)
            ).all()
            for entry in entry_names:
                logger.info(f" - Entry: {entry.entry_name} (Index: {entry.entry_index})")

        time_use_entries = session.exec(select(TimeuseEntry)).all()
        logger.info(f"Total time use entries in database: {len(time_use_entries)}")

        # report for each time_use_entry the fields participant_id, study_id, study_name_short, daily_entry_index
        for entry in time_use_entries:
            study = session.get(Study, entry.study_id)
            study_name_short = study.name_short if study else "Unknown"
            logger.info(f"Entry: participant_id={entry.participant_id}, study_id={entry.study_id}, study_name_short={study_name_short}, daily_entry_index={entry.daily_entry_index}")



def create_default_studies(config_path: str):
    """Create studies from configuration file"""
    try:
        config = load_studies_config(config_path)
    except FileNotFoundError:
        logger.warning("No studies configuration file found. Using default fallback.")
        config = get_fallback_config()

    logger.info(f"Checking whether studies need to be created based on config file at '{config_path}'")

    with Session(engine) as session:
        for study_config in config.studies:
            # Check if study already exists
            existing_study = session.exec(
                select(Study).where(Study.name_short == study_config.name_short)
            ).first()

            if not existing_study:
                # Create study
                study = Study(
                    name=study_config.name,
                    name_short=study_config.name_short,
                    description=study_config.description
                )
                session.add(study)
                session.flush()  # Flush to get the ID without committing

                # Create entry names
                for entry_index, entry_name in enumerate(study_config.entry_names):
                    study_entry = StudyEntryName(
                        study_id=study.id,
                        entry_index=entry_index,
                        entry_name=entry_name
                    )
                    session.add(study_entry)

                logger.info(f"Created study: {study_config.name}")
            else:
                logger.info(f"Study already exists: '{study_config.name_short}' with long name: '{study_config.name}'")

        session.commit()

def get_fallback_config():
    """Provide fallback configuration if no config file is found"""
    from .studies_config import StudiesConfig, StudyConfig

    return StudiesConfig(
        studies=[
            StudyConfig(
                name="Default Study",
                name_short="default",
                description="Default study for time use research",
                entry_names=["default"]
            )
        ]
    )

def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session