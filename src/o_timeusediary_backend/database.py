# database.py
from sqlmodel import SQLModel, create_engine, Session, select
from typing import Generator
from .models import Study, Participant, DayLabel, StudyParticipant, Timeline, Activity
from .settings import settings
from .parsers.studies_config import load_studies_config, CfgFileStudies
from .parsers.activities_config import load_activities_config, ActivitiesConfig
import logging

logger = logging.getLogger(__name__)

engine = create_engine(settings.database_url)


def create_db_and_tables(do_report_contents: bool = False):
    SQLModel.metadata.create_all(engine)
    create_config_file_studies(settings.studies_config_path)
    if do_report_contents:
        report_on_db_contents()

def report_on_db_contents():
    """Report on existing studies and their contents in the database"""
    logger.info("Reporting on database contents:")

    with Session(engine) as session:
        # Report studies
        studies = session.exec(select(Study)).all()
        if not studies:
            logger.info("No studies found in the database.")
            return

        for study in studies:
            logger.info(f"Study: {study.name} (short: {study.name_short}, id: {study.id})")
            logger.info(f"  Description: {study.description}")
            logger.info(f"  Allow unlisted: {study.allow_unlisted_participants}")
            logger.info(f"  Default language: {study.default_language}")
            logger.info(f"  Data collection: {study.data_collection_start} to {study.data_collection_end}")

            # Report day labels
            day_labels = session.exec(
                select(DayLabel).where(DayLabel.study_id == study.id).order_by(DayLabel.display_order)
            ).all()
            logger.info(f"  Day Labels ({len(day_labels)}):")
            for day_label in day_labels:
                logger.info(f"    - {day_label.name} (order: {day_label.display_order}, display name: '{day_label.display_name}')")

            # Report timelines
            timelines = session.exec(
                select(Timeline).where(Timeline.study_id == study.id)
            ).all()
            logger.info(f"  Timelines ({len(timelines)}):")
            for timeline in timelines:
                logger.info(f"    - {timeline.name} (display: '{timeline.display_name}', mode: {timeline.mode})")

            # Report participants
            study_participants = session.exec(
                select(StudyParticipant).where(StudyParticipant.study_id == study.id)
            ).all()
            logger.info(f"  Participants ({len(study_participants)}):")
            for sp in study_participants:
                participant = session.get(Participant, sp.participant_id)
                logger.info(f"    - {participant.id} (joined: {participant.created_at})")

        # Report activities
        activities = session.exec(select(Activity)).all()
        logger.info(f"Total activities in database: {len(activities)}")

        # Report sample activities (limit to 10 to avoid too much output)
        sample_activities = activities[:10]
        logger.info(f"Sample activities (showing first {len(sample_activities)}):")

        for activity in sample_activities:
            study = session.get(Study, activity.study_id)
            participant = session.get(Participant, activity.participant_id)
            day_label = session.get(DayLabel, activity.day_label_id)
            timeline = session.get(Timeline, activity.timeline_id)

            study_name_short = study.name_short if study else "Unknown"
            participant_id = participant.id if participant else "Unknown"
            day_label_name = day_label.name if day_label else "Unknown"
            timeline_name = timeline.name if timeline else "Unknown"

            logger.info(f"  Activity: participant='{participant_id}', study='{study_name_short}', "
                       f"day='{day_label_name}', timeline='{timeline_name}', "
                       f"activity_code={activity.activity_code}, time={activity.start_minutes}-{activity.end_minutes}min, "
                       f"activity_name='{activity.activity_name}'")

        if len(activities) > 10:
            logger.info(f"  ... and {len(activities) - 10} more activities")


def get_timelines_for_study(study_id: int) -> list[Timeline]:
    """Get timelines for a given study"""
    with Session(engine) as session:
        timelines = session.exec(
            select(Timeline).where(Timeline.study_id == study_id)
        ).all()
        return timelines


def create_config_file_studies(config_path: str):
    """Create studies from configuration file"""

    studies_config: CfgFileStudies = load_studies_config(config_path)
    logger.info(f"Checking whether studies need to be created based on config file at '{config_path}'")

    with Session(engine) as session:
        for study_config in studies_config.studies:
            try:
                # Check if study already exists
                existing_study = session.exec(
                    select(Study).where(Study.name_short == study_config.name_short)
                ).first()

                if existing_study:
                    logger.info(f"Study already exists: '{study_config.name_short}' with long name: '{study_config.name}'")
                    continue  # Skip to next study

                # Create study
                study = Study(
                    name=study_config.name,
                    name_short=study_config.name_short,
                    description=study_config.description,
                    allow_unlisted_participants=study_config.allow_unlisted_participants,
                    default_language=study_config.default_language,
                    activities_json_url=study_config.activities_json_file,
                    data_collection_start=study_config.data_collection_start,
                    data_collection_end=study_config.data_collection_end
                )
                session.add(study)
                session.commit()  # Commit immediately after each study

                # Load activities config and create related entities
                activities_config: ActivitiesConfig = load_activities_config(study_config.activities_json_file)

                # Create day labels
                for _, day_label_inst in enumerate(study_config.day_labels):
                    day_label = DayLabel(
                        study_id=study.id,
                        name=day_label_inst.name,
                        display_order=day_label_inst.display_order,
                        display_name=day_label_inst.display_name
                    )
                    session.add(day_label)

                # Create timelines
                for timeline_name, timeline_config in activities_config.timeline.items():
                    timeline = Timeline(
                        study_id=study.id,
                        name=timeline_name,
                        display_name=timeline_config.name,
                        description=timeline_config.description,
                        mode=timeline_config.mode,
                        min_coverage=int(timeline_config.min_coverage) if timeline_config.min_coverage else None
                    )
                    session.add(timeline)

                # Create participants if specified
                if not study_config.allow_unlisted_participants and study_config.study_participant_ids:
                    for participant_id in study_config.study_participant_ids:
                        existing_participant = session.exec(
                            select(Participant).where(Participant.id == participant_id)
                        ).first()

                        if not existing_participant:
                            participant = Participant(id=participant_id)
                            session.add(participant)
                            session.flush()
                        else:
                            participant = existing_participant

                        study_participant = StudyParticipant(
                            study_id=study.id,
                            participant_id=participant.id
                        )
                        session.add(study_participant)

                session.commit()  # Commit all related entities
                logger.info(f"Created study: {study_config.name}")

            except Exception as e:
                session.rollback()  # Rollback on error
                if "duplicate key" in str(e) or "already exists" in str(e):
                    logger.warning(f"Study '{study_config.name_short}' may already exist: {e}")
                else:
                    logger.error(f"Error creating study '{study_config.name_short}': {e}")
                    raise

def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session