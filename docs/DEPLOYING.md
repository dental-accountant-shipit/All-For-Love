# Setting this up, without a command line

Everything here happens in a web browser and in GitHub Desktop. There is no
terminal, and nothing on this page asks you to type a command.

You do it once. After that, pushing from GitHub Desktop tests the code and
publishes the site by itself.

**Roughly half an hour.** Two copy-and-pastes, one permission to grant, and
some clicking in the Firebase console.

---

## Before you start

Two browser tabs open:

- <https://console.firebase.google.com> — your project `all-for-love-8ca52`
- <https://github.com/dental-accountant-shipit/All-For-Love> — the repository

---

## Step 1 — Push the code

In GitHub Desktop, with **All-For-Love** selected, click **Push origin** (or
**Publish branch**) in the bar along the top.

That's it. Go to the repository on GitHub and click the **Actions** tab — you
should see a run called **Tests** with a green tick after a minute or two.
That is the whole test suite running on GitHub's machines rather than yours.

There will also be a **Deploy** run. It will stop early and say it is not
configured yet. That is expected — you configure it in step 4.

---

## Step 2 — Switch on the three Firebase services

In the Firebase console, in `all-for-love-8ca52`:

**Firestore Database** — click it in the left menu, then **Create database**.

- Mode: **Production mode**
- Location: **`europe-west2` (London)**

> The location cannot be changed afterwards. London is right for a UK business
> with UK clients.

**Authentication** — left menu, **Get started**.

- Choose **Email/Password**, switch on the first toggle, **Save**. Leave
  "Email link (passwordless sign-in)" off.
- Go to the **Settings** tab → **User actions** → **untick "Enable create
  (sign-up)"** → Save. This stops anyone signing themselves up. Accounts are
  created by you.
- Go to the **Users** tab → **Add user** → your own email address and a
  password you choose. You will use these to sign in.

**Storage** — this one now needs the Blaze plan; Firebase will not create a
bucket on the free plan at all. **Skip it for now.** It is only used for file
attachments on budget lines, which are not built yet. It gets switched on with
Blaze, later on this page.

---

## Step 3 — Create the web app

Firebase console → the **gear icon** next to Project Overview → **Project
settings** → the **General** tab → scroll to **Your apps** → click the **web
icon `</>`**.

- App nickname: `All for Love Projects (web)`
- Tick **Also set up Firebase Hosting**
- Register app

Firebase now shows you a block of code that looks roughly like this:

```js
const firebaseConfig = {
  apiKey: "AIza…",
  authDomain: "all-for-love-8ca52.firebaseapp.com",
  projectId: "all-for-love-8ca52",
  …
};
```

**Copy the whole block**, curly brackets and all. Do not worry about tidying it
— it gets read as it is. Keep it on your clipboard for the next step.

---

## Step 4 — Paste two things into GitHub

Go to the repository on GitHub → **Settings** (the tab, not your account
settings) → in the left menu, **Secrets and variables** → **Actions**.

### The first secret

Click **New repository secret**.

- Name: `FIREBASE_WEB_CONFIG`
- Secret: paste the whole block you just copied
- **Add secret**

### The second secret

Back in the Firebase console: **Project settings** → the **Service accounts**
tab → **Generate new private key** → **Generate key**. A `.json` file downloads.

**Open the downloaded file in Chrome, not in TextEdit.** New tab, then drag the
`.json` onto it. Chrome shows it as plain text, and copying from a web page
always copies text. Click in the text, **Cmd+A**, **Cmd+C**.

Three things on that page look like the key and are not:

- The grey code block above the blue button, starting `var admin = require(…)`.
  That is sample code, identical for every Firebase project. It has its own
  copy icon, which is how it gets copied by mistake.
- Selecting the `.json` in Finder and pressing **Cmd+C**. That copies the
  *file*, not its contents, and pastes as nothing.
- Anything that does not begin `{"type": "service_account"`.

Before saving the secret, look at what you pasted. It must start with
`{"type": "service_account"` and end with `}`. If it does not, the deploy will
tell you so — but it is quicker to catch here.

> This one really is a secret — it can do anything in the project. Once you
> have pasted it into GitHub, delete the downloaded file from your Downloads
> folder. Do not put it in Google Drive, and do not paste it into a chat or
> send it to anyone, including me. If it ever does end up somewhere it should
> not, it has to be deleted and replaced — see *Revoking a key* below.

Back in GitHub → **New repository secret**.

- Name: `FIREBASE_SERVICE_ACCOUNT`
- Secret: paste the whole contents of the file
- **Add secret**

---

## Step 5 — Let the deploy account do its job

Firebase creates a service account for the project but gives it permissions too
narrow to deploy with, so this step is needed on every new project. Skipping it
produces a `Permission denied to get service` error a few minutes from now.

<https://console.cloud.google.com/iam-admin/iam?project=all-for-love-8ca52>

Find `firebase-adminsdk-fbsvc@all-for-love-8ca52.iam.gserviceaccount.com`,
click the **pencil** at the end of its row, then **+ ADD ANOTHER ROLE**, type
`Editor`, choose **Editor** under *Basic*, and **Save**.

Editor lets it read and write everything in the project. It cannot change
permissions, create more keys, or delete the project — which is the right
shape for something that only ever publishes a website and some rules.

Wait two or three minutes before the next step. IAM changes are not instant.

---

## Step 6 — Publish

GitHub → **Actions** tab → **Deploy** in the left menu → **Run workflow** →
**Run workflow**.

Give it two or three minutes. When it finishes, the summary shows the address:

**<https://all-for-love-8ca52.web.app>**

Open it. You should see the sign-in screen.

---

## Step 7 — Give yourself permission

Sign in with the account you created in step 2 (Authentication → Users → Add user). It will tell you your account
has no role yet. That is correct — a new account can see nothing until someone
grants it a role, otherwise anyone who got an account could give themselves
one.

GitHub → **Actions** tab → **Set a user's role** → **Run workflow**.

- Email: your address
- Role: **director**
- **Run workflow**

Wait for the green tick, then sign out and back in. You now have the run of the
system.

| Role | What they see |
| --- | --- |
| **director** | Everything, including commission and margin |
| **producer** | Project financials and budgets. Not commission. |
| **finance** | Costs, suppliers and billing. Does not edit budgets. |
| **viewer** | Assigned projects. No profit figures. |
| **admin** | The Admin Import screen only |

---

## From now on

Push from GitHub Desktop. GitHub runs the tests, and if they pass, publishes
the site. Nothing else to do.

---

## Two things still to come

**The Blaze plan.** Three things need it: budget **approval**, the automatic
recalculation that keeps the projects list up to date, and file **Storage**.
Everything else — building budgets, recording commitments and costs,
forecasting, profitability — works on the free plan.

When you are ready: Firebase console → the gear → **Usage and billing** →
**Modify plan** → **Blaze**. At this size it costs pennies a month, but set a
limit while you are there: Google Cloud → Billing → **Budgets and alerts** →
**£20 a month**.

Then GitHub → Actions → **Deploy Cloud Functions and Storage** → **Run
workflow**. Once.

**A custom address.** Firebase console → Hosting → **Add custom domain**, for
something like `projects.allforlovelondon.com`. Firebase gives you two DNS
records to add wherever the domain is managed.

---

## When something goes wrong

**A red cross in the Actions tab.** Click the failed run, then the step with
the cross. The last few lines say what happened. Send me those lines — not the
secrets, just the error text.

**"Permission denied to get service [firestore.googleapis.com]" during
Deploy.** The commonest snag by a distance, and nothing you did wrong. Firebase
creates its service account with permissions too narrow to deploy with, so this
happens on every new project.

Go to
<https://console.cloud.google.com/iam-admin/iam?project=all-for-love-8ca52>,
find `firebase-adminsdk-fbsvc@all-for-love-8ca52.iam.gserviceaccount.com`,
click the **pencil** at the end of its row, **+ ADD ANOTHER ROLE**, type
`Editor`, choose **Editor** under *Basic*, and **Save**.

Give it two or three minutes before running Deploy again — IAM changes take a
while to take effect, and retrying immediately looks like the fix did not work.

> Do **not** try to do this from the Firebase console's *Users and permissions*
> page. That page is for people: it accepts a service account address, closes
> as though it worked, and grants nothing.

**"Failed to authenticate, have you run firebase login?"** Despite what it
says, this is almost never about login. It means the `FIREBASE_SERVICE_ACCOUNT`
secret does not contain a readable key — usually because something other than
the file's contents was pasted. The Deploy run now checks this and says which
of the likely causes it is. Re-copy the file as described in step 4.

### Revoking a key

If a key is ever exposed — pasted into a chat, emailed, committed — it has to
be replaced. It cannot be un-exposed.

<https://console.cloud.google.com/iam-admin/serviceaccounts?project=all-for-love-8ca52>
→ click `firebase-adminsdk-fbsvc@…` → the **KEYS** tab → bin icon on the
offending key → **Delete**. Then generate a new one and update the GitHub
secret. Deleting a key is instant and cannot be undone, which is the point.

**The site loads but says Firebase is not configured.** `FIREBASE_WEB_CONFIG`
did not paste completely. Copy the whole block again, including both curly
brackets, and update the secret.

**Signed in, but "your account has no role yet".** Step 6, and remember to sign
out and back in afterwards.

---

## If you would rather someone else did it

Everything above is ordinary Firebase setup. Any developer will recognise it,
and this page is enough on its own — they do not need to read anything else in
the repository.
