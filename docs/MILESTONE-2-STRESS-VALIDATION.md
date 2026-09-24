# M2 construction workload validation — in progress

Staging only. Accepted predecessor d9f84b398a263466d0124fe425d814a7126201ad.
No production deployment or Milestone 3 work is authorized.

## Fixtures

`processor/construction_fixtures.py --directory <scratch-directory>` generates
synthetic architectural, electrical, structural and hydraulic sheets, vector
drawings and specification schedules. Development-only fixture dependencies:
ReportLab 4.4.9, NumPy 2.3.5, Pillow and PDFium from the pinned processor environment.
They are not added to the deployed processor image.

The raster pages model 150-dpi grayscale A1 scans with low-amplitude scanner grain.
All image streams are displayed; no padding, hidden filler or attachments. This is
a scanned-drawing workload, not proof for every CAD export, colour scan or 2,000-page
package. Synthetic drawings are not construction advice.

Generated packages: 95,595,553 bytes / 27 pages and 245,039,596 bytes / 73 pages.
Four discipline PDFs total 20,034,240 bytes / four pages. Per-page manifests record
dimensions, discipline, kind and source SHA-256. Samples were rendered and inspected.

## Issue and correction

The accepted processor rejected these valid scanned sheets with OUTPUT_LIMIT:
RGB PNG references exceeded 2 MB despite identical grayscale channels (one observed
page 2,077,764 bytes). Lossless channel collapse produces a 1,441,689-byte grayscale
PNG at exactly the same pixel dimensions and values. Colour pages remain colour;
the existing pixel and byte bounds stay unchanged. Regression tests verify pixel
identity and colour preservation. No quality reduction or limit bypass is used.

Numeric-only processor telemetry reports download, hashing, strict validation,
preparation (including page callbacks), peak child RSS and CPU time. Hashing is part
of the streaming download, so these durations must not be summed. Parent server and
Worker both allowlist metrics. PDF text, parser error strings, URLs and credentials
are excluded. Container timeout/OOM can prevent the child summary; status and
database job/lease state remain the evidence for those failures.

Local checks passed for every generated page and dimension. Local timings are not
hosted performance measurements. Hosted stress tests and physical iPhone validation
remain pending; production preflight is not cleared.
