// @ts-check
import { getActivityTimeRangeMinutes } from './utils.js';

export class Timeline {
  /**
   * @param {string} key
   * @param {Record<string, any>} [metadata]
   */
  constructor(key, metadata = {}) {
    this.key = key;
    this.name = metadata?.name || '';
    this.description = metadata?.description || '';
    this.mode = metadata?.mode || 'single-choice';
    this.minCoverage = metadata?.min_coverage || 0;
    this.categories = metadata?.categories || [];
    this.activities = [];
  }

  addActivity(activity) {
    if (!activity.startTime || !activity.endTime) {
      throw new Error('Activity start time and end time must be defined');
    }
    this.activities.push(activity);
  }

  removeActivity(activityId) {
    const index = this.activities.findIndex((a) => a.id === activityId);
    if (index !== -1) {
      return this.activities.splice(index, 1)[0];
    }
    return null;
  }

  getActivities() {
    return [...this.activities];
  }

  clear() {
    this.activities = [];
  }

  isComplete() {
    // Implementation depends on timeline requirements
    return false;
  }

  validate() {
    // Compare absolute minutes-of-day, never Date objects: activities carry
    // display strings like "07:30" or "00:30(+1)", and `new Date("07:30")` is an
    // Invalid Date (NaN) in every engine - so the overlap check below could
    // never fire and the callers' "revert the drag" path was dead code.
    const activities = window.timelineManager.activities[this.key] || [];

    const ranges = activities
      .map((activity) => ({
        activity,
        range: getActivityTimeRangeMinutes(activity),
      }))
      .filter((entry) => entry.range !== null)
      .sort((a, b) => a.range.startMinutes - b.range.startMinutes);

    for (let i = 0; i < ranges.length - 1; i++) {
      const current = ranges[i];
      const next = ranges[i + 1];

      if (current.range.endMinutes > next.range.startMinutes) {
        throw new Error(
          `Timeline validation failed: Overlap detected between activities "${current.activity.activity}" and "${next.activity.activity}"`
        );
      }
    }

    return true;
  }
}
