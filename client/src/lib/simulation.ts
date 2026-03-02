import type { SimulationInput, SimulationResult, YearlyResult, SimulationPath } from "@shared/schema";

class SeededRandom {
  private s: number;
  constructor(seed: number) {
    this.s = seed;
  }
  next(): number {
    this.s = (this.s * 1664525 + 1013904223) & 0xffffffff;
    return (this.s >>> 0) / 0xffffffff;
  }
  gaussian(): number {
    let u = 0, v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }
}

function choleskyDecompose(matrix: number[][]): number[][] {
  const n = matrix.length;
  const L: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) {
        sum += L[i][k] * L[j][k];
      }
      if (i === j) {
        const val = matrix[i][i] - sum;
        L[i][j] = Math.sqrt(Math.max(val, 1e-10));
      } else {
        L[i][j] = (matrix[i][j] - sum) / L[j][j];
      }
    }
  }
  return L;
}

function correlatedShocks(L: number[][], rng: SeededRandom): number[] {
  const n = L.length;
  const z = Array.from({ length: n }, () => rng.gaussian());
  const eps: number[] = Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      eps[i] += L[i][j] * z[j];
    }
  }
  return eps;
}

function clampGBM(value: number, initial: number): number {
  return Math.max(initial * 0.1, Math.min(initial * 5.0, value));
}

function runSingleSimulation(input: SimulationInput, rng: SeededRandom): SimulationPath {
  const {
    homePrice, monthlyRent, downPaymentPercent, mortgageRate,
    mortgageTermYears, propertyTaxRate, maintenanceRate, insuranceRate,
    rentGrowthMu, rentGrowthSigma, homeAppreciationMu, homeAppreciationSigma,
    investmentReturnMu, investmentReturnSigma, inflationRate,
    purchaseTaxRate, legalFeesPercent, agencyFeePercent, sellingTaxRate,
    isNonResident, nonResidentExtraPercent, rentCeilingGrowth,
    correlationHomeRent, correlationHomeInvestment, correlationRentInvestment,
  } = input;

  let rHR = correlationHomeRent;
  let rHI = correlationHomeInvestment;
  let rRI = correlationRentInvestment;
  const det = 1 + 2 * rHR * rHI * rRI - rHR * rHR - rHI * rHI - rRI * rRI;
  if (det <= 0) {
    const scale = 0.95;
    rHR *= scale; rHI *= scale; rRI *= scale;
  }
  const corrMatrix = [
    [1.0, rHR, rHI],
    [rHR, 1.0, rRI],
    [rHI, rRI, 1.0],
  ];
  const L = choleskyDecompose(corrMatrix);

  const downPayment = homePrice * (downPaymentPercent / 100);
  const loanAmount = homePrice - downPayment;
  const purchaseCosts = homePrice * (purchaseTaxRate / 100)
    + homePrice * (legalFeesPercent / 100)
    + homePrice * (agencyFeePercent / 100)
    + (isNonResident ? homePrice * (nonResidentExtraPercent / 100) : 0);

  const monthlyMortgageRate = mortgageRate / 100 / 12;
  const totalPayments = mortgageTermYears * 12;
  const monthlyMortgagePayment = monthlyMortgageRate > 0
    ? (loanAmount * monthlyMortgageRate * Math.pow(1 + monthlyMortgageRate, totalPayments))
      / (Math.pow(1 + monthlyMortgageRate, totalPayments) - 1)
    : loanAmount / totalPayments;

  const dt = 1 / 12;
  const sqrtDt = Math.sqrt(dt);

  const muHome = (homeAppreciationMu / 100);
  const sigHome = homeAppreciationSigma;
  const muRent = (rentGrowthMu / 100);
  const sigRent = rentGrowthSigma;
  const muInvest = (investmentReturnMu / 100);
  const sigInvest = investmentReturnSigma;
  const monthlyInflation = Math.pow(1 + inflationRate / 100, 1 / 12) - 1;

  let currentHomeValue = homePrice;
  let remainingLoan = loanAmount;
  let currentMonthlyRent = monthlyRent;
  let rentPortfolio = downPayment + purchaseCosts;
  let cumulativeInflation = 1;

  const yearly: YearlyResult[] = [];

  for (let year = 1; year <= 30; year++) {
    let yearBuyCost = 0;
    let yearRentCost = 0;

    for (let m = 0; m < 12; m++) {
      const month = (year - 1) * 12 + m;
      const eps = correlatedShocks(L, rng);

      const homeShock = (muHome - sigHome * sigHome / 2) * dt + sigHome * sqrtDt * eps[0];
      currentHomeValue = clampGBM(currentHomeValue * Math.exp(homeShock), homePrice);

      const rentShock = (muRent - sigRent * sigRent / 2) * dt + sigRent * sqrtDt * eps[1];
      let newRent = currentMonthlyRent * Math.exp(rentShock);
      if (rentCeilingGrowth !== null) {
        const maxRent = monthlyRent * Math.pow(1 + rentCeilingGrowth / 100, (month + 1) / 12);
        newRent = Math.min(newRent, maxRent);
      }
      currentMonthlyRent = Math.max(newRent, monthlyRent * 0.1);

      let monthBuyCost = 0;
      if (remainingLoan > 0 && month < totalPayments) {
        const interestPayment = remainingLoan * monthlyMortgageRate;
        const principalPayment = monthlyMortgagePayment - interestPayment;
        remainingLoan = Math.max(0, remainingLoan - principalPayment);
        monthBuyCost += monthlyMortgagePayment;
      }
      monthBuyCost += (currentHomeValue * propertyTaxRate / 100) / 12;
      monthBuyCost += (currentHomeValue * maintenanceRate / 100) / 12;
      monthBuyCost += (currentHomeValue * insuranceRate / 100) / 12;

      yearBuyCost += monthBuyCost;
      yearRentCost += currentMonthlyRent;

      const savings = monthBuyCost - currentMonthlyRent;
      rentPortfolio += savings;
      rentPortfolio = Math.max(0, rentPortfolio);

      const investShock = (muInvest - sigInvest * sigInvest / 2) * dt + sigInvest * sqrtDt * eps[2];
      rentPortfolio *= Math.exp(investShock);
      rentPortfolio = Math.max(0, Math.min(rentPortfolio, (downPayment + purchaseCosts) * 50));

      cumulativeInflation *= (1 + monthlyInflation);
    }

    const sellingCosts = currentHomeValue * (sellingTaxRate / 100) + currentHomeValue * (agencyFeePercent / 100);
    const buyNetWorth = (currentHomeValue - remainingLoan - sellingCosts) / cumulativeInflation;
    const rentNetWorth = rentPortfolio / cumulativeInflation;

    yearly.push({
      year,
      buyNetWorth,
      rentNetWorth,
      difference: buyNetWorth - rentNetWorth,
    });
  }

  let breakEvenYear: number | null = null;
  for (let y = 0; y < 29; y++) {
    if (yearly[y].difference > 0 && yearly[y + 1]?.difference > 0) {
      breakEvenYear = yearly[y].year;
      break;
    }
  }
  if (!breakEvenYear && yearly[29]?.difference > 0) {
    breakEvenYear = 30;
  }

  return { yearly, breakEvenYear };
}

function getPercentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function runSensitivity(baseInput: SimulationInput): SimulationResult["sensitivityData"] {
  const variables: { key: keyof SimulationInput; label: string; lowMult: number; highMult: number }[] = [
    { key: "downPaymentPercent", label: "Down Payment %", lowMult: 0.5, highMult: 1.5 },
    { key: "mortgageRate", label: "Mortgage Rate", lowMult: 0.7, highMult: 1.3 },
    { key: "homeAppreciationMu", label: "Home Appreciation", lowMult: 0.5, highMult: 1.5 },
    { key: "rentGrowthMu", label: "Rent Growth", lowMult: 0.5, highMult: 1.5 },
    { key: "investmentReturnMu", label: "Investment Return", lowMult: 0.5, highMult: 1.5 },
    { key: "maintenanceRate", label: "Maintenance Cost", lowMult: 0.5, highMult: 2.0 },
    { key: "homeAppreciationSigma", label: "Price Volatility", lowMult: 0.5, highMult: 2.0 },
  ];

  const rngBase = new SeededRandom(42);
  const quickSims = 200;
  const baseResult = runQuickMedianBreakeven(baseInput, rngBase, quickSims);

  return variables.map(({ key, label, lowMult, highMult }) => {
    const baseVal = baseInput[key] as number;

    const lowInput = { ...baseInput, [key]: baseVal * lowMult, numSimulations: quickSims };
    const highInput = { ...baseInput, [key]: baseVal * highMult, numSimulations: quickSims };

    const lowResult = runQuickMedianBreakeven(lowInput, new SeededRandom(42), quickSims);
    const highResult = runQuickMedianBreakeven(highInput, new SeededRandom(42), quickSims);

    return {
      variable: label,
      low: lowResult,
      high: highResult,
      baseMedian: baseResult,
    };
  });
}

function runQuickMedianBreakeven(input: SimulationInput, rng: SeededRandom, count: number): number {
  const diffs: number[] = [];
  for (let i = 0; i < count; i++) {
    const path = runSingleSimulation(input, rng);
    diffs.push(path.yearly[29].difference);
  }
  return getPercentile(diffs, 50);
}

export function runMonteCarloSimulation(input: SimulationInput): SimulationResult {
  const rng = new SeededRandom(input.seed ?? Math.floor(Math.random() * 2147483647));
  const allPaths: SimulationPath[] = [];

  for (let i = 0; i < input.numSimulations; i++) {
    allPaths.push(runSingleSimulation(input, rng));
  }

  const medianPath: YearlyResult[] = [];
  const percentile10: YearlyResult[] = [];
  const percentile25: YearlyResult[] = [];
  const percentile75: YearlyResult[] = [];
  const percentile90: YearlyResult[] = [];

  for (let year = 0; year < 30; year++) {
    const diffs = allPaths.map((p) => p.yearly[year].difference);
    const buys = allPaths.map((p) => p.yearly[year].buyNetWorth);
    const rents = allPaths.map((p) => p.yearly[year].rentNetWorth);

    medianPath.push({ year: year + 1, buyNetWorth: getPercentile(buys, 50), rentNetWorth: getPercentile(rents, 50), difference: getPercentile(diffs, 50) });
    percentile10.push({ year: year + 1, buyNetWorth: getPercentile(buys, 10), rentNetWorth: getPercentile(rents, 10), difference: getPercentile(diffs, 10) });
    percentile25.push({ year: year + 1, buyNetWorth: getPercentile(buys, 25), rentNetWorth: getPercentile(rents, 25), difference: getPercentile(diffs, 25) });
    percentile75.push({ year: year + 1, buyNetWorth: getPercentile(buys, 75), rentNetWorth: getPercentile(rents, 75), difference: getPercentile(diffs, 75) });
    percentile90.push({ year: year + 1, buyNetWorth: getPercentile(buys, 90), rentNetWorth: getPercentile(rents, 90), difference: getPercentile(diffs, 90) });
  }

  const sampleCount = Math.min(150, allPaths.length);
  const step = Math.max(1, Math.floor(allPaths.length / sampleCount));
  const samplePaths = Array.from({ length: sampleCount }, (_, i) => allPaths[i * step].yearly);

  const allBreakEvens = allPaths.map((p) => p.breakEvenYear).filter((y): y is number => y !== null);
  const breakEvenYear = allBreakEvens.length > 0 ? getPercentile(allBreakEvens, 50) : null;
  const breakEvenOptimistic = allBreakEvens.length > 0 ? getPercentile(allBreakEvens, 10) : null;
  const breakEvenPessimistic = allBreakEvens.length > 0 ? getPercentile(allBreakEvens, 90) : null;

  const breakEvenCurve: { year: number; probability: number }[] = [];
  for (let y = 1; y <= 30; y++) {
    const count = allPaths.filter((p) => p.breakEvenYear !== null && p.breakEvenYear <= y).length;
    breakEvenCurve.push({ year: y, probability: (count / input.numSimulations) * 100 });
  }

  const finalDiffs = allPaths.map((p) => p.yearly[29].difference);
  const buyWinsCount = finalDiffs.filter((d) => d > 0).length;
  const buyWinsProbability = (buyWinsCount / input.numSimulations) * 100;

  const buy10yrCount = allPaths.filter((p) => p.breakEvenYear !== null && p.breakEvenYear <= 10).length;
  const buyWins10yr = (buy10yrCount / input.numSimulations) * 100;

  const breaksEvenCount = allPaths.filter((p) => p.breakEvenYear !== null).length;
  const breakEvenProbability = (breaksEvenCount / input.numSimulations) * 100;

  const riskFreeRate = 0.04;
  const npvDiffs = finalDiffs.map((d) => d / Math.pow(1 + riskFreeRate, 30));
  const expectedNpvDifferential = npvDiffs.reduce((a, b) => a + b, 0) / npvDiffs.length;

  const sensitivityData = runSensitivity(input);

  return {
    medianPath,
    percentile10,
    percentile25,
    percentile75,
    percentile90,
    samplePaths,
    breakEvenYear: breakEvenYear !== null ? Math.round(breakEvenYear) : null,
    breakEvenOptimistic: breakEvenOptimistic !== null ? Math.round(breakEvenOptimistic) : null,
    breakEvenPessimistic: breakEvenPessimistic !== null ? Math.round(breakEvenPessimistic) : null,
    breakEvenProbability,
    buyWinsProbability,
    buyWins10yr,
    finalBuyMedian: medianPath[29].buyNetWorth,
    finalRentMedian: medianPath[29].rentNetWorth,
    finalDifferenceMedian: medianPath[29].difference,
    expectedNpvDifferential,
    breakEvenCurve,
    terminalDistribution: finalDiffs,
    allBreakEvens,
    sensitivityData,
  };
}

export function encodeParams(input: SimulationInput): string {
  const json = JSON.stringify(input);
  return btoa(encodeURIComponent(json));
}

export function decodeParams(encoded: string): SimulationInput | null {
  try {
    const json = decodeURIComponent(atob(encoded));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function exportCSV(result: SimulationResult): string {
  const lines: string[] = ["Year,Buy Net Worth (Median),Rent Net Worth (Median),Difference (Median),10th Pctl,25th Pctl,75th Pctl,90th Pctl,Breakeven Probability %"];
  for (let i = 0; i < 30; i++) {
    lines.push([
      result.medianPath[i].year,
      Math.round(result.medianPath[i].buyNetWorth),
      Math.round(result.medianPath[i].rentNetWorth),
      Math.round(result.medianPath[i].difference),
      Math.round(result.percentile10[i].difference),
      Math.round(result.percentile25[i].difference),
      Math.round(result.percentile75[i].difference),
      Math.round(result.percentile90[i].difference),
      result.breakEvenCurve[i].probability.toFixed(1),
    ].join(","));
  }
  return lines.join("\n");
}

export function exportJSON(result: SimulationResult, input: SimulationInput): string {
  return JSON.stringify({
    parameters: input,
    summary: {
      breakEvenYear: result.breakEvenYear,
      breakEvenOptimistic: result.breakEvenOptimistic,
      breakEvenPessimistic: result.breakEvenPessimistic,
      buyWinsProbability: result.buyWinsProbability,
      buyWins10yr: result.buyWins10yr,
      expectedNpvDifferential: result.expectedNpvDifferential,
      finalBuyMedian: result.finalBuyMedian,
      finalRentMedian: result.finalRentMedian,
    },
    yearlyMedian: result.medianPath,
    breakEvenCurve: result.breakEvenCurve,
    sensitivityAnalysis: result.sensitivityData,
  }, null, 2);
}
