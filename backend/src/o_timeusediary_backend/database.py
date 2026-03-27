# database.py
from sqlmodel import SQLModel, create_engine, Session, select
from typing import Generator
from .models import Study, Participant, DayLabel, StudyParticipant, Timeline, Activity
from .settings import settings
from .parsers.studies_config import load_studies_config, CfgFileStudies
from .parsers.activities_config import load_activities_config, ActivitiesConfig, get_activity_codes_set, get_all_activity_codes
import logging

logger = logging.getLogger(__name__)

engine = create_engine(settings.database_url)


def create_db_and_tables(do_report_contents: bool = False):
    SQLModel.metadata.create_all(engine)
    create_config_file_studies_in_database(settings.studies_config_path)
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
            logger.info(f"* Study: {study.name} (short: {study.name_short}, id: {study.id})")
            logger.info(f"  Description: {study.description}")
            logger.info(f"  Allow unlisted: {study.allow_unlisted_participants}")
            logger.info(f"  Default language: {study.default_language}")
            logger.info(f"  Activities JSON file: {study.activities_json_url}")
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

            # Report activities count in database for this study
            activities = session.exec(select(Activity).where(Activity.study_id == study.id)).all()
            activities_count = len(activities)
            logger.info(f"  Total activities recorded for this study: {activities_count}")

        # Report activities
        logger.info("-- Study-specific reporting done. All activities in database:")
        activities = session.exec(select(Activity)).all()
        logger.info(f"Total activities in database: {len(activities)}")

        # Report sample activities (limit to 10 to avoid too much output)
        if len(activities) > 0:
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


def create_config_file_studies_in_database(config_path: str):
    """Create studies in the database based on info in the studies_config.json configuration file"""

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
                default_activities_file = study_config.get_activities_json_file_for_language(study_config.default_language)
                if not default_activities_file:
                    raise ValueError(
                        f"No activities JSON file configured for study '{study_config.name_short}' "
                        f"and default language '{study_config.default_language}'"
                    )

                activities_config: ActivitiesConfig = load_activities_config(default_activities_file)
                valid_activity_codes = get_activity_codes_set(activities_config)
                activity_info_by_code = get_all_activity_codes(activities_config)

                activities_logged_by_userid = study_config.get_logged_activities_by_participant()
                allowed_day_labels = {day_label.name for day_label in study_config.day_labels}
                allowed_timeline_names = set(activities_config.timeline.keys())

                # Sanity checks before writing anything to DB
                if not study_config.allow_unlisted_participants and activities_logged_by_userid:
                    unauthorized_participants = sorted(
                        set(activities_logged_by_userid.keys()) - set(study_config.study_participant_ids)
                    )
                    if unauthorized_participants:
                        raise ValueError(
                            "Invalid studies_config JSON for study "
                            f"'{study_config.name_short}': closed study has logged activities for unauthorized participants "
                            f"{unauthorized_participants}. All participant IDs in activities_logged_by_userid / "
                            "logged_activities_by_participant_id must be listed in study_participant_ids."
                        )

                invalid_codes = []
                invalid_days = []
                invalid_timelines = []

                for participant_id, day_map in activities_logged_by_userid.items():
                    for day_name, entries in day_map.items():
                        if day_name not in allowed_day_labels:
                            invalid_days.append(
                                f"participant='{participant_id}', day='{day_name}'"
                            )
                            continue

                        for index, activity_item in enumerate(entries):
                            if activity_item.activity_code not in valid_activity_codes:
                                invalid_codes.append(
                                    f"participant='{participant_id}', day='{day_name}', entry={index}, "
                                    f"activity_code={activity_item.activity_code}"
                                )

                            if activity_item.timeline not in allowed_timeline_names:
                                invalid_timelines.append(
                                    f"participant='{participant_id}', day='{day_name}', entry={index}, "
                                    f"timeline='{activity_item.timeline}'"
                                )

                if invalid_days:
                    raise ValueError(
                        "Invalid studies_config JSON for study "
                        f"'{study_config.name_short}': unknown day labels in activities_logged_by_userid / "
                        f"logged_activities_by_participant_id: {invalid_days[:10]}"
                    )

                if invalid_timelines:
                    raise ValueError(
                        "Invalid studies_config JSON for study "
                        f"'{study_config.name_short}': unknown timelines in activities_logged_by_userid / "
                        f"logged_activities_by_participant_id: {invalid_timelines[:10]}"
                    )

                if invalid_codes:
                    raise ValueError(
                        "Invalid studies_config JSON for study "
                        f"'{study_config.name_short}': activity codes in activities_logged_by_userid / "
                        "logged_activities_by_participant_id are missing in the study default-language activities file "
                        f"('{default_activities_file}'). Invalid entries: {invalid_codes[:10]}"
                    )

                study = Study(
                    name=study_config.name,
                    name_short=study_config.name_short,
                    description=study_config.description,
                    allow_unlisted_participants=study_config.allow_unlisted_participants,
                    default_language=study_config.default_language,
                    activities_json_url=default_activities_file,
                    data_collection_start=study_config.data_collection_start,
                    data_collection_end=study_config.data_collection_end
                )
                session.add(study)
                session.commit()  # Commit immediately after each study

                # Create day labels
                day_labels_by_name: dict[str, DayLabel] = {}
                for _, day_label_inst in enumerate(study_config.day_labels):
                    display_name = study_config.get_day_label_display_name(
                        day_label_inst.name,
                        study_config.default_language
                    )
                    day_label = DayLabel(
                        study_id=study.id,
                        name=day_label_inst.name,
                        display_order=day_label_inst.display_order,
                        display_name=display_name or day_label_inst.name
                    )
                    session.add(day_label)
                    day_labels_by_name[day_label.name] = day_label

                # Create timelines
                timelines_by_name: dict[str, Timeline] = {}
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
                    timelines_by_name[timeline.name] = timeline

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

                # Ensure participants exist and are associated for hydrated activities
                for participant_id in activities_logged_by_userid.keys():
                    participant = session.exec(
                        select(Participant).where(Participant.id == participant_id)
                    ).first()
                    if not participant:
                        participant = Participant(id=participant_id)
                        session.add(participant)
                        session.flush()

                    existing_association = session.exec(
                        select(StudyParticipant).where(
                            StudyParticipant.study_id == study.id,
                            StudyParticipant.participant_id == participant_id,
                        )
                    ).first()
                    if not existing_association:
                        session.add(
                            StudyParticipant(
                                study_id=study.id,
                                participant_id=participant_id,
                            )
                        )

                # Flush so DayLabel/Timeline IDs exist for hydrated activities
                session.flush()

                # Hydrate activities from settings file
                for participant_id, day_map in activities_logged_by_userid.items():
                    for day_name, entries in day_map.items():
                        day_label = day_labels_by_name[day_name]
                        for activity_item in entries:
                            timeline = timelines_by_name[activity_item.timeline]
                            activity_info = activity_info_by_code.get(activity_item.activity_code, {})
                            activity_name = activity_info.get("name") or f"Code {activity_item.activity_code}"
                            activity_category = activity_info.get("category")
                            activity_color = activity_info.get("color")
                            parent_name = activity_info.get("parent_name")

                            path_parts = [f"timeline:{timeline.name}"]
                            if activity_category:
                                path_parts.append(f"category:{activity_category}")
                            if parent_name and parent_name != activity_name:
                                path_parts.append(f"parent:{parent_name}")
                            path_parts.append(f"activity:{activity_name}")

                            session.add(
                                Activity(
                                    study_id=study.id,
                                    participant_id=participant_id,
                                    day_label_id=day_label.id,
                                    timeline_id=timeline.id,
                                    activity_code=activity_item.activity_code,
                                    start_minutes=activity_item.start_minutes,
                                    end_minutes=activity_item.end_minutes,
                                    activity_name=activity_name,
                                    activity_path_frontend=" > ".join(path_parts),
                                    color=activity_color,
                                    category=activity_category,
                                )
                            )

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