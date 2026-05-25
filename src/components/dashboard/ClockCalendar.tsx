"use client";
import { useEffect, useState } from "react";
import { Panel } from "@/components/Panel";

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function ClockCalendar() {
  const now = useNow();
  const time = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  const monthLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric" }).toUpperCase();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  return (
    <Panel title="Clock & Calendar" state="ready">
      <div data-testid="clock" className="font-mono text-2xl text-text">{time}</div>
      <div className="mb-2 text-xs text-text/50">{monthLabel}</div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px]">
        {days.map((d) => (
          <span key={d} className={d === today ? "rounded bg-gold/20 text-gold" : "text-text/60"}>
            {d}
          </span>
        ))}
      </div>
    </Panel>
  );
}
