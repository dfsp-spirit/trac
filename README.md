# TRAC -- Time-Use Research Activity Collector


[![Backend Unit Tests](https://github.com/dfsp-spirit/trac/actions/workflows/backend_unit_tests.yml/badge.svg)](https://github.com/dfsp-spirit/trac/actions/workflows/backend_unit_tests.yml)
[![Backend Integration Tests](https://github.com/dfsp-spirit/trac/actions/workflows/backend_integration_tests.yml/badge.svg)](https://github.com/dfsp-spirit/trac/actions/workflows/backend_integration_tests.yml)
[![E2E Tests](https://github.com/dfsp-spirit/trac/actions/workflows/e2e_tests.yml/badge.svg)](https://github.com/dfsp-spirit/trac/actions/workflows/e2e_tests.yml)


TRAC is a web-based research software for time-use research: users can report what they did during one or more days by selecting activities and placing them on one or more timelines per day. E.g., depending on the study, there may be one timeline for 'Primary Activity', and another one for 'Secondary Activity', allowing users to report things like listening to music while riding on the subway.

The frontend is based on [github.com/andreifoldes/o-timeusediary by Andrei Tamas Foldes et al.](https://github.com/andreifoldes/o-timeusediary) but heavily adapted, and the backend was written from scratch.

When using the software in this repo, please also cite [Andrei Tamas Foldes' paper](https://doi.org/10.32797/jtur-2020-1) `Time use diary design for our times - an overview, presenting a Click-and-Drag Diary Instrument (CaDDI) for online application`.


NOTE: Recently the frontend and backend repos were united into this one repo, so for now, you will have to see the [frontend](./frontend/) and [backend](./backend/) directories, and the README files in there, for more details.

## Invitation links and `return_url`

TRAC invitation links can include an optional query parameter named `return_url`.

Example:

`index.html?study_name=default&pid=PARTICIPANT_ID&return_url=https%3A%2F%2Fexample.org%2Ffinish%3Ftoken%3Dabc123`

Behavior:

- TRAC preserves `return_url` while users move from instructions to diary pages, across day navigation, and through final submission/skip flows.
- If `return_url` is present on the final thank-you page, TRAC shows a link with the text `Click here to continue.` instead of the default generic end message.

Encoding rule:

- Encode `return_url` as one query-parameter value using standard percent-encoding.
- Recommended encoders:
	- JavaScript: `encodeURIComponent(rawReturnUrl)`
	- Python: `urllib.parse.quote(raw_return_url, safe='')`
- Do not double-encode the value.

For admins, the backend admin interface also provides a small URL encoder tool at `/admin/tools`.

