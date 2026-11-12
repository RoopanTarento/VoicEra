# Campaign naming, duplicates, uploads and analysis

## Standard names

Campaign and contact list names follow one set of rules (`apps/api/app/services/naming.py`, mirrored in `frontend/src/lib/naming.ts` so people see problems while typing):

* Spaces are trimmed and collapsed; 3 to 80 characters.
* Letters and digits in any script (Hindi and other Indian scripts work) plus `- – — _ . , & ( ) / : ' # +`. No emoji, quotes or control characters, which break CSV exports and file names.
* Unique in the organisation, ignoring capital letters. A taken name is refused with a free alternative: `A campaign called "Ward 12" already exists. Try "Ward 12 (2)".`
* Suggested pattern: what and where, then when, e.g. "Kharif advisory – Belagavi – Nov 2026".

Applied on campaign create, rename, redial and duplicate, and on contact list upload and rename. Existing names aren't changed.

**Files.** Uploaded file names are never trusted: a list stores the standard form (`Ward 12 – Wave 1 (final).XLSX` → `ward-12-wave-1-final.xlsx`) and keeps the original as `original_filename` for display. Downloads the dashboard saves are named `voicera_<subject>_<kind>_<YYYY-MM-DD>.<ext>`, e.g. `voicera_ward-12-drive_report_2026-11-11.csv`.

## Upload guidelines

"Upload guidelines" sits next to every list upload (page header and upload dialog), from `GET /contact-lists/rules` (`lists:read`): CSV or Excel (first sheet), UTF-8, up to 10 MB and 50,000 rows, headers in row one, a `phone_number` column (or phone / mobile), numbers with country code, Excel column formatted as Text, repeats and invalid rows reported by row, standard file names, no ID numbers. The dialog also rejects files over the limit before uploading and shows the file's size.

## Duplicate a campaign

`POST /campaign/{id}/duplicate` (`campaigns:write`, Super admin) creates a new campaign in the Created state with the same agent, contact list, pace, retries and schedule. Calls, results and redial history are not copied. Without a name it is called "X (copy)", then "X (copy 2)" …; a copy of a copy doesn't stack suffixes. The Campaigns page has a Duplicate button on each campaign that opens a dialog with the suggested name (editable, checked live).

## Analysis & calendar

The Campaigns page has two tabs: **Campaigns** and **Analysis & calendar** (`analytics:read`, so every role sees numbers; phone numbers stay masked and transcripts follow the usual role rules).

* **Period:** Day, Month, Year or Custom (up to 400 days), with previous/next and Today, plus campaign and agent filters. All days are India time.
* **Headline numbers:** calls made and active days, answer rate, campaigns that placed calls, average duration and talk time, problems reported and calls that switched path.
* **Views:** Month = a calendar shaded by call volume, each day showing calls, answer rate and its campaigns; Year = every day of the year as a heatmap, each month clickable; Day = calls by hour; Custom = calls per day.
* **Drill-down:** click a day → its campaigns → a campaign's calls that day (time, masked number, outcome, duration, status) → the call's details (transcript, analysis). A breadcrumb leads back. "Campaign results (all time)" opens the campaign's full results.
* Below: outcome and problem-type bars for the period, and a table of the campaigns in it.

A campaign shows on every day it placed calls, not only the day it started.

API:

* `GET /campaign/insights?from=YYYY-MM-DD&to=YYYY-MM-DD[&tz=Asia/Kolkata][&campaign_id=][&agent_id=]` → `totals`, `outcomes`, `issues`, `days` (with each day's campaigns), `hours` (24 local hours), `campaigns`, `truncated` (over 200,000 calls). Errors: dates in the wrong form, end before start, more than 400 days, unknown time zone.
* `GET /calls/org/{org_id}` now also takes `campaign_id`, `date_from`, `date_to` (local days, inclusive) and `tz`, filtered on the server, so a campaign's calls are no longer limited to the newest 500.

Code: `apps/api/app/services/campaign_insights.py`, `frontend/src/components/dashboard/CampaignAnalysis.tsx`. Tests: `apps/api/tests/test_campaign_insights.py`.
