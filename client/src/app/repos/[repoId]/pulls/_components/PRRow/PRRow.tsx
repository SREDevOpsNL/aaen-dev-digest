/* PRRow — one clickable row in the PR list table. Ported from screen_dashboard.jsx. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, Avatar, Badge, CircularScore } from "@devdigest/ui";
import type { PrMeta } from "@/lib/types";
import { formatUsdCost } from "@/lib/format-cost";
import { SIZE_COLOR, STATUS_META } from "../../constants";
import { relativeTime, sizeOf } from "../../helpers";
import { s } from "../../styles";

export function PRRow({ pr, repoId }: { pr: PrMeta; repoId: string }) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const [h, setH] = React.useState(false);
  const [findingsOpen, setFindingsOpen] = React.useState(false);
  const previews = pr.finding_previews ?? [];
  const st = STATUS_META[pr.status] ?? STATUS_META.needs_review!;
  const { size, lines } = sizeOf(pr);
  const reviewed = pr.score != null; // null score ⇒ PR has never been reviewed
  return (
    <div
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      onClick={() => router.push(`/repos/${repoId}/pulls/${pr.number}`)}
      style={s.row(h)}
    >
      <div style={s.rowTitleCell}>
        <Icon.GitPullRequest size={15} style={s.rowIcon(st.c)} />
        <div style={s.rowTitleWrap}>
          <div style={s.rowTitle(h)}>{pr.title}</div>
          <span className="mono" style={s.rowNumber}>
            #{pr.number}
          </span>
        </div>
      </div>
      <div style={s.authorCell}>
        <Avatar name={pr.author} size={18} />
        {pr.author}
      </div>
      <div>
        <Badge
          color={SIZE_COLOR[size]}
          bg="transparent"
          style={s.sizeBadgeBorder(SIZE_COLOR[size]!)}
        >
          {size} · {lines}
        </Badge>
      </div>
      <div style={s.scoreCell}>
        {reviewed ? (
          <CircularScore score={pr.score!} size={34} stroke={3} />
        ) : (
          <span style={s.muted}>—</span>
        )}
      </div>
      <div className="mono" style={s.costCell}>{formatUsdCost(pr.cost_usd)}</div>
      <div style={{ position: "relative" }} onMouseEnter={() => setFindingsOpen(true)} onMouseLeave={() => setFindingsOpen(false)} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
          {Object.entries(pr.findings_by_severity ?? {}).filter(([, count]) => count > 0).map(([severity, count]) => <Badge key={severity} color={severity === "CRITICAL" ? "var(--crit)" : severity === "WARNING" ? "var(--warn)" : "var(--sugg)"} bg="transparent">{severity[0]} {count}</Badge>)}
          {previews.length === 0 && <span style={s.muted}>—</span>}
        </div>
        {findingsOpen && previews.length > 0 && (
          <div role="tooltip" style={{ position: "absolute", zIndex: 10, top: 24, right: 0, width: 340, padding: 12, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-elevated)", boxShadow: "0 8px 24px rgba(0,0,0,.25)" }}>
            <strong style={{ fontSize: 12 }}>{t("list.findingsInRun", { count: previews.length })}</strong>
            {previews.map((finding, index) => <div key={`${finding.file}:${finding.start_line}:${index}`} style={{ marginTop: 10, fontSize: 12 }}>
              <div><Badge color={finding.severity === "CRITICAL" ? "var(--crit)" : finding.severity === "WARNING" ? "var(--warn)" : "var(--sugg)"} bg="transparent">{finding.severity}</Badge> <strong>{finding.title}</strong> · {finding.category}</div>
              <div className="mono">{finding.file}:{finding.start_line} · {Math.round(finding.confidence * 100)}%</div>
              <div>{finding.rationale}</div>
            </div>)}
          </div>
        )}
      </div>
      <div>
        <Badge dot color={st.c} bg="transparent">
          {t(`list.status.${st.labelKey}`)}
        </Badge>
      </div>
      <div style={s.updatedCell}>{relativeTime(pr.updated_at)}</div>
    </div>
  );
}
