import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConfirmModal } from "./ConfirmModal";

afterEach(cleanup);

function renderModal(props: Partial<React.ComponentProps<typeof ConfirmModal>> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmModal title="Delete skill" confirmLabel="Delete" cancelLabel="Cancel" onConfirm={onConfirm} onCancel={onCancel} {...props}>
      Delete “x”?
    </ConfirmModal>,
  );
  return { onConfirm, onCancel };
}

describe("ConfirmModal", () => {
  it("offers Confirm, Cancel and an X close control", () => {
    renderModal();
    expect(screen.getByRole("dialog")).toHaveTextContent("Delete “x”?");
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("Confirm calls onConfirm only; Cancel and X call onCancel", () => {
    const { onConfirm, onCancel } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("while pending, disables both actions, hides X and shows the error slot", () => {
    renderModal({ pending: true, pendingLabel: "Deleting…", error: "Could not delete." });
    expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not delete.");
  });
});
