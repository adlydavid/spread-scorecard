# Spread Scorecard

Footbridge's monthly report of spread (gross profit) and Bullhorn activity, by account manager and recruiter. This is the local copy of the scorecard on claude.ai. It includes all data through **October 14, 2026**: Shelley's Weekly Spread Dashboard for the week ending 09.26.26, plus Bullhorn activity as of Oct 14.

## Run it

You need Node.js 22 or newer (check with `node -v`; install from nodejs.org if needed).

```bash
cd spread-scorecard
npm install      # first time only
npm run dev      # starts the app and opens it in your browser (http://localhost:5173)
```

To stop it, press `Ctrl + C` in the terminal.

Other commands:

| Command | What it does |
|---|---|
| `npm run dev:netlify` | Runs the site **with** the admin upload working, at http://localhost:8888 (see *Weekly upload* below) |
| `npm run build` | Builds the site into `dist/` |
| `npm run preview` | Serves the built `dist/` folder to check it before deploying |

## Using the app

- **Sales / Recruiting** tabs switch between the account manager view and the recruiter view. Michael Salemi, Connor Rogers and Kyle Driscoll (commercial users) aren't listed; their spread stays in the company total. The list is `EXCLUDED` at the top of `src/main.js`.
- **Primes** (top of Sales and Recruiting): every federal client we have someone billing at on the latest spread report, with that month's Bullhorn job orders, client visits, submittals, interviews and deals, and the week's GP. Clients are linked to Bullhorn through each consultant's Placement ID; report clients that share a Bullhorn company (BAE Space and BAE - GEO) show as one row. *+ commercial* marks a company that also has commercial placements, so its Bullhorn activity covers both.
- **Run rate**: the latest weekly report's revenue for the week × 52, in $MM.
- **Recontacting**: everyone billing on the latest report, with their last attempted contact and last note of substance in Bullhorn, most overdue first. Green ≤ 30 days, amber 31–60, red over 60.
- **Spread**: the latest report broken down: run rate, weekly and month-to-date totals, by client, line of business, employment type, account manager and recruiter, weekly totals across uploads, and every consultant (bill and pay rates, hours, revenue, GP, GP/hour). Each table downloads as CSV.
- **Month**: pick one from the dropdown, or click a bar in the *Spread by month* chart. Months are Shelley's payroll months: Sunday-to-Saturday weeks in a 5-4-4 pattern per quarter (so April runs to May 2).
- **Month to date**: after a mid-month upload ("Week 2 of 5"), that month's spread is labelled *month to date*, its bar is shaded with "MTD", and the Spread tile shows what it's on pace for instead of a change vs last month.
- **Sort**: click any column header. Click it again to reverse the order.
- **Find a name** filters the table and the deals list.
- **Show former staff** adds people who have left.
- **Ratio colors** compare each person with the team: green means at or better than the team, amber means up to 50% worse, red means more than 50% worse. Ratios are activity per deal, so lower is better. Fill % is better when higher.
- **Deals this month** at the bottom lists each placement. **How each number is counted** gives the definitions.

## Folder layout

```
index.html                  page markup
src/admin-panel.js          admin panel: sign in, drop the weekly Excel file, preview, publish, undo (loaded only when opened)
src/main.js                 app logic (loads data from public/data, then any uploads from /api/data)
src/style.css               styles (light and dark mode)
shared/spread-import.js     reads the Weekly Spread Dashboard and applies it to a month (used by the page and the server)
netlify/functions/          the upload API (admin.mjs), the uploaded data (data.mjs), and the Bullhorn sync
                            (bullhorn-scheduled.mjs on a timer, bullhorn-sync-background.mjs for Sync now)
netlify/lib/auth.mjs        admin sign-in check (credentials come from environment variables)
netlify/lib/bullhorn*.mjs   Bullhorn sign-in, the pull, and saving the rebuilt months
shared/bullhorn-build.js    turns Bullhorn records into month activity (port of tools/refresh.py's build); the staff roster lives here
public/data/index.json      list of months the app loads
public/data/meta.json       which spread report and Bullhorn date the data comes from
public/data/months/*.json   one file per payroll month: sales rows, recruiting rows, deals
data-exports/*.csv          the same numbers as spreadsheets (open in Excel)
source-data/bullhorn/*.json raw Bullhorn pulls used to build the numbers
source-data/bullhorn/call_counts_by_month.json   call totals per person per month
source-data/payroll_months.json                  payroll month date ranges
tools/refresh.py            the script the weekly claude.ai refresh uses to rebuild a month
netlify.toml                Netlify build settings
```

Raw Bullhorn files in `source-data/bullhorn/`:

| File | Bullhorn data |
|---|---|
| `js*.json` | Job submissions (send outs and submittals) |
| `jo*.json` | Job orders |
| `pl*.json` | Placements (deals and starts) |
| `mt*.json` | Meeting notes (client visits) |
| `iv*.json` | Interview, Interview Prep and Interview Debrief notes |

## Weekly upload (admin)

Each week, click the small **Admin login** button in the bottom-right corner of the scorecard, sign in, and drag in the Excel attachment from the Weekly Spread Dashboard email. Once signed in, the button reads **Upload** for the rest of the browser session. (`/admin.html` and `/?admin` open the same panel.)

The panel's **This week** box shows which report is on the scorecard now (week ending, month, week X of Y) and which week and month the next report should cover.

1. The page reads the **Dashboard - Month To Date** sheet: week ending, revenue, gross profit, and the AE and Recruiter gross profit tables.
2. It shows a **preview** before anything changes: which payroll month the report belongs to, whether it's month to date ("week 2 of 5") or the full month, checks that both tables add up to gross profit, any names that are new to the scorecard, and each person's spread now vs after the upload.
3. **Publish** makes it live for everyone right away; no redeploy. The scorecard behind the panel refreshes, and **View … on the scorecard** jumps to that month.
4. **Recent uploads** lists what was published. **Undo** puts that month back the way it was before the upload (for the newest upload of each month).

### Monthly targets

In the same panel, **Monthly targets** sets a team spread target and, optionally, a target per person. Amounts are per 4-week month; with the box ticked, 5-week months (Jan, Apr, Jul, Oct) get ×1.25. Each save applies **from the month you choose** until a later save, so raising the target in November doesn't rewrite how September looks.

With targets set, the scorecard shows a progress bar under the Spread tile ("98% of $600k target", plus "on pace for" during a month-to-date month), a green target line on each month of the chart, and a **% of target** column when anyone on that tab has a personal target. Periods compare against the sum of their months' targets. With no targets saved, none of this appears.

The upload also saves the rest of the report: the week's totals from *Dashboard - Weekly*, every consultant on the *Detail* sheet, and the client table on *Dashboard - Month To Date*. After publishing, the panel starts a Bullhorn sync so Primes and Recontacting update within a minute.

The spreadsheet only carries **spread**. Calls, visits, job orders, send outs, interviews and deals still come from Bullhorn. A month added only by upload (say, the first November report) shows spread with zero activity until Bullhorn data for it is added.

Uploads are saved in Netlify Blobs and loaded on top of the files in `public/data/`. Replacing those files later doesn't remove an upload for the same month; use **Undo** first if you want the file to win.

### Admin sign-in

The username and password live in environment variables, not in the site's code:

| Variable | Value |
|---|---|
| `ADMIN_USER` | the admin username |
| `ADMIN_PASSWORD` | the admin password |
| `SESSION_SECRET` | any long random string (signs the 8-hour sign-in) |

- **Locally**: they're in `.env` (not committed; `.env.example` shows the format). It's set to `admin` / `admin`.
- **On Netlify**: add the same three under *Site configuration → Environment variables*, then redeploy. Without them the sign-in form says sign-in isn't set up.

`admin` / `admin` is the first thing anyone would guess, and the panel can change what the whole team sees. Use a real password on the live site.

### Running it locally

`npm run dev` still works for the scorecard, but the upload needs the Netlify functions, so use:

```bash
npm run dev:netlify   # http://localhost:8888, then the Admin login button
```

The first run downloads the Netlify CLI. Local uploads are stored in `.netlify/` on your machine and never reach the live site.

If the admin panel says *"The upload service isn't running here"*, the page was opened from `npm run dev` (port 5173/5199) instead of `npm run dev:netlify` (port 8888). If `npm run dev:netlify` exits with an npm error, delete the folder named in the error under `~/.npm/_npx/` and run it again. The script sets `SHARP_IGNORE_GLOBAL_LIBVIPS=1` so the CLI still installs on Macs that have Homebrew's `vips`.

## Updating the data from Bullhorn

The site pulls activity straight from the Bullhorn REST API: **submittals, interviews and placements** (plus send outs, starts, job orders and client visits). It rebuilds the previous and current payroll month and saves them alongside the uploads, so the scorecard updates without a redeploy. Spread is never changed by a sync; it still comes from the weekly upload.

- **Automatically**: weekdays at about 7am and 6pm Eastern (`netlify/functions/bullhorn-scheduled.mjs`).
- **On demand**: in the admin panel, **Bullhorn activity → Sync now**. The panel shows the last sync and each month's submittals, interviews, placements, starts, job orders and calls.

The Bullhorn API credentials are environment variables, never in the site's code:

| Variable | Value |
|---|---|
| `BULLHORN_CLIENT_ID` | OAuth client id |
| `BULLHORN_CLIENT_SECRET` | OAuth client secret |
| `BULLHORN_USERNAME` | the API user (`footbridgeconsulting.api`) |
| `BULLHORN_PASSWORD` | the API user's password |

Locally they're in `.env`; on Netlify add them under *Site configuration → Environment variables*. A sync takes about 10–15 seconds, so **Sync now** runs as a Netlify background function.

New staff: add their last name and full name to `FULL` and to `SALES` or `RECR` in `shared/bullhorn-build.js`. The panel warns about people with activity who aren't on the roster.

## Live site

**https://footbridge-spread-scorecard.netlify.app** (Netlify project `footbridge-spread-scorecard`, linked to this folder). Deploy changes with:

```bash
SHARP_IGNORE_GLOBAL_LIBVIPS=1 npx netlify-cli@27.10.2 deploy --build --prod
```

Data lives in the site's Netlify Blobs store, not in the deploy, so a redeploy never touches it. To rebuild past months from Bullhorn: `NETLIFY_SITE_ID=… NETLIFY_AUTH_TOKEN=… SITE_URL=… node --env-file=.env tools/backfill.mjs 2026-01 2026-08`.

## Putting it on Netlify

The admin upload needs Netlify Functions, so deploy from Git or the Netlify CLI. Dragging `dist/` onto app.netlify.com/drop publishes the scorecard only, without the upload's backend.

1. Push this folder to a **private** Git repo and connect it in Netlify (or run `npx netlify-cli deploy --build --prod` from this folder). `netlify.toml` sets the build command, publish folder, functions folder and Node 22.
2. Add `ADMIN_USER`, `ADMIN_PASSWORD`, `SESSION_SECRET` and the four `BULLHORN_*` variables in the site's environment variables.
3. Turn on Netlify password protection (or another access control) for the whole site.

Keep the site private. The Spread and Recontacting tabs show pay rates and candidate notes; they're served by `/api/data` from Netlify Blobs and never written to the repo. The data includes everyone's spread, and `source-data/` includes candidate names and pay and bill rates. Don't push this folder to a public repo.

## How the numbers are counted

- **Spread**: gross profit from Shelley's Weekly Spread Dashboard, credited to each consultant's account manager (A/E) and recruiter (R/M). Monthly totals match her report.
- **Calls**: not shown for now. Nooks logs only some reps' dials into Bullhorn, so a Bullhorn call count would undercount. They come back once Nooks data can be read directly.
- **Client visits**: New, Existing and In-Person Meetings logged against a client contact, all combined.
- **Job orders**: new job orders by owner. MIT Lincoln Laboratory reqs loaded by the web import are credited to Hannah Wilkinson.
- **Send outs**: candidates submitted against the account manager's job orders. **Submittals**: the same submissions, credited to the recruiter who sent them.
- **Interviews**: candidates with an interview-type note, counted once per candidate per week.
- **Deals / Placements**: placements created during the month. **Starts**: placements starting in the month, excluding Never Started.
- **Ratios**: send out : deal, visit : deal, submittal : deal and interview : deal. **Fill %** is deals ÷ job orders.
