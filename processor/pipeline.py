"""Bounded PDF ingestion, no AI calls and no document/error-string logging."""
import base64
import hashlib
import io
import json
import math
import os
import ssl
from pathlib import Path
import sys
import urllib.request
from urllib.parse import urlparse

import pikepdf
import pypdfium2 as pdfium

FILE_LIMIT = 250_000_000
PAGE_LIMIT = 2000
R2_HOST = '531521b13c35aabe7b97954af0e2169b.r2.cloudflarestorage.com'
CALLBACK = 'https://conduit-ingestion-staging.letstalk-531.workers.dev/processor/callback'


class Rejected(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise Rejected('PROCESSOR_UNAVAILABLE')


def opener():
    context = ssl.create_default_context()
    # Trust Cloudflare's per-container egress CA in addition to system roots;
    # TLS hostname and chain verification remain enabled.
    ca = Path('/etc/cloudflare/certs/cloudflare-containers-ca.crt')
    if ca.exists():
        context.load_verify_locations(cafile=str(ca))
    return urllib.request.build_opener(NoRedirect, urllib.request.HTTPSHandler(context=context))


def callback(config, action, data):
    if config['callback_url'] != CALLBACK:
        raise Rejected('PROCESSOR_UNAVAILABLE')
    body = json.dumps({'version_id': config['version_id'], 'lease_token': config['lease_token'], 'action': action, 'data': data}).encode()
    req = urllib.request.Request(CALLBACK, data=body, headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + config['callback_token']})
    with opener().open(req, timeout=25) as response:
        if response.status != 200:
            raise Rejected('PROCESSOR_UNAVAILABLE')


def download(config, target):
    parsed = urlparse(config['source_url'])
    if parsed.scheme != 'https' or parsed.netloc != R2_HOST or not parsed.path.startswith('/conduit-ingestion-staging/source/'):
        raise Rejected('PROCESSOR_UNAVAILABLE')
    expected = config['expected_bytes']
    if not isinstance(expected, int) or not 0 < expected <= FILE_LIMIT:
        raise Rejected('SIZE_MISMATCH')
    digest = hashlib.sha256()
    size = 0
    with opener().open(config['source_url'], timeout=30) as response, open(target, 'wb') as output:
        while chunk := response.read(1024 * 1024):
            size += len(chunk)
            if size > expected:
                raise Rejected('SIZE_MISMATCH')
            digest.update(chunk)
            output.write(chunk)
    if size != expected:
        raise Rejected('SIZE_MISMATCH')
    return digest.hexdigest()


def validate(path, expected):
    if Path(path).stat().st_size != expected or not 0 < expected <= FILE_LIMIT:
        raise Rejected('SIZE_MISMATCH')
    with open(path, 'rb') as source:
        if source.read(5) != b'%PDF-':
            raise Rejected('INVALID_PDF')
    try:
        with pikepdf.open(path, attempt_recovery=False, suppress_warnings=True) as document:
            if document.is_encrypted:
                raise Rejected('ENCRYPTED_PDF')
            if not 1 <= len(document.pages) <= PAGE_LIMIT:
                raise Rejected('PAGE_LIMIT')
            if document.check_pdf_syntax():
                raise Rejected('CORRUPT_PDF')
            count = len(document.pages)
    except pikepdf.PasswordError:
        raise Rejected('ENCRYPTED_PDF') from None
    except pikepdf.PdfError:
        raise Rejected('CORRUPT_PDF') from None
    return count


def prepare(path, emit):
    with pdfium.PdfDocument(str(path)) as document:
        for number in range(len(document)):
            page = document[number]
            try:
                width, height = page.get_size()
                if not all(math.isfinite(n) and 0 < n <= 14400 for n in [width, height]):
                    raise Rejected('PAGE_DIMENSIONS')
                text_page = page.get_textpage()
                try:
                    if text_page.count_chars() > 100000:
                        raise Rejected('OUTPUT_LIMIT')
                    text = text_page.get_text_range()
                finally:
                    text_page.close()
                data = {'page_number': number + 1, 'width_points': width, 'height_points': height, 'text': text}
                if not text.strip():
                    scale = min(1.0, math.sqrt(4_000_000 / (width * height)))
                    bitmap = page.render(scale=scale)
                    try:
                        image = bitmap.to_pil()
                        with io.BytesIO() as output:
                            image.save(output, format='PNG')
                            encoded = output.getvalue()
                            if len(encoded) > 2_000_000:
                                raise Rejected('OUTPUT_LIMIT')
                            data['image_base64'] = base64.b64encode(encoded).decode()
                        image.close()
                    finally:
                        bitmap.close()
                emit(data)
            finally:
                page.close()


def run(config, directory):
    path = Path(directory) / 'source.pdf'
    digest = download(config, path)
    count = validate(path, config['expected_bytes'])
    callback(config, 'validated', {'page_count': count, 'sha256': digest})
    prepare(path, lambda page: callback(config, 'page', page))
    callback(config, 'completed', {})


if __name__ == '__main__':
    # Linux container limits apply to the entire native parsing child.
    if sys.platform == 'linux':
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (2 * 1024**3, 2 * 1024**3))
        resource.setrlimit(resource.RLIMIT_CPU, (480, 480))
        resource.setrlimit(resource.RLIMIT_FSIZE, (300_000_000, 300_000_000))
        resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))
    config = json.loads(sys.stdin.buffer.read(16384))
    try:
        run(config, os.environ['JOB_DIRECTORY'])
    except Rejected as error:
        try:
            callback(config, 'failed', {'error_code': str(error), 'retryable': str(error) == 'PROCESSOR_UNAVAILABLE'})
        except Exception:
            sys.exit(2)
    except Exception:
        # Do not print PDF parser strings, paths, document contents or URLs.
        sys.exit(2)
