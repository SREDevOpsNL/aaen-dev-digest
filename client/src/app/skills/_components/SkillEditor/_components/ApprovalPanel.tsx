"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, ErrorState, FormField, Skeleton, TextInput } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { ConfirmModal } from "@/components/confirm-modal";
import { ApiError } from "@/lib/api";
import { useApproveSkill, useRevokeSkill, useSkillApprovals } from "@/lib/hooks/skills";
import { ApprovalBadge } from "../../ApprovalBadge";
import { skillStyles as s } from "../../../styles";

type Pending = "approve" | "revoke" | undefined;

/** The exact stored body, unrendered: HTML comments, raw HTML and link
 *  definitions that Markdown would hide are all visible here. */
function RawBody({ body, label }: { body: string; label: string }) {
  return (
    <pre
      aria-label={label}
      data-testid="approval-raw-body"
      className="mono"
      tabIndex={0}
      style={{ ...rawStyle }}
    >
      {body}
    </pre>
  );
}

const rawStyle: React.CSSProperties = {
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  maxHeight: 320,
  overflow: "auto",
  margin: "8px 0",
  padding: "10px 12px",
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--bg-surface)",
  fontSize: 12,
};

/**
 * Owner decision for the skill's CURRENT content. The owner reviews the raw
 * stored text (not the rendered Markdown, which hides comments and raw HTML),
 * and Approve sends the version and body digest shown with it, so the server
 * can refuse (409) when the body changed in the meantime; it never approves
 * "whatever is current".
 */
export function ApprovalPanel({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const approve = useApproveSkill();
  const revoke = useRevokeSkill();
  const history = useSkillApprovals(skill.id);
  const [pending, setPending] = React.useState<Pending>();
  const [reason, setReason] = React.useState("");
  const { approval } = skill;

  const open = (kind: Exclude<Pending, undefined>) => {
    approve.reset();
    revoke.reset();
    setReason("");
    setPending(kind);
  };
  const errorFor = (error: unknown) => {
    if (!error) return null;
    if (error instanceof ApiError && error.status === 409 && pending === "approve") return t("approval.conflict");
    if (error instanceof ApiError && error.status === 403) return t("approval.forbidden");
    return t("approval.failed");
  };
  const done = { onSuccess: () => setPending(undefined) };

  return (
    <section aria-label={t("approval.title")} style={{ marginTop: 24 }}>
      <div style={s.sectionRow}>
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>{t("approval.title")}</h2>
        <ApprovalBadge approval={approval} />
      </div>
      <p style={{ ...s.muted, marginBottom: 8 }}>{t("approval.explainer")}</p>
      <h3 style={{ fontSize: 13, fontWeight: 700, margin: "12px 0 0" }}>{t("approval.rawTitle")}</h3>
      <p style={{ ...s.muted, fontSize: 12 }}>{t("approval.rawHint")}</p>
      <RawBody body={skill.body} label={t("approval.rawTitle")} />
      <p className="mono" style={{ ...s.muted, fontSize: 12, overflowWrap: "anywhere" }} title={approval.body_sha256}>
        {t("approval.current", { version: approval.version, digest: approval.body_sha256 })}
      </p>
      {approval.approved_version !== null && approval.approved_at && (
        <p style={{ ...s.muted, fontSize: 12 }}>
          {t("approval.approvedBy", { version: approval.approved_version, at: new Date(approval.approved_at).toLocaleString() })}
        </p>
      )}
      <div style={{ ...s.actions, justifyContent: "flex-start", gap: 8 }}>
        {approval.status !== "approved" && (
          <Button kind="primary" size="sm" icon="Shield" onClick={() => open("approve")}>
            {t("approval.approve")}
          </Button>
        )}
        {(approval.status === "approved" || approval.status === "stale") && (
          <Button kind="secondary" size="sm" icon="XCircle" onClick={() => open("revoke")}>
            {t("approval.revoke")}
          </Button>
        )}
      </div>

      <h3 style={{ fontSize: 13, fontWeight: 700, margin: "18px 0 8px" }}>{t("approval.historyTitle")}</h3>
      {history.isLoading ? (
        <Skeleton height={48} />
      ) : history.isError ? (
        <ErrorState body={t("approval.historyError")} onRetry={() => void history.refetch()} />
      ) : !history.data?.length ? (
        <p style={s.muted}>{t("approval.historyEmpty")}</p>
      ) : (
        <ol aria-label={t("approval.historyTitle")} style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {history.data.map((record) => (
            <li key={record.id} style={{ ...s.versionRow, fontSize: 12 }}>
              <span>
                {t("approval.historyRow", {
                  decision: t(`approval.decision.${record.decision}`),
                  version: record.version,
                  actor: record.actor_name ?? record.actor_user_id,
                  at: new Date(record.created_at).toLocaleString(),
                })}
              </span>
              {record.reason && <span style={{ ...s.muted, fontSize: 12 }}> — {record.reason}</span>}
            </li>
          ))}
        </ol>
      )}

      {pending === "approve" && (
        <ConfirmModal
          title={t("approval.approveTitle", { version: approval.version })}
          confirmLabel={t("approval.approveConfirm")}
          cancelLabel={t("approval.cancel")}
          pendingLabel={t("approval.approvePending")}
          confirmKind="primary"
          confirmIcon="Shield"
          pending={approve.isPending}
          error={errorFor(approve.error)}
          onConfirm={() =>
            approve.mutate(
              { id: skill.id, version: approval.version, body_sha256: approval.body_sha256, reason: reason.trim() || undefined },
              done,
            )
          }
          onCancel={() => setPending(undefined)}
        >
          <p>{t("approval.approveBody", { version: approval.version })}</p>
          <RawBody body={skill.body} label={t("approval.rawConfirmTitle", { version: approval.version })} />
          <p className="mono" data-testid="approval-confirm-digest" style={{ ...s.muted, fontSize: 12, overflowWrap: "anywhere" }}>
            {t("approval.current", { version: approval.version, digest: approval.body_sha256 })}
          </p>
          <FormField label={t("approval.reasonLabel")}>
            <TextInput value={reason} onChange={setReason} aria-label={t("approval.reasonLabel")} />
          </FormField>
        </ConfirmModal>
      )}
      {pending === "revoke" && (
        <ConfirmModal
          title={t("approval.revokeTitle", { name: skill.name })}
          confirmLabel={t("approval.revokeConfirm")}
          cancelLabel={t("approval.cancel")}
          pendingLabel={t("approval.revokePending")}
          confirmIcon="XCircle"
          pending={revoke.isPending}
          error={errorFor(revoke.error)}
          onConfirm={() => revoke.mutate({ id: skill.id, reason: reason.trim() || undefined }, done)}
          onCancel={() => setPending(undefined)}
        >
          <p>{t("approval.revokeBody")}</p>
          <FormField label={t("approval.reasonLabel")}>
            <TextInput value={reason} onChange={setReason} aria-label={t("approval.reasonLabel")} />
          </FormField>
        </ConfirmModal>
      )}
    </section>
  );
}
