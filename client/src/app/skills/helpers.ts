import type { SkillSummary } from "@devdigest/shared";

export function filterSkills(skills: SkillSummary[], query: string): SkillSummary[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return skills;
  return skills.filter((skill) =>
    [skill.name, skill.description, skill.type].some((value) =>
      value.toLowerCase().includes(normalized),
    ),
  );
}

export function deriveSkillName(body: string, filename?: string): string {
  const heading = body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /^#\s+/.test(line));
  if (heading) return heading.replace(/^#\s+/, "").trim();
  if (filename) return filename.replace(/\.(md|markdown|txt)$/i, "").trim();
  return "";
}

export function approximateTokens(body: string): number {
  return Math.ceil(body.length / 4);
}

export function isSupportedSkillFileName(filename: string): boolean {
  return /\.(md|markdown|txt)$/i.test(filename);
}
