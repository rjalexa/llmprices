from dataclasses import dataclass, field
from pathlib import Path

import yaml


class FamilyConfigError(Exception):
    """Raised when families.yaml is malformed or references unknown models."""


@dataclass(frozen=True)
class Family:
    key: str
    label: str
    vendor: str
    group: str
    members: list[str]
    variants: list[str] = field(default_factory=list)

    @property
    def all_ids(self) -> list[str]:
        return [*self.members, *self.variants]


@dataclass(frozen=True)
class Fork:
    """A generation that fans out into multiple tiers: `from_id` was current
    when the split happened; `to_ids` are the tiers that came out of it."""

    from_id: str
    to_ids: list[str]


@dataclass(frozen=True)
class Roster:
    families: list[Family]
    blend_ratio: tuple[float, float]  # (input weight, output weight)
    forks: list[Fork] = field(default_factory=list)

    @property
    def ids(self) -> list[str]:
        seen: dict[str, None] = {}
        for fam in self.families:
            for mid in fam.all_ids:
                seen.setdefault(mid, None)
        return list(seen)


VALID_GROUPS = {"frontier-us", "china", "eu"}


def load_roster(path: Path) -> Roster:
    if not path.exists():
        raise FamilyConfigError(f"families file not found: {path}")
    doc = yaml.safe_load(path.read_text()) or {}

    meta = doc.get("meta") or {}
    ratio = meta.get("blend_ratio") or {}
    blend = (float(ratio.get("input", 3)), float(ratio.get("output", 1)))
    if blend[0] + blend[1] <= 0:
        raise FamilyConfigError("meta.blend_ratio weights must sum to > 0")

    raw_families = doc.get("families")
    if not raw_families:
        raise FamilyConfigError("families.yaml declares no families")

    families: list[Family] = []
    keys: set[str] = set()
    owner: dict[str, str] = {}
    problems: list[str] = []

    for i, raw in enumerate(raw_families):
        for required in ("key", "label", "vendor", "group", "members"):
            if not raw.get(required):
                problems.append(f"families[{i}]: missing required field '{required}'")
        key = raw.get("key", f"<index {i}>")
        if key in keys:
            problems.append(f"duplicate family key '{key}'")
        keys.add(key)
        if raw.get("group") not in VALID_GROUPS:
            problems.append(
                f"family '{key}': group '{raw.get('group')}' not in {sorted(VALID_GROUPS)}"
            )
        members = list(raw.get("members") or [])
        variants = list(raw.get("variants") or [])
        # A model belonging to two families would make `ordinal` ambiguous.
        for mid in [*members, *variants]:
            if mid in owner:
                problems.append(f"model '{mid}' claimed by both '{owner[mid]}' and '{key}'")
            owner[mid] = key
        families.append(
            Family(
                key=key,
                label=raw.get("label", key),
                vendor=raw.get("vendor", ""),
                group=raw.get("group", ""),
                members=members,
                variants=variants,
            )
        )

    # Forks may only reference models the roster already declares — a fork
    # target needs a family membership to have a series at all.
    forks: list[Fork] = []
    for i, raw in enumerate(doc.get("forks") or []):
        from_id = raw.get("from")
        to_ids = list(raw.get("to") or [])
        if not from_id or not to_ids:
            problems.append(f"forks[{i}]: needs both 'from' and a non-empty 'to' list")
            continue
        for mid in [from_id, *to_ids]:
            if mid not in owner:
                problems.append(f"forks[{i}]: '{mid}' is not a member of any family")
        if from_id in to_ids:
            problems.append(f"forks[{i}]: '{from_id}' cannot fork into itself")
        forks.append(Fork(from_id=from_id, to_ids=to_ids))

    if problems:
        raise FamilyConfigError("invalid families.yaml:\n  - " + "\n  - ".join(problems))
    return Roster(families=families, blend_ratio=blend, forks=forks)


def validate_against_ledger(roster: Roster, ledger_models: dict) -> None:
    """Fail loudly when a rostered id is absent upstream — that is how we learn
    a model was renamed or retired."""
    unknown = [mid for mid in roster.ids if mid not in ledger_models]
    if unknown:
        raise FamilyConfigError(
            f"{len(unknown)} model id(s) in families.yaml are absent from the ledger "
            f"(renamed or retired upstream?):\n  - " + "\n  - ".join(unknown)
        )
