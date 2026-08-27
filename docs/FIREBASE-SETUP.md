# Firebase setup checklist

Everything you need to do in the Firebase and Google Cloud consoles, in order.
I cannot do these steps — they create accounts and credentials, which you own.

**Nothing in this checklist should ever be pasted into chat or committed to the
repository.** Values go into `.env.local`, which is git-ignored, and into the
hosting provider's environment settings.

---

## 1. Create the Firebase projects

Go to <https://console.firebase.google.com> and create **two** projects.

| Purpose | Suggested project name | Suggested project ID |
| --- | --- | --- |
| Production | `All for Love — Projects` | `all-for-love-projects` |
| Development | `All for Love — Projects (Dev)` | `all-for-love-projects-dev` |

- Sign in with an account All for Love or Fortuous will keep long-term. The
  first account becomes the Owner.
- **Do not** add these to any existing Firebase project used by MTD, Quarterly
  Review, Dental Accountant or any other Fortuous application. They must be
  new, separate projects.
- Google Analytics: **decline**. It is not needed and it adds a data-sharing
  consent you do not want on a financial system.
- Set the billing account to **Blaze (pay as you go)** on the production
  project. Cloud Functions require it. Expected cost at this scale is very
  low, but set a **budget alert at £20/month** in Google Cloud → Billing →
  Budgets & alerts so there are no surprises.

Do the remaining steps **twice** — once per project — unless noted.

---

## 2. Enable the services

In the Firebase console for each project:

**Authentication** → Get started
- Enable **Email/Password**. Leave "Email link (passwordless sign-in)" off.
- Do not enable Google, Apple or any social provider. Only All for Love staff
  log in, and accounts are created by an administrator rather than self-signup.
- Settings → User actions → **uncheck "Enable create (sign-up)"** so nobody can
  self-register.

**Firestore Database** → Create database
- Mode: **Production mode** (locked). The rules in `firestore.rules` replace
  the defaults at first deploy.
- Location: **`europe-west2` (London)**. This cannot be changed later.

**Storage** → Get started
- Same location: **`europe-west2`**.
- Production mode.

**Functions**
- No setup in the console. Enabling Blaze is enough; the first deploy creates
  what it needs.

**Hosting** (production project only, for now)
- Get started, then stop at the "install the CLI" step — the repo already has
  `firebase.json`.

---

## 3. Get the web app configuration

For each project: **Project settings** (gear icon) → **General** → scroll to
"Your apps" → **Add app** → **Web** (`</>`).

- App nickname: `All for Love Projects (web)`
- Tick **"Also set up Firebase Hosting"** on the production project only.

Firebase shows a `firebaseConfig` object. These six values are **not secrets** —
they identify the project to the browser and are protected by security rules,
not by obscurity. They still go in `.env.local` rather than in the source.

| Firebase console shows | Goes into `.env.local` as |
| --- | --- |
| `apiKey` | `NEXT_PUBLIC_FIREBASE_API_KEY` |
| `authDomain` | `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` |
| `projectId` | `NEXT_PUBLIC_FIREBASE_PROJECT_ID` |
| `storageBucket` | `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` |
| `messagingSenderId` | `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` |
| `appId` | `NEXT_PUBLIC_FIREBASE_APP_ID` |

Copy `.env.example` to `.env.local` in the repository root and fill these in
from your **development** project. `.env.local` is git-ignored and must stay
that way.

---

## 4. Get the service account key (server side only)

**Project settings → Service accounts → Generate new private key.** This
downloads a JSON file. This one **is** a secret — it bypasses all security
rules.

- Save it outside the repository. Do not put it in Google Drive.
- It is needed for: the Cloud Functions runtime (which gets it automatically —
  you do not configure anything), and for running the Admin Import locally.
- For local admin work only, set `GOOGLE_APPLICATION_CREDENTIALS` to its path
  in your shell profile. Never in `.env.local`, never in the repo.

If this file ever leaks: Service accounts → the key → delete it, and generate a
new one. Nothing else needs changing.

---

## 5. Create the first users and set their roles

Roles are Firebase custom claims, not documents. The security rules read
`request.auth.token.role`.

1. **Authentication → Users → Add user.** Create an account for each member of
   staff with a temporary password, which they change on first sign-in.
2. Run the role-setting script (added in the next work package):
   `npm run set-role -- --email ruth@allforlovelondon.com --role director`

| Role | Sees | Can change |
| --- | --- | --- |
| `director` | Everything, including commission and margin | Everything |
| `producer` | Project financials, not commission | Budgets, commitments, costs |
| `finance` | Costs, suppliers, billing | Commitments, transactions, invoices |
| `viewer` | Assigned projects, no profit figures | Nothing |
| `admin` | The Admin Import screen | Nothing through the app; import only |

Give the first account `director`. Add `admin` only to the account that will
run the C & D Wedding import.

---

## 6. Deploy the security rules

From the repository root, once per project:

```
npm install -g firebase-tools
firebase login
firebase use --add            # select the dev project, alias it "dev"
firebase use --add            # select the prod project, alias it "prod"

firebase use dev
firebase deploy --only firestore:rules,firestore:indexes,storage
```

`firestore.rules` in this repository is the source of truth. **Never edit rules
in the Firebase console** — the next deploy silently overwrites them, and the
change leaves no trace in git.

The rules enforce two things that matter more than the rest: approved budget
versions cannot be written by any signed-in user including admins, and clients
cannot author rollup totals. Both are properties of the deployed rules, not
promises made in code.

---

## 7. Deployment configuration

**Hosting.** `firebase.json` is in the repo. To deploy:

```
firebase use prod
npm run build
firebase deploy --only hosting,functions
```

**Environment values in production.** The six `NEXT_PUBLIC_*` values above go
into your hosting provider's environment settings, using the **production**
project's config — not the dev one.

**Custom domain** (optional, later). Hosting → Add custom domain, e.g.
`projects.allforlovelondon.com`. Firebase issues the certificate; you add two
DNS records at whoever hosts the domain.

---

## 8. Before real budgets go in

- [ ] Firestore → Backups: enable **daily backups with 7-day retention** on the
      production project.
- [ ] Billing budget alert set.
- [ ] At least two accounts hold the `director` role, so nobody is locked out.
- [ ] The service account JSON is stored somewhere durable and private.
- [ ] Rules deployed from the repository, not edited in the console.

---

## What I need from you once this is done

Only confirmation that each step is complete, and the **project IDs**. Project
IDs are not secrets. Do not send me the API key, the service account JSON, or
any password — the code reads all of it from environment variables that only
you ever fill in.
