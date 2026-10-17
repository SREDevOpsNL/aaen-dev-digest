"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, IconBtn, Toggle } from "@devdigest/ui";
import type { SkillSummary } from "@devdigest/shared";
import { useUpdateSkill } from "@/lib/hooks/skills";
import { SKILL_TYPE_COLORS } from "../../constants";
import { skillStyles as s } from "../../styles";

/**
 * Skills-grid card: name, type, description, enabled toggle, current version and
 * linked-agent count. The card itself is not interactive. It holds three
 * separate controls, never nested: a native preview button (name +
 * description), the enabled toggle and Delete.
 */
export function SkillCard({
  skill,
  onOpen,
  onDelete,
}: {
  skill: SkillSummary;
  onOpen: (skill: SkillSummary) => void;
  onDelete: (skill: SkillSummary) => void;
}) {
  const t = useTranslations("skills");
  const update = useUpdateSkill();

  return (
    <article style={s.gridCard(skill.enabled)}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <button type="button" aria-label={t("card.open", { name: skill.name })} onClick={() => onOpen(skill)} style={s.previewButton}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon.Sparkles size={15} style={{ color: SKILL_TYPE_COLORS[skill.type], flexShrink: 0 }} />
            <span className="mono" style={s.cardName}>{skill.name}</span>
          </span>
          <span style={s.cardDescription}>{skill.description || t("card.noDescription")}</span>
        </button>
        <label title={skill.enabled ? t("card.disable") : t("card.enable")} style={{ paddingTop: 2 }}>
          <span style={s.visuallyHidden}>{skill.enabled ? t("card.disable") : t("card.enable")}</span>
          <Toggle on={skill.enabled} onChange={(enabled) => update.mutate({ id: skill.id, patch: { enabled } })} size={14} />
        </label>
        <IconBtn icon="Trash" size={26} danger label={t("card.delete", { name: skill.name })} onClick={() => onDelete(skill)} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: "auto" }}>
        <Badge color={SKILL_TYPE_COLORS[skill.type]}>{t(`listItem.type.${skill.type}`)}</Badge>
        <span className="mono" style={{ ...s.muted, fontSize: 11 }}>{t("card.version", { version: skill.version })}</span>
        <span style={{ ...s.muted, fontSize: 11, marginLeft: "auto" }}>{t("card.usedBy", { count: skill.used_by_count })}</span>
      </div>
    </article>
  );
}
