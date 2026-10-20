"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { SkillSummary } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { useSkills } from "@/lib/hooks/skills";
import { AddSkillMenu } from "./_components/AddSkillMenu";
import { DeleteSkillModal } from "./_components/DeleteSkillModal";
import { SkillCard } from "./_components/SkillCard";
import { SkillPreviewDrawer } from "./_components/SkillPreviewDrawer";
import { filterSkills } from "./helpers";
import { skillStyles as s } from "./styles";

export default function SkillsPage() {
  const t = useTranslations("skills");
  const skills = useSkills();
  const [query, setQuery] = React.useState("");
  const [previewId, setPreviewId] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState<SkillSummary | null>(null);

  const all = skills.data ?? [];
  const visible = filterSkills(all, query);
  // Read the previewed skill from the live list so a toggle or edit shows up at once.
  const preview = previewId ? all.find((skill) => skill.id === previewId) : undefined;
  const ready = !skills.isLoading && !skills.isError;

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }]}>
      <div style={s.page}>
        <div style={s.pageHeader}>
          <h1 style={{ flex: 1, fontSize: 20, fontWeight: 700 }}>{t("page.heading")}</h1>
          <label style={{ ...s.search, width: 280 }}>
            <Icon.Search size={13} style={{ color: "var(--text-muted)" }} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("page.searchPlaceholder")}
              aria-label={t("page.searchPlaceholder")}
              style={s.searchInput}
            />
          </label>
          <AddSkillMenu size="md" />
        </div>

        {skills.isLoading && (
          <div style={s.grid}>
            {[0, 1, 2].map((key) => <Skeleton key={key} height={150} />)}
          </div>
        )}
        {skills.isError && <ErrorState body={t("page.loadError")} onRetry={() => void skills.refetch()} />}
        {ready && all.length === 0 && <EmptyState icon="Sparkles" title={t("page.empty.title")} body={t("page.empty.body")} />}
        {ready && all.length > 0 && visible.length === 0 && <p style={s.muted}>{t("page.noMatches")}</p>}
        {ready && visible.length > 0 && (
          <div role="list" aria-label={t("page.gridLabel")} style={s.grid}>
            {visible.map((skill) => (
              <div role="listitem" key={skill.id} style={{ display: "flex" }}>
                <SkillCard skill={skill} onOpen={(open) => setPreviewId(open.id)} onDelete={setDeleting} />
              </div>
            ))}
          </div>
        )}
      </div>

      {preview && <SkillPreviewDrawer skill={preview} onClose={() => setPreviewId(null)} />}
      {deleting && (
        <DeleteSkillModal
          skill={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            if (previewId === deleting.id) setPreviewId(null);
          }}
        />
      )}
    </AppShell>
  );
}
