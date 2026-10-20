"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import type { Skill, SkillVersion } from "@devdigest/shared";
import { ConfirmModal } from "@/components/confirm-modal";
import { useRestoreSkillVersion, useSkillVersions } from "@/lib/hooks/skills";
import { lineDiff } from "../../../helpers";
import { skillStyles as s } from "../../../styles";

type Panel = { version: number; view: "body" | "diff" };

export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const versions = useSkillVersions(skill.id);
  const restore = useRestoreSkillVersion();
  const [panel, setPanel] = React.useState<Panel>();
  const [restoring, setRestoring] = React.useState<SkillVersion>();

  if (versions.isLoading) return <Skeleton height={220} />;
  if (versions.isError) return <ErrorState body={t("versions.loadError")} onRetry={() => void versions.refetch()} />;
  if (!versions.data?.length) return <EmptyState icon="History" title={t("versions.emptyTitle")} body={t("versions.emptyBody")} />;

  const toggle = (version: number, view: Panel["view"]) =>
    setPanel(panel?.version === version && panel.view === view ? undefined : { version, view });

  return (
    <div style={s.content}>
      <div style={s.sectionRow}>
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>{t("versions.title")}</h2>
        <Badge color="var(--text-secondary)">{t("versions.count", { count: versions.data.length })}</Badge>
      </div>
      <p style={{ ...s.muted, marginBottom: 16 }}>{t("versions.subtitle")}</p>
      {[...versions.data].sort((a, b) => b.version - a.version).map((version) => {
        const isCurrent = version.version === skill.version;
        const open = panel?.version === version.version ? panel.view : undefined;
        return (
          <article key={version.version} aria-label={t("editor.version", { version: version.version })} style={s.versionRow}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Badge color={isCurrent ? "var(--accent)" : "var(--text-secondary)"} mono>
                {t("editor.version", { version: version.version })}
              </Badge>
              <span style={{ flex: 1, color: "var(--text-secondary)", fontSize: 12 }}>
                {new Date(version.created_at).toLocaleString()}
              </span>
              {isCurrent && <Badge color="var(--ok)" dot>{t("versions.current")}</Badge>}
              <Button kind="ghost" size="sm" icon="Eye" onClick={() => toggle(version.version, "body")}>
                {open === "body" ? t("versions.hideBody") : t("versions.showBody")}
              </Button>
              {!isCurrent && (
                <>
                  <Button kind="ghost" size="sm" icon="Code" onClick={() => toggle(version.version, "diff")}>
                    {open === "diff" ? t("versions.hideDiff") : t("versions.diff")}
                  </Button>
                  <Button kind="ghost" size="sm" icon="History" onClick={() => { restore.reset(); setRestoring(version); }}>
                    {t("versions.restore")}
                  </Button>
                </>
              )}
            </div>
            {open === "body" && <pre className="mono" style={s.versionBody}>{version.body}</pre>}
            {open === "diff" && <VersionDiff version={version} skill={skill} />}
          </article>
        );
      })}
      {restoring && (
        <ConfirmModal
          title={t("versions.restoreTitle", { version: restoring.version })}
          confirmLabel={t("versions.restoreConfirm")}
          cancelLabel={t("versions.restoreCancel")}
          pendingLabel={t("versions.restorePending")}
          confirmKind="primary"
          confirmIcon="History"
          pending={restore.isPending}
          error={restore.isError ? t("versions.restoreFailed") : null}
          onConfirm={() =>
            restore.mutate(
              { id: skill.id, version: restoring.version },
              { onSuccess: () => { setRestoring(undefined); setPanel(undefined); } },
            )
          }
          onCancel={() => setRestoring(undefined)}
        >
          {t("versions.restoreBody", { version: restoring.version, next: skill.version + 1 })}
        </ConfirmModal>
      )}
    </div>
  );
}

/** Inline line diff of a previous version's body against the current body. */
function VersionDiff({ version, skill }: { version: SkillVersion; skill: Skill }) {
  const t = useTranslations("skills");
  const lines = lineDiff(version.body, skill.body);
  const changed = lines.some((line) => line.kind !== "same");
  return (
    <figure style={{ marginTop: 12 }}>
      <figcaption style={{ ...s.muted, fontSize: 12, marginBottom: 6 }}>
        {t("versions.diffTitle", { version: version.version, current: skill.version })}
        {changed && <> · {t("versions.diffLegend", { version: version.version })}</>}
      </figcaption>
      {changed ? (
        <pre className="mono" data-testid="version-diff" style={{ ...s.versionBody, marginTop: 0 }}>
          {lines.map((line, index) => (
            <div key={index} data-kind={line.kind} style={s.diffLine(line.kind)}>
              {line.kind === "add" ? "+ " : line.kind === "del" ? "− " : "  "}
              {line.text}
            </div>
          ))}
        </pre>
      ) : (
        <p style={s.muted}>{t("versions.diffSame")}</p>
      )}
    </figure>
  );
}
