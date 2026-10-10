"""Bounded text-only PDF extraction. A blank/scanned page never becomes full text."""
import io
import json
import sys
from pypdf import PdfReader

data = sys.stdin.buffer.read(6 * 1024 * 1024 + 1)
if len(data) > 6 * 1024 * 1024 or not data.startswith(b"%PDF-"):
    raise ValueError("PDF size or magic invalid")
reader = PdfReader(io.BytesIO(data), strict=True)
if reader.is_encrypted or not 1 <= len(reader.pages) <= 160:
    raise ValueError("Encrypted PDF or page limit")
texts = []
characters = 0
for page in reader.pages:
    text = page.extract_text() or ""
    if not text.strip() or "\ufffd" in text:
        raise ValueError("Page lacks reliable text; visual review/OCR required")
    characters += len(text.encode("utf-16-le")) // 2
    if characters > 160000:
        raise ValueError("Text limit; refusing truncation")
    texts.append(text)
print(json.dumps({"pages": texts}, ensure_ascii=False))
