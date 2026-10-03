#!/usr/bin/env bash
set -euo pipefail

# Run as root after installing the official grafana, loki and alloy RPMs.
install -d -m 0750 -o loki -g loki /var/lib/loki
install -m 0644 /tmp/loki.yml /etc/loki/config.yml
install -m 0644 /tmp/alloy.alloy /etc/alloy/config.alloy
install -m 0640 -o root -g grafana /tmp/datasource.yml /etc/grafana/provisioning/datasources/live-access.yml
install -m 0640 -o root -g grafana /tmp/dashboards.yml /etc/grafana/provisioning/dashboards/live-access.yml
install -d -m 0750 -o grafana -g grafana /var/lib/grafana/dashboards/live-access
install -m 0640 -o grafana -g grafana /tmp/live-access-dashboard.json /var/lib/grafana/dashboards/live-access/live-access-dashboard.json
install -m 0700 /tmp/verify-server.py /usr/local/sbin/live-monitor-verify

# Alloy already belongs to adm and systemd-journal. Give that group read access
# to the Nginx JSONL file, including files recreated by logrotate.
chgrp adm /var/log/nginx/live-idol-timetable-access.jsonl
chmod 0640 /var/log/nginx/live-idol-timetable-access.jsonl
sed -i 's/create 0640 nginx root/create 0640 nginx adm/' /etc/logrotate.d/nginx
if [ -d /var/lib/loki-import ]; then
  chgrp -R adm /var/lib/loki-import
fi

python3 - <<'PY'
from pathlib import Path
import secrets

password_path = Path('/root/.grafana-initial-password')
if not password_path.exists():
    password_path.write_text(secrets.token_urlsafe(36) + '\n')
    password_path.chmod(0o600)
secret_path = Path('/root/.grafana-secret-key')
if not secret_path.exists():
    secret_path.write_text(secrets.token_hex(48) + '\n')
    secret_path.chmod(0o600)

config_path = Path('/etc/grafana/grafana.ini')
lines = config_path.read_text().splitlines(keepends=True)
settings = {
    'server': {
        'http_addr': '127.0.0.1',
        'http_port': '3000',
        'root_url': 'http://localhost:3000/',
    },
    'security': {
        'admin_password': password_path.read_text().strip(),
        'secret_key': secret_path.read_text().strip(),
    },
    'users': {'allow_sign_up': 'false'},
    'auth.anonymous': {'enabled': 'false'},
}
section = None
changed = set()
result = []
for line in lines:
    stripped = line.strip()
    if stripped.startswith('[') and stripped.endswith(']'):
        section = stripped[1:-1]
    key = stripped.lstrip(';').split('=', 1)[0].strip() if '=' in stripped else None
    if section in settings and key in settings[section] and (section, key) not in changed:
        result.append(f'{key} = {settings[section][key]}\n')
        changed.add((section, key))
    else:
        result.append(line)
config_path.write_text(''.join(result))
PY

/usr/bin/loki -config.file=/etc/loki/config.yml -verify-config >/dev/null
/usr/bin/alloy validate /etc/alloy/config.alloy
systemctl daemon-reload
systemctl enable --now loki.service
systemctl enable --now alloy.service
systemctl enable --now grafana-server.service
