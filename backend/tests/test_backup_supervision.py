"""Fault injection for the root backup wrapper, without touching host services."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest

spec = importlib.util.spec_from_file_location('backup_supervision', Path(__file__).parents[2] / 'deploy/backup_production.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


def test_partial_stop_recovers_only_previously_active(tmp_path, monkeypatch):
    calls = []
    def ctl(*args):
        calls.append(args)
        code = (args[-1] in {'paper-agent-worker', 'paper-preparation-worker'}) if args[0] == 'is-active' else (args[0] == 'stop')
        return SimpleNamespace(returncode=int(code))
    monkeypatch.setattr(backup, 'systemctl', ctl)
    state = tmp_path / 'state'
    with pytest.raises(RuntimeError):
        backup.quiesce(state)
    backup.recover(state)
    assert [c for c in calls if c[0] == 'start'] == [('start', 'paper-translation-worker'), ('start', 'paper-platform')]
    assert not state.exists()


def test_failed_recovery_keeps_journal_and_tries_all_services(tmp_path, monkeypatch):
    state = tmp_path / 'state'
    state.write_text('["paper-platform", "paper-agent-worker"]')
    calls = []
    def ctl(*args):
        calls.append(args)
        return SimpleNamespace(returncode=int(args[-1] == 'paper-platform'))
    monkeypatch.setattr(backup, 'systemctl', ctl)
    with pytest.raises(RuntimeError):
        backup.recover(state)
    assert len(calls) == 2 and state.exists()
    monkeypatch.setattr(backup, 'systemctl', lambda *args: SimpleNamespace(returncode=0))
    backup.recover(state)
    backup.recover(state)  # idempotent
    assert not state.exists()


def test_publish_does_not_overwrite_or_publish_incomplete(tmp_path):
    partial, target = tmp_path / 'backup.partial', tmp_path / 'backup.zip'
    partial.write_bytes(b'complete')
    assert not target.exists()
    backup.publish(partial, target)
    assert target.read_bytes() == b'complete' and not partial.exists()
    partial.write_bytes(b'new')
    with pytest.raises(FileExistsError):
        backup.publish(partial, target)
    assert target.read_bytes() == b'complete'


def test_journal_rejects_unrelated_service(tmp_path, monkeypatch):
    state = tmp_path / 'state'
    state.write_text('["other-application"]')
    monkeypatch.setattr(backup, 'systemctl', lambda *args: pytest.fail('must not execute'))
    with pytest.raises(ValueError):
        backup.recover(state)


def test_backup_quiesces_preparation_and_recovers_after_interruption(tmp_path, monkeypatch):
    calls = []
    def ctl(*args):
        calls.append(args)
        return SimpleNamespace(returncode=0)
    monkeypatch.setattr(backup, 'systemctl', ctl)
    state = tmp_path / 'state'
    active = backup.quiesce(state)
    assert ('stop', 'paper-preparation-worker') in calls
    assert calls.index(('stop', 'paper-platform')) < calls.index(('stop', 'paper-preparation-worker'))
    assert state.exists()
    # Simulate ExecStopPost in a fresh process: only the durable journal remains.
    backup.recover(state)
    assert [c[1] for c in calls if c[0] == 'start'] == active
    assert calls.index(('start', 'paper-preparation-worker')) < calls.index(('start', 'paper-platform'))
    assert not state.exists()
