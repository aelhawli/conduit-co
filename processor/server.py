"""Only reachable via private Container binding; one bounded parsing child."""
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def reply(self, status, metrics=None):
        body = json.dumps(metrics or {}).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.reply(200 if self.path == '/health' else 404)

    def do_POST(self):
        if self.path != '/process':
            return self.reply(404)
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 16384:
                return self.reply(413)
            body = self.rfile.read(length)
            config = json.loads(body)
            if not isinstance(config, dict):
                return self.reply(400)
            with tempfile.TemporaryDirectory(prefix='conduit-ingestion-') as directory:
                result = subprocess.run([sys.executable, str(Path(__file__).with_name('pipeline.py'))], input=body,
                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=600,
                    env={**os.environ, 'JOB_DIRECTORY': directory})
            allowed = {'checksum_ms', 'download_ms', 'validation_ms', 'page_count', 'preparation_ms', 'peak_rss_kib', 'cpu_ms'}
            try:
                raw = json.loads(result.stdout) if len(result.stdout) < 2048 else {}
                metrics = {k: v for k, v in raw.items() if k in allowed and isinstance(v, (int, float)) and 0 <= v < 1e12}
            except (ValueError, AttributeError):
                metrics = {}
            self.reply(200 if result.returncode == 0 else 503, metrics)
        except subprocess.TimeoutExpired:
            self.reply(504)
        except Exception:
            self.reply(503)


if __name__ == '__main__':
    HTTPServer(('0.0.0.0', 8080), Handler).serve_forever()
