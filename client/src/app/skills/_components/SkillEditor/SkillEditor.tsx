"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, Tabs } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { SKILL_TABS, SKILL_TYPE_COLORS } from "../../constants";
import { skillStyles as s } from "../../styles";
import { ConfigTab } from "./_components/ConfigTab";
import { PreviewTab } from "./_components/PreviewTab";
import { ScaffoldTab } from "./_components/ScaffoldTab";
import { VersionsTab } from "./_components/VersionsTab";

export function SkillEditor({ skill, tab, onTab }: { skill: Skill; tab: string; onTab: (tab: string) => void }) {
  const t = useTranslations("skills");
  const tabs = SKILL_TABS.map((key) => ({ key, label: t(`editor.tabs.${key}`) }));

  return (
    <section style={s.detail}>
      <div style={s.detailHeader}>
        <Icon.Sparkles size={18} style={{ color: SKILL_TYPE_COLORS[skill.type] }} />
        <h1 className="mono" style={{ fontSize: 17, fontWeight: 700 }}>{skill.name}</h1>
        <Badge color={SKILL_TYPE_COLORS[skill.type]}>{t(`listItem.type.${skill.type}`)}</Badge>
        <Badge color="var(--text-secondary)" icon="History" mono>{t("editor.version", { version: skill.version })}</Badge>
        {!skill.enabled && <Badge color="var(--text-muted)">{t("editor.disabled")}</Badge>}
      </div>
      <div style={{ marginTop: 12 }}>
        <Tabs tabs={tabs} value={tab} onChange={onTab} pad="0 28px" />
      </div>
      <div style={s.tabBody}>
        {tab === "config" && <ConfigTab skill={skill} />}
        {tab === "preview" && <PreviewTab skill={skill} />}
        {tab === "evals" && <ScaffoldTab kind="evals" />}
        {tab === "stats" && <ScaffoldTab kind="stats" />}
        {tab === "versions" && <VersionsTab skill={skill} />}
      </div>
    </section>
  );
}
