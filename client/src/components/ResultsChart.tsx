import { useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Line,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency } from "@/lib/locationData";
import type { SimulationResult } from "@shared/schema";

interface ResultsChartProps {
  result: SimulationResult;
  currency?: string;
  currencySymbol?: string;
}

function ChartTooltip({ active, payload, label, currencySymbol }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover border border-popover-border rounded-md p-3 shadow-lg max-w-[220px]">
      <p className="text-xs font-semibold mb-2">Year {label}</p>
      {payload
        .filter((e: any) => e.name !== "spaghetti")
        .map((entry: any, i: number) => (
          <div key={i} className="flex items-center gap-2 text-xs mb-0.5">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
            <span className="text-muted-foreground truncate">{entry.name}:</span>
            <span className="font-mono font-medium">{formatCurrency(entry.value, "", currencySymbol || "$")}</span>
          </div>
        ))}
    </div>
  );
}

export function ResultsChart({ result, currency = "USD", currencySymbol = "$" }: ResultsChartProps) {
  const [activeChart, setActiveChart] = useState("fan");

  const fmt = (val: number) => formatCurrency(val, currency, currencySymbol);

  const spaghettiData = useMemo(() => {
    return result.medianPath.map((mp, i) => {
      const row: Record<string, number> = {
        year: mp.year,
        Median: Math.round(mp.difference),
        p10: Math.round(result.percentile10[i].difference),
        p25: Math.round(result.percentile25[i].difference),
        p75: Math.round(result.percentile75[i].difference),
        p90: Math.round(result.percentile90[i].difference),
      };
      result.samplePaths.forEach((path, j) => {
        row[`s${j}`] = Math.round(path[i].difference);
      });
      return row;
    });
  }, [result]);

  const scurveData = useMemo(() => result.breakEvenCurve, [result]);

  const kdeData = useMemo(() => {
    const diffs = result.terminalDistribution;
    const min = Math.min(...diffs);
    const max = Math.max(...diffs);
    const range = max - min;
    if (range === 0) return [{ x: fmt(min), density: diffs.length, isPositive: min > 0, raw: min }];

    const bucketCount = 40;
    const bucketSize = range / bucketCount;
    const bandwidth = range / 15;

    const points: { x: string; density: number; isPositive: boolean; raw: number }[] = [];
    for (let i = 0; i < bucketCount; i++) {
      const center = min + (i + 0.5) * bucketSize;
      let density = 0;
      for (const d of diffs) {
        const u = (center - d) / bandwidth;
        density += Math.exp(-0.5 * u * u) / (bandwidth * Math.sqrt(2 * Math.PI));
      }
      density /= diffs.length;
      points.push({
        x: fmt(center),
        density: density * 1000,
        isPositive: center > 0,
        raw: center,
      });
    }
    return points;
  }, [result, currency, currencySymbol]);

  const tornadoData = useMemo(() => {
    return result.sensitivityData
      .map((d) => ({
        variable: d.variable,
        lowDelta: d.low - d.baseMedian,
        highDelta: d.high - d.baseMedian,
        absRange: Math.abs(d.high - d.low),
      }))
      .sort((a, b) => b.absRange - a.absRange);
  }, [result]);

  return (
    <Tabs value={activeChart} onValueChange={setActiveChart} className="w-full">
      <TabsList className="grid w-full grid-cols-4 mb-4">
        <TabsTrigger value="fan" data-testid="tab-fan">Projections</TabsTrigger>
        <TabsTrigger value="scurve" data-testid="tab-scurve">Breakeven</TabsTrigger>
        <TabsTrigger value="kde" data-testid="tab-kde">Outcomes</TabsTrigger>
        <TabsTrigger value="tornado" data-testid="tab-tornado">What matters</TabsTrigger>
      </TabsList>

      <TabsContent value="fan">
        <p className="text-xs text-muted-foreground mb-3">
          Each thin line is one possible future. The bold line shows the most likely outcome. Above zero means buying is ahead. Shaded areas show the range of likely results.
        </p>
        <div className="h-[350px] sm:h-[420px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spaghettiData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
              <XAxis dataKey="year" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickLine={false} />
              <YAxis tickFormatter={fmt} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickLine={false} width={70} />
              <Tooltip content={<ChartTooltip currencySymbol={currencySymbol} />} />
              <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeWidth={1} />
              {result.samplePaths.slice(0, 100).map((_, j) => (
                <Line
                  key={j}
                  type="monotone"
                  dataKey={`s${j}`}
                  stroke="hsl(197, 85%, 55%)"
                  strokeWidth={0.4}
                  strokeOpacity={0.15}
                  dot={false}
                  name="spaghetti"
                  legendType="none"
                />
              ))}
              <Area type="monotone" dataKey="p90" stroke="none" fill="hsl(197, 85%, 45%)" fillOpacity={0.06} name="Best 10% range" legendType="none" />
              <Area type="monotone" dataKey="p75" stroke="none" fill="hsl(197, 85%, 45%)" fillOpacity={0.08} name="Better half range" legendType="none" />
              <Area type="monotone" dataKey="p25" stroke="none" fill="hsl(25, 90%, 50%)" fillOpacity={0.06} name="Worse half range" legendType="none" />
              <Area type="monotone" dataKey="p10" stroke="none" fill="hsl(25, 90%, 50%)" fillOpacity={0.08} name="Worst 10% range" legendType="none" />
              <Line
                type="monotone"
                dataKey="Median"
                stroke="hsl(197, 85%, 45%)"
                strokeWidth={2.5}
                dot={false}
                name="Most likely outcome"
              />
              {result.breakEvenYear && (
                <ReferenceLine
                  x={result.breakEvenYear}
                  stroke="hsl(var(--chart-4))"
                  strokeDasharray="5 5"
                  strokeWidth={1.5}
                  label={{ value: `Yr ${result.breakEvenYear}`, position: "top", style: { fontSize: 11, fill: "hsl(140, 80%, 40%)" } }}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </TabsContent>

      <TabsContent value="scurve">
        <p className="text-xs text-muted-foreground mb-3">
          This shows the chance that buying has paid off by each year. When the line crosses 50%, buying is more likely than not to have been worth it.
        </p>
        <div className="h-[350px] sm:h-[420px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={scurveData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="scurveGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(197, 85%, 45%)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(197, 85%, 45%)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
              <XAxis dataKey="year" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickLine={false} label={{ value: "Year", position: "insideBottom", offset: -2, style: { fontSize: 11, fill: "hsl(var(--muted-foreground))" } }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickLine={false} label={{ value: "Chance (%)", angle: -90, position: "insideLeft", style: { fontSize: 11, fill: "hsl(var(--muted-foreground))" } }} />
              <Tooltip formatter={(value: number) => [`${value.toFixed(1)}%`, "Chance of breakeven"]} labelFormatter={(l) => `Year ${l}`} contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "12px" }} />
              <ReferenceLine y={50} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeWidth={1} label={{ value: "50%", position: "right", style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" } }} />
              <Area type="monotone" dataKey="probability" stroke="hsl(197, 85%, 45%)" strokeWidth={2.5} fill="url(#scurveGrad)" name="Chance of breakeven" />
              {result.breakEvenYear && (
                <ReferenceLine
                  x={result.breakEvenYear}
                  stroke="hsl(var(--chart-4))"
                  strokeDasharray="5 5"
                  strokeWidth={1.5}
                  label={{ value: `Typical: Yr ${result.breakEvenYear}`, position: "top", style: { fontSize: 11, fill: "hsl(140, 80%, 40%)" } }}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </TabsContent>

      <TabsContent value="kde">
        <p className="text-xs text-muted-foreground mb-3">
          After 30 years, how much better off are you buying vs renting? This shows the spread of all possible outcomes. Blue means buying won, orange means renting won.
        </p>
        <div className="h-[350px] sm:h-[420px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={kdeData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
              <XAxis dataKey="x" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" tickLine={false} interval={Math.max(1, Math.floor(kdeData.length / 8))} />
              <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickLine={false} label={{ value: "Likelihood", angle: -90, position: "insideLeft", style: { fontSize: 11, fill: "hsl(var(--muted-foreground))" } }} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="bg-popover border border-popover-border rounded-md p-3 shadow-lg">
                      <p className="text-xs font-semibold mb-1">Net difference: {d.x}</p>
                      <p className="text-xs text-muted-foreground">{d.isPositive ? "Buying wins" : "Renting wins"}</p>
                    </div>
                  );
                }}
              />
              <Bar dataKey="density" radius={[2, 2, 0, 0]}>
                {kdeData.map((entry, i) => (
                  <Cell key={i} fill={entry.isPositive ? "hsl(197, 85%, 45%)" : "hsl(25, 90%, 50%)"} fillOpacity={0.8} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center justify-center gap-6 mt-3">
          <div className="flex items-center gap-2 text-xs">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "hsl(197, 85%, 45%)" }} />
            <span className="text-muted-foreground">Buying wins ({result.buyWinsProbability.toFixed(1)}%)</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "hsl(25, 90%, 50%)" }} />
            <span className="text-muted-foreground">Renting wins ({(100 - result.buyWinsProbability).toFixed(1)}%)</span>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="tornado">
        <p className="text-xs text-muted-foreground mb-3">
          Which assumptions matter most? Each bar shows how much the result changes when we adjust one factor. Longer bars mean that factor has a bigger impact on your decision.
        </p>
        <div className="h-[350px] sm:h-[420px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={tornadoData} layout="vertical" margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
              <XAxis type="number" tickFormatter={fmt} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickLine={false} />
              <YAxis type="category" dataKey="variable" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickLine={false} width={110} />
              <Tooltip
                formatter={(value: number, name: string) => [fmt(value), name === "lowDelta" ? "Lower estimate" : "Higher estimate"]}
                contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "12px" }}
              />
              <ReferenceLine x={0} stroke="hsl(var(--muted-foreground))" strokeWidth={1} />
              <Bar dataKey="lowDelta" fill="hsl(25, 90%, 50%)" fillOpacity={0.7} name="Lower estimate" radius={[2, 2, 2, 2]} />
              <Bar dataKey="highDelta" fill="hsl(197, 85%, 45%)" fillOpacity={0.7} name="Higher estimate" radius={[2, 2, 2, 2]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </TabsContent>
    </Tabs>
  );
}
