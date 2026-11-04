import type { SkillApproval, SkillApprovalStatus } from "@devdigest/shared";

/** Test fixture: a skill's approval state (approved v1 unless overridden). */
export function approvalFixture(status: SkillApprovalStatus = "approved", overrides: Partial<SkillApproval> = {}): SkillApproval {
  const approved = status === "approved" || status === "stale";
  return {
    status,
    version: 1,
    body_sha256: "a".repeat(64),
    approved_version: approved ? 1 : null,
    approved_at: approved ? "2026-10-30T10:00:00.000Z" : null,
    approved_by: approved ? "user-1" : null,
    ...overrides,
  };
}
