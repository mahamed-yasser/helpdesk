# HelpDesk

Support ticket desk with business-hours SLA timers, priorities, assignment, internal notes and breach tracking.

![HelpDesk screen](docs/01-dashboard.png)

![HelpDesk second screen](docs/03-ticket-detail.png)

<img src="docs/04-mobile-dashboard.png" alt="HelpDesk on a phone" width="320">

_Screenshots of the running app with fictional demo data (captured from the real app in Chrome)._

**Status: local demo, fictional data, not security-reviewed.**

## Features
- Tickets with priority, status, assignee, notes
- SLA due times computed over business hours (Mon-Fri, fixed UTC hours)
- Breach and at-risk dashboard
- Persistent sqlite storage

## Run
Requires Node 22+ (no npm install needed).

    node server.js        # http://127.0.0.1:3000 (PORT overrides; HOST is loopback unless you set it)
    npm test              # unit and API tests
    npm run e2e           # browser test, needs google-chrome
    node docs/overflow-check.js   # phone layout: no sideways page scroll at 390 and 320 px

First run: open the page and create the owner account (username, name, password of 10+ characters). There is no built-in or default account. Setup works once per database; after that it is a normal sign-in.

## Honest limits
- Fictional seed data, local use only.
- Not security-reviewed. No HTTPS, no password reset, a single owner role. Do not expose it to a network without a reverse proxy with HTTPS and your own review.
- Tests and browser checks create a throwaway owner with a random in-memory password; nothing credential-like is stored in the repo.
- SLA targets and business hours are demo policy values, not a contractual or legal commitment.
- No public holidays in SLA calculation; no email intake.
- Data lives in a local sqlite file; back it up yourself.
