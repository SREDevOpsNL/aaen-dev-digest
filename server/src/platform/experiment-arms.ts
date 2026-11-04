/**
 * HW2 experiment mode: a slot armed for exactly one Run Review click on the PR
 * page (criteria 17–18 name "PR page → Run Review"). The experiments service
 * arms a slot only after every check a direct dispatch runs (capability,
 * isolation, unused slot id, budget) and with the spend gate already open for
 * it. The review route then consumes it once, for its own PR and agent only.
 * An arm that expires or is disarmed can never dispatch: it is gone from
 * here, and its gate is closed.
 */

export type ArmState = 'armed' | 'consumed' | 'expired' | 'disarmed';

export interface ArmedSlot<T> {
  slotId: string;
  workspaceId: string;
  prId: string;
  agentId: string;
  /** What a dispatch of this slot needs (the experiment request). */
  request: T;
}

/** How long an armed slot waits for its Run Review click. */
export const EXPERIMENT_ARM_TTL_MS = 10 * 60_000;

export class ExperimentArms<T = unknown> {
  private current: (ArmedSlot<T> & { expiresAt: number; timer: ReturnType<typeof setTimeout>; release: () => void }) | null = null;
  /** Last known state per slot id, for the reconciliation lookup. */
  private readonly states = new Map<string, { state: ArmState; expires_at: string }>();
  ttlMs = EXPERIMENT_ARM_TTL_MS;

  get armedSlot(): string | null {
    return this.current?.slotId ?? null;
  }

  /**
   * Arm one slot. `release` closes its spend gate; it runs when the arm
   * expires or is disarmed, never when the arm is consumed (the dispatched run
   * then owns the gate).
   */
  arm(slot: ArmedSlot<T>, release: () => void, now = Date.now()): { expires_at: string } {
    if (this.current) throw new Error(`Experiment slot ${this.current.slotId} is already armed`);
    const expiresAt = now + this.ttlMs;
    const timer = setTimeout(() => this.end(slot.slotId, 'expired'), this.ttlMs);
    timer.unref?.();
    this.current = { ...slot, expiresAt, timer, release };
    const expires_at = new Date(expiresAt).toISOString();
    this.states.set(slot.slotId, { state: 'armed', expires_at });
    return { expires_at };
  }

  /**
   * The armed slot for this click, consumed once: only for its own workspace,
   * PR and single agent, and only before it expires. Null otherwise; a click
   * that does not match leaves the arm in place.
   */
  take(workspaceId: string, prId: string, agentIds: string[], now = Date.now()): ArmedSlot<T> | null {
    const slot = this.current;
    if (!slot || slot.workspaceId !== workspaceId || slot.prId !== prId) return null;
    if (agentIds.length !== 1 || agentIds[0] !== slot.agentId) return null;
    if (now >= slot.expiresAt) {
      this.end(slot.slotId, 'expired');
      return null;
    }
    clearTimeout(slot.timer);
    this.current = null;
    this.states.set(slot.slotId, { state: 'consumed', expires_at: new Date(slot.expiresAt).toISOString() });
    const { expiresAt: _expiresAt, timer: _timer, release: _release, ...armed } = slot;
    return armed;
  }

  /** True when a slot is armed for this workspace and PR (a non-matching click is then refused, not run). */
  armedFor(workspaceId: string, prId: string): boolean {
    return this.current?.workspaceId === workspaceId && this.current.prId === prId;
  }

  /** Disarm before the click; false when this slot is not armed. */
  disarm(slotId: string): boolean {
    if (this.current?.slotId !== slotId) return false;
    this.end(slotId, 'disarmed');
    return true;
  }

  stateOf(slotId: string): { state: ArmState; expires_at: string } | null {
    return this.states.get(slotId) ?? null;
  }

  private end(slotId: string, state: 'expired' | 'disarmed'): void {
    const slot = this.current;
    if (!slot || slot.slotId !== slotId) return;
    clearTimeout(slot.timer);
    this.current = null;
    this.states.set(slotId, { state, expires_at: new Date(slot.expiresAt).toISOString() });
    slot.release();
  }
}
