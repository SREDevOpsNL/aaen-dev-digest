/* FindingsPreview — per-severity finding counts with a read-only hover/focus
   preview of the findings behind them. Shared by the PR list (PRRow) and the
   PR timeline (RunHistory); ported from RunFindings + FindingsTooltip in the
   L01 design (prdetail_runs.jsx). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import { shortFindingDescription } from "../../helpers";
import { PREVIEW_SEVERITIES, SEVERITY_META, type PreviewFinding, type PreviewSeverity } from "./constants";
import { tooltipPosition } from "./helpers";
import { s } from "./styles";

function metaOf(severity: string) {
  return SEVERITY_META[severity as PreviewSeverity] ?? { color: "var(--text-muted)", icon: "Info" as const };
}

export function FindingsPreview({
  counts,
  items,
  align = "left",
}: {
  /** Findings per severity; zero and missing severities are not shown. */
  counts: Partial<Record<string, number>>;
  /** The findings behind the counts. With none, the counts render without a preview. */
  items: PreviewFinding[];
  /** Which edge of the counts the preview aligns to. */
  align?: "left" | "right";
}) {
  const t = useTranslations("prReview");
  const triggerRef = React.useRef<HTMLSpanElement>(null);
  const [position, setPosition] = React.useState<React.CSSProperties | null>(null);
  const tooltipId = React.useId();
  const open = position !== null;

  const show = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPosition(tooltipPosition(rect, align, { width: window.innerWidth, height: window.innerHeight }));
  };
  const hide = () => setPosition(null);

  // A fixed card would detach from the counts on scroll; close it instead.
  React.useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, [open]);

  const shown = PREVIEW_SEVERITIES.filter((severity) => (counts[severity] ?? 0) > 0);
  if (shown.length === 0) return null;

  const interactive = items.length > 0;
  const summary = shown
    .map((severity) => `${counts[severity]} ${t("panel.severity." + severity.toLowerCase())}`)
    .join(", ");

  return (
    <span
      ref={triggerRef}
      role="group"
      aria-label={`${t("list.columns.findings")}: ${summary}`}
      aria-describedby={open && interactive ? tooltipId : undefined}
      tabIndex={interactive ? 0 : undefined}
      style={s.trigger(interactive)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onClick={(event) => event.stopPropagation()}
    >
      {shown.map((severity) => {
        const meta = SEVERITY_META[severity];
        const SeverityIcon = Icon[meta.icon];
        return (
          <span key={severity} style={s.count(meta.color)}>
            <SeverityIcon size={12.5} aria-hidden />
            <span className="tnum">{counts[severity]}</span>
          </span>
        );
      })}

      {position && interactive && (
        <span style={s.tooltipFrame(position)}>
          <span id={tooltipId} role="tooltip" style={s.tooltipCard}>
            <span style={s.heading}>
              <Icon.AlertOctagon size={12} aria-hidden />
              {t("list.findingsInRun", { count: items.length })}
            </span>
            <span style={s.list}>
              {items.map((finding, index) => {
                const meta = metaOf(finding.severity);
                const SeverityIcon = Icon[meta.icon];
                const lines =
                  finding.end_line != null && finding.end_line !== finding.start_line
                    ? `${finding.start_line}-${finding.end_line}`
                    : `${finding.start_line}`;
                return (
                  <span key={[finding.file, finding.start_line, index].join(":")} style={s.item(index === items.length - 1)}>
                    <span style={s.itemHeader}>
                      <span style={s.severity(meta.color)}>
                        <SeverityIcon size={12} aria-hidden />
                        {t("panel.severity." + finding.severity.toLowerCase())}
                      </span>{" "}
                      <strong>{finding.title}</strong> · <span style={s.category}>{finding.category}</span>
                    </span>
                    <span className="mono" style={s.location}>
                      {finding.file}:{lines} · {Math.round(finding.confidence * 100)}%
                    </span>
                    <span style={s.description}>{shortFindingDescription(finding.rationale)}</span>
                  </span>
                );
              })}
            </span>
          </span>
        </span>
      )}
    </span>
  );
}
