#!/usr/bin/env bash
# Create (if missing) and re-seed the LOCAL dummy account against the local
# Supabase stack. Reads the URL, anon key and dummy credentials from .env.local,
# which `supabase start` + this repo's dev setup writes. Never touches production:
# it refuses to run unless VITE_SUPABASE_URL points at 127.0.0.1/localhost.
#
#   colima start            # container runtime (once per boot)
#   supabase start          # local stack, migrations applied
#   scripts/local/seed-dummy.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

export DOCKER_HOST="${DOCKER_HOST:-unix://$HOME/.colima/default/docker.sock}"

get() { grep -E "^$1=" .env.local | head -1 | cut -d= -f2-; }
URL="$(get VITE_SUPABASE_URL)"
ANON="$(get VITE_SUPABASE_ANON_KEY)"
EMAIL="$(get VITE_DEV_EMAIL)"
PASSWORD="$(get VITE_DEV_PASSWORD)"

case "$URL" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "Refusing: VITE_SUPABASE_URL is not a local stack ($URL)" >&2; exit 1 ;;
esac

DB="supabase_db_$(basename "$PWD")"
exists="$(docker exec "$DB" psql -U postgres -tAc "select 1 from auth.users where email = '$EMAIL'")"
if [ "$exists" != "1" ]; then
  curl -fsS -o /dev/null -X POST "$URL/auth/v1/signup" \
    -H "apikey: $ANON" -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
  echo "created $EMAIL"
fi

docker exec -i "$DB" psql -U postgres -v ON_ERROR_STOP=1 -q < scripts/local/seed-dummy.sql
echo "seeded $EMAIL"
# The seed hard-deletes and re-inserts, and the app's local replica (IndexedDB
# `nuvo-sync`) keeps rows it already had — re-seeding under an open app shows
# every block twice until that store is cleared.
echo "If the app was already open: DevTools → Application → IndexedDB → delete 'nuvo-sync', then reload."
