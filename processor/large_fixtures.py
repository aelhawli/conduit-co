"""Generate exact-size synthetic PDFs with drawings and image pages.

The unused binary stream fills the exact byte boundary; it is not representative
of extra page complexity. Image/drawing pages exercise actual preparation.
"""
import argparse
import hashlib
import json
from pathlib import Path
import time

import pikepdf
import pipeline
from test_pipeline import fixture


def large_fixture(path, target):
    fixture(path, pages=12, text=False)
    with pikepdf.open(path, allow_overwriting_input=True) as pdf:
        # Unique deterministic synthetic RGB images, never customer material.
        for number, page in enumerate(pdf.pages):
            raw = hashlib.shake_256(f'conduit-synthetic-{number}'.encode()).digest(512*512*3)
            image = pdf.make_stream(raw)
            image.Type = pikepdf.Name.XObject
            image.Subtype = pikepdf.Name.Image
            image.Width = 512
            image.Height = 512
            image.ColorSpace = pikepdf.Name.DeviceRGB
            image.BitsPerComponent = 8
            page.Resources.XObject = pikepdf.Dictionary(Im1=image)
            page.Contents = pdf.make_stream(b'q 400 0 0 400 70 200 cm /Im1 Do Q')
        padding = target - 12*512*512*3 - 10000
        for _ in range(5):
            pdf.Root.SyntheticBoundaryPadding = pdf.make_stream(b'X'*padding)
            pdf.save(path, compress_streams=False, object_stream_mode=pikepdf.ObjectStreamMode.disable)
            difference = target-path.stat().st_size
            if difference == 0:
                return
            padding += difference
        raise RuntimeError('Exact byte boundary generation failed')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', required=True)
    args = parser.parse_args()
    directory = Path(args.directory)
    directory.mkdir(parents=True, exist_ok=True)
    results = []
    for size in [50_000_000, 100_000_000, 250_000_000]:
        path = directory/f'synthetic-{size//1_000_000}MB.pdf'
        large_fixture(path, size)
        started = time.monotonic()
        count = pipeline.validate(path, size)
        prepared = []
        pipeline.prepare(path, lambda p: prepared.append(p['page_number']))
        results.append({'bytes': size, 'pages': count, 'prepared_pages': len(prepared), 'local_processing_seconds': round(time.monotonic()-started, 3)})
    print(json.dumps(results))
