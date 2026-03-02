import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InfoTip } from "@/components/InfoTip";
import { formatCurrency } from "@/lib/locationData";
import type { SimulationResult } from "@shared/schema";
import {
  TrendingUp,
  TrendingDown,
  Target,
  BarChart3,
  Home,
  Building,
  Clock,
  Zap,
} from "lucide-react";

interface ResultsSummaryProps {
  result: SimulationResult;
  currency?: string;
  currencySymbol?: string;
}

export function ResultsSummary({ result, currency = "USD", currencySymbol = "$" }: ResultsSummaryProps) {
  const buyWins = result.buyWinsProbability > 50;
  const fmt = (val: number) => formatCurrency(val, currency, currencySymbol);

  return (
    <div className="space-y-4">
      <div className={`text-center p-6 rounded-lg border ${buyWins ? "bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border-primary/20" : "bg-gradient-to-br from-chart-2/10 via-chart-2/5 to-transparent border-chart-2/20"}`}>
        <div className="flex items-center justify-center gap-2 mb-2">
          {buyWins ? (
            <Home className="h-5 w-5 text-primary" />
          ) : (
            <Building className="h-5 w-5 text-chart-2" />
          )}
          <h3 className="text-lg font-bold">
            {buyWins ? "Buying is likely better" : "Renting is likely better"}
          </h3>
        </div>
        <p className="text-sm text-muted-foreground">
          In {result.buyWinsProbability.toFixed(0)}% of {result.terminalDistribution.length.toLocaleString()} simulated futures,
          buying ends up being the better deal after 30 years
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <Target className="h-4 w-4 text-chart-4" />
            <span className="text-xs font-medium text-muted-foreground">Breakeven year</span>
            <InfoTip text="The year when buying typically starts to be worth more than renting. This is the middle estimate — half of scenarios break even faster, half take longer." />
          </div>
          <p className="text-xl font-bold" data-testid="text-breakeven-year">
            {result.breakEvenYear ? `Year ${result.breakEvenYear}` : "Never"}
          </p>
          {result.breakEvenOptimistic && result.breakEvenPessimistic && (
            <p className="text-xs text-muted-foreground mt-1">
              Best case Yr {result.breakEvenOptimistic}, worst case Yr {result.breakEvenPessimistic}
            </p>
          )}
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <BarChart3 className="h-4 w-4 text-primary" />
            <span className="text-xs font-medium text-muted-foreground">Chance buying wins</span>
          </div>
          <p className="text-xl font-bold" data-testid="text-buy-probability">
            {result.buyWinsProbability.toFixed(1)}%
          </p>
          <Badge variant={buyWins ? "default" : "secondary"} className="mt-1 text-xs">
            {buyWins ? "Favorable" : "Unfavorable"}
          </Badge>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <Zap className="h-4 w-4 text-chart-2" />
            <span className="text-xs font-medium text-muted-foreground">Wins within 10 years</span>
          </div>
          <p className="text-xl font-bold" data-testid="text-buy-10yr">
            {result.buyWins10yr.toFixed(1)}%
          </p>
          <p className="text-xs text-muted-foreground mt-1">of scenarios</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp className="h-4 w-4 text-chart-1" />
            <span className="text-xs font-medium text-muted-foreground">Buyer's wealth (30yr)</span>
          </div>
          <p className="text-lg font-bold" data-testid="text-buy-networth">
            {fmt(result.finalBuyMedian)}
          </p>
          <div className="flex items-center gap-1 mt-1">
            <p className="text-xs text-muted-foreground">typical, today's money</p>
            <InfoTip text="This is the middle estimate of a buyer's total wealth after 30 years, adjusted for inflation so you can compare it to today's prices." />
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingDown className="h-4 w-4 text-chart-2" />
            <span className="text-xs font-medium text-muted-foreground">Renter's wealth (30yr)</span>
          </div>
          <p className="text-lg font-bold" data-testid="text-rent-networth">
            {fmt(result.finalRentMedian)}
          </p>
          <div className="flex items-center gap-1 mt-1">
            <p className="text-xs text-muted-foreground">typical, today's money</p>
            <InfoTip text="This is the middle estimate of a renter's investment portfolio after 30 years, adjusted for inflation." />
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <Clock className="h-4 w-4 text-chart-3" />
            <span className="text-xs font-medium text-muted-foreground">Net advantage</span>
            <InfoTip text="This takes the average gain from buying over renting and converts it to what that money would be worth today. Think of it as: if you could collect all the future savings right now, this is what they'd be worth." />
          </div>
          <p className={`text-lg font-bold ${result.expectedNpvDifferential > 0 ? "text-chart-4" : "text-destructive"}`} data-testid="text-npv">
            {result.expectedNpvDifferential > 0 ? "+" : ""}
            {fmt(result.expectedNpvDifferential)}
          </p>
          <p className="text-xs text-muted-foreground">in today's money</p>
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex items-center gap-2 mb-1">
          {result.finalDifferenceMedian > 0 ? (
            <TrendingUp className="h-4 w-4 text-chart-4" />
          ) : (
            <TrendingDown className="h-4 w-4 text-destructive" />
          )}
          <span className="text-xs font-medium text-muted-foreground">
            How much better off after 30 years
          </span>
        </div>
        <p
          className={`text-xl font-bold ${result.finalDifferenceMedian > 0 ? "text-chart-4" : "text-destructive"}`}
          data-testid="text-net-advantage"
        >
          {result.finalDifferenceMedian > 0 ? "+" : ""}
          {fmt(result.finalDifferenceMedian)}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Adjusted for inflation, based on all simulated scenarios
        </p>
      </Card>
    </div>
  );
}
