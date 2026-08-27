# Setting this up, without a command line

Everything here happens in a web browser and in GitHub Desktop. There is no
terminal, and nothing on this page asks you to type a command.

You do it once. After that, pushing from GitHub Desktop tests the code and
publishes the site by itself.

**Roughly twenty minutes.** Two copy-and-pastes, and some clicking in the
Firebase console.

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

Open that file in TextEdit (right-click → Open With → TextEdit) and copy
**everything** in it.

> This one really is a secret — it can do anything in the project. Once you
> have pasted it into GitHub, delete the downloaded file from your Downloads
> folder. Do not put it in Google Drive, and do not send it to anyone,
> including me.

Back in GitHub → **New repository secret**.

- Name: `FIREBASE_SERVICE_ACCOUNT`
- Secret: paste the whole contents of the file
- **Add secret**

---

## Step 5 — Publish

GitHub → **Actions** tab → **Deploy** in the left menu → **Run workflow** →
**Run workflow**.

Give it two or three minutes. When it finishes, the summary shows the address:

**<https://all-for-love-8ca52.web.app>**

Open it. You should see the sign-in screen.

---

## Step 6 — Give yourself permission

Sign in with the account you created in step 2. It will tell you your account
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

**"Permission denied" or "caller does not have permission" during Deploy.**
The commonest snag, and nothing you did wrong. The service account needs
permission to publish. Go to
<https://console.cloud.google.com/iam-admin/iam?project=all-for-love-8ca52>,
find the account ending `@all-for-love-8ca52.iam.gserviceaccount.com`, click
the pencil, **Add another role**, and add these:

- Firebase Hosting Admin
- Firebase Rules Admin
- Cloud Datastore Owner
- Service Account User

Save, then run Deploy again.

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
