#!/bin/bash
#
# Double-click this to stop All for Love if it is running.
#
# Normally you never need it: closing the Terminal window that Start opened
# stops everything. This exists for when a copy has been left running with no
# window attached to it — which is invisible, and which then blocks the next
# start with "already running somewhere".
#
# Your work is not affected. It lives in the .local-data folder, not in the
# running program.

cd "$(dirname "$0")" || exit 1

bold=$(tput bold 2>/dev/null); dim=$(tput dim 2>/dev/null); off=$(tput sgr0 2>/dev/null)
say()  { printf "\n%s%s%s\n" "$bold" "$1" "$off"; }
note() { printf "%s%s%s\n" "$dim" "$1" "$off"; }


# --------------------------------------------------------------------------
# Save the local database before stopping anything
# --------------------------------------------------------------------------
#
# The emulators write their data to disk on a clean exit and not before, so
# everything done since the last start lives in memory until then. A forced
# stop — which is what the escalation below eventually does, and what a Mac
# does on shutdown — therefore throws the lot away.
#
# The Emulator Hub can be asked to export on demand. It is asked here, and then
# the result is CHECKED, because a curl whose failure is thrown away is how you
# end up telling somebody their work is safe when it is not.
save_now() {
  mkdir -p .local-data

  # Ask, then WAIT. The export is not instant — a real supplier list is
  # sixteen hundred documents — and the first version of this asked, checked
  # once, found nothing yet, and went on to kill the emulators mid-write. The
  # log said it plainly afterwards: "Received SIGTERM 2 times. You have forced
  # the Emulator Suite to exit without waiting." Everything since the last
  # start went with it.
  curl -fsS -X POST "http://127.0.0.1:4400/emulators/export" \
    -H "Content-Type: application/json" \
    -d "{\"path\":\"$(pwd)/.local-data\"}" >/dev/null 2>&1 &
  local request=$!

  for _ in $(seq 1 90); do
    if [ -f .local-data/firebase-export-metadata.json ]; then
      # The metadata file appears at the end of a successful export, but give
      # the last writes a moment to settle before anything is killed.
      sleep 2
      note "Saved — $(find .local-data -type f | wc -l | tr -d ' ') files in .local-data"
      return 0
    fi
    printf "."
    sleep 1
  done

  kill "$request" 2>/dev/null
  echo
  return 1
}

PORTS="9099 8080 5001 9199 4400 4500 4000 4001 4401 4501 9150 3000"

listeners() {
  for port in $PORTS; do
    lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null
  done | sort -u
}

clear
say "Stopping All for Love"

found=$(listeners)
if [ -z "$found" ]; then
  note "Nothing was running."
  echo; read -r -p "Press Return to close. "
  exit 0
fi

note "Saving your work… (this can take a minute — do not close the window)"
if ! save_now; then
  say "It could not save the local database"
  cat <<'MESSAGE'
Stopping now would lose anything done since this was last started — imported
suppliers, budget lines, everything.

Try this first: go to the Terminal window that Start opened and press
Control-C. That shuts the emulators down tidily, which makes them save.

If there is no such window, or that does not work, carry on — but expect to
redo today's work.

MESSAGE
  read -r -p "Press Return to stop anyway, or close this window to leave it running. "
fi

# Ask politely first. Only things that are actually the emulators, the
# application or the Firebase tooling — matched on what the process really is,
# not on whatever happens to hold a port.
for pid in $found; do
  case "$(ps -o comm= -p "$pid" 2>/dev/null)" in
    *java*|*node*|*firebase*) kill "$pid" 2>/dev/null ;;
  esac
done

note "Waiting for it to stop…"
for _ in $(seq 1 15); do
  [ -z "$(listeners)" ] && break
  sleep 1
done

# Still there: insist.
remaining=$(listeners)
if [ -n "$remaining" ]; then
  note "Insisting…"
  for pid in $remaining; do
    case "$(ps -o comm= -p "$pid" 2>/dev/null)" in
      *java*|*node*|*firebase*) kill -9 "$pid" 2>/dev/null ;;
    esac
  done
  sleep 3
fi

if [ -z "$(listeners)" ]; then
  say "Stopped"
  echo "Double-click Start All for Love whenever you want it back."
else
  say "Something is still holding on"
  echo "These are still running:"
  echo
  for pid in $(listeners); do
    printf "    %s  %s\n" "$pid" "$(ps -o comm= -p "$pid" 2>/dev/null)"
  done
  echo
  echo "Restarting the Mac will certainly clear it."
fi

echo; read -r -p "Press Return to close. "
