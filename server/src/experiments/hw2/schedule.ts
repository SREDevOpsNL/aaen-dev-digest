/**
 * HW2 experiment schedule: immutable slot ids and a balanced, randomized
 * interleave from a recorded seed, so the order is reproducible and committed
 * in the pre-registration before any confirmatory run.
 */

export type Condition = 'with' | 'without';
export type Phase = 'exploration' | 'confirmatory';

export interface Slot {
  /** Immutable and unique: `<phase>-<experiment>-<condition>-<trial>`, or `c-<tag>-…` in a successor study. */
  slot_id: string;
  index: number;
  phase: Phase;
  experiment: string;
  condition: Condition;
  trial: number;
}

/** mulberry32: a small seeded PRNG with a recorded seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A study tag (`v4`, …) names a successor study's confirmatory slots:
 * `c-<tag>-<experiment>-<condition>-<trial>`. It keeps the `c-` prefix the
 * server's admission check requires, and since an experiment is all digits
 * and a tag starts with a letter, a tagged ID never equals an untagged one.
 */
const STUDY_TAG = /^v[0-9]{1,3}$/;

export function slotId(phase: Phase, experiment: string, condition: Condition, trial: number, tag?: string): string {
  if (tag === undefined) return `${phase === 'confirmatory' ? 'c' : 'x'}-${experiment}-${condition}-${trial}`;
  if (!STUDY_TAG.test(tag)) throw new Error(`Study tag "${tag}" is not v<number>`);
  if (phase !== 'confirmatory') throw new Error('A study tag names confirmatory slots only');
  return `c-${tag}-${experiment}-${condition}-${trial}`;
}

/** Untagged (v3 and exploration) and tagged (successor study) slot IDs, never matching each other. */
export const UNTAGGED_SLOT_ID = /^(c|x)-([0-9]+)-(with|without)-([1-9][0-9]*)$/;
export const TAGGED_SLOT_ID = /^c-(v[0-9]{1,3})-([0-9]+)-(with|without)-([1-9][0-9]*)$/;

/** The parts of a scheduled slot ID, or null when it is not one. */
export function parseSlotId(id: string): { phase: Phase; tag: string | null; experiment: string; condition: Condition; trial: number } | null {
  const untagged = UNTAGGED_SLOT_ID.exec(id);
  if (untagged) {
    return { phase: untagged[1] === 'c' ? 'confirmatory' : 'exploration', tag: null, experiment: untagged[2]!, condition: untagged[3] as Condition, trial: Number(untagged[4]) };
  }
  const tagged = TAGGED_SLOT_ID.exec(id);
  if (tagged) return { phase: 'confirmatory', tag: tagged[1]!, experiment: tagged[2]!, condition: tagged[3] as Condition, trial: Number(tagged[4]) };
  return null;
}

/**
 * Balanced interleave: one with/without pair per experiment and trial; pairs
 * are shuffled (Fisher–Yates), and the order inside each pair is a coin flip.
 */
export function buildSchedule(args: { seed: number; phase: Phase; experiments: string[]; trials: number; tag?: string }): Slot[] {
  const random = mulberry32(args.seed);
  const pairs: Array<{ experiment: string; trial: number }> = [];
  for (const experiment of args.experiments) {
    for (let trial = 1; trial <= args.trials; trial++) pairs.push({ experiment, trial });
  }
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pairs[i], pairs[j]] = [pairs[j]!, pairs[i]!];
  }
  const slots: Slot[] = [];
  for (const pair of pairs) {
    const order: Condition[] = random() < 0.5 ? ['with', 'without'] : ['without', 'with'];
    for (const condition of order) {
      slots.push({
        slot_id: slotId(args.phase, pair.experiment, condition, pair.trial, args.tag),
        index: slots.length,
        phase: args.phase,
        experiment: pair.experiment,
        condition,
        trial: pair.trial,
      });
    }
  }
  return slots;
}
