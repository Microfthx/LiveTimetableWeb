#!/bin/sh
set -eu

port="${1:-}"
mode="${2:-recent}"
case "$port:$mode" in
  9000:recent)
    journalctl -u fujian-oshi9.service --since today -o cat --no-pager | grep '"kind":"access","port":9000' | tail -n 100 || true
    ;;
  9000:follow)
    journalctl -u fujian-oshi9.service -f -o cat --no-pager | grep --line-buffered '"kind":"access","port":9000'
    ;;
  9999:recent)
    tail -n 100 /var/log/nginx/live-idol-timetable-access.jsonl
    ;;
  9999:follow)
    tail -F /var/log/nginx/live-idol-timetable-access.jsonl
    ;;
  *)
    echo 'Usage: live-access 9000|9999 [recent|follow]' >&2
    exit 2
    ;;
esac
