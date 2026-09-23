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

    def reply(self, status):
        self.send_response(status)
        self.send_header('Content-Length', '0')
        self.end_headers()

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
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=600,
                    env={**os.environ, 'JOB_DIRECTORY': directory})
            self.reply(200 if result.returncode == 0 else 503)
        except subprocess.TimeoutExpired:
            self.reply(504)
        except Exception:
            self.reply(503)


if __name__ == '__main__':
    HTTPServer(('0.0.0.0', 8080), Handler).serve_forever()
