"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Badge, Button, EmptyState, ErrorState, Icon, Skeleton, Toggle } from "@devdigest/ui";
import type { Agent, SkillSummary } from "@devdigest/shared";
import { useAgentSkills, useSetAgentSkillEnabled, useSetAgentSkills, useSkills } from "@/lib/hooks/skills";
import { MAX_AGENT_SKILLS, SKILL_TYPE_COLORS } from "@/app/skills/constants";
import { skillStyles as s } from "@/app/skills/styles";
import { ApprovalBadge } from "@/app/skills/_components/ApprovalBadge";
import { moveLinkedSkill } from "../helpers";

// Fixed column widths, so the headings line up with each row's controls.
const cols = {
  row: { display: "flex", alignItems: "center", gap: 10 },
  handle: { display: "flex", width: 14, flexShrink: 0 },
  attached: { display: "flex", alignItems: "center", width: 64, flexShrink: 0 },
  skill: { flex: 1, minWidth: 0 },
  enabled: { display: "flex", alignItems: "center", width: 104, flexShrink: 0 },
  type: { display: "flex", width: 84, flexShrink: 0 },
  order: { display: "flex", gap: 5, width: 62, flexShrink: 0 },
} satisfies Record<string, React.CSSProperties>;

const clamp2: React.CSSProperties = { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" };

const legend = {
  box: { display: "grid", gap: 6, margin: "0 0 14px", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-surface)" },
  item: { display: "grid", gridTemplateColumns: "150px 1fr", gap: 10 },
  term: { fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" },
  desc: { margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--text-muted)" },
  heading: { fontSize: 11, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase", color: "var(--text-muted)" },
} satisfies Record<string, React.CSSProperties>;

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
  const setEnabled = useSetAgentSkillEnabled();
  const busy = save.isPending || setEnabled.isPending;
  const [query, setQuery] = React.useState("");
  const [linkedIds, setLinkedIds] = React.useState<string[]>([]);
  const [limitReached, setLimitReached] = React.useState(false);
  const [dragId, setDragId] = React.useState<string>();
  const [overId, setOverId] = React.useState<string>();

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
    if (busy) return;
    if (!checked) return persist(linkedIds.filter((linkedId) => linkedId !== id));
    if (linkedIds.length >= MAX_AGENT_SKILLS) {
      setLimitReached(true);
      return;
    }
    persist([...linkedIds, id]);
  };

  const move = (id: string, direction: -1 | 1) => {
    if (busy) return;
    const from = linkedIds.indexOf(id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= linkedIds.length) return;
    const next = [...linkedIds];
    const [moved] = next.splice(from, 1);
    if (moved) next.splice(to, 0, moved);
    persist(next);
  };

  const drop = (targetId: string) => {
    const fromId = dragId;
    setDragId(undefined);
    setOverId(undefined);
    if (!fromId || busy) return;
    const next = moveLinkedSkill(linkedIds, fromId, targetId);
    if (next !== linkedIds) persist([...next]);
  };

  if (skills.isError || links.isError) {
    return <ErrorState body={t("skills.loadError")} onRetry={() => { void skills.refetch(); void links.refetch(); }} />;
  }
  if (skills.isLoading || links.isLoading) return <><Skeleton height={48} /><div style={{ height: 8 }} /><Skeleton height={48} /></>;
  if (!skills.data?.length) {
    return <EmptyState icon="Sparkles" title={t("skills.emptyTitle")} body={t("skills.emptyBody")} cta={t("skills.emptyCta")} onCta={() => router.push("/skills")} />;
  }

  // The per-agent switch of each link; a skill linked a moment ago starts on.
  const linkEnabled = new Map((links.data ?? []).map((link) => [link.skill_id, link.link_enabled]));
  // Effective skills (attached, on for this agent and on globally) whose content
  // is not approved: the server refuses this agent's reviews while any exist.
  const blocking = orderedSkills(skills.data, linkedIds).filter(
    (skill) => linkedIds.includes(skill.id) && skill.enabled && (linkEnabled.get(skill.id) ?? true) && skill.approval.status !== "approved",
  );
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
      {/* One explanation of the two switches and the order, instead of text on every row. */}
      <dl aria-label={t("skills.legend.title")} style={legend.box}>
        <div style={legend.item}>
          <dt style={legend.term}>{t("skills.legend.attachedTerm")}</dt>
          <dd style={legend.desc}>{t("skills.legend.attached", { max: MAX_AGENT_SKILLS })}</dd>
        </div>
        <div style={legend.item}>
          <dt style={legend.term}>{t("skills.legend.enabledTerm")}</dt>
          <dd style={legend.desc}>{t("skills.legend.enabled", { off: t("skills.disabledForAgent") })}</dd>
        </div>
        <div style={legend.item}>
          <dt style={legend.term}>{t("skills.legend.approvedTerm")}</dt>
          <dd style={legend.desc}>{t("skills.legend.approved")}</dd>
        </div>
        <div style={legend.item}>
          <dt style={legend.term}>{t("skills.legend.orderTerm")}</dt>
          <dd style={legend.desc}>{t("skills.orderHint")}</dd>
        </div>
      </dl>
      {blocking.length > 0 && (
        <div role="alert" data-testid="approval-blocked" style={{ marginBottom: 12, color: "var(--warn)", fontSize: 13 }}>
          {t("skills.blockedByApproval", { names: blocking.map((skill) => skill.name).join(", ") })}
        </div>
      )}
      {limitReached && <div role="alert" style={{ marginBottom: 12, color: "var(--warn)", fontSize: 13 }}>{t("skills.limitReached", { max: MAX_AGENT_SKILLS })}</div>}
      {/* Column headings: the switches carry their own accessible names, so these are visual only. */}
      <div aria-hidden style={{ ...cols.row, padding: "0 13px 6px", ...legend.heading }}>
        <span style={cols.handle} />
        <span style={cols.attached}>{t("skills.columns.attached")}</span>
        <span style={cols.skill}>{t("skills.columns.skill")}</span>
        <span style={cols.enabled}>{t("skills.columns.enabled")}</span>
        <span style={cols.type}>{t("skills.columns.type")}</span>
        <span style={cols.order}>{t("skills.columns.order")}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((skill) => {
          const linked = linkedIds.includes(skill.id);
          const index = linkedIds.indexOf(skill.id);
          const onForAgent = linked && (linkEnabled.get(skill.id) ?? true);
          // Only a skill that is linked and enabled — both its own switch and this
          // agent's — takes part in drag-and-drop; the arrows stay available for
          // every linked skill (keyboard).
          const draggable = onForAgent && skill.enabled && !busy;
          const dimmed = !skill.enabled || (linked && !onForAgent);
          return (
            <div
              key={skill.id}
              data-testid={`agent-skill-${skill.id}`}
              draggable={draggable}
              onDragStart={draggable ? (event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", skill.id);
                setDragId(skill.id);
              } : undefined}
              onDragOver={draggable && dragId ? (event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                if (overId !== skill.id) setOverId(skill.id);
              } : undefined}
              onDragLeave={draggable ? () => setOverId((id) => (id === skill.id ? undefined : id)) : undefined}
              onDrop={draggable ? (event) => { event.preventDefault(); drop(skill.id); } : undefined}
              onDragEnd={() => { setDragId(undefined); setOverId(undefined); }}
              style={{
                ...s.row,
                ...cols.row,
                opacity: dragId === skill.id ? 0.5 : 1,
                cursor: draggable ? "grab" : undefined,
                outline: overId === skill.id && dragId !== skill.id ? "2px dashed var(--accent)" : undefined,
              }}
            >
              <span aria-hidden title={draggable ? t("skills.dragHint") : undefined} style={{ ...cols.handle, color: draggable ? "var(--text-muted)" : "transparent" }}>
                <Icon.Menu size={13} />
              </span>
              <label style={cols.attached} title={t("skills.attachedTooltip", { name: skill.name })}>
                <Toggle on={linked} onChange={(on) => toggle(skill.id, on)} size={14} />
                <span style={s.visuallyHidden}>{t("skills.linkLabel", { name: skill.name })}</span>
              </label>
              {/* Only the name and description dim for a skill left out of the prompt; its status and controls stay readable. */}
              <div style={cols.skill}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span data-testid="skill-row-name" style={{ fontWeight: 600, opacity: dimmed ? 0.6 : 1 }}>{skill.name}</span>
                  {linked && !onForAgent && (
                    <span title={t("skills.disabledForAgentTooltip")}>
                      <Badge color="var(--text-muted)">{t("skills.disabledForAgent")}</Badge>
                    </span>
                  )}
                  {!skill.enabled && (
                    <span title={t("skills.disabledGloballyTooltip")}>
                      <Badge color="var(--text-muted)">{t("skills.disabledGlobally")}</Badge>
                    </span>
                  )}
                  <ApprovalBadge approval={skill.approval} />
                </div>
                <div title={skill.description} style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 2, opacity: dimmed ? 0.6 : 1, ...clamp2 }}>{skill.description}</div>
              </div>
              <div style={cols.enabled}>
                {linked ? (
                  <label style={{ display: "flex", alignItems: "center", gap: 6 }} title={t("skills.enabledTooltip", { name: skill.name })}>
                    <Toggle
                      on={onForAgent}
                      onChange={(on) => { if (!busy) setEnabled.mutate({ agentId: agent.id, skillId: skill.id, enabled: on }); }}
                      size={12}
                    />
                    <span aria-hidden style={{ fontSize: 12, color: onForAgent ? "var(--text-secondary)" : "var(--text-muted)" }}>
                      {onForAgent ? t("skills.enabledState.on") : t("skills.enabledState.off")}
                    </span>
                    <span style={s.visuallyHidden}>{t("skills.enabledLabel", { name: skill.name })}</span>
                  </label>
                ) : (
                  <span aria-hidden title={t("skills.enabledNeedsAttach")} style={{ color: "var(--text-muted)", fontSize: 12 }}>—</span>
                )}
              </div>
              <div style={cols.type}>
                <Badge color={SKILL_TYPE_COLORS[skill.type]}>{t(`skills.type.${skill.type}`)}</Badge>
              </div>
              <div style={cols.order}>
                {linked && (
                  <>
                    <button style={s.iconButton} disabled={busy || index === 0} aria-label={t("skills.moveUp", { name: skill.name })} onClick={() => move(skill.id, -1)}><Icon.ArrowUp size={13} /></button>
                    <button style={s.iconButton} disabled={busy || index === linkedIds.length - 1} aria-label={t("skills.moveDown", { name: skill.name })} onClick={() => move(skill.id, 1)}><Icon.ArrowDown size={13} /></button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ ...s.actions, justifyContent: "space-between" }}>
        <Button kind="secondary" size="sm" icon="Sparkles" onClick={() => router.push("/skills")}>{t("skills.manage")}</Button>
        <span aria-live="polite" style={s.muted}>{busy ? t("skills.saving") : t("skills.autoSaved")}</span>
      </div>
    </div>
  );
}
