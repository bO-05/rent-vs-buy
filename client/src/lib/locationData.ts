import type { SimulationInput } from "@shared/schema";

export function formatCurrency(value: number, currency: string = "USD", symbol: string = "$"): string {
  if (Math.abs(value) >= 1e12) {
    return `${symbol}${(value / 1e12).toFixed(1)}T`;
  }
  if (Math.abs(value) >= 1e9) {
    return `${symbol}${(value / 1e9).toFixed(1)}B`;
  }
  if (Math.abs(value) >= 1e6) {
    return `${symbol}${(value / 1e6).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1e3) {
    return `${symbol}${(value / 1e3).toFixed(0)}K`;
  }
  return `${symbol}${Math.round(value).toLocaleString()}`;
}

export function formatCurrencyFull(value: number, currency: string = "USD", symbol: string = "$"): string {
  return `${symbol}${Math.round(value).toLocaleString()}`;
}

export function getPtrAssessment(ptr: number): { label: string; color: string } {
  if (ptr < 10) return { label: "Strongly favors buying", color: "text-chart-4" };
  if (ptr < 15) return { label: "Tends to favor buying", color: "text-chart-1" };
  if (ptr <= 20) return { label: "Could go either way", color: "text-muted-foreground" };
  return { label: "Tends to favor renting", color: "text-chart-2" };
}

export function getDefaultSimulationParams(): Omit<SimulationInput, "locationId" | "homePrice" | "monthlyRent"> {
  return {
    downPaymentPercent: 20,
    mortgageRate: 6.5,
    mortgageTermYears: 30,
    propertyTaxRate: 1.0,
    maintenanceRate: 1.0,
    insuranceRate: 0.5,
    rentGrowthMu: 3,
    rentGrowthSigma: 0.08,
    homeAppreciationMu: 4,
    homeAppreciationSigma: 0.12,
    investmentReturnMu: 8,
    investmentReturnSigma: 0.15,
    inflationRate: 3,
    purchaseTaxRate: 2,
    legalFeesPercent: 1,
    agencyFeePercent: 3,
    sellingTaxRate: 2,
    isNonResident: false,
    nonResidentExtraPercent: 0,
    rentCeilingGrowth: null,
    numSimulations: 2000,
    seed: null,
    correlationHomeRent: 0.5,
    correlationHomeInvestment: 0.3,
    correlationRentInvestment: 0.2,
  };
}
