import type { LocationResearchResult, SimulationInput } from "@shared/schema";

interface MistralMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: MistralToolCall[];
}

interface MistralToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface MistralTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// --- Core API Caller ---

async function callMistral(
  messages: MistralMessage[],
  model: string = "mistral-large-latest",
  options: {
    jsonMode?: boolean;
    tools?: MistralTool[];
    toolChoice?: "auto" | "any" | "none";
    temperature?: number;
    maxTokens?: number;
  } = {}
): Promise<{ content: string; toolCalls?: MistralToolCall[] }> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) throw new Error("MISTRAL_API_KEY not configured");

  const {
    jsonMode = false,
    tools,
    toolChoice = "auto",
    temperature = 0.3,
    maxTokens = 4096,
  } = options;

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = toolChoice;
    body.parallel_tool_calls = true;
  }

  const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Mistral API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];

  return {
    content: choice?.message?.content || "",
    toolCalls: choice?.message?.tool_calls,
  };
}

// --- Robust Normalizer ---
// Mistral's json_object mode returns valid JSON but with unpredictable schema.
// This normalizer extracts the right values from whatever structure Mistral returns
// and maps them to the exact flat schema the simulation engine expects.

function num(val: unknown, fallback: number): number {
  if (val === null || val === undefined) return fallback;
  const n = Number(val);
  return isNaN(n) ? fallback : n;
}

function str(val: unknown, fallback: string): string {
  if (val === null || val === undefined || typeof val !== "string" || val.trim() === "") return fallback;
  return val.trim();
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// Deep-search a nested object for a key name, returns first found value
function deepFind(obj: any, keys: string[]): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  for (const val of Object.values(obj)) {
    if (val && typeof val === "object") {
      const found = deepFind(val, keys);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function normalizeLocationData(raw: any, queryLocation: string, isNonResident: boolean): LocationResearchResult {
  const loc = raw?.location || raw || {};
  const rp = raw?.recommendedParams || raw?.recommended_params || raw?.params || {};

  // --- Location fields ---
  const medianHomePrice = num(
    deepFind(raw, ["medianHomePrice", "median_home_price", "homePrice", "home_price", "propertyPrice"]),
    300000
  );
  const averageMonthlyRent = num(
    deepFind(raw, ["averageMonthlyRent", "average_monthly_rent", "monthlyRent", "monthly_rent", "rent"]),
    1500
  );

  const location = {
    id: str(loc.id, queryLocation.toLowerCase().replace(/[^a-z0-9]+/g, "-")),
    name: str(loc.name, queryLocation),
    country: str(loc.country, "Unknown"),
    region: str(loc.region || loc.state || loc.province, ""),
    currency: str(loc.currency, "USD"),
    currencySymbol: str(loc.currencySymbol || loc.currency_symbol, "$"),
    medianHomePrice,
    averageMonthlyRent,
    priceToRentRatio: Math.round((medianHomePrice / (averageMonthlyRent * 12)) * 10) / 10,
    description: str(loc.description || loc.marketDescription, `Real estate market data for ${queryLocation}`),
    dataSource: str(loc.dataSource || loc.data_source, "Mistral AI + Perplexity Sonar"),
    listingCount: num(loc.listingCount || loc.listing_count, 0),
    warnings: Array.isArray(loc.warnings) ? loc.warnings.filter((w: any) => typeof w === "string") : [],
  };

  // --- Recommended params (flat, exact schema expected by SimulationInput) ---
  // Extract values from potentially nested objects Mistral returns
  const purchaseTax = num(
    deepFind(rp, ["purchaseTaxRate", "purchase_tax_rate", "stampDuty", "stamp_duty", "stampDutyTransferTax", "transferTax"]),
    2
  );
  const legalFees = num(
    deepFind(rp, ["legalFeesPercent", "legal_fees_percent", "legalFees", "legalNotarialFees"]),
    1
  );
  const agencyFee = num(
    deepFind(rp, ["agencyFeePercent", "agency_fee_percent", "agentCommission", "agent_commission"]),
    3
  );
  const sellingTax = num(
    deepFind(rp, ["sellingTaxRate", "selling_tax_rate", "capitalGainsTaxRate", "capital_gains_tax"]),
    2
  );

  const homeAppreciationMu = num(rp.homeAppreciationMu || rp.home_appreciation_mu, 4);
  const rentGrowthMu = num(rp.rentGrowthMu || rp.rent_growth_mu, 3);
  const investmentReturnMu = num(rp.investmentReturnMu || rp.investment_return_mu, 8);

  const recommendedParams: Partial<SimulationInput> = {
    downPaymentPercent: clamp(num(rp.downPaymentPercent || rp.down_payment_percent, 20), 5, 50),
    mortgageRate: clamp(num(rp.mortgageRate || rp.mortgage_rate, 6.5), 0.5, 20),
    mortgageTermYears: clamp(num(rp.mortgageTermYears || rp.mortgage_term_years, 30), 10, 40),
    propertyTaxRate: clamp(num(rp.propertyTaxRate || rp.property_tax_rate, 1.0), 0.01, 5),
    maintenanceRate: clamp(num(rp.maintenanceRate || rp.maintenance_rate, 1.0), 0.1, 5),
    insuranceRate: clamp(num(rp.insuranceRate || rp.insurance_rate || rp.homeInsuranceRate, 0.5), 0.05, 3),
    rentGrowthMu: clamp(rentGrowthMu, -5, 15),
    rentGrowthSigma: clamp(num(rp.rentGrowthSigma || rp.rent_growth_sigma, 0.08), 0.01, 0.4),
    homeAppreciationMu: clamp(homeAppreciationMu, -5, 15),
    homeAppreciationSigma: clamp(num(rp.homeAppreciationSigma || rp.home_appreciation_sigma, 0.12), 0.01, 0.4),
    investmentReturnMu: clamp(investmentReturnMu, 2, 15),
    investmentReturnSigma: clamp(num(rp.investmentReturnSigma || rp.investment_return_sigma, 0.16), 0.05, 0.4),
    inflationRate: clamp(num(rp.inflationRate || rp.inflation_rate, 3), 0.5, 15),
    purchaseTaxRate: clamp(purchaseTax, 0, 15),
    legalFeesPercent: clamp(legalFees, 0, 10),
    agencyFeePercent: clamp(agencyFee, 0, 10),
    sellingTaxRate: clamp(sellingTax, 0, 30),
    isNonResident: isNonResident,
    nonResidentExtraPercent: isNonResident ? clamp(num(rp.nonResidentExtraPercent || rp.non_resident_extra_percent, 3), 0, 15) : 0,
    correlationHomeRent: clamp(num(rp.correlationHomeRent || rp.correlation_home_rent, 0.5), -0.5, 0.9),
    correlationHomeInvestment: clamp(num(rp.correlationHomeInvestment || rp.correlation_home_investment, 0.3), -0.5, 0.9),
    correlationRentInvestment: clamp(num(rp.correlationRentInvestment || rp.correlation_rent_investment, 0.2), -0.5, 0.9),
  };

  // Fix sigma values that Mistral may return as percentages instead of decimals
  if (recommendedParams.rentGrowthSigma! > 1) recommendedParams.rentGrowthSigma! /= 100;
  if (recommendedParams.homeAppreciationSigma! > 1) recommendedParams.homeAppreciationSigma! /= 100;
  if (recommendedParams.investmentReturnSigma! > 1) recommendedParams.investmentReturnSigma! /= 100;

  return { location, recommendedParams };
}

// --- Exported Functions ---

/**
 * Call Mistral Large 3 with function calling to orchestrate data collection tools.
 */
export async function orchestrateResearch(
  location: string,
  isNonResident: boolean,
  availableTools: MistralTool[]
): Promise<{ toolCalls: MistralToolCall[]; assistantMessage: string }> {
  const systemPrompt = `You are a real estate research orchestrator. When a user asks about a location, you MUST use the available tools to gather real-time market data. Always call search_real_estate_data.`;

  const userPrompt = `Research real estate market data for "${location}". Non-resident buyer: ${isNonResident ? "Yes" : "No"}. Use all available tools to gather comprehensive data.`;

  const result = await callMistral(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    "mistral-large-latest",
    {
      tools: availableTools,
      toolChoice: "any",
      temperature: 0.1,
      maxTokens: 512,
    }
  );

  return {
    toolCalls: result.toolCalls || [],
    assistantMessage: result.content,
  };
}

/**
 * Call Mistral Large 3 to convert raw research into LocationResearchResult.
 */
export async function processLocationData(
  location: string,
  scrapedData: string,
  isNonResident: boolean
): Promise<LocationResearchResult> {
  const systemPrompt = `You are a real estate data extraction assistant. Extract specific numbers from research data and return them as a flat JSON object.

Return JSON with EXACTLY this structure:
{
  "location": {
    "id": "city-slug",
    "name": "City, Country",
    "country": "Country",
    "region": "Region",
    "currency": "USD",
    "currencySymbol": "$",
    "medianHomePrice": 500000,
    "averageMonthlyRent": 2000,
    "priceToRentRatio": 20.8,
    "description": "Brief market summary",
    "dataSource": "Perplexity Sonar",
    "listingCount": 0,
    "warnings": ["warning1"]
  },
  "recommendedParams": {
    "downPaymentPercent": 20,
    "mortgageRate": 6.5,
    "mortgageTermYears": 30,
    "propertyTaxRate": 1.0,
    "maintenanceRate": 1.0,
    "insuranceRate": 0.5,
    "rentGrowthMu": 3,
    "rentGrowthSigma": 0.08,
    "homeAppreciationMu": 4,
    "homeAppreciationSigma": 0.12,
    "investmentReturnMu": 8,
    "investmentReturnSigma": 0.16,
    "inflationRate": 3,
    "purchaseTaxRate": 2,
    "legalFeesPercent": 1,
    "agencyFeePercent": 3,
    "sellingTaxRate": 2,
    "isNonResident": false,
    "nonResidentExtraPercent": 0,
    "correlationHomeRent": 0.5,
    "correlationHomeInvestment": 0.3,
    "correlationRentInvestment": 0.2
  }
}

CRITICAL RULES:
- Use ONLY numbers from the research data. Do NOT invent prices.
- ALL fields must be FLAT numbers — NO nested objects.
- Percentage fields (mortgageRate, propertyTaxRate, etc.) are in percentage format: 6.5 means 6.5%
- Sigma fields are in DECIMAL format: 0.12 means 12% volatility
- medianHomePrice and averageMonthlyRent are in LOCAL CURRENCY as whole numbers
- homeAppreciationMu should be realistic yearly growth (typically 2-8%), NOT one-year change
- NEVER use null for any numeric field — always provide a reasonable estimate
- NEVER set mortgageRate or inflationRate to 0`;

  const userPrompt = `Location: ${location}
Non-resident buyer: ${isNonResident ? "Yes" : "No"}

Research data:
${scrapedData || "No research data available — use your market knowledge."}

Return the flat JSON object as specified. Every field must have a value, no nulls.`;

  const result = await callMistral(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    "mistral-large-latest",
    {
      jsonMode: true,
      temperature: 0.2,
      maxTokens: 4096,
    }
  );

  const parsed = JSON.parse(result.content);
  return normalizeLocationData(parsed, location, isNonResident);
}

/**
 * Complete the agentic research loop: feed tool results back to Mistral.
 */
export async function completeResearchWithToolResults(
  location: string,
  isNonResident: boolean,
  toolResults: { toolCallId: string; functionName: string; result: string }[],
  originalToolCalls: MistralToolCall[],
  assistantMessage: string
): Promise<LocationResearchResult> {
  const messages: MistralMessage[] = [
    {
      role: "system",
      content: `You are a real estate data extraction assistant. The tools have returned research data. Extract specific numbers and return a flat JSON object.

Return JSON with EXACTLY this structure (ALL fields flat numbers, NO nested objects):
{
  "location": {
    "id": "city-slug", "name": "City", "country": "Country", "region": "Region",
    "currency": "USD", "currencySymbol": "$",
    "medianHomePrice": 500000, "averageMonthlyRent": 2000, "priceToRentRatio": 20.8,
    "description": "summary", "dataSource": "source", "listingCount": 0, "warnings": []
  },
  "recommendedParams": {
    "downPaymentPercent": 20, "mortgageRate": 6.5, "mortgageTermYears": 30,
    "propertyTaxRate": 1.0, "maintenanceRate": 1.0, "insuranceRate": 0.5,
    "rentGrowthMu": 3, "rentGrowthSigma": 0.08,
    "homeAppreciationMu": 4, "homeAppreciationSigma": 0.12,
    "investmentReturnMu": 8, "investmentReturnSigma": 0.16,
    "inflationRate": 3, "purchaseTaxRate": 2, "legalFeesPercent": 1,
    "agencyFeePercent": 3, "sellingTaxRate": 2,
    "isNonResident": false, "nonResidentExtraPercent": 0,
    "correlationHomeRent": 0.5, "correlationHomeInvestment": 0.3, "correlationRentInvestment": 0.2
  }
}

CRITICAL: ALL fields must be flat numbers. NO nested objects. homeAppreciationMu should be realistic YEARLY growth (typically 2-8%). NEVER use null. Percentage fields are in % format (6.5 = 6.5%). Sigma fields in decimal (0.12 = 12% volatility).`,
    },
    {
      role: "user",
      content: `Research real estate data for "${location}". Non-resident: ${isNonResident ? "Yes" : "No"}.`,
    },
    {
      role: "assistant",
      content: assistantMessage || "",
      tool_calls: originalToolCalls,
    },
  ];

  // Add tool results
  for (const tr of toolResults) {
    messages.push({
      role: "tool",
      content: tr.result,
      tool_call_id: tr.toolCallId,
    });
  }

  const result = await callMistral(messages, "mistral-large-latest", {
    jsonMode: true,
    temperature: 0.2,
    maxTokens: 4096,
  });

  const parsed = JSON.parse(result.content);
  return normalizeLocationData(parsed, location, isNonResident);
}

// --- Mistral Built-in Web Search (via official SDK) ---
export interface MistralWebSearchResult {
  text: string;
  success: boolean;
  elapsedMs: number;
}

import { Mistral } from "@mistralai/mistralai";

let mistralSdkClient: InstanceType<typeof Mistral> | null = null;

function getMistralSdkClient(): InstanceType<typeof Mistral> | null {
  if (mistralSdkClient) return mistralSdkClient;
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) return null;
  mistralSdkClient = new Mistral({ apiKey });
  return mistralSdkClient;
}

export async function mistralWebSearch(location: string): Promise<MistralWebSearchResult> {
  const client = getMistralSdkClient();
  if (!client) return { text: "", success: false, elapsedMs: 0 };

  const startTime = Date.now();
  console.log(`[mistral-web] Starting web search for "${location}"`);

  try {
    const conversation = await client.beta.conversations.start({
      model: "mistral-small-latest",
      inputs: `Search for current real estate data in ${location}: median home prices, average monthly rent for a 2-bedroom, current mortgage rates, property tax rates, and recent price trends. Return raw data with specific numbers.`,
      tools: [{ type: "web_search" as const }],
      store: false,
    });

    // Extract text from conversation outputs
    let text = "";
    const outputs = (conversation as any).outputs;
    if (outputs && Array.isArray(outputs)) {
      for (const output of outputs) {
        if (output.content && typeof output.content === "string") {
          text += output.content;
        } else if (output.content && Array.isArray(output.content)) {
          // Content can be array of chunks
          for (const chunk of output.content) {
            if (chunk.text) text += chunk.text;
            else if (typeof chunk === "string") text += chunk;
          }
        }
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[mistral-web] Completed in ${elapsed}ms, got ${text.length} chars`);

    return { text, success: text.length > 50, elapsedMs: elapsed };
  } catch (e: any) {
    const elapsed = Date.now() - startTime;
    console.log(`[mistral-web] Error after ${elapsed}ms: ${e.message}`);
    return { text: "", success: false, elapsedMs: elapsed };
  }
}

// --- Router Agent (smart scenario detection) ---
export interface RouterResult {
  queryType: string;
  location: string;
  country: string;
  isResidential: boolean;
  isNonResident: boolean;
  simulationYears: number | null;
  mortgageTermYears: number | null;
  downPaymentPercent: number | null;
  homePrice: number | null;
  monthlyRent: number | null;
  userCurrency: string | null;  // currency user specified amounts in (e.g. "USD", "EUR")
  fullScenario: string;
  elapsedMs: number;
}

export async function routerClassifyQuery(rawQuery: string): Promise<RouterResult> {
  const startTime = Date.now();
  try {
    const result = await callMistral(
      [
        {
          role: "system",
          content: `You are a smart real estate query router. Extract ALL information from the user's input. The user may write a simple city name OR a long natural-language scenario with financial details. Return JSON only:
{
  "queryType": "residential_purchase" | "investment" | "relocation" | "vacation_home",
  "location": "TARGET city/area to BUY in (not where they currently live)",
  "country": "country of the target location",
  "isNonResident": true if user is non-resident/foreign/expat buyer OR lives in different country from target,
  "simulationYears": simulation/projection duration in years (e.g. "20-year Monte Carlo simulation" → 20), or null,
  "mortgageTermYears": mortgage/loan term in years (e.g. "15-year mortgage" → 15), or null. This is DIFFERENT from simulationYears,
  "downPaymentPercent": down payment percentage (e.g. "25% down" → 25, "put down 25%" → 25), or null,
  "homePrice": purchase price AS THE USER STATED IT (raw number, do NOT convert currency). If a RANGE, use MIDPOINT. null if not specified,
  "monthlyRent": monthly rent AS THE USER STATED IT (raw number, do NOT convert currency). If a RANGE, use MIDPOINT. null if not specified,
  "userCurrency": the 3-letter currency code the user specified their budget in (e.g. "USD", "EUR", "GBP", "CHF"). Detect from $ → USD, € → EUR, £ → GBP, "usd" → USD, etc. null if user didn't specify a currency or used local currency,
  "fullScenario": one-sentence summary of the full request
}

IMPORTANT:
- "location" = TARGET city to BUY in, not where they currently live
- "simulationYears" = how long to run the simulation (e.g. "20-year simulation")
- "mortgageTermYears" = the loan/mortgage term (e.g. "15-year mortgage"). These are often DIFFERENT numbers!
- "homePrice"/"monthlyRent" = user's stated budget IN THE CURRENCY THEY SPECIFIED. Do NOT convert. Convert ranges to midpoints. Convert: 1.5M=1500000, 500K=500000
- "userCurrency" = CRITICAL: If user says "750k USD" or "$750k" or "1000 usd", set to "USD". If they say "1.5M CHF", set to "CHF". If they just say "1.5M" with no currency hint, set to null.

Examples:
- "Buy in Surabaya, budget 750k USD" → homePrice: 750000, userCurrency: "USD"
- "rent $2000/mo in Tokyo" → monthlyRent: 2000, userCurrency: "USD"
- "purchase price 1.5M CHF in Geneva" → homePrice: 1500000, userCurrency: "CHF"
- "budget 500K to 700K, rent $2000/mo" → homePrice: 600000, monthlyRent: 2000, userCurrency: "USD"
- "25% down on 15-year mortgage, 20-year simulation" → downPaymentPercent: 25, mortgageTermYears: 15, simulationYears: 20, userCurrency: null
- "Austin, Texas" → everything null except location/country`,
        },
        { role: "user", content: rawQuery },
      ],
      "mistral-small-latest",
      { jsonMode: true, temperature: 0, maxTokens: 350 }
    );

    const parsed = JSON.parse(result.content);
    const elapsed = Date.now() - startTime;

    const downPct = typeof parsed.downPaymentPercent === "number" ? parsed.downPaymentPercent : null;
    const mortYears = typeof parsed.mortgageTermYears === "number" ? parsed.mortgageTermYears : null;
    const simYears = typeof parsed.simulationYears === "number" ? parsed.simulationYears : null;
    const price = typeof parsed.homePrice === "number" && parsed.homePrice > 0 ? parsed.homePrice : null;
    const rent = typeof parsed.monthlyRent === "number" && parsed.monthlyRent > 0 ? parsed.monthlyRent : null;
    const userCurrency = typeof parsed.userCurrency === "string" && parsed.userCurrency.length === 3 ? parsed.userCurrency.toUpperCase() : null;

    console.log(`[router] Classified "${rawQuery.slice(0, 60)}..." → ${parsed.queryType} in ${parsed.location}, ${parsed.country} | nonResident=${parsed.isNonResident} | simYears=${simYears} | mortgage=${mortYears}yr | down=${downPct}% | price=${price} ${userCurrency || '(local)'} | rent=${rent} ${userCurrency || '(local)'} (${elapsed}ms)`);

    return {
      queryType: parsed.queryType || "residential_purchase",
      location: parsed.location || rawQuery,
      country: parsed.country || "",
      isResidential: parsed.queryType === "residential_purchase" || parsed.queryType === "relocation",
      isNonResident: parsed.isNonResident === true,
      simulationYears: simYears,
      mortgageTermYears: mortYears,
      downPaymentPercent: downPct,
      homePrice: price,
      monthlyRent: rent,
      userCurrency,
      fullScenario: parsed.fullScenario || "",
      elapsedMs: elapsed,
    };
  } catch (e: any) {
    const elapsed = Date.now() - startTime;
    console.log(`[router] Classification failed (${elapsed}ms): ${e.message}`);
    return {
      queryType: "residential_purchase",
      location: rawQuery,
      country: "",
      isResidential: true,
      isNonResident: false,
      simulationYears: null,
      mortgageTermYears: null,
      downPaymentPercent: null,
      homePrice: null,
      monthlyRent: null,
      userCurrency: null,
      fullScenario: "",
      elapsedMs: elapsed,
    };
  }
}

export type { MistralToolCall, MistralTool };
