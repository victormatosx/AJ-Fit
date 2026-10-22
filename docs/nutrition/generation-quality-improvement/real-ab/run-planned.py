"""Foreground, checkpointed executor of the already authorized PLAN. No HTTP retries."""
from pathlib import Path
from decimal import Decimal
import json, os, subprocess, signal, time, datetime, hashlib
HERE = Path(__file__).resolve().parent
PLAN_PATH = HERE / 'PLAN.json'
MANIFEST_PATH = HERE / 'comparison-snapshots.json'
LEDGER = HERE / 'ledger.json'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
plan = json.loads(PLAN_PATH.read_text()); manifest = json.loads(MANIFEST_PATH.read_text())
auth = json.loads((HERE / 'authorization.json').read_text())
assert auth['approved'] is True and auth['task'] == plan['task'] == 'generation-quality-improvement'
assert auth['ceilingUsd'] == plan['proposedBudgetUsd'] == 1.08
assert auth['planSha256'] == sha(PLAN_PATH) and auth['sourceManifestSha256'] == sha(MANIFEST_PATH)
assert plan['maxJobs'] == len(plan['jobs']) == 36 and plan['maxCallsPerJob'] == 4
lock = HERE / 'runner.lock'; lock_fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
os.write(lock_fd, str(os.getpid()).encode())
def read_ledger():
    return json.loads(LEDGER.read_text()) if LEDGER.exists() else {'runs': []}
def stop(reason):
    data = read_ledger(); data['stopped'] = data.get('stopped') or reason
    LEDGER.write_text(json.dumps(data, indent=2) + '\n')
    print('STOP ' + data['stopped'], flush=True)
def state(value):
    (HERE / 'runner-state.json').write_text(json.dumps(value, indent=2) + '\n')
try:
    while True:
        data = read_ledger(); runs = data['runs']; index = len(runs)
        if (HERE / 'STOP_REQUESTED').exists():
            stop('external_stop_requested_sentinel_file'); break
        if data.get('stopped'):
            print('STOP ' + data['stopped'], flush=True); break
        if index >= 36:
            stop('predefined_job_limit_reached'); break
        assert not (HERE / 'ledger.lock').exists(), 'HARNESS_ALREADY_ACTIVE'
        assert all(r.get('result') for r in runs), 'UNRESOLVED_JOB_DO_NOT_REPLAY'
        assert sha(PLAN_PATH) == auth['planSha256'] and sha(MANIFEST_PATH) == auth['sourceManifestSha256']
        for i, r in enumerate(runs):
            assert r['scenario'] == plan['jobs'][i]['scenario'] and r['result']['arm'] == plan['jobs'][i]['arm']
        reserved = sum((Decimal(str(c['reservedUsd'])) for r in runs for c in r['calls']), Decimal(0))
        if reserved + Decimal('.03') > Decimal('1.08'):
            stop('insufficient_capacity_for_one_job'); break
        scheduled = plan['jobs'][index]; arm = scheduled['arm']; work = manifest['arms'][arm]['work']
        env = os.environ.copy(); env.update({'AJFIT_QUALITY_REAL': '1', 'AJFIT_QUALITY_ARM': arm,
          'AJFIT_QUALITY_ARTIFACTS': str(HERE), 'FIRESTORE_EMULATOR_HOST': '127.0.0.1:8080',
          'GCLOUD_PROJECT': 'demo-ajfit-quality-comparison'})
        log = HERE / ('job-%02d-%s-%s.log' % (index + 1, arm, scheduled['scenario']))
        print('START job=%d/36 arm=%s profile=%s reserved_so_far=%s' % (index + 1, arm, scheduled['scenario'], reserved), flush=True)
        state({'status': 'running', 'job': index + 1, 'arm': arm, 'scenario': scheduled['scenario'], 'log': str(log), 'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()})
        started = time.monotonic(); last = None
        with log.open('w') as output:
            process = subprocess.Popen(['./node_modules/.bin/vitest', 'run', 'src/nutrition/__tests__/generationQualityComparison.manual.test.ts'], cwd=work, env=env, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                while process.poll() is None:
                    if time.monotonic() - started > 480:
                        os.killpg(process.pid, signal.SIGTERM); process.wait(timeout=10)
                        stop('runner_timeout_unresolved_job'); raise RuntimeError('JOB_TIMEOUT_NO_RETRY')
                    d = read_ledger(); current = d['runs'][-1] if len(d['runs']) > index else None
                    summary = [(c['role'], c['state']) for c in current['calls']] if current else []
                    if summary != last:
                        print('PROGRESS job=%d calls=%s' % (index + 1, summary), flush=True); last = summary
                    time.sleep(2)
            except BaseException:
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGTERM); process.wait(timeout=10)
                raise
        data = read_ledger()
        if process.returncode != 0:
            stop('test_process_failed_no_retry'); print('Log: ' + str(log), flush=True); break
        assert len(data['runs']) == index + 1 and data['runs'][-1].get('result'), 'MISSING_TERMINAL_RESULT'
        r = data['runs'][-1]; calls = r['calls']; result = r['result']
        if any(c['state'] != 'responded' or c.get('estimatedCostUsd') is None for c in calls):
            stop('unresolved_provider_cost'); break
        assert len(calls) <= 4 and result['aiReservedUsd'] <= .03
        assert not result['creditUsed'] and result['status'] in ['completed', 'failed']
        print('DONE job=%d arm=%s success=%s first=%s calls=%d cost_est=%.8f duration=%.1fs' % (index + 1, arm, result['success'], result['firstCreationApproved'], len(calls), sum(c['estimatedCostUsd'] for c in calls), result['durationMs']/1000), flush=True)
    state({'status': 'stopped', 'reason': read_ledger().get('stopped'), 'jobs': len(read_ledger()['runs']), 'endedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()})
finally:
    os.close(lock_fd); lock.unlink()
