"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, Drawer, Markdown } from "@devdigest/ui";
import type { SkillSummary } from "@devdigest/shared";
import { SKILL_TYPE_COLORS } from "../../constants";
import { skillStyles as s } from "../../styles";

/** Side preview of a skill: metadata and rendered body, with a link to the full editor. */
export function SkillPreviewDrawer({ skill, onClose }: { skill: SkillSummary; onClose: () => void }) {
  const t = useTranslations("skills");
  const router = useRouter();
  return (
    <Drawer
      width={640}
      title={<span className="mono">{skill.name}</span>}
      subtitle={skill.description || t("card.noDescription")}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8 }}>
          <Button kind="primary" icon="ArrowRight" onClick={() => router.push(`/skills/${skill.id}?tab=config`)}>
            {t("preview.openDetails")}
          </Button>
          <Button kind="ghost" onClick={onClose}>{t("preview.close")}</Button>
        </div>
      }
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <Badge color={SKILL_TYPE_COLORS[skill.type]}>{t(`listItem.type.${skill.type}`)}</Badge>
        <span className="mono" style={s.muted}>{t("card.version", { version: skill.version })}</span>
        <span style={s.muted}>{t("card.usedBy", { count: skill.used_by_count })}</span>
        <span style={{ ...s.muted, marginLeft: "auto" }}>{skill.enabled ? t("preview.enabled") : t("preview.disabled")}</span>
      </div>
      <div style={s.preview}><Markdown>{skill.body}</Markdown></div>
    </Drawer>
  );
}
