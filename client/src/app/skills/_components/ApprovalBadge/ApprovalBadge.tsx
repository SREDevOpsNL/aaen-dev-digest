"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { SkillApproval } from "@devdigest/shared";
import { APPROVAL_COLORS } from "../../constants";

/**
 * Whether the skill's current content may enter the review's system message.
 * Deliberately separate from the Enabled switch: an enabled skill that is not
 * approved blocks the reviews that would use it.
 */
export function ApprovalBadge({ approval }: { approval: SkillApproval }) {
  const t = useTranslations("skills");
  return (
    <span
      data-testid="skill-approval"
      data-status={approval.status}
      title={t(`approval.statusTooltip.${approval.status}`, {
        version: approval.version,
        approved: approval.approved_version ?? 0,
      })}
    >
      <Badge color={APPROVAL_COLORS[approval.status]} icon={approval.status === "approved" ? "Shield" : "AlertTriangle"}>
        {t(`approval.status.${approval.status}`)}
      </Badge>
    </span>
  );
}
