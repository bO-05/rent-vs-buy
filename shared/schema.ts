import { z } from "zod";

export const locationDataSchema = z.object({
  id: z.string(),
  name: z.string(),
  country: z.string(),
  region: z.string(),
  currency: z.string(),
  currencySymbol: z.string(),
  medianHomePrice: z.number(),
  averageMonthlyRent: z.number(),
  priceToRentRatio: z.number(),
  description: z.string(),
  dataSource: z.string(),
  listingCount: z.number(),
  warnings: z.array(z.string()),
  citations: z.array(z.string()).optional(),
});

export type LocationData = z.infer<typeof locationDataSchema>;

export const simulationInputSchema = z.object({
  locationId: z.string(),
  homePrice: z.number().min(1),
  monthlyRent: z.number().min(1),
  downPaymentPercent: z.number().min(0).max(100),
  mortgageRate: z.number().min(0).max(30),
  mortgageTermYears: z.number().min(1).max(30),
  propertyTaxRate: z.number().min(0).max(10),
  maintenanceRate: z.number().min(0).max(10),
  insuranceRate: z.number().min(0).max(5),
  rentGrowthMu: z.number().min(-5).max(20),
  rentGrowthSigma: z.number().min(0.01).max(0.5),
  homeAppreciationMu: z.number().min(-10).max(20),
  homeAppreciationSigma: z.number().min(0.01).max(0.5),
  investmentReturnMu: z.number().min(-10).max(30),
  investmentReturnSigma: z.number().min(0.01).max(0.5),
  inflationRate: z.number().min(0).max(15),
  purchaseTaxRate: z.number().min(0).max(20),
  legalFeesPercent: z.number().min(0).max(10),
  agencyFeePercent: z.number().min(0).max(10),
  sellingTaxRate: z.number().min(0).max(20),
  isNonResident: z.boolean(),
  nonResidentExtraPercent: z.number().min(0).max(20),
  rentCeilingGrowth: z.number().min(0).max(20).nullable(),
  numSimulations: z.number().min(100).max(10000),
  seed: z.number().nullable(),
  correlationHomeRent: z.number().min(-1).max(1),
  correlationHomeInvestment: z.number().min(-1).max(1),
  correlationRentInvestment: z.number().min(-1).max(1),
});

export type SimulationInput = z.infer<typeof simulationInputSchema>;

export interface YearlyResult {
  year: number;
  buyNetWorth: number;
  rentNetWorth: number;
  difference: number;
}

export interface SimulationPath {
  yearly: YearlyResult[];
  breakEvenYear: number | null;
}

export interface SimulationResult {
  medianPath: YearlyResult[];
  percentile10: YearlyResult[];
  percentile25: YearlyResult[];
  percentile75: YearlyResult[];
  percentile90: YearlyResult[];
  samplePaths: YearlyResult[][];
  breakEvenYear: number | null;
  breakEvenOptimistic: number | null;
  breakEvenPessimistic: number | null;
  breakEvenProbability: number;
  buyWinsProbability: number;
  buyWins10yr: number;
  finalBuyMedian: number;
  finalRentMedian: number;
  finalDifferenceMedian: number;
  expectedNpvDifferential: number;
  breakEvenCurve: { year: number; probability: number }[];
  terminalDistribution: number[];
  allBreakEvens: number[];
  sensitivityData: { variable: string; low: number; high: number; baseMedian: number }[];
}

export interface LocationResearchResult {
  location: LocationData;
  recommendedParams: Partial<SimulationInput>;
}
