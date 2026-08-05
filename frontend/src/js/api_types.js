/**
 * JSDoc typedefs for the TRAC backend REST API response shapes.
 *
 * These describe the JSON returned by the FastAPI backend (see
 * backend/src/o_timeusediary_backend/api.py). Keeping them in sync with the
 * backend models lets the type checker catch contract mismatches at the API
 * boundary (e.g. a field renamed or added on one side but not the other).
 *
 * This module has no runtime code; it exists only to be referenced via
 * `import('./api_types.js').SomeType` in JSDoc annotations.
 *
 * @module api_types
 */

/**
 * One day label from the study-config response.
 * @typedef {Object} ApiDayLabel
 * @property {string} name                  e.g. "monday"
 * @property {number} display_order         e.g. 0
 * @property {string} [display_name]        default-language display name
 * @property {Record<string,string>} [display_names]  per-language map, e.g. {"en":"Monday","sv":"Måndag"}
 */

/**
 * One timeline definition from the study-config response.
 * @typedef {Object} ApiTimeline
 * @property {string} name                  timeline key, e.g. "primary"
 * @property {string} display_name
 * @property {string} [description]
 * @property {string} mode                  "single-choice" | "multiple-choice"
 * @property {number} [min_coverage]
 */

/**
 * Study configuration response: GET /api/studies/{study}/study-config.
 * @typedef {Object} StudyConfigResponse
 * @property {string} study_name
 * @property {string} study_name_short
 * @property {string|Record<string,string>|null} [description]
 * @property {boolean} allow_unlisted_participants
 * @property {boolean} require_consent
 * @property {boolean} allow_skip_timeuse
 * @property {boolean} require_diary_before_external_tasks
 * @property {string} default_language
 * @property {string} selected_language
 * @property {string[]} supported_languages
 * @property {string} activities_json_url
 * @property {string} [study_text_intro]
 * @property {string} [study_text_end_completed]
 * @property {string} [study_text_end_skipped]
 * @property {string} [study_text_end_noconsent]
 * @property {string} [study_text_consent]
 * @property {string} [study_text_instructions]
 * @property {number} study_days_count
 * @property {ApiDayLabel[]} day_labels
 * @property {ApiTimeline[]} timelines
 * @property {number} [inactivity_timeout_minutes]
 * @property {number} [inactivity_timeout_stress_time_left]
 * @property {Record<string,string>|null} [inactivity_page_custom_text]
 * @property {Array<Record<string,unknown>>|null} [footer_links]
 * @property {boolean} [hide_server_wide_links]
 * @property {boolean|null} [consent_given]
 * @property {string|null} [consent_decided_at]
 * @property {boolean} [instructions_completed]
 * @property {string|null} [instructions_completed_at]
 * @property {boolean} [participant_has_completed_study]
 * @property {Array<Record<string,unknown>>} [external_tasks]
 * @property {boolean} [all_external_tasks_confirmed]
 */

/**
 * A single activity (or template activity) in the participant-activities response.
 * @typedef {Object} ApiActivity
 * @property {string} timeline_key
 * @property {string} timeline_display_name
 * @property {string} timeline_mode
 * @property {string} activity
 * @property {number} activity_code
 * @property {string|null} [frequency_key]
 * @property {string} [color]
 * @property {string} [category]
 * @property {number} [parent_activity_code]
 * @property {string} activity_path_frontend
 * @property {number} start_minutes
 * @property {number} end_minutes
 * @property {string} start_time
 * @property {string} end_time
 * @property {number} duration
 * @property {string} created_at
 * @property {number|null} activity_id_backend   null for template activities
 * @property {boolean} [is_template_from_previous_day]
 * @property {string} [template_source_day_label]
 * @property {number} [template_source_day_index]
 * @property {number} [day_label_index]
 * @property {string} [day_label]
 */

/**
 * Participant activities response: GET .../participants/{pid}/activities.
 * @typedef {Object} ActivitiesResponse
 * @property {string} study
 * @property {number} study_days_count
 * @property {number[]} day_indices_with_data
 * @property {number[]} day_indices_meet_min_coverage
 * @property {string} participant
 * @property {string} day_label
 * @property {number} day_label_index
 * @property {string} day_display_name
 * @property {string[]} timelines_in_study
 * @property {number} total_activities
 * @property {boolean} has_template
 * @property {string|null} template_source_day_label
 * @property {number|null} template_source_day_index
 * @property {ApiActivity[]} activities
 * @property {ApiActivity[]} template_activities
 */

/**
 * Cross-user template copy response: POST /api/template-activities.
 * @typedef {Object} TemplateCopyResponse
 * @property {number} copied_days_count
 * @property {number} skipped_days_count
 * @property {number[]} copied_day_indices
 * @property {number[]} skipped_day_indices
 */

export {};
