import argparse
import sys
from pathlib import Path

from .config import settings
from .ingest.families import FamilyConfigError, load_roster
from .ingest.run import ingest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="atlas", description="LLM Price Atlas")
    sub = parser.add_subparsers(dest="command", required=True)

    p_ingest = sub.add_parser("ingest", help="fetch upstream data into SQLite")
    p_ingest.add_argument("--ledger", type=Path, help="local prices.json instead of the network")
    p_ingest.add_argument("--snapshot", type=Path, help="local output.json instead of the network")
    p_ingest.add_argument("--force", action="store_true", help="ingest even if upstream is unchanged")

    sub.add_parser("validate", help="check families.yaml parses and has no duplicate ids")

    p_export = sub.add_parser(
        "export-static",
        help="bake the whole atlas into one JSON file for static hosting",
    )
    p_export.add_argument("--out", type=Path, required=True, help="path to write atlas.json")

    args = parser.parse_args(argv)

    try:
        if args.command == "ingest":
            result = ingest(
                ledger_path=args.ledger, snapshot_path=args.snapshot, force=args.force
            )
            print(result.summary())
        elif args.command == "validate":
            roster = load_roster(settings.families_file)
            print(f"ok: {len(roster.families)} families, {len(roster.ids)} model ids")
        elif args.command == "export-static":
            from .db import connect
            from .export_static import write_payload

            roster = load_roster(settings.families_file)
            conn = connect()
            try:
                path = write_payload(conn, roster.blend_ratio, args.out)
            finally:
                conn.close()
            print(f"wrote {path} ({path.stat().st_size / 1024:.0f} KB)")
    except FamilyConfigError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except Exception as exc:  # noqa: BLE001 - CLI boundary
        print(f"error: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
