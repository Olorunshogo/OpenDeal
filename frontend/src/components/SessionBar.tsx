"use client";

import { useState } from "react";
import { clearSession, loadSession, saveSession, type Session } from "@/lib/session";

export function SessionBar() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [token, setToken] = useState("");
  const [pubkey, setPubkey] = useState("");
  const [roleLabel, setRoleLabel] = useState("seller");

  function onSave() {
    const next = { token: token.trim(), pubkey: pubkey.trim(), roleLabel };
    saveSession(next);
    setSession(next);
  }

  function onClear() {
    clearSession();
    setSession(null);
    setToken("");
    setPubkey("");
  }

  if (session) {
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--ink-muted)]">
        <span className="network-badge rounded border border-[var(--line)] px-2 py-1 text-[var(--accent-soft)]">
          regtest experimental
        </span>
        <span>
          {session.roleLabel}: {session.pubkey.slice(0, 8)}…{session.pubkey.slice(-6)}
        </span>
        <button
          type="button"
          onClick={onClear}
          className="underline decoration-[var(--line)] underline-offset-4 hover:text-[var(--ink)]"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg-lift)]/60 p-3 text-sm">
      <p className="text-[var(--ink-muted)]">
        Paste a JWT from Nostr login (`POST /api/v1/auth/nostr/login`) for demo sessions.
      </p>
      <div className="grid gap-2 md:grid-cols-3">
        <input
          className="rounded border border-[var(--line)] bg-transparent px-2 py-1.5"
          placeholder="Bearer token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <input
          className="rounded border border-[var(--line)] bg-transparent px-2 py-1.5"
          placeholder="Your pubkey (hex)"
          value={pubkey}
          onChange={(e) => setPubkey(e.target.value)}
        />
        <select
          className="rounded border border-[var(--line)] bg-[var(--bg-deep)] px-2 py-1.5"
          value={roleLabel}
          onChange={(e) => setRoleLabel(e.target.value)}
        >
          <option value="seller">seller</option>
          <option value="buyer">buyer</option>
          <option value="mediator">mediator</option>
        </select>
      </div>
      <button
        type="button"
        onClick={onSave}
        className="w-fit rounded bg-[var(--accent)] px-3 py-1.5 font-medium text-[var(--bg-deep)]"
      >
        Save session
      </button>
    </div>
  );
}
