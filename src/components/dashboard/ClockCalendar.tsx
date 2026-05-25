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

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

export function ClockCalendar() {
  const now = useNow();
  const time = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  const monthLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric" }).toUpperCase();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Blank cells before day 1 so each date sits under its real weekday column.
  const leadingBlanks = new Date(year, month, 1).getDay();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  return (
    <Panel title="Calendar" state="ready">
      <div className="mb-2 flex items-baseline justify-between">
        <div data-testid="clock" className="font-mono text-2xl tracking-wider text-text">
          {time}
        </div>
        <div className="text-right text-[10px] uppercase tracking-wider text-text/45">
          <div>{weekday}</div>
          <div className="text-gold/70">{monthLabel}</div>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px]">
        {WEEKDAYS.map((d, i) => (
          <span key={`wd-${i}`} className="font-medium text-text/30">{d}</span>
        ))}
        {Array.from({ length: leadingBlanks }, (_, i) => (
          <span key={`blank-${i}`} />
        ))}
        {days.map((d) => (
          <span
            key={d}
            className={
              d === today
                ? "rounded bg-gold/20 py-0.5 font-semibold text-gold ring-1 ring-gold/40"
                : "py-0.5 text-text/60"
            }
          >
            {d}
          </span>
        ))}
      </div>
    </Panel>
  );
}
