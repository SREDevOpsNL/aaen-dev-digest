/**
 * HW2 experiment schedule: immutable slot ids and a balanced, randomized
 * interleave from a recorded seed, so the order is reproducible and committed
 * in the pre-registration before any confirmatory run.
 */

export type Condition = 'with' | 'without';
export type Phase = 'exploration' | 'confirmatory';

export interface Slot {
  /** Immutable and unique: `<phase>-<experiment>-<condition>-<trial>`. */
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

export const slotId = (phase: Phase, experiment: string, condition: Condition, trial: number) =>
  `${phase === 'confirmatory' ? 'c' : 'x'}-${experiment}-${condition}-${trial}`;

/**
 * Balanced interleave: one with/without pair per experiment and trial; pairs
 * are shuffled (Fisher–Yates), and the order inside each pair is a coin flip.
 */
export function buildSchedule(args: { seed: number; phase: Phase; experiments: string[]; trials: number }): Slot[] {
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
        slot_id: slotId(args.phase, pair.experiment, condition, pair.trial),
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
