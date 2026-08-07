import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

const TOKEN_KEY = "atlas.admin_token";

/**
 * Triggers a re-ingest without shelling into the container.
 *
 * The endpoint is token-guarded and disabled outright when ATLAS_ADMIN_TOKEN is
 * unset, so this asks for the token once and keeps it in sessionStorage — it is
 * an operator action on a self-hosted box, not an end-user one.
 */
export function RefreshButton() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<"idle" | "running">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    let token = sessionStorage.getItem(TOKEN_KEY) ?? "";
    if (!token) {
      token = window.prompt("Admin token (ATLAS_ADMIN_TOKEN)") ?? "";
      if (!token) return;
      sessionStorage.setItem(TOKEN_KEY, token);
    }

    setState("running");
    setMessage(null);
    try {
      const res = await fetch("/api/admin/refresh", {
        method: "POST",
        headers: { "X-Atlas-Token": token },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) sessionStorage.removeItem(TOKEN_KEY);
        setMessage(body.detail ?? `${res.status} ${res.statusText}`);
        return;
      }
      setMessage(body.detail ?? "done");
      await queryClient.invalidateQueries();
    } catch (err) {
      setMessage(String(err));
    } finally {
      setState("idle");
    }
  }

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={state === "running"}
        className="min-h-6 rounded border px-2 py-0.5 text-[11px] disabled:opacity-50"
        style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
      >
        {state === "running" ? "Refreshing…" : "Refresh data"}
      </button>
      {message && (
        <span className="max-w-64 truncate text-[11px]" style={{ color: "var(--text-muted)" }} title={message}>
          {message}
        </span>
      )}
    </span>
  );
}
