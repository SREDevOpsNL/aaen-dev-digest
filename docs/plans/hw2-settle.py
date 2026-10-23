"""HW2 offline settlement across every stack's ledger (operator guide).

Reads ledgers only; prints each stack's conservative charge, the totals and
the slots never to replay; fails closed (`FAILED`, exit 1). Usage:

    python3 -I hw2-settle.py "$HOME/.devdigest/hw2-experiments"

Environment (all optional):
  SETTLE_EXPECT       stacks that must have a ledger (space-separated ids)
  SETTLE_NEW          stacks that must be fresh: their directory exists (made
                      by `scripts/e2e.sh --serve`), with no ledger yet, no
                      kept token of an earlier slot and no runner lock
  SETTLE_KEY_USAGE    the dedicated key's usage (USD) to check against the ledgers
  SETTLE_NEXT_STACK, SETTLE_STACK_MAX, SETTLE_ENVELOPE, SETTLE_RESERVATION
                      size the next capability of that stack and refuse one
                      that does not fit; the stack must be in SETTLE_EXPECT or
                      SETTLE_NEW, and must have no unresolved slot
"""
import glob, json, os, sys
from decimal import Decimal

ROOT = sys.argv[1]
# Closed stacks: their ledgers must exist and keep these conservative charges (USD).
PINNED = {"hw2f-f53ed971": Decimal("0.01022896"), "hw2f-39febf41": Decimal("0.01017892")}
EXPECTED = os.environ.get("SETTLE_EXPECT", "").split()
NEW = os.environ.get("SETTLE_NEW", "").split()
TERMINAL = {"completed", "failed", "refused", "ambiguous"}
STATES = TERMINAL | {"reserved", "dispatched"}
usd = lambda v: Decimal(str(v))
problems = []
ledgers = {os.path.basename(os.path.dirname(p)): p for p in glob.glob(os.path.join(ROOT, "hw2f-*", "ledger.jsonl"))}
problems += [f"{stack}: ledger missing" for stack in sorted(set(PINNED) | set(EXPECTED)) if stack not in ledgers]
for stack in sorted(set(NEW)):
    directory = os.path.join(ROOT, stack)
    if stack in PINNED or stack in EXPECTED:
        problems.append(f"{stack}: listed as new, but it is a pinned or expected stack")
    elif not os.path.isdir(directory):
        problems.append(f"{stack}: listed as new, but its stack directory does not exist")
    elif stack in ledgers:
        problems.append(f"{stack}: listed as new, but it already has a ledger (list it in SETTLE_EXPECT)")
    else:
        # A first-use stack has never run a slot: its ledger is missing, not lost.
        # A kept token (an earlier slot's) or a runner lock says otherwise. The
        # live capability of the lifecycle in progress does not: the lifecycle
        # refuses to start while any capability or unkept token exists.
        traces = sorted(n for n in os.listdir(directory) if n.startswith("capability.token.") or n == "runner.lock")
        if traces:
            problems.append(f"{stack}: listed as new, but it has no ledger and {', '.join(traces)}: a ledger may be lost; investigate")
slots, ignored = {}, 0
for stack, path in sorted(ledgers.items()):
    try:
        lines = open(path, encoding="utf-8").read().splitlines()
    except (OSError, UnicodeDecodeError) as err:
        problems.append(f"{stack}: ledger unreadable ({type(err).__name__})")
        continue
    for n, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            event = json.loads(line, parse_float=Decimal)
            valid = isinstance(event, dict) and isinstance(event.get("slot_id"), str) and event.get("state") in STATES \
                and event.get("phase") in ("exploration", "confirmatory") and isinstance(event.get("reservation_usd"), (int, Decimal)) \
                and (event.get("cost_usd") is None or isinstance(event.get("cost_usd"), (int, Decimal)))
        except ValueError:
            valid = False
        if not valid:
            problems.append(f"{stack}: line {n} is not a ledger event")
            continue
        key = (stack, event["slot_id"])
        current = slots.get(key)
        if current and current["state"] in TERMINAL:
            ignored += 1
            continue
        slots[key] = {"state": event["state"], "phase": event["phase"], "reservation": usd(event["reservation_usd"]),
                      "cost": None if event.get("cost_usd") is None else usd(event["cost_usd"])}
def charge(slot):
    if slot["state"] == "refused":
        return Decimal(0)
    if slot["state"] in ("completed", "failed") and slot["cost"] is not None:
        return slot["cost"]
    return slot["reservation"]
name = lambda key: f"({key[0]}, {key[1]})"
by_stack = {stack: sum((charge(s) for k, s in slots.items() if k[0] == stack), Decimal(0)) for stack in sorted({k[0] for k in slots})}
for stack, charged in by_stack.items():
    print(f"stack {stack}: {sum(1 for k in slots if k[0] == stack)} slot(s), charged ${charged}")
for stack in sorted(set(NEW) - set(ledgers)):
    print(f"stack {stack}: new, no ledger yet, charged $0")
problems += [f"{stack}: charged ${by_stack.get(stack, 0)}, but closed at ${pin}" for stack, pin in PINNED.items() if stack in ledgers and by_stack.get(stack, Decimal(0)) != pin]
spent = {phase: sum((charge(s) for s in slots.values() if s["phase"] == phase), Decimal(0)) for phase in ("exploration", "confirmatory")}
total = spent["exploration"] + spent["confirmatory"]
for state in sorted({s["state"] for s in slots.values()}):
    print(f"{state}: {', '.join(sorted(name(k) for k, s in slots.items() if s['state'] == state))}")
print(f"charged: exploration ${spent['exploration']}, confirmatory ${spent['confirmatory']}, total ${total}")
print(f"remaining confirmatory budget at most ${max(Decimal(0), min(Decimal('1.00') - spent['confirmatory'], Decimal('1.50') - total))}")
print("never replay: " + (", ".join(sorted(name(k) for k, s in slots.items() if s["state"] != "refused")) or "(none)"))
if ignored:
    print(f"events after a slot's terminal state (ignored, as by the runner): {ignored}")
if os.environ.get("SETTLE_KEY_USAGE"):
    usage = Decimal(os.environ["SETTLE_KEY_USAGE"])
    known = sum((s["cost"] for s in slots.values() if s["state"] in ("completed", "failed") and s["cost"] is not None), Decimal(0))
    unknown = sum((s["reservation"] for s in slots.values() if s["state"] != "refused" and not (s["state"] in ("completed", "failed") and s["cost"] is not None)), Decimal(0))
    print(f"key usage ${usage}: known costs ${known}, unknown-cost reservations ${unknown}")
    if not (known - Decimal("0.000001") <= usage <= known + unknown + Decimal("0.000001")):
        problems.append(f"key usage ${usage} is outside [{known}, {known + unknown}]: the key spent what the ledgers do not explain")
if os.environ.get("SETTLE_NEXT_STACK"):
    stack, reservation = os.environ["SETTLE_NEXT_STACK"], Decimal(os.environ["SETTLE_RESERVATION"])
    stack_max, envelope = Decimal(os.environ["SETTLE_STACK_MAX"]), Decimal(os.environ["SETTLE_ENVELOPE"])
    if stack not in EXPECTED and stack not in NEW:
        problems.append(f"the next stack {stack} is in neither SETTLE_EXPECT nor SETTLE_NEW")
    unresolved = sorted(name(k) for k, s in slots.items() if k[0] == stack and s["state"] not in TERMINAL)
    if unresolved:
        problems.append(f"{stack} has unresolved slots {', '.join(unresolved)}: reconcile first")
    capability = by_stack.get(stack, Decimal(0)) + reservation
    print(f"next capability for {stack}: ${capability} (stack maximum ${stack_max}; exploration ${spent['exploration'] + reservation} of ${envelope})")
    if capability > stack_max or spent["exploration"] + reservation > envelope:
        problems.append(f"the next {stack} slot does not fit: ${capability} of ${stack_max}, or ${spent['exploration'] + reservation} of the ${envelope} envelope")
if problems:
    sys.exit("FAILED:\n" + "\n".join(problems))
print("settled")
