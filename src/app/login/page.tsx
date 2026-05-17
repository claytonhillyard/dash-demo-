"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Login() {
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user, password }),
    });
    if (res.ok) router.replace("/");
    else setError(true);
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <form onSubmit={submit} className="w-80 space-y-3 rounded-lg bg-surface p-6">
        <h1 className="font-display text-gold text-xl tracking-widest">CHILLY.AI</h1>
        <input aria-label="user" className="w-full bg-bg p-2" value={user}
          onChange={(e) => setUser(e.target.value)} />
        <input aria-label="password" type="password" className="w-full bg-bg p-2"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="text-bad text-sm" role="alert">Invalid credentials</p>}
        <button className="w-full bg-gold p-2 text-black" type="submit">Enter</button>
      </form>
    </main>
  );
}
