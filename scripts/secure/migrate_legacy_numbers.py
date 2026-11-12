"""Protect phone numbers stored in plain text before VoicEra Secure.

Dry run (default) reports what would change:

    PYTHONPATH="$PWD:$PWD/apps/api" python scripts/secure/migrate_legacy_numbers.py

Apply:

    PYTHONPATH="$PWD:$PWD/apps/api" python scripts/secure/migrate_legacy_numbers.py --apply

Delete the legacy campaign CSV files from object storage too (irreversible;
run without it first and review the list):

    PYTHONPATH="$PWD:$PWD/apps/api" python scripts/secure/migrate_legacy_numbers.py --apply --delete-source-files

Needs the same environment as the API (database, SECURE_VAULT_KEYS).
"""

from __future__ import annotations

import argparse
import json


def main() -> None:
    parser = argparse.ArgumentParser(description="Protect legacy plaintext phone numbers")
    parser.add_argument("--apply", action="store_true", help="Write changes (default is a dry run)")
    parser.add_argument("--delete-source-files", action="store_true", help="Also delete legacy campaign CSVs from MinIO")
    args = parser.parse_args()

    from app.database import connect_to_mongo
    from app.services.secure import migration

    connect_to_mongo()
    report = migration.run(apply=args.apply)
    if args.apply and args.delete_source_files:
        from app.storage.minio_client import MinIOStorage

        storage = MinIOStorage()
        deleted = 0
        for item in report["legacy_csv_objects"]:
            storage.client.remove_object(storage.default_bucket, item["object"])
            deleted += 1
        report["legacy_csv_objects_deleted"] = deleted
    print(json.dumps(report, indent=2, default=str))
    if not args.apply:
        print("\nDry run: nothing was changed. Re-run with --apply to migrate.")


if __name__ == "__main__":
    main()
