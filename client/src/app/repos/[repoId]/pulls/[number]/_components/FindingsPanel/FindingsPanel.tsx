/* FindingsPanel — hide-low-confidence + j/k navigation + FindingCard list,
   wiring the accept/dismiss action hook (A2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, EmptyState } from "@devdigest/ui";
import type { FindingRecord, Severity } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import { useFindingAction } from "../../../../../../../lib/hooks/reviews";
import { FILTER_SEVERITIES, KEY_TO_ACTION } from "./constants";
import { countFindingsBySeverity, visibleFindings } from "./helpers";
import { s } from "./styles";

const SEVERITY_COLORS: Record<Severity, { color: string; background: string }> = {
  CRITICAL: { color: "var(--crit)", background: "var(--crit-bg)" },
  WARNING: { color: "var(--warn)", background: "var(--warn-bg)" },
  SUGGESTION: { color: "var(--sugg)", background: "var(--sugg-bg)" },
};

export function FindingsPanel({
  findings,
  prId,
  repoFullName,
  headSha,
}: {
  findings: FindingRecord[];
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const [hideLow, setHideLow] = React.useState(false);
  const [activeSeverity, setActiveSeverity] = React.useState<Severity | null>(null);
  const [focusIdx, setFocusIdx] = React.useState(0);

  const severityCounts = countFindingsBySeverity(findings);
  const shown = visibleFindings(findings, hideLow, activeSeverity);

  const selectSeverity = (severity: Severity) => {
    setActiveSeverity((current) => (current === severity ? null : severity));
    setFocusIdx(0);
  };

  const changeHideLow = (on: boolean) => {
    setHideLow(on);
    setFocusIdx(0);
  };

  // j/k navigation + a/d shortcuts on the focused finding (keyboard).
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "j") setFocusIdx((i) => Math.min(i + 1, shown.length - 1));
      else if (e.key === "k") setFocusIdx((i) => Math.max(i - 1, 0));
      else if (KEY_TO_ACTION[e.key] && shown[focusIdx]) {
        action.mutate({ findingId: shown[focusIdx]!.id, action: KEY_TO_ACTION[e.key]!, prId });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shown, focusIdx, action, prId]);

  return (
    <div>
      <div style={s.toolbar}>
        <div role="group" style={s.severityFilters} aria-label={t("panel.severityFilters")}>
          {FILTER_SEVERITIES.flatMap((severity, index) => {
            const count = severityCounts[severity];
            if (count === 0) return [];
            const colors = SEVERITY_COLORS[severity];
            const filter = (
              <button
                key={severity}
                type="button"
                aria-pressed={activeSeverity === severity}
                onClick={() => selectSeverity(severity)}
                style={s.severityButton(colors.color, colors.background, activeSeverity === severity)}
              >
                {t("panel.severityCounter", {
                  count,
                  severity: t(`panel.severity.${severity.toLowerCase()}`),
                })}
              </button>
            );
            const hasEarlierCounter = FILTER_SEVERITIES.slice(0, index).some(
              (candidate) => severityCounts[candidate] > 0,
            );
            return hasEarlierCounter
              ? [
                  <span key={`${severity}-separator`} aria-hidden="true" style={s.separator}>
                    ·
                  </span>,
                  filter,
                ]
              : [filter];
          })}
        </div>
        <div style={s.toggleGroup}>
          {t("panel.hideLowConfidence")}
          <Toggle on={hideLow} onChange={changeHideLow} size={16} />
        </div>
      </div>

      <div style={s.list}>
        {shown.length === 0 ? (
          <EmptyState icon="Filter" title={t("panel.noMatchTitle")} body={t("panel.noMatchBody")} />
        ) : (
          shown.map((f, i) => (
            <FindingCard
              key={f.id}
              f={f}
              focused={i === focusIdx}
              defaultExpanded={i === 0}
              pending={action.isPending}
              repoFullName={repoFullName}
              headSha={headSha}
              onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
            />
          ))
        )}
      </div>
    </div>
  );
}
