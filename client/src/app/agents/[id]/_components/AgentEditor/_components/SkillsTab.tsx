"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Badge, Button, Checkbox, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { Agent, SkillSummary } from "@devdigest/shared";
import { useAgentSkills, useSetAgentSkills, useSkills } from "@/lib/hooks/skills";
import { MAX_AGENT_SKILLS, SKILL_TYPE_COLORS } from "@/app/skills/constants";
import { skillStyles as s } from "@/app/skills/styles";

function orderedSkills(all: SkillSummary[], linkedIds: string[]): SkillSummary[] {
  const byId = new Map(all.map((skill) => [skill.id, skill]));
  const linked = linkedIds.flatMap((id) => {
    const skill = byId.get(id);
    return skill ? [skill] : [];
  });
  const rest = all.filter((skill) => !linkedIds.includes(skill.id)).sort((a, b) => a.name.localeCompare(b.name));
  return [...linked, ...rest];
}

export function SkillsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const router = useRouter();
  const skills = useSkills();
  const links = useAgentSkills(agent.id);
  const save = useSetAgentSkills();
  const [query, setQuery] = React.useState("");
  const [linkedIds, setLinkedIds] = React.useState<string[]>([]);
  const [limitReached, setLimitReached] = React.useState(false);

  React.useEffect(() => {
    if (links.data) {
      setLinkedIds([...links.data].sort((a, b) => a.order - b.order).map((link) => link.skill_id));
    }
  }, [links.data, agent.id]);

  const persist = (nextIds: string[]) => {
    setLinkedIds(nextIds);
    setLimitReached(false);
    save.mutate(
      { agentId: agent.id, skillIds: nextIds },
      { onError: () => links.data && setLinkedIds([...links.data].sort((a, b) => a.order - b.order).map((link) => link.skill_id)) },
    );
  };

  const toggle = (id: string, checked: boolean) => {
    if (save.isPending) return;
    if (!checked) return persist(linkedIds.filter((linkedId) => linkedId !== id));
    if (linkedIds.length >= MAX_AGENT_SKILLS) {
      setLimitReached(true);
      return;
    }
    persist([...linkedIds, id]);
  };

  const move = (id: string, direction: -1 | 1) => {
    if (save.isPending) return;
    const from = linkedIds.indexOf(id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= linkedIds.length) return;
    const next = [...linkedIds];
    const [moved] = next.splice(from, 1);
    if (moved) next.splice(to, 0, moved);
    persist(next);
  };

  if (skills.isError || links.isError) {
    return <ErrorState body={t("skills.loadError")} onRetry={() => { void skills.refetch(); void links.refetch(); }} />;
  }
  if (skills.isLoading || links.isLoading) return <><Skeleton height={48} /><div style={{ height: 8 }} /><Skeleton height={48} /></>;
  if (!skills.data?.length) {
    return <EmptyState icon="Sparkles" title={t("skills.emptyTitle")} body={t("skills.emptyBody")} cta={t("skills.emptyCta")} onCta={() => router.push("/skills")} />;
  }

  const normalized = query.trim().toLowerCase();
  const rows = orderedSkills(skills.data, linkedIds).filter((skill) =>
    !normalized || skill.name.toLowerCase().includes(normalized) || skill.description.toLowerCase().includes(normalized),
  );

  return (
    <div style={{ maxWidth: 820 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>{t("skills.title")}</h2>
        <Badge color="var(--accent)">{t("skills.attachedCount", { linked: linkedIds.length, max: MAX_AGENT_SKILLS })}</Badge>
        <label style={{ ...s.search, marginLeft: "auto", width: 260 }}>
          <Icon.Search size={13} style={{ color: "var(--text-muted)" }} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("skills.filterPlaceholder")} aria-label={t("skills.filterPlaceholder")} style={s.searchInput} />
        </label>
      </div>
      <p style={{ ...s.muted, marginBottom: 14 }}>{t("skills.orderHint", { max: MAX_AGENT_SKILLS })}</p>
      {limitReached && <div role="alert" style={{ marginBottom: 12, color: "var(--warn)", fontSize: 13 }}>{t("skills.limitReached", { max: MAX_AGENT_SKILLS })}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((skill) => {
          const linked = linkedIds.includes(skill.id);
          const index = linkedIds.indexOf(skill.id);
          return (
            <div key={skill.id} style={{ ...s.row, opacity: skill.enabled ? 1 : 0.6 }}>
              <Checkbox checked={linked} onChange={(checked) => toggle(skill.id, checked)} label={<span style={{ fontWeight: 600 }}>{skill.name}</span>} />
              <span style={{ flex: 1, color: "var(--text-muted)", fontSize: 12 }}>{skill.description}</span>
              {!skill.enabled && <Badge color="var(--text-muted)">{t("skills.disabledGlobally")}</Badge>}
              <Badge color={SKILL_TYPE_COLORS[skill.type]}>{t(`skills.type.${skill.type}`)}</Badge>
              {linked && (
                <div style={{ display: "flex", gap: 5 }}>
                  <button style={s.iconButton} disabled={save.isPending || index === 0} aria-label={t("skills.moveUp", { name: skill.name })} onClick={() => move(skill.id, -1)}><Icon.ArrowUp size={13} /></button>
                  <button style={s.iconButton} disabled={save.isPending || index === linkedIds.length - 1} aria-label={t("skills.moveDown", { name: skill.name })} onClick={() => move(skill.id, 1)}><Icon.ArrowDown size={13} /></button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ ...s.actions, justifyContent: "space-between" }}>
        <Button kind="secondary" size="sm" icon="Sparkles" onClick={() => router.push("/skills")}>{t("skills.manage")}</Button>
        <span aria-live="polite" style={s.muted}>{save.isPending ? t("skills.saving") : t("skills.autoSaved")}</span>
      </div>
    </div>
  );
}
