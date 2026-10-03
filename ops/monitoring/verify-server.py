#!/usr/bin/env python3
"""Read-only checks for the local monitoring stack."""

import base64
import json
from pathlib import Path
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def get_json(url: str, auth: bool = False):
    headers = {}
    if auth:
        password = Path('/root/.grafana-initial-password').read_text().strip()
        value = base64.b64encode(f'admin:{password}'.encode()).decode()
        headers['Authorization'] = f'Basic {value}'
    with urlopen(Request(url, headers=headers), timeout=15) as response:
        return response.status, json.load(response)


now_ns = time.time_ns()
query = '{job=~"live-9999|oshi-9000"} | json | kind="access"'
params = urlencode({
    'query': query,
    'start': str(now_ns - 6 * 3600 * 10**9),
    'end': str(now_ns),
    'limit': '1000',
})
status, logs = get_json(f'http://127.0.0.1:3100/loki/api/v1/query_range?{params}')
counts = {}
for stream in logs.get('data', {}).get('result', []):
    port = stream.get('stream', {}).get('port', '?')
    counts[port] = counts.get(port, 0) + len(stream.get('values', []))
print('Loki query HTTP:', status, 'log counts by port:', counts)

for title, expression in (
    ('7-day requests by port', 'sum by (port) (count_over_time({job=~"live-9999|oshi-9000"} | json | kind="access" [7d]))'),
    ('Top IPs', 'topk(5, sum by (ip) (count_over_time({job=~"live-9999|oshi-9000"} | json | kind="access" [7d])))'),
    ('4xx/5xx', 'sum(count_over_time({job=~"live-9999|oshi-9000"} | json | kind="access" | status >= 400 [7d]))'),
):
    url = 'http://127.0.0.1:3100/loki/api/v1/query?' + urlencode({'query': expression})
    status, result = get_json(url)
    values = [(item.get('metric', {}), item.get('value', [None, None])[1])
              for item in result.get('data', {}).get('result', [])]
    print(title, 'HTTP:', status, 'values:', values[:5])

status, datasource = get_json(
    'http://127.0.0.1:3000/api/datasources/uid/live-access-loki', auth=True
)
print('Grafana datasource HTTP:', status, 'name:', datasource.get('name'))

status, dashboard = get_json(
    'http://127.0.0.1:3000/api/dashboards/uid/live-access-9000-9999', auth=True
)
print('Grafana dashboard HTTP:', status, 'title:', dashboard.get('dashboard', {}).get('title'),
      'url:', dashboard.get('meta', {}).get('url'))
