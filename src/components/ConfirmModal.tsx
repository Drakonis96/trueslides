"use client";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "OK",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl p-5 w-full max-w-sm mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold mb-2">{title}</h3>
        <p className="text-xs text-[var(--muted)] mb-4">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--surface)] text-[var(--fg)] hover:bg-[var(--surface-2)] transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              danger
                ? "bg-red-500 text-white hover:bg-red-600"
                : "bg-[var(--accent)] text-white hover:opacity-90"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
