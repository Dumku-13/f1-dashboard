"""Export only public core data. Run with --cache for existing, dated backend caches.

Default: fetch current API data from --origin, validate, then atomically replace.
No auth headers, credentials, telemetry, or user data are accepted.
"""
import argparse
import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen

frontend = Path(__file__).resolve().parents[1]
backend = frontend.parent / 'backend'
parser = argparse.ArgumentParser()
parser.add_argument('--cache', action='store_true')
parser.add_argument('--origin', default='http://127.0.0.1:8000')
args = parser.parse_args()
entries = {}
def stamp(path):
    return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()
def add(path, label, data, at, source):
    assert isinstance(data, (list, dict)) and data, f'Empty {path}'
    if '/standings/' in path:
        assert all(data.get(k) for k in ('drivers', 'constructors', 'rounds'))
        assert all(isinstance(d.get('points'), (int, float)) for d in data['drivers'])
    if '/calendar/' in path:
        assert all(d.get('sessions') and d.get('name') and d.get('round') for d in data)
    entries[path] = dict(label=label, capturedAt=at, source=source, data=data)
for year in (2024, 2025, 2026):
    for kind, path in [('standings', f'/api/standings/?year={year}'), ('calendar', f'/api/sessions/calendar/{year}')]:
        if args.cache:
            files = list((backend / 'cache/api').glob(f'{kind}_{year}*.json'))
            file = max(files, key=lambda p: p.stat().st_mtime)
            data = json.loads(file.read_text(encoding='utf-8'))
            at, source = stamp(file), f'Backend cache: {file.name} (cache file timestamp)'
        else:
            with urlopen(args.origin.rstrip('/') + path, timeout=180) as response:
                data = json.load(response)
            at, source = datetime.now(timezone.utc).isoformat(), 'Dashboard public API'
        add(path, f'{year} {kind}', data, at, source)
if args.cache:
    file = backend / 'data/circuits.py'
    spec = importlib.util.spec_from_file_location('snapshot_circuits', file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    circuits, at, source = list(module.CIRCUITS.values()), stamp(file), 'Repository circuit reference (file timestamp)'
else:
    with urlopen(args.origin.rstrip('/') + '/api/circuits/', timeout=30) as response:
        circuits = json.load(response)
    at, source = datetime.now(timezone.utc).isoformat(), 'Dashboard public API'
assert circuits and all(c.get('key') and c.get('name') for c in circuits)
add('/api/circuits/', 'Circuit reference', circuits, at, source)
target = frontend / 'lib/api/core-snapshot.json'
temp = target.with_suffix('.tmp')
temp.write_text(json.dumps(dict(version=1, exportedAt=datetime.now(timezone.utc).isoformat(), entries=entries), ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
temp.replace(target)
print(f'Exported {len(entries)} public resources, {target.stat().st_size:,} bytes')
