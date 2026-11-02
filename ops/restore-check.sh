#!/usr/bin/env bash
# Restore drill: loads a backup into a throw-away database and checks the money still adds up.
# Run it monthly and after any change to backups. Usage: ./ops/restore-check.sh backups/hnb-XXXX.dump
set -euo pipefail
cd "$(dirname "$0")/.."
dump="${1:?usage: restore-check.sh <dump file>}"
compose="docker compose -f docker-compose.prod.yml"
$compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS hnb_restore_check" -c "CREATE DATABASE hnb_restore_check"' > /dev/null
$compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d hnb_restore_check --no-owner' < "$dump"
$compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d hnb_restore_check -At -v ON_ERROR_STOP=1' <<'SQL'
select 'receivables', count(*) from "Receivable";
select 'ledger entries', count(*) from "LedgerEntry";
select 'audit events', count(*) from "AuditEvent";
-- Every receivable's stored balance must equal debits less credits in the ledger.
select 'receivables disagreeing with the ledger', count(*) from "Receivable" r
  where r.balance <> coalesce((select sum(debit - credit) from "LedgerEntry" l where l."receivableId" = r.id), 0);
SQL
$compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE hnb_restore_check"' > /dev/null
echo "Restore drill finished: the line 'receivables disagreeing with the ledger' must read 0."
