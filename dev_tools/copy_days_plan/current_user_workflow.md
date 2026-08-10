

## TRAC -- old user workflow to enter activities into a diary study

### Background on TRAC

TRAC has studies that span several days. Each day has one or more timelines, e.g., "primary activity timeline" and "secondary activitiy done in parallel timeline". Users place activity blocks with a start and end time on the timnelines to document what they did during the day for time use research. The timelines may enforce that users fill in a certain amount of minutes (min_coverage), to prevent users from providing bad quality data.


### Old workflow

* The old workflow was based on guiding users through the days of the study day after day
* Users open diary, they are on first study day. app checks for existing activities in db for user+study (to edit previous entries), loads if needed, but typically empty here. They enter data into first timeline, client checks min coverage, and allows moving to second one once it is met (if any min coverage on that timeline). Users repeats for next timeline(s).Users can go back to previous timelines and edit data if needed. Once all timelines are ready (mion coverage met), a  button to submit the day becomes active.
* when clicked, data gets stored in database. the database/backend checks prior to saving whether the data fullfills min coverage. the day gets advanced to next day. once more, frontend checks backend for data for that day. but now, on days with day_index > 0, there is a twist: if that day has no data yet in database (no returning user, first time filling out), the backend sends to the frontend template data that is copied from the acvtivities they have saved in the database (from seconds ago most likely) and sends them as templates. they only live in frtonend for now: the user can see them, edit them, etc. The template feature serves to speed up the data collection for the user, and is intended to reduce dropout in the scientific study. The user then saves the day, and things continue like this.
* On the last day, the button for submitting the day submits the day and sends the user on to the next page of the flow that does not collect activity data anymore (e.g., a Thank you page)


