#!/bin/bash
#
# Double-click this file to run All for Love — Projects on this Mac.
#
# It starts a complete private copy: the application, a local database, sign-in,
# and the server-side functions that budget approval and the Admin Import need.
# Nothing here touches the live site, nothing costs anything, and nothing leaves
# this laptop.
#
# To stop it: close the Terminal window, or press Control-C.
#
# Written to be run by double-clicking rather than typed, so it explains itself
# as it goes and says what to do when something is missing instead of printing
# a stack trace and quitting.

cd "$(dirname "$0")" || exit 1

bold=$(tput bold 2>/dev/null); dim=$(tput dim 2>/dev/null); off=$(tput sgr0 2>/dev/null)
say()  { printf "\n%s%s%s\n" "$bold" "$1" "$off"; }
note() { printf "%s%s%s\n" "$dim" "$1" "$off"; }

stop() {
  say "Stopping — saving your work first"
  note "This can take a minute on a big list. Please wait."

  # Ask the emulators to write their data out, and wait for it to finish before
  # signalling anything. They only export on a clean exit otherwise, and a
  # signal sent while the export is running aborts it — which is exactly how a
  # day's work was lost once already.
  mkdir -p .local-data
  curl -fsS -X POST "http://127.0.0.1:4400/emulators/export" \
    -H "Content-Type: application/json" \
    -d "{\"path\":\"$(pwd)/.local-data\"}" >/dev/null 2>&1 &

  for _ in $(seq 1 90); do
    [ -f .local-data/firebase-export-metadata.json ] && break
    printf "."
    sleep 1
  done
  echo

  if [ -f .local-data/firebase-export-metadata.json ]; then
    sleep 2
    note "Saved."
  else
    note "Could not save — anything since the last start may be lost."
  fi

  # Kill the whole process group so the emulators do not outlive the window.
  kill 0 2>/dev/null
  exit 0
}
# HUP is what closing the Terminal window sends. Without it the emulators
# outlive the window that started them, invisibly, and the next run finds its
# ports taken by something the user cannot see to close.
trap stop INT TERM HUP

clear
say "All for Love — Projects, running on this Mac"
note "Close this window when you are finished."

# --------------------------------------------------------------------------
# Node
# --------------------------------------------------------------------------

# A double-clicked script gets a bare PATH: Homebrew and nvm installs are
# invisible unless we go looking. Checking the usual places is the difference
# between "works" and "install Node" for somebody who already has it.
for candidate in /opt/homebrew/bin /usr/local/bin "$HOME/.nvm/versions/node"/*/bin; do
  [ -d "$candidate" ] && PATH="$candidate:$PATH"
done
export PATH

if ! command -v node >/dev/null 2>&1; then
  say "Node is not installed"
  cat <<'MESSAGE'
This needs Node, which is free and takes about a minute.

  1. Go to  https://nodejs.org
  2. Download the big green "LTS" button
  3. Open the downloaded file and click through the installer
  4. Double-click this Start file again

Nothing else to configure — the installer does it all.
MESSAGE
  echo; read -r -p "Press Return to close. "
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 20 ]; then
  say "Node is too old"
  echo "Found version $(node -v); this needs 20 or newer."
  echo "Download the current LTS from https://nodejs.org and run this again."
  echo; read -r -p "Press Return to close. "
  exit 1
fi
note "Node $(node -v)"

# --------------------------------------------------------------------------
# Java — the Firestore emulator is a Java program
# --------------------------------------------------------------------------

if ! /usr/libexec/java_home >/dev/null 2>&1 && ! command -v java >/dev/null 2>&1; then
  say "Java is not installed"
  cat <<'MESSAGE'
The local database needs Java. It is free and takes about two minutes.

  1. Go to  https://adoptium.net
  2. Download the button it offers for macOS
  3. Open the downloaded file and click through the installer
  4. Double-click this Start file again

MESSAGE
  echo; read -r -p "Press Return to close. "
  exit 1
fi
note "Java found"

# --------------------------------------------------------------------------
# Dependencies
# --------------------------------------------------------------------------

# Check for the thing that is actually needed, not for the folder that usually
# contains it. An interrupted install leaves node_modules present and useless —
# hundreds of packages, no .bin, and "next: command not found" from a launcher
# that has already said Ready.
if [ ! -x node_modules/.bin/next ]; then
  if [ -d node_modules ]; then
    say "The installed files are incomplete — repairing"
    note "Clearing them out and fetching a clean set. A few minutes."
    # Deleted rather than installed over. A half-finished tree can also be a
    # tree built for the wrong operating system, and npm will happily leave
    # those in place because the version numbers look right.
    rm -rf node_modules
  else
    say "First run — fetching what it needs"
    note "A few minutes. Only ever happens once."
  fi
  if ! npm install --no-audit --no-fund; then
    say "That did not work"
    echo "Usually the internet connection. Try again; if it keeps failing, send me"
    echo "the last few lines above."
    echo; read -r -p "Press Return to close. "
    exit 1
  fi
fi

if [ ! -x node_modules/.bin/next ]; then
  say "Something is wrong with the installed files"
  echo "npm finished but the application itself is still missing. Deleting the"
  echo "node_modules folder and running this again is the usual cure."
  echo; read -r -p "Press Return to close. "
  exit 1
fi

if [ ! -d functions/node_modules/firebase-functions ]; then
  note "Preparing the server-side functions…"
  rm -rf functions/node_modules
  npm --prefix functions install --no-audit --no-fund >/dev/null 2>&1
fi

note "Building the functions…"
if ! npm --prefix functions run build > .local-functions-build.log 2>&1; then
  say "The server-side functions did not compile"
  echo "Budget approval and the workbook import will not work until they do."
  echo "What the compiler said:"
  echo
  tail -15 .local-functions-build.log | sed 's/^/    /'
  echo
  echo "Everything else still runs. Continuing."
  echo; read -r -p "Press Return to carry on. "
fi

# --------------------------------------------------------------------------
# Local configuration
# --------------------------------------------------------------------------

# The emulators do not check these values, so they are deliberately obvious
# placeholders. Anyone who opens this file should be able to see at a glance
# that there is no real credential in it.
if [ ! -f .env.local ]; then
  note "Writing local settings…"
  cat > .env.local <<'ENVFILE'
# Local development against the Firebase emulators.
# These are placeholders — the emulators accept anything. No real project,
# no real credentials, nothing that reaches the live site.
NEXT_PUBLIC_FIREBASE_API_KEY=local
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=localhost
NEXT_PUBLIC_FIREBASE_PROJECT_ID=all-for-love-local
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=all-for-love-local
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=000000000000
NEXT_PUBLIC_FIREBASE_APP_ID=1:000000000000:web:local
NEXT_PUBLIC_APP_NAME=All for Love — Projects
NEXT_PUBLIC_BASE_CURRENCY=GBP
NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true
ENVFILE
fi

if ! grep -q 'NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true' .env.local; then
  say "This copy is pointed at the live site, not the local one"
  echo "Rename .env.local to .env.live and run this again to start fresh locally."
  echo; read -r -p "Press Return to close. "
  exit 1
fi

# --------------------------------------------------------------------------
# Go
# --------------------------------------------------------------------------

# --------------------------------------------------------------------------
# Anything already running?
# --------------------------------------------------------------------------

# A previous window left open holds the ports, and the emulators respond by
# printing a wall of "port taken" into a log file and shutting themselves down.
# The application then starts perfectly well against the *old* database, which
# looks like everything working until something is mysteriously missing from it.
# Better to notice here.

busy=""
for port in 9099 8080 5001 9199 4400; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then busy="$busy $port"; fi
done

if [ -n "$busy" ]; then
  say "This is already running somewhere"
  cat <<'MESSAGE'
Another copy has the local database open — almost certainly a Terminal window
from earlier that is still sitting there. Two copies cannot share it.

If you carry on, this will stop the old one first. Nothing is lost: the work is
kept in the .local-data folder either way.

MESSAGE
  read -r -p "Press Return to stop the old one and carry on, or close this window. "

  # Only our own emulators, matched by what is actually listening on those
  # ports — not a blanket kill of anything that happens to be in the way.
  holders() {
    for port in 9099 8080 5001 9199 4400 4500 4000 4001 4401 4501 9150; do
      lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null
    done | sort -u
  }

  ours() {
    case "$(ps -o comm= -p "$1" 2>/dev/null)" in
      *java*|*node*|*firebase*) return 0 ;;
      *) return 1 ;;
    esac
  }

  for pid in $(holders); do ours "$pid" && kill "$pid" 2>/dev/null; done

  note "Waiting for it to let go…"
  for _ in $(seq 1 15); do
    [ -z "$(holders)" ] && break
    sleep 1
  done

  # A polite request is not always enough, and a launcher that then carries on
  # into "port taken" has wasted the asking.
  if [ -n "$(holders)" ]; then
    note "Insisting…"
    for pid in $(holders); do ours "$pid" && kill -9 "$pid" 2>/dev/null; done
    sleep 3
  fi

  if [ -n "$(holders)" ]; then
    say "It will not let go"
    echo "Still running:"
    echo
    for pid in $(holders); do
      printf "    %s  %s\n" "$pid" "$(ps -o comm= -p "$pid" 2>/dev/null)"
    done
    echo
    echo "Restarting the Mac will certainly clear it. Nothing is lost either way."
    echo; read -r -p "Press Return to close. "
    exit 1
  fi
fi

mkdir -p .local-data

say "Starting the local database…"
note "The first run downloads the database itself — a few minutes. After that it is seconds."

npx --yes firebase-tools@latest emulators:start \
  --only firestore,auth,functions,storage \
  --project all-for-love-local \
  --import .local-data --export-on-exit .local-data \
  > .local-emulators.log 2>&1 &

# The seeder waits for Auth itself and prints the sign-in details.
node scripts/local/seedLocal.mjs &

say "Starting the application…"
npm run dev > .local-app.log 2>&1 &

# Wait for the dev server rather than guessing at a delay — opening the browser
# too early shows a connection error and teaches people to distrust it.
app_up=no
for _ in $(seq 1 90); do
  if curl -sS -o /dev/null http://127.0.0.1:3000 2>/dev/null; then app_up=yes; break; fi
  sleep 1
done

# Saying "Ready" over a dead application is how somebody ends up staring at a
# browser error believing the fault is theirs.
if [ "$app_up" = "no" ]; then
  say "The application did not start"
  echo "The last few lines of its log say why:"
  echo
  tail -12 .local-app.log 2>/dev/null | sed 's/^/    /'
  echo
  echo "The local database is running, so this is the application alone."
  echo; read -r -p "Press Return to close. "
  stop
fi

say "Ready"
cat <<'READY'
  The application     http://localhost:3000

  Sign in as          director@local  /  localdev     — normal use
  or                  admin@local     /  localdev     — the workbook import

  What is different from the live site:
    · Everything works, including budget approval and the Admin Import —
      the functions run here, free, so Blaze is not needed.
    · It is a separate database. Nothing you do here touches the live site.
    · Your work is kept between runs, in a folder called .local-data.

  Behind the scenes, if you ever want it:
    Database and functions   http://localhost:4000

  Close this window to stop everything.
READY

open http://localhost:3000 2>/dev/null

# Hold the window open so closing it stops the emulators.
wait
