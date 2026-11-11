"""Run the SDK and CLI checks against fresh copies of official distributions."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parent
VERSIONS = (ROOT / 'versions.txt').read_text().split()


def port():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        return listener.getsockname()[1]


def run(version, source, output):
    with tempfile.TemporaryDirectory(prefix='kcadm-node-') as workspace:
        return run_in_workspace(version, source, output, Path(workspace))


def run_in_workspace(version, source, output, workspace):
    server = workspace / 'keycloak'
    shutil.copytree(source / f'keycloak-{version}', server, ignore=shutil.ignore_patterns('data'))
    http_port = port()
    base_url = f'http://127.0.0.1:{http_port}'
    password = secrets.token_hex(16)
    env = {**os.environ, 'JAVA_OPTS_KC_HEAP': '-Xms128m -Xmx768m'}
    if version.startswith('26.'):
        env.update(KC_BOOTSTRAP_ADMIN_USERNAME='probe-admin', KC_BOOTSTRAP_ADMIN_PASSWORD=password)
    else:
        env.update(KEYCLOAK_ADMIN='probe-admin', KEYCLOAK_ADMIN_PASSWORD=password)
    if version.startswith(('23.', '24.')) and os.getenv('KC_MATRIX_JAVA17'):
        env['JAVA_HOME'] = os.environ['KC_MATRIX_JAVA17']
    args = [str(server / 'bin/kc.sh'), 'start-dev', '--http-host=127.0.0.1', f'--http-port={http_port}']
    if version.startswith(('25.', '26.')):
        args += [f'--http-management-port={port()}']
    log = output / f'{version}.log'
    with log.open('w') as stream:
        process = subprocess.Popen(
            args, env=env, cwd=server, stdout=stream, stderr=subprocess.STDOUT, start_new_session=True,
        )
        try:
            for _ in range(150):
                if process.poll() is not None:
                    raise RuntimeError(f'server exited {process.returncode}; see {log}')
                if 'Running the server in development mode' not in log.read_text():
                    time.sleep(1)
                    continue
                try:
                    with urllib.request.urlopen(
                        base_url + '/realms/master/.well-known/openid-configuration', timeout=2,
                    ) as response:
                        if response.status == 200:
                            break
                except OSError:
                    time.sleep(1)
            else:
                raise RuntimeError(f'server readiness timeout; see {log}')
            probe_env = {**os.environ, 'PROBE_PASSWORD': password,
                         'PROBE_SECRET': secrets.token_hex(24),
                         'PROBE_CONFIG': str(workspace / 'config.json'),
                         'PROBE_KCADM': str(server / 'bin/kcadm.sh')}
            if 'JAVA_HOME' in env:
                probe_env['JAVA_HOME'] = env['JAVA_HOME']
            outcome = subprocess.run(
                ['node', str(ROOT / 'probe.js'), base_url, version],
                env=probe_env, capture_output=True, text=True, timeout=180,
            )
            (output / f'{version}.json').write_text(outcome.stdout)
            if outcome.stderr:
                (output / f'{version}.stderr').write_text(outcome.stderr)
            results = json.loads(outcome.stdout)['results']
            differences = [name for name, result in results.items() if not result.get('pass')]
            print(f'{version}: {len(results) - len(differences)}/{len(results)}; '
                  f'raw differences: {", ".join(differences) or "none"}; exit={outcome.returncode}', flush=True)
            return outcome.returncode == 0
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--servers', type=Path, default=os.getenv('KC_MATRIX_SERVERS'))
    parser.add_argument('--output', type=Path, default=ROOT / 'results')
    parser.add_argument('versions', choices=VERSIONS, nargs='*')
    args = parser.parse_args()
    if args.servers is None:
        parser.error('specify --servers or KC_MATRIX_SERVERS with extracted official distributions')
    args.output.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(
            lambda version: run(version, args.servers.resolve(), args.output.resolve()),
            args.versions or VERSIONS,
        ))
    return 0 if all(results) else 1


if __name__ == '__main__':
    raise SystemExit(main())
