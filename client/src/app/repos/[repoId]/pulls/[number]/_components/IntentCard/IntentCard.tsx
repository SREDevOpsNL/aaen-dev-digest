"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, SectionLabel } from "@devdigest/ui";
import type { IntentAnalysis, PrIntentView } from "@devdigest/shared";
import { useEnsurePrIntent, usePrIntent, useRecomputePrIntent } from "@/lib/hooks";
import { s } from "./styles";

/**
 * PR intent (L03): why this PR was opened, as derived from its claims and
 * changes. Reading never bills; on first open with nothing cached the card
 * asks the server to generate it (rate-limited). Stale intent is shown with a
 * manual Recompute — never refreshed automatically here.
 */
export function IntentCard({ prId }: { prId: string }) {
  const t = useTranslations("prReview.intent");
  const query = usePrIntent(prId);
  const ensure = useEnsurePrIntent();
  const recompute = useRecomputePrIntent();
  const requested = React.useRef(false);

  // Auto-generate exactly once per mount, only when nothing is cached.
  React.useEffect(() => {
    if (query.data?.state === "missing" && !requested.current) {
      requested.current = true;
      ensure.mutate(prId);
    }
  }, [query.data?.state, prId, ensure]);

  const view = query.data;
  const busy = ensure.isPending || recompute.isPending;
  const recomputeButton =
    view && view.state !== "missing" ? (
      <Button kind="secondary" size="sm" onClick={() => recompute.mutate(prId)} disabled={busy}>
        {recompute.isPending ? t("recomputing") : t("recompute")}
      </Button>
    ) : null;

  let body: React.ReactNode;
  if (query.isError) {
    body = <div style={s.notice("error")}>{t("loadError")}</div>;
  } else if (!view || view.state === "missing" || (busy && !view.analysis)) {
    body = <div style={s.notice("info")}>{t("deriving")}</div>;
  } else if (view.state === "skipped_no_key") {
    body = <div style={s.notice("warn")}>{t("noKey")}</div>;
  } else if (view.state === "failed") {
    body = <div style={s.notice("error")}>{t("failed", { error: view.last_error ?? "" })}</div>;
  } else {
    body = <ReadyIntent view={view} analysis={view.analysis!} />;
  }

  return (
    <section>
      <SectionLabel icon="Target" right={recomputeButton}>
        {t("title")}
      </SectionLabel>
      <div style={s.card} data-testid="intent-card">
        {body}
      </div>
    </section>
  );
}

function ReadyIntent({ view, analysis }: { view: PrIntentView; analysis: IntentAnalysis }) {
  const t = useTranslations("prReview.intent");
  const reasons = view.stale_reasons.map((r) => t(`staleReason.${r}`)).join("; ");
  const low = analysis.confidence === "low";

  return (
    <>
      <div style={s.badges}>
        {view.stale && (
          <Badge color="var(--warn)" bg="var(--warn-bg)" icon="Clock">
            {t("stale")}
          </Badge>
        )}
        <Badge
          color={low ? "var(--warn)" : "var(--text-secondary)"}
          bg={low ? "var(--warn-bg)" : "transparent"}
          icon={low ? "AlertTriangle" : "Check"}
        >
          {t(`confidence.${analysis.confidence}`)}
        </Badge>
        {view.linked_issue && (
          <Badge color="var(--text-secondary)" bg="transparent" icon="GitBranch">
            {t("linkedIssue", { number: view.linked_issue.number, title: view.linked_issue.title })}
          </Badge>
        )}
      </div>

      {view.stale && <div style={s.notice("warn")}>{t("staleHint", { reasons })}</div>}
      {view.last_error && <div style={s.notice("error")}>{t("lastError", { error: view.last_error })}</div>}
      {low && <div style={s.notice("info")}>{t("lowConfidenceHint")}</div>}

      {analysis.claimed_purpose && (
        <div>
          <div style={s.heading}>{t("claimed")}</div>
          <div>{analysis.claimed_purpose}</div>
        </div>
      )}

      <div>
        <div style={s.heading}>{t("supported")}</div>
        <div style={s.hint}>{t("supportedHint")}</div>
        {analysis.supported_points.length > 0 ? (
          <ul style={s.list}>
            {analysis.supported_points.map((p, i) => (
              <li key={i}>
                {p.statement}{" "}
                <span style={s.cite}>
                  ({p.evidence.map((e) => `${e.file}:${e.side === "new" ? "L" : "O"}${e.start_line}`).join(", ")})
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div>{t("noSupported")}</div>
        )}
      </div>

      {analysis.in_scope.length > 0 && (
        <div>
          <div style={s.heading}>{t("inScope")}</div>
          <ul style={s.list}>{analysis.in_scope.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}
      {analysis.out_of_scope.length > 0 && (
        <div>
          <div style={s.heading}>{t("outOfScope")}</div>
          <ul style={s.list}>{analysis.out_of_scope.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}
      {analysis.discrepancies.length > 0 && (
        <div>
          <div style={s.heading}>{t("discrepancies")}</div>
          <ul style={s.list}>
            {analysis.discrepancies.map((d, i) => (
              <li key={i}>
                {t(`discrepancyKind.${d.kind}`)}: {d.statement}
              </li>
            ))}
          </ul>
        </div>
      )}
      {analysis.unverified_statements.length > 0 && (
        <div>
          <div style={s.heading}>{t("unverified")}</div>
          <div style={s.hint}>{t("unverifiedHint")}</div>
          <ul style={s.list}>{analysis.unverified_statements.map((u, i) => <li key={i}>{u.statement}</li>)}</ul>
        </div>
      )}

      <div style={s.meta}>
        {view.model && t("derivedWith", { model: view.model })}
        {" · "}
        {view.provider_cost_usd !== null
          ? t("cost", { cost: view.provider_cost_usd.toFixed(4) })
          : t("costUnknown")}
        {view.evidence?.truncated && ` · ${t("evidenceTruncated")}`}
      </div>
    </>
  );
}
