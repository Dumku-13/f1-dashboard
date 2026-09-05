#!/usr/bin/env bash
# Warm the live deploy before presenting it.  Run ~20 minutes ahead.
#
#   bash warm-before-demo.sh
#
# WHY THIS EXISTS
# ---------------
# Render's free plan gives the backend 512MB and no persistent disk, so every
# spin-down wakes a fresh instance with an empty fastf1 cache. Measured, ONE
# cold session load with telemetry peaks at +198MB over idle; an instance
# already serving pages sits near 175MB of its 512MB. So one heavy request fits
# (~373MB) and TWO AT ONCE DO NOT — the kernel kills the process, the visitor
# gets a 502 with nothing in the logs about memory, every other endpoint dies
# with it, and the restart costs 15s to 3.5 minutes.
#
# TWO RULES THIS SCRIPT FOLLOWS, both learned by breaking the instance:
#
#   1. Talk to the API DIRECTLY, not through the site's /api/* proxy. The proxy
#      gives up at 30 seconds but the BACKEND KEEPS COMPUTING, so an abandoned
#      request is still holding its hundreds of MB when the next one starts.
#      That is how a strictly sequential warm still managed to OOM the box.
#      Direct, with a long timeout, means each request actually finishes.
#
#   2. One at a time, and confirm the instance is alive between the expensive
#      ones. Never background these.
#
# Re-run if you have been idle 15+ minutes — that is when the free instance
# spins down again.
set -u

API="https://f1-dashboard-api-v2.onrender.com"
WEB="https://f1-dashboard-web.onrender.com"
YEAR=2026
ROUND=12          # last COMPLETED round — the one with real session data
NEXT=13           # the round the landing page features

pass=0; warmed=0; fail=0

# Wait until the instance answers again. A heavy cold request can still tip it
# over on the current deploy; recovery is usually 15-30s.
recover() {
  local n=0
  until curl -sf -o /dev/null --max-time 10 "$API/api/health" 2>/dev/null; do
    n=$((n+1))
    [ "$n" -gt 40 ] && { echo "     ! still down after ~3.5min"; return 1; }
    printf '.'; sleep 5
  done
  return 0
}

hit() {
  local label="$1" path="$2" base="${3:-$API}"
  printf '  %-44s' "$label"
  local out code time
  out=$(curl -s -o /dev/null -w '%{http_code} %{time_total}' --max-time 600 "$base$path" 2>/dev/null)
  code=${out%% *}; time=${out##* }
  case "$code" in
    200)
      if awk "BEGIN{exit !($time > 10)}"; then
        printf 'ok  %ss  (was cold, now warm)\n' "$time"; warmed=$((warmed+1))
      else
        printf 'ok  %ss\n' "$time"; pass=$((pass+1))
      fi ;;
    503) printf 'busy (queued behind another load) — fine, retrying later\n'; warmed=$((warmed+1)) ;;
    *)
      printf 'FAILED %s after %ss\n' "$code" "$time"; fail=$((fail+1))
      printf '     waiting for the instance to come back'; recover && echo " back." ;;
  esac
}

echo
echo "Warming $API"
echo "Sequential and direct-to-API on purpose — see the comments in this file."
echo

echo "1/4  wake up"
hit "backend health"                "/api/health"
hit "frontend"                      "/" "$WEB"

echo
echo "2/4  core demo path (cheap, already warmed at boot)"
hit "calendar"                      "/api/sessions/calendar/$YEAR"
hit "standings"                     "/api/standings/?year=$YEAR"
hit "drivers"                       "/api/drivers/?year=$YEAR"
hit "circuits"                      "/api/circuits/"
hit "season stats"                  "/api/season-stats?year=$YEAR"
hit "news"                          "/api/news?limit=6"
hit "live timing state"             "/api/livetiming/state"

echo
echo "3/4  the expensive ones — this is the part that matters"
hit "season scan (all analysis)"    "/api/analysis/teammates/$YEAR"
hit "race results (R$ROUND)"        "/api/sessions/$YEAR/$ROUND/Race/results"
hit "quali results (R$ROUND)"       "/api/sessions/$YEAR/$ROUND/Q/results"
hit "race pace (R$ROUND)"           "/api/analysis/race-pace/$YEAR/$ROUND"
hit "pit stops"                     "/api/analysis/pitstops/$YEAR"
hit "consistency"                   "/api/analysis/consistency/$YEAR"
hit "track detail (R$NEXT)"         "/api/livetiming/track/$YEAR/$NEXT/details"
hit "track DNA (R$NEXT)"            "/api/analysis/track-dna/$YEAR/$NEXT?session_code=Q"
hit "telemetry fastest lap"         "/api/telemetry/$YEAR/$ROUND/Q/NOR/fastest-lap"
hit "telemetry compare"             "/api/telemetry/$YEAR/$ROUND/Q/compare?driver1=NOR&driver2=VER"

echo
echo "4/4  driver pages you are most likely to click"
for n in 12 63 44 1 16 3; do
  hit "driver $n season"            "/api/drivers/$n/season/$YEAR"
  hit "driver $n career"            "/api/drivers/$n/career"
done

echo
echo "-----------------------------------------------------------"
printf 'already warm: %d    warmed just now: %d    FAILED: %d\n' "$pass" "$warmed" "$fail"
echo
if [ "$fail" -gt 0 ]; then
  echo "Re-run once — the second pass reads the caches the first one built,"
  echo "and anything that failed on a restart normally passes now."
  exit 1
fi
echo "All good. Leave a tab open on $WEB so it does not spin down again."
