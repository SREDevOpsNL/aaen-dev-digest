"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Icon, Skeleton, Toggle } from "@devdigest/ui";
import type { SkillSummary } from "@devdigest/shared";
import { useSkills, useUpdateSkill } from "@/lib/hooks/skills";
import { filterSkills } from "../../helpers";
import { SKILL_TYPE_COLORS } from "../../constants";
import { skillStyles as s } from "../../styles";
import { CreateSkillModal } from "./_components/CreateSkillModal";
import { ImportSkillDrawer } from "./_components/ImportSkillDrawer";

function SkillRailCard({ skill, active, tab }: { skill: SkillSummary; active: boolean; tab: string }) {
  const t = useTranslations("skills");
  const update = useUpdateSkill();
  return (
    <div style={s.card(active, skill.enabled)}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <Link href={`/skills/${skill.id}?tab=${tab}`} style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon.Sparkles size={15} style={{ color: SKILL_TYPE_COLORS[skill.type], flexShrink: 0 }} />
            <span className="mono" style={{ fontSize: 13, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {skill.name}
            </span>
          </div>
          <p style={{ ...s.muted, margin: "7px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {skill.description || t("card.noDescription")}
          </p>
        </Link>
        <label title={skill.enabled ? t("card.disable") : t("card.enable")}>
          <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden" }}>
            {skill.enabled ? t("card.disable") : t("card.enable")}
          </span>
          <Toggle
            on={skill.enabled}
            onChange={(enabled) => update.mutate({ id: skill.id, patch: { enabled } })}
            size={14}
          />
        </label>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Badge color={SKILL_TYPE_COLORS[skill.type]}>{t(`listItem.type.${skill.type}`)}</Badge>
        <span style={{ ...s.muted, fontSize: 11 }}>{t("card.usedBy", { count: skill.used_by_count })}</span>
      </div>
    </div>
  );
}

export function SkillsRail({ activeId, tab = "config" }: { activeId?: string; tab?: string }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const skills = useSkills();
  const [query, setQuery] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);

  const visible = filterSkills(skills.data ?? [], query);
  return (
    <aside style={s.rail}>
      <div style={s.railHeader}>
        <div style={s.titleRow}>
          <h1 style={{ flex: 1, fontSize: 18, fontWeight: 700 }}>{t("page.heading")}</h1>
          <Button kind="primary" size="sm" icon="Plus" onClick={() => setCreateOpen(true)}>
            {t("page.addSkill")}
          </Button>
          <Button kind="ghost" size="sm" icon="Upload" onClick={() => setImportOpen(true)}>
            {t("page.import")}
          </Button>
        </div>
        <label style={s.search}>
          <Icon.Search size={13} style={{ color: "var(--text-muted)" }} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("page.searchPlaceholder")}
            aria-label={t("page.searchPlaceholder")}
            style={s.searchInput}
          />
        </label>
      </div>

      <div style={s.railList}>
        {skills.isLoading && <><Skeleton height={92} /><div style={{ height: 8 }} /><Skeleton height={92} /></>}
        {skills.isError && <ErrorState body={t("page.loadError")} onRetry={() => void skills.refetch()} />}
        {!skills.isLoading && !skills.isError && visible.map((skill) => (
          <SkillRailCard key={skill.id} skill={skill} active={skill.id === activeId} tab={tab} />
        ))}
        {!skills.isLoading && !skills.isError && (skills.data?.length ?? 0) > 0 && visible.length === 0 && (
          <p style={{ ...s.muted, padding: 12 }}>{t("page.noMatches")}</p>
        )}
      </div>

      {createOpen && (
        <CreateSkillModal
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => {
            setCreateOpen(false);
            router.push(`/skills/${id}?tab=config`);
          }}
        />
      )}
      {importOpen && (
        <ImportSkillDrawer
          onClose={() => setImportOpen(false)}
          onImported={(id) => {
            setImportOpen(false);
            router.push(`/skills/${id}?tab=config`);
          }}
        />
      )}
    </aside>
  );
}
