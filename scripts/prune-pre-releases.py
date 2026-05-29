#!/usr/bin/env python3
"""
Prune pre-release builds from GitHub Releases.

Retention rules (applied in order - each pass sees only survivors of the prior one):
  1. Per ISO calendar week  → keep the 12 most recent
  2. Per calendar month     → keep the  7 most recent
  3. Hard cap               → keep at most 50 total

Usage:
  # Normal run (calls gh CLI against the real repo)
  python3 scripts/prune-pre-releases.py

  # Dry run - prints what would be deleted, touches nothing
  python3 scripts/prune-pre-releases.py --dry-run

  # Mock run - uses synthetic data instead of calling gh (no credentials needed)
  python3 scripts/prune-pre-releases.py --mock --dry-run

  # Mock run with a custom synthetic build count
  python3 scripts/prune-pre-releases.py --mock --mock-count 80 --dry-run
"""

import argparse
import json
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Callable


# ── Retention limits ──────────────────────────────────────────────────────────
WEEK_KEEP  = 12
MONTH_KEEP =  7
TOTAL_CAP  = 50


# ── Pruning algorithm ─────────────────────────────────────────────────────────
def prune_buckets(
    releases: list[dict],
    key_fn: Callable[[datetime], str],
    keep: int,
    to_delete: set[str],
) -> None:
    """Mark tags beyond `keep` in each bucket for deletion.

    `releases` must be sorted newest-first so tags[keep:] are always the oldest
    within a bucket.
    """
    buckets: dict[str, list[str]] = defaultdict(list)
    for r in releases:
        dt = datetime.fromisoformat(r["createdAt"].replace("Z", "+00:00"))
        buckets[key_fn(dt)].append(str(r["tagName"]))
    for tags in buckets.values():
        if len(tags) > keep:
            to_delete.update(tags[keep:])


def compute_deletions(releases: list[dict]) -> set[str]:
    """Return the set of tags that should be deleted given the retention rules."""
    # Only commit-pinned pre-releases; excludes "edge" and semver tags.
    pre = [
        r for r in releases
        if r.get("isPrerelease") and str(r["tagName"]).startswith("v0.0.0-pre.")
    ]

    # Newest first - all bucket slices preserve this order.
    pre.sort(key=lambda r: r["createdAt"], reverse=True)

    to_delete: set[str] = set()

    # Pass 1 - weekly (%G-W%V is ISO 8601: correct across year boundaries)
    prune_buckets(pre, lambda dt: dt.strftime("%G-W%V"), WEEK_KEEP, to_delete)

    # Pass 2 - monthly (survivors from pass 1 only)
    survivors = [r for r in pre if r["tagName"] not in to_delete]
    prune_buckets(survivors, lambda dt: dt.strftime("%Y-%m"), MONTH_KEEP, to_delete)

    # Pass 3 - hard cap (survivors from passes 1+2)
    survivors = [r for r in pre if r["tagName"] not in to_delete]
    if len(survivors) > TOTAL_CAP:
        to_delete.update(str(r["tagName"]) for r in survivors[TOTAL_CAP:])

    return to_delete


# ── Mock data generator ───────────────────────────────────────────────────────
def generate_mock_releases(count: int = 80) -> list[dict]:
    """Generate `count` synthetic pre-releases spread over time.

    Distribution (newest → oldest):
      - 20 releases in the past 7 days   (stress-tests the weekly rule)
      - 30 releases in the past 30 days  (stress-tests the monthly rule)
      - remainder spread over ~6 months  (stress-tests the hard cap)
    """
    now = datetime.now(timezone.utc)
    releases: list[dict] = []

    def make(offset_hours: float, index: int):
        ts = now - timedelta(hours=offset_hours)
        tag = f"v0.0.0-pre.mock{index:03d}"
        return {
            "tagName": tag,
            "createdAt": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "isPrerelease": True,
        }

    recent   = min(20, count)
    medium   = min(30, max(0, count - recent))
    old      = max(0, count - recent - medium)

    # Recent: spread evenly over past 7 days (168 hours)
    for i in range(recent):
        offset = (i / max(recent - 1, 1)) * 168
        releases.append(make(offset, i))

    # Medium: spread evenly over 7–30 days
    for i in range(medium):
        offset = 168 + (i / max(medium - 1, 1)) * (720 - 168)
        releases.append(make(offset, recent + i))

    # Old: spread evenly over 30 days – 6 months
    for i in range(old):
        offset = 720 + (i / max(old - 1, 1)) * (4320 - 720)
        releases.append(make(offset, recent + medium + i))

    return releases


# ── GitHub CLI helpers ────────────────────────────────────────────────────────
def fetch_releases() -> list[dict]:
    raw = subprocess.run(
        ["gh", "release", "list", "--limit", "200",
         "--json", "tagName,createdAt,isPrerelease"],
        capture_output=True, text=True, check=True,
    ).stdout
    return json.loads(raw)


def delete_release(tag: str) -> bool:
    result = subprocess.run(
        ["gh", "release", "delete", tag, "--yes", "--cleanup-tag"],
    )
    return result.returncode == 0


# ── Main ──────────────────────────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run",    action="store_true",
                        help="Print what would be deleted without deleting anything.")
    parser.add_argument("--mock",       action="store_true",
                        help="Use synthetic release data instead of calling gh.")
    parser.add_argument("--mock-count", type=int, default=80,
                        help="Number of synthetic releases to generate (default: 80).")
    args = parser.parse_args()

    # ── fetch ─────────────────────────────────────────────────────────────────
    if args.mock:
        releases = generate_mock_releases(args.mock_count)
        print(f"[mock] Generated {len(releases)} synthetic pre-releases.", file=sys.stderr)
    else:
        releases = fetch_releases()

    pre = [
        r for r in releases
        if r.get("isPrerelease") and str(r["tagName"]).startswith("v0.0.0-pre.")
    ]

    # ── compute ───────────────────────────────────────────────────────────────
    to_delete = compute_deletions(releases)
    survivors = [r for r in pre if r["tagName"] not in to_delete]

    print(
        f"Pre-releases: {len(pre)} total | "
        f"{len(to_delete)} to delete | "
        f"{len(survivors)} to keep",
        file=sys.stderr,
    )

    if not to_delete:
        print("Nothing to prune.", file=sys.stderr)
        sys.exit(0)

    mode = "[dry-run]" if args.dry_run else "[delete]"
    for tag in sorted(to_delete):
        print(f"  {mode} {tag}", file=sys.stderr)

    if args.dry_run:
        print("Dry run - no releases were deleted.", file=sys.stderr)
        sys.exit(0)

    # ── delete ────────────────────────────────────────────────────────────────
    errors = 0
    for tag in sorted(to_delete):
        if not delete_release(tag):
            print(f"  WARNING: failed to delete {tag}", file=sys.stderr)
            errors += 1

    print(
        f"Pruning complete - {len(to_delete) - errors} deleted, {errors} failed.",
        file=sys.stderr,
    )
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
