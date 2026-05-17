"use client";
import { useEffect, useRef } from "react";
import { createChart, type IChartApi } from "lightweight-charts";

export function Sparkline({ points }: { points: number[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || points.length === 0) return;
    const chart: IChartApi = createChart(ref.current, {
      width: 96, height: 28,
      layout: { background: { color: "transparent" }, textColor: "transparent" },
      rightPriceScale: { visible: false },
      timeScale: { visible: false },
      grid: { horzLines: { visible: false }, vertLines: { visible: false } },
      handleScroll: false, handleScale: false,
    });
    const series = chart.addLineSeries({ lineWidth: 1 });
    series.setData(points.map((v, i) => ({ time: (i + 1) as any, value: v })));
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [points]);
  return <div ref={ref} data-testid="sparkline" />;
}
