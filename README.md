# PeoplePay360 — HR & Payroll

An integrated HR and payroll platform: employee master data, contracts, working
schedules, attendance, time off, salary structures and rules, payruns, payslips,
PDF generation, bulk email and a live payroll dashboard.

**Stack:** React + Vite (JavaScript) · Express + Prisma (JavaScript) · PostgreSQL · Docker

---

## Quickstart

### 🚀 1-Command Startup (Recommended)

Run the entire platform (PostgreSQL, Mailpit, Express API with automatic database migration & seeding, and React Frontend) with a single command:

```bash
docker compose up --build -d
```

- **Application:** http://localhost:5173
- **Mailpit Web Inbox:** http://localhost:8025
- **API Health:** http://localhost:5000/api/health

To stop the containers:
```bash
docker compose down
```

---

### 💻 Manual Local Development (Alternative)

> **Windows note:** clone into a short path such as `D:\odoo-hackathon-2026`.
> Deeply nested paths hit the Windows 260-character limit and `git clone` fails
> with `Filename too long`.

#### 1. Environment files

```bash
cp .env.example .env
cp server/.env.example server/.env
```

Then generate a session secret and put it in `server/.env` as `JWT_SECRET`
(the server refuses to start with a secret shorter than 32 characters):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

#### 2. Start PostgreSQL and Mailpit

```bash
docker compose up postgres mailpit -d
```

Wait until the database reports healthy before running Prisma:

```bash
docker compose ps
```

### 3. Set up the backend and database

```bash
cd server && npm install && npx prisma migrate deploy && npm run seed
```

The seed creates the demo employees and the accounts you sign in with. It is
idempotent, so it is safe to run again after a schema change.

### 4. Start the API

```bash
cd server && npm run dev
```

### 5. Start the frontend (separate terminal)

```bash
cd client && npm install && npm run dev
```

### 6. Open the application

- Application — http://localhost:5173
- Mail inbox (sent payslips) — http://localhost:8025

Sign in with one of the seeded accounts. Every one uses the password
`Password@123` (override it by setting `SEED_PASSWORD` before running the seed).

| Email | Roles | What they see |
| --- | --- | --- |
| `admin@oxp.com` | Admin | Everything, including User Management |
| `nisha@oxp.com` | Payroll Admin | Payroll, plus read access to HR data |
| `sara@oxp.com` | HR Manager | Employees, attendance and time off |
| `neha@oxp.com` | Time Off Admin | Time off only |
| `aarav@oxp.com` | Payroll User | Payroll and the dashboard, read only |
| `john@oxp.com` | Employee | Self service only |

Accounts are created by an administrator: sign in as `admin@oxp.com` and use
**Users** in the navigation. Maya Shah, Rohan Patel and Anita Oliver are seeded
without an account so there is somebody to create one for.

Visit **System** in the top navigation to confirm the browser reaches the API
and the API reaches PostgreSQL.

---

## Layout

```
client/                 React + Vite, JavaScript and JSX
  src/api/              the single fetch wrapper, normalises every error
  src/components/       shared UI: table, form controls, buttons, toasts, modal
  src/hooks/            useResource — loads screen data, aborts stale requests
  src/pages/            one folder-free module per screen
  src/styles.css        the entire stylesheet, no CSS framework

server/                 Express + Prisma, JavaScript, ES modules
  src/app.js            builds and exports the Express app
  src/index.js          environment validation and server startup
  src/lib/              prisma singleton, errors, validation, dates, money
  src/middleware/       session lookup and permission guards
  src/routes/           thin HTTP handlers
  src/services/         Prisma access and transactions
  src/domain/           pure business logic, no Prisma and no Express
  prisma/seed.js        demo employees and the bootstrap administrator
  prisma/schema.prisma  database schema

docker-compose.yml      PostgreSQL 16 and Mailpit
```

## HR records

An **employee** is the person. A **contract** is the agreement that gives them a
wage for a period, and an employee accumulates contracts over time; payroll
reads the one covering the payslip period, which is why history is kept rather
than overwritten. The server refuses a second *running* contract overlapping an
existing one, because payroll would then have no single wage to use — save it as
a draft, or end the first contract.

A **working schedule** is a weekly pattern of days. Days per week and hours per
week are never stored: `server/src/domain/schedule.js` derives them from the
lines, so the summary on the list can never disagree with the pattern on the
form. Times are minutes from midnight, since a pattern has no calendar date.

Contract references such as `CON/2026/0042` come from the `Sequence` counter,
incremented inside the same transaction that writes the contract, so two
simultaneous requests can never be handed the same number.

---

## Attendance

A check-in is stored as an **instant**; the **business day** it belongs to is
computed separately, in `COMPANY_TIMEZONE`. Both are needed — the instants are
what worked hours are measured from, the day is what every report groups by —
and deriving the day from the server's own clock would file a 00:30 check-in in
Mumbai under the previous day.

Worked hours, present-or-late and overtime are all derived in
`server/src/domain/attendance.js` and never typed in: lateness is a check-in more
than 10 minutes past the schedule's start for that weekday, and overtime is the
hours beyond what the schedule expects that day. An employee with no working
schedule is never late and never in overtime, because there is nothing to
measure against.

The widget in the top bar is the employee's own: red dot when no session is
running, green while checked in. Its elapsed time ticks in the browser from the
check-in instant rather than being polled. Attendance records are corrected
rather than deleted, so a correction stays visible — the dashboard reports how
many records were touched by hand.

---

## Time off

Three records, in the order they matter. A **type** is the policy: the unit
(days or hours), whether requests must draw on an allocation, and who approves
them. An **allocation** grants balance to one employee for one type — and only
an *approved* allocation grants anything. A **request** consumes that balance
when it is approved.

Taken and remaining are never stored. `server/src/domain/timeoff.js` sums them
from the approved requests linked to an allocation, so refusing an approved
request returns its days immediately, with no counter to adjust and nothing to
drift.

Duration is derived the same way: working days between the dates, taken from
the employee's working schedule, so a weekend inside a range is not charged as
leave and a request covering only a weekend is rejected rather than recorded as
zero. An hours type counts the hours the schedule expects on those days instead.

Approval is where the rules bite. A request of a type that requires an
allocation is only approvable against an approved allocation that covers its
dates and still has enough left, and the allocation used is recorded on the
request so the screen can name the balance it came out of. Two approved leaves
may not cover the same day. Allowed status moves are declared as data, so a
stale page cannot re-approve a refused request.

---

## Payroll

A **salary structure** is an ordered set of **salary rules**, and that order is
the calculation: HRA can be a percentage of basic only because basic ran first,
gross sums the categories the rules above it filled in, and net subtracts the
deductions below that. Every rule declares a category, which is what makes those
totals possible without the engine guessing from rule names.

A rule computes in one of three ways. **Fixed** is the exact value entered.
**Percentage** is a percentage of a chosen base — contract wage, basic, or gross.
**Formula** is an expression, for everything the first two cannot say:
attendance-proportioned pay, overtime, unpaid-leave deductions, arithmetic across
several rules.

Formulas are parsed and evaluated by `server/src/domain/formula.js`, never by
`eval` or `new Function`. Those would hand anybody who can edit a salary rule the
ability to run arbitrary code in the server process. The evaluator can only
produce a number: no property access, no loops, no globals, and lookups read only
a table's own keys, so `categories['constructor']` finds nothing. A formula may
read `wage`, `worked_days`, `total_days`, `unpaid_days`, `leave_days`,
`overtime_hours`, `worked_ratio`, `categories['CODE']`, `rules['CODE']`, and the
functions `min`, `max`, `round`, `abs`, `floor`, `ceil`.

A **payrun** is one period. Creating one takes two steps, and the first creates
nothing — a payrun is the employees in it, so it exists only once they are
chosen. Only employees with a contract covering the period are offered: without
one there is no wage to compute from.

The workflow is Draft → Compute → Validate → Mark Paid. Validation refuses while
any payslip still carries a warning, because warnings — a missing bank account, a
duplicate payslip, a missing contract — are exactly what somebody is meant to
look at before payroll is finalised. A paid payrun is historical data: it is
never recomputed, since rerunning it against rules edited since would rewrite
what people were actually paid.

Payslips are generated as PDFs with pdfkit and emailed through Mailpit, so the
send is a real SMTP conversation with a real attachment, demoable offline. Read
what was sent at http://localhost:8025.

---

## Dashboard

One endpoint builds every block, so a department filter narrows the same
employee set for all of them rather than each card fetching its own version of
"the employees". Nothing on it is a constant: an empty period shows zeroes.

Two figures are worth explaining. **Salary cost by department** reads the
payslips for the period, and falls back to running contract wages when payroll
has not been run yet — otherwise the chart would be empty for exactly the period
somebody is about to pay. **Attendance coverage** measures only the days that
have already happened, because measuring a month in progress against its whole
length reports every current period as badly covered and hides the ones that
really are incomplete.

Charts are inline SVG and CSS. A charting library would ship more code to the
browser than four shapes are worth.

---

## Access control

A user account belongs to an employee and holds one or more roles. Roles are
not checked directly: `server/src/domain/roles.js` maps a role set to a set of
permission strings, the API guards each route with a permission, and the same
set is sent to the browser so the navigation only offers what the account can
actually open. Because the mapping exists once, the menu and the API can never
disagree. Nobody may change the roles or the status of their own account.

---

Business rules live in `server/src/domain/`. Those modules import neither Prisma
nor Express, which is what lets the payroll calculations, the leave balances and
the attendance derivations be unit tested without a database — `npm test` in
`server/` runs them in under a second.

---

## Commands

**Server** (`cd server`)

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the API with automatic restart on file changes |
| `npm start` | Start the API once |
| `npm test` | Run the test suite (Node's built-in test runner) |
| `npm run test:watch` | Re-run tests on change |
| `npm run prisma:migrate` | Create and apply a migration during development |
| `npm run prisma:deploy` | Apply existing migrations (setup and CI) |
| `npm run seed` | Create the demo employees and sign-in accounts |
| `npm run prisma:studio` | Browse the database |

**Client** (`cd client`)

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server on port 5173, proxying `/api` to port 5000 |
| `npm run build` | Production build |
| `npm run preview` | Serve the production build locally |

---

## Troubleshooting

**Port 5432 or 5433 already in use.** Change `POSTGRES_PORT` in `.env` and update
the port in `DATABASE_URL` in `server/.env` to match.

**"Can't reach database server" right after `docker compose up -d`.** PostgreSQL
takes a few seconds to accept connections on first launch. Run `docker compose ps`
and wait for `(healthy)`, then retry.

**"Cannot find module '@prisma/client'".** Run `npx prisma generate` in `server/`.
This also runs automatically as a `postinstall` step after `npm install`.

**The server exits immediately on start.** It validates its environment before
listening and prints exactly which variable is missing or invalid. The usual
cause is a missing `server/.env` or a `JWT_SECRET` shorter than 32 characters.
