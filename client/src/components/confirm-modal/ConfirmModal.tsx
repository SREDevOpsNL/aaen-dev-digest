"use client";

import React from "react";
import { Button, Modal } from "@devdigest/ui";

/**
 * Confirmation dialog for destructive actions: Confirm, Cancel and the Modal's
 * own X close. Cancel, X and the backdrop all call `onCancel`. Callers pass
 * translated labels, so the component stays namespace-agnostic.
 */
export function ConfirmModal({
  title,
  children,
  confirmLabel,
  cancelLabel,
  pendingLabel,
  pending = false,
  confirmDisabled = false,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  children?: React.ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  pendingLabel?: string;
  pending?: boolean;
  /** Keep Confirm disabled, e.g. until the caller has loaded what the action affects. */
  confirmDisabled?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      width={460}
      title={title}
      onClose={pending ? undefined : onCancel}
      footer={
        <div style={{ display: "flex", gap: 8 }}>
          <Button kind="danger" icon="Trash" onClick={onConfirm} disabled={pending || confirmDisabled}>
            {pending && pendingLabel ? pendingLabel : confirmLabel}
          </Button>
          <Button kind="ghost" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </Button>
        </div>
      }
    >
      <div style={{ padding: 24, fontSize: 14, lineHeight: 1.55, color: "var(--text-secondary)" }}>
        {children}
        {error && (
          <div role="alert" style={{ marginTop: 12, color: "var(--crit)", fontSize: 13 }}>
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
