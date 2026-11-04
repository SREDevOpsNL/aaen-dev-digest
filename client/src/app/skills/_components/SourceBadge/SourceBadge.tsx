"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";

/** Provenance badge; only imported skills get one, so manual skills stay uncluttered. */
export function SourceBadge({ source }: { source: Skill["source"] }) {
  const t = useTranslations("skills");
  if (source !== "imported_file") return null;
  return <Badge color="var(--accent)" icon="Upload">{t("source.imported_file")}</Badge>;
}
