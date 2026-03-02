export interface PerplexityResult {
  text: string;
  citations: string[];
  success: boolean;
  elapsedMs: number;
}

export async function searchRealEstateData(location: string, isNonResident: boolean): Promise<PerplexityResult> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error("PERPLEXITY_API_KEY not configured");

  const startTime = Date.now();
  console.log(`[perplexity] Starting real estate search for "${location}"`);

  const systemPrompt = `You are a real estate market research assistant. Provide factual, current data with specific numbers. Always cite your sources. Be precise — give exact numbers, not ranges, when possible.`;

  const userPrompt = `I need current real estate market data for "${location}". Please research and provide ALL of these with SPECIFIC NUMBERS:

1. **Median home sale price** — from current listings on Zillow, Realtor.com, Redfin, Idealista, Rightmove, Domain, or local real estate sites. Give ONE specific number.
2. **Average monthly rent for a 2-bedroom** — from rental sites like Apartments.com, Zillow Rentals, Numbeo, or local equivalents. Give ONE specific number.
3. **Currency** — ISO code (USD, EUR, GBP, etc.)
4. **Current mortgage interest rate** — the prevailing fixed-rate mortgage rate in this market (e.g., "6.8% for a 30-year fixed"). This is critical — always provide a specific rate.
5. **Property tax rate** — annual property tax as a percentage of property value (e.g., "1.8% annually in Texas")
6. **Home insurance rate** — annual homeowners insurance as a percentage of property value
7. **Buying transaction costs**: stamp duty/transfer tax %, legal/notarial fees %, real estate agent commission %
8. **Selling costs**: capital gains tax rate %, agent commission when selling %
9. **Home price appreciation** — average annual % change over the past 3-5 years
10. **Rent growth** — average annual % rent increase recently
11. **Inflation rate** — current annual inflation rate for this country
${isNonResident ? "12. **Non-resident/foreign buyer restrictions** — extra taxes, ownership limits, or additional costs for foreign buyers" : ""}

IMPORTANT: Provide specific numbers for EVERY item above. Do not skip any. For example:
- "Median home price: $425,000"
- "Average 2BR rent: $1,650/month"
- "Mortgage rate: 6.8% (30-year fixed)"
- "Property tax: 1.8% annually"
- "Transfer tax: 2% of purchase price"
If you can't find an exact number for a specific item, provide the closest available estimate with a note.`;

  const TIMEOUT_MS = 45000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.log(`[perplexity] Aborting after ${TIMEOUT_MS}ms timeout`);
    controller.abort();
  }, TIMEOUT_MS);

  try {
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        top_p: 0.9,
        search_recency_filter: "month",
        return_images: false,
        return_related_questions: false,
        stream: false,
        frequency_penalty: 1,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      const elapsed = Date.now() - startTime;
      console.log(`[perplexity] API error ${response.status} after ${elapsed}ms: ${errorText.slice(0, 300)}`);
      return { text: "", citations: [], success: false, elapsedMs: elapsed };
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "";
    const citations: string[] = data.citations || [];
    const elapsed = Date.now() - startTime;

    console.log(`[perplexity] Completed in ${elapsed}ms, got ${text.length} chars, ${citations.length} citations`);

    return {
      text,
      citations,
      success: text.length > 50,
      elapsedMs: elapsed,
    };
  } catch (e: any) {
    clearTimeout(timeoutId);
    const elapsed = Date.now() - startTime;

    if (e.name === "AbortError") {
      console.log(`[perplexity] Request timed out after ${elapsed}ms`);
      return { text: "", citations: [], success: false, elapsedMs: elapsed };
    }

    console.log(`[perplexity] Error after ${elapsed}ms: ${e.message}`);
    return { text: "", citations: [], success: false, elapsedMs: elapsed };
  }
}
