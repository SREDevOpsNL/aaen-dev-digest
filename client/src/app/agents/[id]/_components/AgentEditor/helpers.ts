/**
 * Move `fromId` to the position `toId` holds in the agent's linked-skill order.
 * Returns the same array when the move is a no-op or either id is not linked.
 */
export function moveLinkedSkill(linkedIds: readonly string[], fromId: string, toId: string): readonly string[] {
  const from = linkedIds.indexOf(fromId);
  const to = linkedIds.indexOf(toId);
  if (from < 0 || to < 0 || from === to) return linkedIds;
  const next = [...linkedIds];
  next.splice(from, 1);
  next.splice(to, 0, fromId);
  return next;
}
