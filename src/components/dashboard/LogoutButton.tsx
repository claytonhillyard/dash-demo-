"use client";
import { useState } from "react";

export function LogoutButton() {
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  }
  return (
    <button
      onClick={logout}
      disabled={busy}
      className="w-full rounded-lg border border-border px-3 py-2 text-xs uppercase tracking-widest text-text/60 transition-colors hover:border-gold/40 hover:text-gold disabled:opacity-50"
    >
      {busy ? "Signing out…" : "Log Out"}
    </button>
  );
}
