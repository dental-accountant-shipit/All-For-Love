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
