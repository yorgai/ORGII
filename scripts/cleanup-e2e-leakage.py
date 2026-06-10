#!/usr/bin/env python3
"""One-shot cleanup for E2E fixtures leaked into the real ~/.orgii.

Before wdio.conf.mjs made isolation the default (E2E_USE_REAL_HOME opt-in),
non-isolated E2E runs wrote spec fixtures ("E2E Custom Member Agent ...",
"E2E Strict Org ...") into the user's actual agent-definitions.json /
agent-orgs.json whenever a spec crashed before its finally-cleanup.

This script removes every entry whose name starts with "E2E " from both
files. A timestamped backup of each file is written next to it first.

Usage:
    python3 scripts/cleanup-e2e-leakage.py            # dry run (list only)
    python3 scripts/cleanup-e2e-leakage.py --apply    # delete with backup
"""

import json
import os
import shutil
import sys
import time

HOME = os.environ.get("ORGII_HOME", os.path.expanduser("~/.orgii"))
TARGETS = ["agent-definitions.json", "agent-orgs.json"]


def is_leaked(entry: dict) -> bool:
    return entry.get("name", "").startswith("E2E ")


def main() -> int:
    apply = "--apply" in sys.argv
    stamp = time.strftime("%Y%m%d-%H%M%S")
    total_removed = 0

    for filename in TARGETS:
        path = os.path.join(HOME, filename)
        if not os.path.exists(path):
            print(f"skip {filename}: not found")
            continue
        with open(path) as fh:
            entries = json.load(fh)
        leaked = [e for e in entries if is_leaked(e)]
        kept = [e for e in entries if not is_leaked(e)]
        print(f"{filename}: {len(entries)} total, {len(leaked)} E2E-leaked")
        for entry in leaked[:10]:
            print(f"  - {entry.get('id', '?')[:13]}... {entry.get('name')}")
        if len(leaked) > 10:
            print(f"  ... and {len(leaked) - 10} more")
        total_removed += len(leaked)
        if apply and leaked:
            backup = f"{path}.bak-{stamp}"
            shutil.copy2(path, backup)
            with open(path, "w") as fh:
                json.dump(kept, fh, indent=2)
            print(f"  wrote {len(kept)} entries (backup: {backup})")

    if not apply:
        print(f"\nDRY RUN — {total_removed} entries would be removed. "
              "Re-run with --apply to delete (backups are written first).")
    else:
        print(f"\nRemoved {total_removed} leaked entries.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
