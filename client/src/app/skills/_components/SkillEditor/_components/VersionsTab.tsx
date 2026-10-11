"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillVersions } from "@/lib/hooks/skills";
import { skillStyles as s } from "../../../styles";

export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const versions = useSkillVersions(skill.id);
  const [expanded, setExpanded] = React.useState<number>();

  if (versions.isLoading) return <Skeleton height={220} />;
  if (versions.isError) return <ErrorState body={t("versions.loadError")} onRetry={() => void versions.refetch()} />;
  if (!versions.data?.length) return <EmptyState icon="History" title={t("versions.emptyTitle")} body={t("versions.emptyBody")} />;

  return (
    <div style={s.content}>
      <div style={s.sectionRow}>
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>{t("versions.title")}</h2>
        <Badge color="var(--text-secondary)">{t("versions.count", { count: versions.data.length })}</Badge>
      </div>
      <p style={{ ...s.muted, marginBottom: 16 }}>{t("versions.subtitle")}</p>
      {[...versions.data].sort((a, b) => b.version - a.version).map((version) => {
        const isCurrent = version.version === skill.version;
        const isExpanded = expanded === version.version;
        return (
          <article key={version.version} style={s.versionRow}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Badge color={isCurrent ? "var(--accent)" : "var(--text-secondary)"} mono>
                {t("editor.version", { version: version.version })}
              </Badge>
              <span style={{ flex: 1, color: "var(--text-secondary)", fontSize: 12 }}>
                {new Date(version.created_at).toLocaleString()}
              </span>
              {isCurrent && <Badge color="var(--ok)" dot>{t("versions.current")}</Badge>}
              <Button kind="ghost" size="sm" icon="Eye" onClick={() => setExpanded(isExpanded ? undefined : version.version)}>
                {isExpanded ? t("versions.hideBody") : t("versions.showBody")}
              </Button>
            </div>
            {isExpanded && <pre className="mono" style={{ marginTop: 12, padding: 12, overflow: "auto", whiteSpace: "pre-wrap", background: "var(--bg-surface)", borderRadius: 7, color: "var(--text-secondary)", fontSize: 12 }}>{version.body}</pre>}
          </article>
        );
      })}
    </div>
  );
}
