"""Offline backup with a systemd ExecStopPost recovery journal."""
import datetime
import fcntl
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

# The web process and every worker can write database rows and stored files.
# Stop producers first, then consumers; restart consumers before the web process.
SERVICES = ('paper-translation-worker', 'paper-agent-worker',
            'paper-preparation-worker', 'paper-platform')
STATE = Path('/run/paper-platform-backup-recovery.json')
LOCK = Path('/run/lock/paper-platform-backup.lock')


def systemctl(*args):
    return subprocess.run(['systemctl', *args], check=False)


def recover(state=STATE):
    if not state.exists():
        return
    active = json.loads(state.read_text())
    if not isinstance(active, list) or any(s not in SERVICES for s in active):
        raise ValueError('Invalid backup recovery journal')
    failed = []
    for service in active:
        if systemctl('start', service).returncode:
            failed.append(service)
    if failed:
        raise RuntimeError('Could not restore services: ' + ', '.join(failed))
    state.unlink()


def quiesce(state=STATE):
    active = [s for s in SERVICES if systemctl('is-active', '--quiet', s).returncode == 0]
    temp = state.with_suffix('.tmp')
    with temp.open('w') as handle:
        json.dump(active, handle)
        handle.flush()
        os.fsync(handle.fileno())
    temp.replace(state)
    for service in reversed(active):
        if systemctl('stop', service).returncode:
            raise RuntimeError('Could not stop ' + service)
    return active


def publish(partial, target):
    # Hard link is atomic and refuses to replace an existing completed backup.
    with partial.open('rb') as handle:
        os.fsync(handle.fileno())
    os.link(partial, target)
    partial.unlink()
    fd = os.open(target.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def main():
    os.umask(0o077)
    assert os.geteuid() == 0
    with LOCK.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        recover()
        if '--recover' in sys.argv:
            return
        for line in Path('/etc/paper-platform/app.env').read_text().splitlines():
            if line and not line.startswith('#'):
                key, value = line.split('=', 1)
                os.environ[key] = value
        sys.path.insert(0, '/srv/paper-platform/app')
        from backend.cli import backup
        from backend.config import Settings
        out = Path('/var/backups/paper-platform')
        out.mkdir(mode=0o700, parents=True, exist_ok=True)
        assert shutil.disk_usage(out).free > 1024**3, 'Less than 1GiB free'
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        target = out / ('paper-' + stamp + '.zip')
        partial = target.with_suffix('.zip.partial')
        encrypted = None
        try:
            active = quiesce()
            counts = backup(Settings.env(), partial)
            publish(partial, target)
            recipient_file = os.getenv('PAPER_BACKUP_RECIPIENT_FILE')
            if recipient_file:
                from backend.ops_backup import package
                encrypted = target.with_suffix('.age')
                encrypted_partial = encrypted.with_suffix('.age.partial')
                package(Settings.env(), encrypted_partial, Path(recipient_file).read_text().strip(), '/etc/paper-platform/app.env')
                publish(encrypted_partial, encrypted)
        finally:
            recover()
        cutoff = datetime.datetime.now(datetime.timezone.utc).timestamp() - 14 * 86400
        import re
        for old in out.iterdir():
            if (re.fullmatch(r'paper-\d{8}T\d{6}(?:\d{6})?Z\.(zip|age)', old.name)
                    and not old.is_symlink() and old.is_file() and old.stat().st_mtime < cutoff):
                old.unlink()
        print(json.dumps({'backup': str(target), 'table_counts': counts,
                          'services_restored': active, 'encrypted_backup': str(encrypted) if encrypted else None}))


if __name__ == '__main__':
    main()
