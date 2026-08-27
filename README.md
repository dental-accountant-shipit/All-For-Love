# All for Love — Projects

Project management and profitability for All for Love London.

A standalone All for Love application. It shares no architecture, terminology,
branding or business logic with the MTD, Quarterly Review, Dental Accountant or
any other Fortuous system, and it runs in its own Firebase project.

**Reference workbooks, design documents and exports live in Google Drive
(`All for Love Ltd/Budget App`), never in this repository.** `.gitignore`
excludes `.xlsx` / `.xlsm` so a workbook cannot be committed by accident.

---

## What it is for

All for Love build event budgets in Excel, copy the file each time the budget
changes, and reconcile actual supplier costs against it by hand. The workbook
works until it doesn't: version 14 of one project's budget contains a
£36,820 cost understatement, an £80,077 error in the VAT-inclusive total, and
£33,958 of delivered client work that appears in no total at all.

This system replaces that with four figures per line that always agree —
**Budget · Committed · Actual · Forecast** — and a profit figure nobody types
in.

The design principle throughout: *the client sees simplicity, the system
handles complexity underneath.* Someone comfortable with Excel and
uncomfortable with accounting software should be able to build a budget here
with no training. It is deliberately **not** a browser copy of the workbook.

---

## Structure

```
src/
  domain/           Pure calculation core. No React, no Firebase, no I/O.
    types.ts        Every Firestore document shape
    money.ts        Integer pence, GBP formatting, safe margins
    forecast.ts     Per-status forecast rules, commitments, overrides
    revenue.ts      Revenue composition, commission
    rollup.ts       Cost item → sub-event → project
    __tests__/      31 tests, including the full worked example
  lib/
    brand/          Brand tokens — placeholders, sampled from the live website
  app/              Next.js application (in progress)
functions/          Cloud Functions: rollup chain, approval, admin import
docs/
  FIREBASE-SETUP.md Step-by-step checklist for creating the Firebase projects
firestore.rules     Security rules — the source of truth, never the console
storage.rules
firestore.indexes.json
firebase.json
```

## Running it

```
npm install
npm test          # vitest
npm run typecheck
```

Copy `.env.example` to `.env.local` and fill it in from your own Firebase
project — see `docs/FIREBASE-SETUP.md`. `.env.local` is git-ignored and must
stay that way. No credential belongs in this repository.

---

## The two rules everything else follows from

**A Cost Item is permanent; a budget version is only an opinion about its
price.** "Vatican Florals" may be budgeted at £25,000, then £28,000, then
£30,000, and invoiced at £31,200. Commitments and transactions reference
`costItemId` and never a version row, so approving a revision cannot orphan a
supplier bill, and removing a line cannot delete a cost already incurred.

**Sub-events are mandatory in the data and optional in the interface.** Every
project is created with one, which an ordinary event never sees. A destination
wedding reveals the layer and gets per-day profitability that still reconciles
exactly to the project total — asserted in the test suite, not by eye.

---

## Calculation rules encoded in `src/domain`

**Forecast cost, per cost item**

| Status | Forecast |
| --- | --- |
| Planned · Quoted · Committed · In Progress | `max(budget, actual + remainingCommitted)` |
| Completed | `actual` |
| Cancelled | `actual` — often zero, not always |

`budget` means the **current approved** budget, never an open draft, so a
half-typed revision cannot move the forecast. `remainingCommitted` is computed
per commitment: an over-invoiced commitment contributes zero and never offsets
one still outstanding.

**Revenue**

```
currentAgreedClientRevenue = originalClientValue + approvedExtras − agreedReductions
```

Each line's movement since the first approved budget is classified as an
increase or a decrease, so the three components sum back to the current figure
by construction rather than by luck.

Proposed extras contribute to neither cost nor revenue and are reported
separately. Rejected extras contribute to nothing at all.

**Commission** is never a supplier cost. Four bases, including
`percent_of_cost` — which is how the existing workbook actually calculates it.
Percentage-of-profit commissions are computed on profit before any commission;
they do not cascade.

**Money** is integer pence everywhere. A budget that drifts by a penny across
200 lines is a budget nobody trusts.

---

## Branding

`src/lib/brand/tokens.ts` holds every colour, typeface, radius and density
value, all sampled from the live All for Love London website because no formal
brand pack exists yet. When one arrives, that file is the only thing that
changes. No component may hard-code a hex value. No logo is invented.

One rule that keeps a red brand usable in a financial application: **primary
actions are black, not red. Red inside a data region always means over budget,
over-committed, or a loss.**
