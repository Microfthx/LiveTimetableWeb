#!/usr/bin/env python3
"""Convert the previous combined Nginx access log to timestamped JSONL once."""

from datetime import datetime
import json
from pathlib import Path
import re


SOURCE = Path('/var/log/nginx/live-idol-timetable-access.log')
DESTINATION = Path('/var/lib/loki-import/live-idol-timetable-legacy.jsonl')
PATTERN = re.compile(
    r'^(?P<ip>\S+) \S+ \S+ \[(?P<time>[^]]+)\] '
    r'"(?P<method>\S+) (?P<uri>\S+) [^"]+" '
    r'(?P<status>\d+) (?P<bytes>\d+|-) "[^"]*" "(?P<ua>[^"]*)"'
)

if DESTINATION.exists():
    print('Legacy JSONL already exists; leaving it unchanged')
    raise SystemExit(0)

DESTINATION.parent.mkdir(mode=0o750, exist_ok=True)
parsed = skipped = 0
with SOURCE.open(encoding='utf-8', errors='replace') as source, DESTINATION.open('x', encoding='utf-8') as output:
    for line in source:
        match = PATTERN.match(line)
        if not match:
            skipped += 1
            continue
        item = match.groupdict()
        try:
            timestamp = datetime.strptime(item['time'], '%d/%b/%Y:%H:%M:%S %z').isoformat()
        except ValueError:
            skipped += 1
            continue
        output.write(json.dumps({
            'kind': 'access',
            'port': 9999,
            'time': timestamp,
            'ip': item['ip'],
            'method': item['method'],
            'path': item['uri'].split('?', 1)[0],
            'status': int(item['status']),
            'bytes': int(item['bytes']) if item['bytes'].isdigit() else 0,
            'user_agent': item['ua'],
        }, ensure_ascii=False) + '\n')
        parsed += 1
DESTINATION.chmod(0o640)
print(f'Legacy access lines converted: {parsed}; skipped: {skipped}')
