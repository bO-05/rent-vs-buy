import { useState, useCallback, useEffect, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LocationSearch } from "@/components/LocationSearch";
import { ParameterForm } from "@/components/ParameterForm";
import { ResultsChart } from "@/components/ResultsChart";
import { ResultsSummary } from "@/components/ResultsSummary";
import { AdvisorChat } from "@/components/AdvisorChat";
import { InfoTip } from "@/components/InfoTip";
import { getDefaultSimulationParams, formatCurrency } from "@/lib/locationData";
import { runMonteCarloSimulation, encodeParams, decodeParams, exportCSV, exportJSON } from "@/lib/simulation";
import type { LocationData, LocationResearchResult, SimulationInput, SimulationResult } from "@shared/schema";
import {
  Calculator as CalcIcon,
  ChevronDown,
  ChevronUp,
  Loader2,
  MapPin,
  RotateCcw,
  Sparkles,
  Info,
  Share2,
  Lock,
  Unlock,
  AlertTriangle,
  FileJson,
  FileSpreadsheet,
  Check,
  MessageSquareText,
  Mic,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PropertySearch } from "@/components/PropertySearch";

function createDefaultParams(): SimulationInput {
  return {
    locationId: "",
    homePrice: 0,
    monthlyRent: 0,
    ...getDefaultSimulationParams(),
  };
}

function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function CalculatorPage() {
  const { toast } = useToast();
  const [location, setLocation] = useState<LocationData | null>(null);
  const [showLocationSearch, setShowLocationSearch] = useState(true);
  const [params, setParams] = useState<SimulationInput>(createDefaultParams());
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [seedLocked, setSeedLocked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showTechDetails, setShowTechDetails] = useState(false);
  const [showAdvisor, setShowAdvisor] = useState(false);
  const [researchMeta, setResearchMeta] = useState<{ confidence: number; sourceCount: number; totalCitations: number } | null>(null);

  const currency = location?.currency || "USD";
  const currencySymbol = location?.currencySymbol || "$";
  const fmt = (val: number) => formatCurrency(val, currency, currencySymbol);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const encoded = urlParams.get("s");
    const locationEncoded = urlParams.get("l");
    if (encoded) {
      const decoded = decodeParams(encoded);
      if (decoded) {
        setParams(decoded);
        let hasValidLocation = false;
        if (locationEncoded) {
          try {
            const loc = JSON.parse(decodeURIComponent(atob(locationEncoded)));
            if (loc && loc.name && loc.currency && loc.medianHomePrice) {
              setLocation(loc);
              hasValidLocation = true;
            }
          } catch { }
        }
        if (hasValidLocation) {
          setShowLocationSearch(false);
        }
        setSeedLocked(decoded.seed !== null);
        setTimeout(() => {
          setIsRunning(true);
          setTimeout(() => {
            const res = runMonteCarloSimulation(decoded);
            setResult(res);
            setIsRunning(false);
          }, 50);
        }, 100);
      }
    }
  }, []);

  const warnings = useMemo(() => {
    const w: string[] = [];
    if (location?.warnings) {
      w.push(...location.warnings);
    }
    if (params.homePrice > 0 && params.downPaymentPercent < 20) {
      w.push("A down payment below 20% may lead to higher mortgage rates and extra financing costs.");
    }
    if (params.mortgageTermYears < 5) {
      w.push("If you plan to sell within 5 years, upfront buying costs make buying very unlikely to pay off.");
    }
    return w;
  }, [params, location]);

  const handleLocationResearched = useCallback((researchResult: LocationResearchResult) => {
    const loc = researchResult.location;
    setLocation(loc);

    const recommended = researchResult.recommendedParams;
    const defaults = getDefaultSimulationParams();
    const meta = (researchResult as any).meta;

    // Auto-apply financial params extracted from natural language
    const mortgageYears = meta?.mortgageTermYears;
    const downPct = meta?.downPaymentPercent;
    const userHomePrice = meta?.homePrice;
    const userMonthlyRent = meta?.monthlyRent;
    // simulationYears maps to mortgageTermYears only if no explicit mortgage term was given
    const simYears = meta?.simulationYears;
    const effectiveMortgageTerm = mortgageYears && mortgageYears >= 1 && mortgageYears <= 40
      ? mortgageYears
      : simYears && simYears >= 1 && simYears <= 40 && !mortgageYears
        ? simYears  // fallback: use simulation years as mortgage term if no mortgage term specified
        : undefined;

    console.log('[Calculator] Meta from router:', { mortgageYears, downPct, simYears, effectiveMortgageTerm, userHomePrice, userMonthlyRent, meta });

    // User-specified price/rent override AI-researched market values
    const effectiveHomePrice = userHomePrice && userHomePrice > 1000 ? userHomePrice : loc.medianHomePrice;
    const effectiveRent = userMonthlyRent && userMonthlyRent > 10 ? userMonthlyRent : loc.averageMonthlyRent;

    setParams({
      locationId: loc.id,
      homePrice: loc.medianHomePrice,
      monthlyRent: loc.averageMonthlyRent,
      ...defaults,
      ...recommended,
      // User-specified overrides from natural language (applied last = highest priority)
      ...(effectiveHomePrice !== loc.medianHomePrice ? { homePrice: effectiveHomePrice } : {}),
      ...(effectiveRent !== loc.averageMonthlyRent ? { monthlyRent: effectiveRent } : {}),
      ...(effectiveMortgageTerm ? { mortgageTermYears: effectiveMortgageTerm } : {}),
      ...(downPct && downPct >= 1 && downPct <= 100 ? { downPaymentPercent: downPct } : {}),
      numSimulations: defaults.numSimulations,
      seed: null,
      rentCeilingGrowth: null,
    });
    setShowLocationSearch(false);
    setResult(null);
    // Capture meta if present (confidence, source count, etc.)
    if (meta) {
      setResearchMeta(meta);
    }
  }, []);

  const handleRunSimulation = useCallback(() => {
    if (!location) return;
    setIsRunning(true);
    const simParams = seedLocked
      ? { ...params, seed: params.seed ?? 42 }
      : { ...params, seed: null };
    setParams(simParams);

    setTimeout(() => {
      const res = runMonteCarloSimulation(simParams);
      setResult(res);
      setIsRunning(false);
      setShowAdvisor(true);
    }, 50);
  }, [params, location, seedLocked]);

  const handleReset = useCallback(() => {
    setLocation(null);
    setShowLocationSearch(true);
    setResult(null);
    setShowAdvisor(false);
    setParams(createDefaultParams());
    setSeedLocked(false);
    setShowTechDetails(false);
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const handleShare = useCallback(() => {
    const shareParams = seedLocked ? { ...params, seed: params.seed ?? 42 } : params;
    const encoded = encodeParams(shareParams);
    let url = `${window.location.origin}${window.location.pathname}?s=${encoded}`;
    if (location) {
      const locationEncoded = btoa(encodeURIComponent(JSON.stringify(location)));
      url += `&l=${locationEncoded}`;
    }
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      toast({ title: "Link copied", description: "Anyone with this link will see the same results." });
      setTimeout(() => setCopied(false), 2000);
    });
  }, [params, seedLocked, location, toast]);

  useEffect(() => {
    if (location && !result) {
      handleRunSimulation();
    }
  }, [location]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-md bg-primary flex items-center justify-center flex-shrink-0">
              <CalcIcon className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold leading-tight">Rent vs Buy</h1>
              <p className="text-xs text-muted-foreground hidden sm:block">
                AI-powered financial scenario calculator
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {result && (
              <>
                <div className="hidden sm:flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSeedLocked(!seedLocked)}
                    data-testid="button-toggle-seed"
                  >
                    {seedLocked ? <Lock className="h-3.5 w-3.5 mr-1.5" /> : <Unlock className="h-3.5 w-3.5 mr-1.5" />}
                    {seedLocked ? "Locked" : "Fresh"}
                  </Button>
                  <InfoTip text={seedLocked ? "Results stay the same each time you run. Useful for comparing changes to a single assumption." : "Each run uses fresh randomness, so results will vary slightly."} />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleShare}
                  data-testid="button-share"
                >
                  {copied ? <Check className="h-3.5 w-3.5 mr-1.5" /> : <Share2 className="h-3.5 w-3.5 mr-1.5" />}
                  {copied ? "Copied" : "Share"}
                </Button>
              </>
            )}
            {location && (
              <Button variant="outline" size="sm" onClick={handleReset} data-testid="button-reset">
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                Reset
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {!location && (
          <div className="mb-8 text-center">
            <div className="inline-flex items-center gap-2 mb-3">
              <Sparkles className="h-5 w-5 text-primary" />
              <Badge variant="secondary" data-testid="badge-ai-powered">AI-powered research</Badge>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold mb-3" data-testid="text-hero-title">
              Should you rent or buy?
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-sm sm:text-base mb-4">
              Type any location worldwide. Our AI will research local property prices, rental rates, taxes, and market conditions — then simulate thousands of possible futures to help you decide.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground">
              <span>Any location worldwide</span>
              <span className="text-border">|</span>
              <span>Real market data</span>
              <span className="text-border">|</span>
              <span>Local taxes & costs</span>
              <span className="text-border">|</span>
              <span>Thousands of scenarios</span>
            </div>
          </div>
        )}

        {showLocationSearch && !location && (
          <div className="mb-8 max-w-2xl mx-auto">
            <LocationSearch onLocationResearched={handleLocationResearched} />
          </div>
        )}

        {location && (
          <div className="space-y-6">
            <div
              className="flex items-center justify-between gap-3 cursor-pointer p-2 -mx-2 rounded-md hover-elevate"
              onClick={() => setShowLocationSearch(!showLocationSearch)}
              data-testid="button-toggle-location"
            >
              <div className="flex items-center gap-3">
                <MapPin className="h-4 w-4 text-primary" />
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold">{location.name}</p>
                    <Badge variant="secondary" className="text-xs">{location.country}</Badge>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap">
                    <span>{fmt(params.homePrice)} home</span>
                    <span className="text-border">|</span>
                    <span>{fmt(params.monthlyRent)}/mo rent</span>
                    <span className="text-border">|</span>
                    <span>Price is {location.priceToRentRatio.toFixed(0)}x annual rent</span>
                    <InfoTip text={`The home costs about ${location.priceToRentRatio.toFixed(0)} times the yearly rent. Below 15x generally favors buying, above 20x generally favors renting.`} />
                  </div>
                  {location.dataSource && (
                    <p className="text-xs text-muted-foreground/60 mt-0.5">
                      {location.dataSource}
                    </p>
                  )}
                  {researchMeta && (
                    <div className="flex items-center gap-3 mt-1.5">
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className={`font-semibold ${researchMeta.confidence >= 70 ? 'text-emerald-600' : researchMeta.confidence >= 40 ? 'text-amber-600' : 'text-red-500'}`}>
                          {researchMeta.confidence}% confidence
                        </span>
                      </div>
                      <div className="flex-1 max-w-[120px] h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${researchMeta.confidence >= 70 ? 'bg-emerald-500' : researchMeta.confidence >= 40 ? 'bg-amber-500' : 'bg-red-500'}`}
                          style={{ width: `${researchMeta.confidence}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {researchMeta.sourceCount} providers · {researchMeta.totalCitations} sources
                      </span>
                    </div>
                  )}
                </div>
              </div>
              {showLocationSearch ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>

            {showLocationSearch && (
              <div className="max-w-2xl">
                <LocationSearch onLocationResearched={handleLocationResearched} />
              </div>
            )}

            {warnings.length > 0 && (
              <div className="space-y-2">
                {warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 p-3 rounded-md bg-chart-2/10 border border-chart-2/20">
                    <AlertTriangle className="h-4 w-4 text-chart-2 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-chart-2">{w}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-1 space-y-4">
                <Card className="p-4 sm:p-5">
                  <div className="flex items-center justify-between gap-2 mb-4">
                    <h3 className="text-sm font-semibold">Assumptions</h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAdvanced(!showAdvanced)}
                      data-testid="button-toggle-advanced"
                    >
                      {showAdvanced ? "Simple" : "Advanced"}
                    </Button>
                  </div>

                  {showAdvanced ? (
                    <ParameterForm
                      params={params}
                      onParamsChange={(p) => {
                        setParams(p);
                        setResult(null);
                      }}
                      currencySymbol={currencySymbol}
                    />
                  ) : (
                    <div className="space-y-4">
                      <div className="p-3 rounded-md bg-muted/50 text-xs text-muted-foreground space-y-2">
                        <div className="flex items-start gap-2">
                          <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="font-medium text-foreground mb-1">AI-researched values for {location.name}</p>
                            <ul className="space-y-0.5">
                              <li>{params.downPaymentPercent}% down payment</li>
                              <li>{params.mortgageRate}% mortgage rate, {params.mortgageTermYears}-year term</li>
                              <li>Buying costs: ~{(params.purchaseTaxRate + params.legalFeesPercent).toFixed(1)}% of home price</li>
                              <li>Selling costs: ~{(params.sellingTaxRate + params.agencyFeePercent).toFixed(1)}% when you sell</li>
                              <li>Home values grow ~{params.homeAppreciationMu}%/year on average</li>
                              <li>Investment returns ~{params.investmentReturnMu}%/year on average</li>
                            </ul>
                          </div>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        These values were set by AI based on {location.country} market conditions. Switch to <strong>Advanced</strong> to adjust anything.
                      </p>
                    </div>
                  )}

                  <Button
                    className="w-full mt-4"
                    onClick={handleRunSimulation}
                    disabled={isRunning}
                    data-testid="button-run-simulation"
                  >
                    {isRunning ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Calculating...
                      </>
                    ) : (
                      <>
                        <CalcIcon className="h-4 w-4 mr-2" />
                        Run Simulation
                      </>
                    )}
                  </Button>
                </Card>
              </div>

              <div className="lg:col-span-2 space-y-6">
                {isRunning && (
                  <div className="flex items-center justify-center py-20">
                    <div className="text-center">
                      <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
                      <p className="text-sm font-medium">
                        Running {params.numSimulations.toLocaleString()} scenarios...
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Crunching the numbers for thousands of possible futures
                      </p>
                    </div>
                  </div>
                )}

                {result && !isRunning && (
                  <>
                    {/* Interactive What-If Slider */}
                    <Card className="p-4 sm:p-5 animate-in">
                      <div className="flex items-center gap-2 mb-3">
                        <Sparkles className="h-4 w-4 text-primary" />
                        <h3 className="text-sm font-semibold">What If?</h3>
                        <span className="text-xs text-muted-foreground ml-auto">
                          Drag or type to explore scenarios
                        </span>
                      </div>
                      <div className="space-y-3">
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-xs text-muted-foreground">Mortgage Rate</label>
                            <div className="flex items-center">
                              <input
                                type="number"
                                min={2}
                                max={12}
                                step={0.1}
                                defaultValue={params.mortgageRate.toFixed(1)}
                                key={`rate-${params.mortgageRate}`}
                                onBlur={(e) => {
                                  const val = Math.min(12, Math.max(2, parseFloat(e.target.value) || params.mortgageRate));
                                  const newParams = { ...params, mortgageRate: val };
                                  setParams(newParams);
                                  const simParams = seedLocked ? { ...newParams, seed: newParams.seed ?? 42 } : { ...newParams, seed: null };
                                  setResult(runMonteCarloSimulation(simParams));
                                }}
                                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                className="w-12 text-right text-xs font-mono font-medium bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none transition-colors"
                                data-testid="input-mortgage-rate"
                              />
                              <span className="text-xs font-mono font-medium">%</span>
                            </div>
                          </div>
                          <input
                            type="range"
                            min="2"
                            max="12"
                            step="0.1"
                            value={params.mortgageRate}
                            onChange={(e) => {
                              const newRate = parseFloat(e.target.value);
                              const newParams = { ...params, mortgageRate: newRate };
                              setParams(newParams);
                              const simParams = seedLocked ? { ...newParams, seed: newParams.seed ?? 42 } : { ...newParams, seed: null };
                              const res = runMonteCarloSimulation(simParams);
                              setResult(res);
                            }}
                            className="w-full h-1.5 appearance-none bg-muted rounded-full cursor-pointer accent-primary"
                            data-testid="slider-mortgage-rate"
                          />
                          <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                            <span>2%</span>
                            <span>12%</span>
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-xs text-muted-foreground">Down Payment</label>
                            <div className="flex items-center">
                              <input
                                type="number"
                                min={0}
                                max={50}
                                step={5}
                                defaultValue={params.downPaymentPercent}
                                key={`dp-${params.downPaymentPercent}`}
                                onBlur={(e) => {
                                  const val = Math.min(50, Math.max(0, parseInt(e.target.value) || params.downPaymentPercent));
                                  const newParams = { ...params, downPaymentPercent: val };
                                  setParams(newParams);
                                  const simParams = seedLocked ? { ...newParams, seed: newParams.seed ?? 42 } : { ...newParams, seed: null };
                                  setResult(runMonteCarloSimulation(simParams));
                                }}
                                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                className="w-10 text-right text-xs font-mono font-medium bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none transition-colors"
                                data-testid="input-down-payment"
                              />
                              <span className="text-xs font-mono font-medium">%</span>
                            </div>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="50"
                            step="5"
                            value={params.downPaymentPercent}
                            onChange={(e) => {
                              const newDown = parseInt(e.target.value);
                              const newParams = { ...params, downPaymentPercent: newDown };
                              setParams(newParams);
                              const simParams = seedLocked ? { ...newParams, seed: newParams.seed ?? 42 } : { ...newParams, seed: null };
                              const res = runMonteCarloSimulation(simParams);
                              setResult(res);
                            }}
                            className="w-full h-1.5 appearance-none bg-muted rounded-full cursor-pointer accent-primary"
                            data-testid="slider-down-payment"
                          />
                          <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                            <span>0%</span>
                            <span>50%</span>
                          </div>
                        </div>
                      </div>
                    </Card>

                    <Card className="p-4 sm:p-5">
                      <div className="flex items-center justify-between gap-2 mb-4">
                        <h3 className="text-sm font-semibold">Financial Projection</h3>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => downloadFile(exportCSV(result), `rvb-${location.id}.csv`, "text/csv")}
                            data-testid="button-export-csv"
                          >
                            <FileSpreadsheet className="h-3.5 w-3.5 mr-1" />
                            <span className="text-xs">CSV</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => downloadFile(exportJSON(result, params), `rvb-${location.id}.json`, "application/json")}
                            data-testid="button-export-json"
                          >
                            <FileJson className="h-3.5 w-3.5 mr-1" />
                            <span className="text-xs">JSON</span>
                          </Button>
                        </div>
                      </div>
                      <ResultsChart result={result} currency={currency} currencySymbol={currencySymbol} />
                    </Card>

                    <ResultsSummary result={result} currency={currency} currencySymbol={currencySymbol} />

                    {/* Property Search — context-aware based on simulation verdict */}
                    {location && (
                      <PropertySearch
                        location={location.name || location.id}
                        country={location.country || ""}
                        currency={currency}
                        currencySymbol={currencySymbol}
                        recommendation={result.buyWinsProbability > 50 ? "buy" : "rent"}
                        homePrice={params.homePrice}
                        monthlyRent={params.monthlyRent}
                        isNonResident={params.isNonResident}
                      />
                    )}

                    {/* AI Advisor — Streaming + Follow-Up Chat */}
                    {showAdvisor && location && (
                      <AdvisorChat
                        location={location}
                        simulationResult={result}
                        params={params}
                        currencySymbol={currencySymbol}
                      />
                    )}

                    <Card className="p-4">
                      <div className="flex items-start gap-2">
                        <Info className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                        <div className="text-xs text-muted-foreground space-y-2 w-full">
                          <p className="font-medium text-foreground">How it works</p>
                          <p>
                            We used AI to research real estate conditions in {location.name}, {location.country},
                            including local property prices, rental rates, taxes, and transaction costs.
                            Then we ran {params.numSimulations.toLocaleString()} simulated futures, each projecting
                            home prices, rents, and investment returns month-by-month over 30 years.
                            All values are shown in today's money (adjusted for inflation).
                            {seedLocked ? " Results are locked so you get the same outcome each run." : " Each run uses fresh randomness for a slightly different spread."}
                          </p>
                          <p>
                            Market data is sourced from real-time web research and may not reflect exact current conditions. For informational purposes only — not financial advice.
                          </p>
                          {location.citations && location.citations.length > 0 && (
                            <div className="mt-2">
                              <p className="font-medium text-foreground mb-1">Data sources</p>
                              <ul className="space-y-0.5">
                                {location.citations.slice(0, 8).map((url, i) => {
                                  let display = url;
                                  try { display = new URL(url).hostname.replace("www.", ""); } catch { }
                                  return (
                                    <li key={i}>
                                      <a
                                        href={url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-primary hover:underline"
                                        data-testid={`link-citation-${i}`}
                                      >
                                        {display}
                                      </a>
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          )}
                          <button
                            className="text-primary hover:underline font-medium cursor-pointer"
                            onClick={() => setShowTechDetails(!showTechDetails)}
                            data-testid="button-toggle-tech-details"
                          >
                            {showTechDetails ? "Hide technical details" : "Show technical details"}
                          </button>
                          {showTechDetails && (
                            <div className="mt-2 p-3 rounded-md bg-muted/50 space-y-1">
                              <p className="font-medium text-foreground">Technical details</p>
                              <p>
                                Monte Carlo simulation using Geometric Brownian Motion (GBM) with Cholesky-decomposed
                                correlated shocks across home prices, rent growth, and investment returns.
                                Each of {params.numSimulations.toLocaleString()} paths evolves over 360 monthly time steps.
                                Local transaction costs are modeled explicitly based on AI research.
                                Breakeven detection requires 2+ consecutive years of positive wealth differential.
                                All terminal values are real (inflation-adjusted). Expected NPV is discounted at 4%.
                                Correlation matrix is validated for positive semi-definiteness and auto-scaled if needed.
                              </p>
                              <p className="mt-1">
                                Powered by Mistral AI (data structuring, parameter extraction, and web search), Perplexity Sonar (real-time web research), and Exa (property data).
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </Card>
                  </>
                )}

                {!result && !isRunning && (
                  <div className="flex items-center justify-center py-20 text-center">
                    <div>
                      <CalcIcon className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">
                        Click "Run Simulation" to see the results
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div >
          </div >
        )
        }
      </main >

      <footer className="border-t mt-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 text-center">
          <p className="text-xs text-muted-foreground">
            Powered by Mistral AI — Large 3 (research) · Small (structuring) · Voxtral (voice) · Perplexity Sonar · Exa
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            For informational purposes only. Not financial advice.
          </p>
        </div>
      </footer>
    </div >
  );
}
