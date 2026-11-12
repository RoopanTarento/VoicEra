"""Write the built-in schemes' knowledge packs as PDF files.

Usage: PYTHONPATH="$PWD:$PWD/apps/api" .venv/bin/python scripts/secure/build_knowledge_packs.py [out_dir]

The same PDFs are added to an organisation's knowledge base automatically when
an agent is written for a scheme (app.services.knowledge_packs.ensure_packs);
this script only produces copies to read, share or upload by hand.
"""

from __future__ import annotations

import sys
from pathlib import Path

from app.services import knowledge_packs, use_cases


def main() -> None:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "docs/secure/knowledge-packs")
    out.mkdir(parents=True, exist_ok=True)
    for scheme in use_cases.SCHEMES:
        full = use_cases._builtin_scheme(scheme)
        path = out / knowledge_packs.pack_filename(full)
        path.write_bytes(knowledge_packs.pack_pdf(full))
        print(f"{path}  ({path.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
