import type { SkillType } from "@devdigest/shared";

export const SKILL_TYPES: readonly SkillType[] = ["rubric", "convention", "security", "custom"];

export const SKILL_TYPE_COLORS: Record<SkillType, string> = {
  rubric: "var(--accent)",
  convention: "var(--ok)",
  security: "var(--crit)",
  custom: "var(--text-secondary)",
};

export const SKILL_TABS = ["config", "preview", "evals", "stats", "versions"] as const;
export const MAX_AGENT_SKILLS = 4;
