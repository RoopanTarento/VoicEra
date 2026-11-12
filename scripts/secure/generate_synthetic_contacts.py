"""Write a synthetic contact CSV for VoicEra Secure demos.

    PYTHONPATH="$PWD:$PWD/apps/api" python scripts/secure/generate_synthetic_contacts.py \
        --count 100 --out frontend/public/samples/secure_contacts_sample_100.csv

The file contains 4 duplicate rows (two exact, two reformatted) and 3 invalid
rows so validation has something to report. Upload it with "Synthetic demo
data" switched on: synthetic contacts can only be dialled through the mock
telephony provider.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from app.services.secure.synthetic import generate_csv


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--count", type=int, default=100)
    parser.add_argument("--seed", type=int, default=20261109)
    parser.add_argument("--out", type=Path, default=Path("frontend/public/samples/secure_contacts_sample_100.csv"))
    args = parser.parse_args()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(generate_csv(args.count, seed=args.seed), encoding="utf-8")
    print(f"Wrote {args.count} synthetic rows to {args.out}")


if __name__ == "__main__":
    main()
