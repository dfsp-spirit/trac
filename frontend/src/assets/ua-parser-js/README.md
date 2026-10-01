# Vendored: ua-parser-js

Browser/device detection used to record whether TRAC works across different
devices (see `frontend/src/js/client_info.js`).

| | |
|---|---|
| Package | `ua-parser-js` |
| Version | `1.0.41` (last MIT-licensed release) |
| License | MIT — see `LICENSE.md` |
| Source | https://unpkg.com/ua-parser-js@1.0.41/dist/ua-parser.min.js |
| SHA-256 | `506462f545eb810192aa0cd26fd880d7234c62d0878969cc079981481d9fa2ea` |
| Loaded | Classic `<script>` tag in `index.html`; exposes the global `UAParser` |

## Why 1.x and not 2.x

`ua-parser-js` 2.x is licensed **AGPL-3.0-or-later**. Serving the app to users
triggers AGPL's network clause, which would impose source-disclosure obligations
on TRAC. The 1.x line stays MIT and covers browser/engine/OS/device/CPU
detection, which is all this feature needs. 2.x additionally offers Client Hints
and bot detection — if that ever becomes necessary, revisit the licence question
first (a commercial licence is the alternative to AGPL).

## Updating

Renovate does not manage vendored files, so update manually:

1. Download the new `dist/ua-parser.min.js` from the pinned version.
2. Verify the SHA-256 and confirm the version header at the top of the file.
3. Replace `ua-parser.min.js` and update the table above.
4. Keep the version in `client_info.js` (`PARSER_VERSION`) in sync — it is
   exported per participant so stored records stay interpretable.
5. Do **not** upgrade to a 2.x release without a licence decision.
