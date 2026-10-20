"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@devdigest/ui";

export function ScaffoldTab({ kind }: { kind: "evals" | "stats" }) {
  const t = useTranslations("skills");
  return (
    <EmptyState
      icon={kind === "evals" ? "FlaskConical" : "BarChart"}
      title={t(`${kind}.title`)}
      body={t(`${kind}.body`)}
    />
  );
}
