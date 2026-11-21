# The scheduler

This is for drafts the board posts through X's API. Drafts you schedule yourself in X's composer don't need it
(X posts those; the board just moves them to Posted once their time passes).

Scheduled drafts are posted by `GET /api/cron/publish`, which posts everything that's due. It needs
`Authorization: Bearer <CRON_SECRET>`, so set `CRON_SECRET` to a long random string (`openssl rand -hex 32`).

Something has to call it. Pick one:

| Option | How often | Setup |
|---|---|---|
| **Vercel Schedules** (default, in `vercel.json`) | every 15 min on Hobby (posts can be up to ~15 min late, plus jitter; Hobby is for non-commercial use); every minute on Pro | Nothing: deploying with `vercel.json` sets it up. Vercel sends `CRON_SECRET` itself. On Pro, change the schedule to `* * * * *` and add `"jitter": 1` for on-the-minute posts. |
| **cron-job.org** (free) | every minute | Create a job for `https://YOUR-DOMAIN/api/cron/publish`, method GET, header `Authorization: Bearer <CRON_SECRET>`. |
| **GitHub Actions** | every ~5 min (GitHub may delay it) | Copy `docs/github-actions-scheduler.yml` to `.github/workflows/`, add repo secrets `APP_URL` and `CRON_SECRET`. GitHub pauses scheduled workflows in repos with no activity for 60 days. |

On top of that, whenever anyone has the board open, it posts due drafts within about a minute, so a team that works in
the board rarely waits on the scheduler.

Settings → Scheduler shows the last run. Vercel Schedules is in beta; if your plan or region doesn't have it yet, use
the classic cron instead: replace the `schedules` block in `vercel.json` with
`"crons": [{ "path": "/api/cron/publish", "schedule": "0 9 * * *" }]` (Hobby allows one run a day, Pro every minute),
or use one of the other options above.

Times are picked in each person's own time zone and stored in UTC.
