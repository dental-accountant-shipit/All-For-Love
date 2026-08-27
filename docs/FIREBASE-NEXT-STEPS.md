# Firebase — short checklist for `all-for-love-8ca52`

Ten minutes of console work. Nothing here asks you for a secret.

---

## Spark is fine for now. Blaze is needed later, and not yet.

| What | Plan needed | When |
| --- | --- | --- |
| Firestore, Authentication, Storage, Hosting | **Spark** | Now |
| Security rules and indexes deployed from the repo | **Spark** | Now |
| Budget grid, revisions, commitments, costs, forecasting, profitability | **Spark** | Now |
| Cloud Functions — the rollup chain and budget approval | **Blaze** | Before go-live |

Cloud Functions are the only thing on the list that requires Blaze, and the
application is built so that this does not block you:

- The rollup engine is pure TypeScript. On Spark the app computes the same
  figures in the browser from the same code (`src/lib/firestore/liveRollup.ts`)
  — identical arithmetic, no server.
- When Blaze is switched on, the Cloud Functions in `functions/src/index.ts`
  call that same engine and start maintaining the cached rollups. Nothing about
  the data model, the screens or the calculations changes.

The one thing Blaze is genuinely required for before real budgets go in is
**budget approval**, because approving a version must write approved history —
and the security rules deny that to every signed-in user, including admins,
deliberately. Until Blaze is on, budgets can be built and edited but not
approved.

At this scale Blaze costs pennies a month. Set a budget alert when you enable
it: Google Cloud → Billing → Budgets & alerts → **£20/month**.

---

## 1. Firestore

Console → **Firestore Database** → Create database

- Mode: **Production mode** (locked). The repo's rules replace the defaults on
  first deploy.
- Location: **`europe-west2` (London)**. Cannot be changed afterwards.

## 2. Authentication

Console → **Authentication** → Get started

- Enable **Email/Password** only. Not the passwordless email link.
- Settings → User actions → **untick "Enable create (sign-up)"**, so nobody can
  self-register. Accounts are created by you.
- Add your own account: Users → Add user.

## 3. Storage

Console → **Storage** → Get started

- Production mode, location **`europe-west2`**.

## 4. Web app

Console → **Project settings** (gear) → General → Your apps → **Web** (`</>`)

- Nickname: `All for Love Projects (web)`
- Tick **Also set up Firebase Hosting**.

Firebase then shows a `firebaseConfig` block. Copy `.env.example` to
`.env.local` in the repository root and fill in the six values:

| Console shows | `.env.local` key |
| --- | --- |
| `apiKey` | `NEXT_PUBLIC_FIREBASE_API_KEY` |
| `authDomain` | `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` |
| `projectId` | `NEXT_PUBLIC_FIREBASE_PROJECT_ID` (`all-for-love-8ca52`) |
| `storageBucket` | `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` |
| `messagingSenderId` | `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` |
| `appId` | `NEXT_PUBLIC_FIREBASE_APP_ID` |

`.env.local` is git-ignored. These six are not secrets — they identify the
project to the browser and are protected by the security rules — but they still
do not belong in source, so that development and production are never one edit
apart.

## 5. Deploy the rules

From the repository root:

```
npm install -g firebase-tools
firebase login
firebase use --add          # choose all-for-love-8ca52, alias it "prod"
firebase deploy --only firestore:rules,firestore:indexes,storage
```

`firestore.rules` in the repo is the source of truth. **Never edit rules in the
console** — the next deploy overwrites them silently and the change leaves no
trace in git.

## 6. Set your role

Roles are custom claims, not documents. The script comes with the auth work in
the next package; until then the rules will refuse everything, which is correct
— a system that fails closed before roles exist is behaving properly.

| Role | Sees | Can change |
| --- | --- | --- |
| `director` | Everything, including commission and margin | Everything |
| `producer` | Project financials, not commission | Budgets, commitments, costs |
| `finance` | Costs, suppliers, billing | Commitments, transactions, invoices |
| `viewer` | Assigned projects, no profit figures | Nothing |
| `admin` | The Admin Import screen only | Nothing through the app |

## 7. Before real budgets go in

- [ ] Blaze enabled, with a £20/month budget alert
- [ ] Firestore → Backups: daily, 7-day retention
- [ ] At least two accounts hold `director`, so nobody is locked out
- [ ] Rules deployed from the repo, not edited in the console

---

## What to send me

The confirmation that each step is done. **Nothing else** — not the API key,
not a service account file, not a password. The code reads every value from
environment variables that only you ever fill in.
