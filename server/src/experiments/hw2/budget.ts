import type { SlotRecord } from './ledger.js';

/** Plan rev. 4.3 caps (USD): exploration, confirmatory, and the total across both. */
export const CAPS = { exploration: 0.5, confirmatory: 1.0, total: 1.5 } as const;

/**
 * What a slot counts against the budget: a refused slot costs nothing; a
 * terminal slot with a known cost counts that cost; everything else
 * (reserved, dispatched, ambiguous, or terminal with unknown cost) counts its
 * full reservation.
 */
export function charge(slot: SlotRecord): number {
  if (slot.state === 'refused') return 0;
  if ((slot.state === 'completed' || slot.state === 'failed') && slot.cost_usd !== null) return slot.cost_usd;
  return slot.reservation_usd;
}

export function spent(slots: Iterable<SlotRecord>, phase?: SlotRecord['phase']): number {
  let total = 0;
  for (const slot of slots) if (!phase || slot.phase === phase) total += charge(slot);
  return total;
}

/** Whether one more slot with this reservation fits both its phase cap and the total cap. */
export function fits(slots: SlotRecord[], phase: SlotRecord['phase'], reservationUsd: number): { ok: boolean; reason: string | null } {
  const phaseSpent = spent(slots, phase);
  const totalSpent = spent(slots);
  if (phaseSpent + reservationUsd > CAPS[phase] + 1e-12) {
    return { ok: false, reason: `${phase} budget: $${phaseSpent.toFixed(6)} charged + $${reservationUsd} reservation > $${CAPS[phase]}` };
  }
  if (totalSpent + reservationUsd > CAPS.total + 1e-12) {
    return { ok: false, reason: `total budget: $${totalSpent.toFixed(6)} charged + $${reservationUsd} reservation > $${CAPS.total}` };
  }
  return { ok: true, reason: null };
}

/** Pre-Gate-4 rule: the whole confirmatory schedule must fit at its per-slot worst case. */
export function scheduleFits(slotCount: number, perSlotWorstCaseUsd: number): boolean {
  return slotCount * perSlotWorstCaseUsd <= CAPS.confirmatory + 1e-12;
}
