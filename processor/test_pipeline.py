"""Synthetic-only native parser checks; no customer files or network calls."""
import hashlib
import io
from PIL import Image, ImageChops
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import pikepdf
import pipeline


def fixture(path, pages=2, text=True, encryption=None, dimensions=(595, 842)):
    with pikepdf.new() as pdf:
        font = pdf.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1, BaseFont=pikepdf.Name.Helvetica))
        for n in range(pages):
            page = pdf.add_blank_page(page_size=dimensions)
            page.Resources = pikepdf.Dictionary(Font=pikepdf.Dictionary(F1=font))
            content = f'BT /F1 18 Tf 40 770 Td (SYNTHETIC CONDUIT TENDER - Page {n+1}) Tj ET\n' if text else ''
            content += '40 100 500 600 re S\n40 300 m 540 300 l S\n'
            page.Contents = pdf.make_stream(content.encode('ascii'))
        pdf.save(path, encryption=encryption)


class ProcessorTests(unittest.TestCase):
    def test_greyscale_reference_is_pixel_identical_without_rgb_overhead(self):
        image = Image.effect_noise((1200, 1200), 3).convert('RGB')
        encoded = pipeline.encode_reference(image)
        with Image.open(io.BytesIO(encoded)) as restored:
            self.assertEqual(restored.mode, 'L')
            self.assertEqual(restored.size, image.size)
            self.assertIsNone(ImageChops.difference(restored.convert('RGB'), image).getbbox())

    def test_colour_reference_keeps_colour(self):
        image = Image.new('RGB', (50, 50), (255, 40, 90))
        with Image.open(io.BytesIO(pipeline.encode_reference(image))) as restored:
            self.assertEqual(restored.getpixel((0, 0)), (255, 40, 90))

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'synthetic.pdf'

    def tearDown(self):
        self.temp.cleanup()

    def test_text_pages_and_dimensions(self):
        fixture(self.path)
        self.assertEqual(pipeline.validate(self.path, self.path.stat().st_size), 2)
        emitted = []
        pipeline.prepare(self.path, emitted.append)
        self.assertEqual([p['page_number'] for p in emitted], [1, 2])
        self.assertTrue(all('SYNTHETIC CONDUIT' in p['text'] for p in emitted))
        self.assertEqual(emitted[0]['width_points'], 595)
        self.assertNotIn('image_base64', emitted[0])

    def test_drawings_without_text_have_rendered_reference_payload(self):
        fixture(self.path, pages=1, text=False)
        emitted = []
        pipeline.prepare(self.path, emitted.append)
        self.assertTrue(emitted[0]['image_base64'].startswith('iVBOR'))

    def test_encrypted_with_and_without_user_password(self):
        for password in ['synthetic-only-password', '']:
            fixture(self.path, encryption=pikepdf.Encryption(owner='synthetic-owner', user=password))
            with self.assertRaisesRegex(pipeline.Rejected, 'ENCRYPTED_PDF'):
                pipeline.validate(self.path, self.path.stat().st_size)

    def test_fake_pdf(self):
        self.path.write_bytes(b'<html>not a PDF</html>')
        with self.assertRaisesRegex(pipeline.Rejected, 'INVALID_PDF'):
            pipeline.validate(self.path, self.path.stat().st_size)

    def test_corrupt_pdf(self):
        fixture(self.path)
        self.path.write_bytes(self.path.read_bytes()[:200])
        with self.assertRaisesRegex(pipeline.Rejected, 'CORRUPT_PDF'):
            pipeline.validate(self.path, self.path.stat().st_size)

    def test_actual_size_is_enforced(self):
        fixture(self.path)
        for size in [0, self.path.stat().st_size + 1, 250_000_001]:
            with self.assertRaisesRegex(pipeline.Rejected, 'SIZE_MISMATCH'):
                pipeline.validate(self.path, size)

    def test_page_count_bound(self):
        fixture(self.path, pages=2001)
        with self.assertRaisesRegex(pipeline.Rejected, 'PAGE_LIMIT'):
            pipeline.validate(self.path, self.path.stat().st_size)

    def test_source_url_never_fetches_foreign_hosts(self):
        for url in ['http://127.0.0.1/a', 'https://evil.example/source/x', 'https://'+pipeline.R2_HOST+'/other-bucket/source/x']:
            with self.assertRaisesRegex(pipeline.Rejected, 'PROCESSOR_UNAVAILABLE'):
                pipeline.download({'source_url': url, 'expected_bytes': 100}, self.path)

    def test_invalid_source_never_starts_preparation(self):
        self.path.write_bytes(b'not-pdf')
        def download(_config, target):
            Path(target).write_bytes(b'not-pdf')
            return hashlib.sha256(b'not-pdf').hexdigest()
        with patch.object(pipeline, 'download', download), patch.object(pipeline, 'prepare') as prepare, patch.object(pipeline, 'callback') as callback:
            with self.assertRaises(pipeline.Rejected):
                pipeline.run({'expected_bytes': 7}, self.temp.name)
            prepare.assert_not_called()
            callback.assert_not_called()


if __name__ == '__main__':
    unittest.main()
