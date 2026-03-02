import { mistralWebSearch } from "./mistral";
import { getGeoHint } from "./exa";
import { Mistral } from "@mistralai/mistralai";

export interface PropertyListing {
    title: string;
    price: string;
    url: string;
    snippet: string;
    source: "mistral" | "perplexity" | "exa";
    type: "sale" | "rental" | "unknown";
}

export interface PropertySearchResult {
    listings: PropertyListing[];
    summary: string;
    sources: { mistral: boolean; perplexity: boolean; exa: boolean };
    elapsedMs: number;
}

interface PropertySearchParams {
    location: string;
    country: string;
    currency: string;
    currencySymbol: string;
    recommendation: "buy" | "rent";
    homePrice: number;
    monthlyRent: number;
    isNonResident: boolean;
    fullScenario: string;
}

// Build a smart search query from user parameters
function buildSearchQuery(p: PropertySearchParams): string {
    const type = p.recommendation === "buy" ? "for sale" : "for rent";
    const budget = p.recommendation === "buy"
        ? `under ${p.currencySymbol}${(p.homePrice * 1.2).toLocaleString()}`
        : `around ${p.currencySymbol}${p.monthlyRent.toLocaleString()} per month`;

    return [
        `${p.location} ${p.country}`,
        `property ${type}`,
        budget,
        new Date().getFullYear().toString(),
        p.isNonResident ? "foreign buyer eligible" : "",
        "real estate listing",
    ].filter(Boolean).join(" ");
}

// --- Source 1: Mistral Web Search ---
async function searchMistral(p: PropertySearchParams): Promise<{ raw: string; success: boolean; elapsedMs: number }> {
    const client = (() => {
        const key = process.env.MISTRAL_API_KEY;
        if (!key) return null;
        return new Mistral({ apiKey: key });
    })();
    if (!client) return { raw: "", success: false, elapsedMs: 0 };

    const startTime = Date.now();
    const type = p.recommendation === "buy" ? "properties for sale" : "apartments/homes for rent";
    const budget = p.recommendation === "buy"
        ? `budget around ${p.currencySymbol}${p.homePrice.toLocaleString()}`
        : `rent around ${p.currencySymbol}${p.monthlyRent.toLocaleString()}/month`;

    try {
        const conversation = await client.beta.conversations.start({
            model: "mistral-small-latest",
            inputs: `Find current ${type} in ${p.location}, ${p.country}. ${budget}. ${p.isNonResident ? "I am a foreign/non-resident buyer." : ""} List specific properties with prices, addresses, and links to listings if available. Focus on the best deals currently available in ${new Date().getFullYear()}.`,
            tools: [{ type: "web_search" as const }],
            store: false,
        });

        let text = "";
        const outputs = (conversation as any).outputs;
        if (outputs && Array.isArray(outputs)) {
            for (const output of outputs) {
                if (output.content && typeof output.content === "string") {
                    text += output.content;
                } else if (output.content && Array.isArray(output.content)) {
                    for (const chunk of output.content) {
                        if (chunk.text) text += chunk.text;
                        else if (typeof chunk === "string") text += chunk;
                    }
                }
            }
        }

        const elapsed = Date.now() - startTime;
        console.log(`[property-search] Mistral completed in ${elapsed}ms, ${text.length} chars`);
        return { raw: text, success: text.length > 50, elapsedMs: elapsed };
    } catch (e: any) {
        const elapsed = Date.now() - startTime;
        console.log(`[property-search] Mistral error: ${e.message}`);
        return { raw: "", success: false, elapsedMs: elapsed };
    }
}

// --- Source 2: Perplexity Sonar ---
async function searchPerplexity(p: PropertySearchParams): Promise<{ raw: string; citations: string[]; success: boolean; elapsedMs: number }> {
    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) return { raw: "", citations: [], success: false, elapsedMs: 0 };

    const startTime = Date.now();
    const type = p.recommendation === "buy" ? "properties for sale" : "rental apartments/homes";
    const budget = p.recommendation === "buy"
        ? `budget ${p.currencySymbol}${(p.homePrice * 0.8).toLocaleString()} to ${p.currencySymbol}${(p.homePrice * 1.2).toLocaleString()}`
        : `rent ${p.currencySymbol}${(p.monthlyRent * 0.8).toLocaleString()} to ${p.currencySymbol}${(p.monthlyRent * 1.2).toLocaleString()}/month`;

    try {
        const response = await fetch("https://api.perplexity.ai/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: "sonar",
                messages: [
                    { role: "system", content: "You are a real estate search assistant. Find specific property listings with prices, addresses, and links. Be specific and cite real listings." },
                    { role: "user", content: `Find the best ${type} currently available in ${p.location}, ${p.country}. ${budget}. ${p.isNonResident ? "Must be available to foreign/non-resident buyers." : ""} List at least 5 specific properties with their prices, addresses, and listing URLs.` },
                ],
                temperature: 0.1,
            }),
        });

        if (!response.ok) {
            const elapsed = Date.now() - startTime;
            console.log(`[property-search] Perplexity error ${response.status}`);
            return { raw: "", citations: [], success: false, elapsedMs: elapsed };
        }

        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || "";
        const citations = data.citations || [];
        const elapsed = Date.now() - startTime;
        console.log(`[property-search] Perplexity completed in ${elapsed}ms, ${text.length} chars, ${citations.length} citations`);
        return { raw: text, citations, success: text.length > 50, elapsedMs: elapsed };
    } catch (e: any) {
        const elapsed = Date.now() - startTime;
        console.log(`[property-search] Perplexity error: ${e.message}`);
        return { raw: "", citations: [], success: false, elapsedMs: elapsed };
    }
}

// --- Source 3: Exa (listing domains) ---
async function searchExa(p: PropertySearchParams): Promise<{ results: { url: string; title: string; snippet: string }[]; success: boolean; elapsedMs: number }> {
    const apiKey = process.env.EXA_API_KEY;
    if (!apiKey) return { results: [], success: false, elapsedMs: 0 };

    const startTime = Date.now();
    const LISTING_DOMAINS = [
        // North America
        "zillow.com", "redfin.com", "realtor.com", "trulia.com",
        "apartments.com", "rent.com", "realtor.ca",
        // UK & Europe
        "rightmove.co.uk", "zoopla.co.uk",
        "idealista.com", "immobilienscout24.de", "funda.nl",
        "seloger.com", "immoscout24.ch", "homegate.ch",
        // Asia-Pacific
        "propertyguru.com.sg", "99.co",
        "domain.com.au", "realestate.com.au",
        "magicbricks.com", "99acres.com", "ddproperty.com", "lamudi.com",
        // Middle East
        "bayut.com", "propertyfinder.ae",
        // Africa & Latin America
        "property24.com", "properati.com", "zapimoveis.com.br",
    ];

    const type = p.recommendation === "buy" ? "property for sale" : "rental apartment";
    const geoHint = getGeoHint(`${p.location} ${p.country}`);
    const budget = p.recommendation === "buy"
        ? `under ${p.currencySymbol}${(p.homePrice * 1.3).toLocaleString()}`
        : `around ${p.currencySymbol}${p.monthlyRent.toLocaleString()} per month`;
    const query = `${type} ${p.location} ${p.country} ${geoHint} ${budget} ${new Date().getFullYear()}`;

    try {
        const response = await fetch("https://api.exa.ai/search", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": apiKey },
            body: JSON.stringify({
                query,
                type: "auto",
                num_results: 12,
                include_domains: LISTING_DOMAINS,
                contents: {
                    highlights: { num_sentences: 3, highlights_per_url: 2 },
                },
            }),
        });

        if (!response.ok) {
            const elapsed = Date.now() - startTime;
            console.log(`[property-search] Exa error ${response.status}`);
            return { results: [], success: false, elapsedMs: elapsed };
        }

        const data = await response.json();
        const results = (data.results || []).map((r: any) => ({
            url: r.url,
            title: r.title || "",
            snippet: r.highlights?.join(" ") || r.text?.slice(0, 200) || "",
        }));

        const elapsed = Date.now() - startTime;
        console.log(`[property-search] Exa completed in ${elapsed}ms, ${results.length} listings from [${results.map((r: any) => { try { return new URL(r.url).hostname } catch { return '?' } }).join(", ")}]`);
        return { results, success: results.length > 0, elapsedMs: elapsed };
    } catch (e: any) {
        const elapsed = Date.now() - startTime;
        console.log(`[property-search] Exa error: ${e.message}`);
        return { results: [], success: false, elapsedMs: elapsed };
    }
}

// --- Structurer: Use Mistral to convert raw results into uniform cards ---
async function structureListings(
    mistralRaw: string,
    perplexityRaw: string,
    exaResults: { url: string; title: string; snippet: string }[],
    p: PropertySearchParams
): Promise<PropertyListing[]> {
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) return [];

    // Build raw data block for structuring
    const rawData = [
        mistralRaw ? `=== MISTRAL WEB SEARCH RESULTS ===\n${mistralRaw}` : "",
        perplexityRaw ? `=== PERPLEXITY SEARCH RESULTS ===\n${perplexityRaw}` : "",
        exaResults.length > 0
            ? `=== EXA LISTING RESULTS ===\n${exaResults.map(r => `Title: ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}`).join("\n\n")}`
            : "",
    ].filter(Boolean).join("\n\n");

    if (!rawData) return [];

    const type = p.recommendation === "buy" ? "for sale" : "for rent";

    try {
        const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: "mistral-small-latest",
                messages: [
                    {
                        role: "system",
                        content: `Extract property listings from the data below into a JSON array. Each listing MUST have a real, verifiable URL.

CRITICAL RULES:
- ONLY include listings that have an actual URL starting with "http". No empty URLs allowed.
- If a listing has no URL, DO NOT include it — it may be hallucinated.
- Prefer listings from Exa and Perplexity (they have real URLs from web scraping).
- Mistral web search results rarely have specific listing URLs — only include if a real URL is present.

Each listing object:
{
  "title": "property description (e.g. '3-bed apartment in Geneva')",
  "price": "formatted price string (e.g. 'CHF 1,200,000' or '$3,500/mo')",
  "url": "REQUIRED - must be a real listing URL starting with http",
  "snippet": "1-2 sentence description",
  "source": "mistral" | "perplexity" | "exa" (which source found it),
  "type": "${p.recommendation === "buy" ? "sale" : "rental"}"
}

Return ONLY a JSON array. Deduplicate similar listings. Maximum 8 listings.`,
                    },
                    { role: "user", content: `Find ${type} properties in ${p.location}, ${p.country} (budget: ${p.currencySymbol}${p.recommendation === "buy" ? p.homePrice.toLocaleString() : p.monthlyRent.toLocaleString() + "/mo"}).\n\nRAW DATA:\n${rawData.slice(0, 6000)}` },
                ],
                temperature: 0,
                response_format: { type: "json_object" },
                max_tokens: 1500,
            }),
        });

        if (!response.ok) return [];

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || "[]";
        const parsed = JSON.parse(content);
        const listings = Array.isArray(parsed) ? parsed : parsed.listings || parsed.properties || [];

        // Hard filter: only keep listings with real URLs (no hallucinated ones)
        return listings
            .map((l: any) => ({
                title: l.title || "Property listing",
                price: l.price || "Price on request",
                url: l.url || "",
                snippet: l.snippet || "",
                source: (["mistral", "perplexity", "exa"].includes(l.source) ? l.source : "mistral") as PropertyListing["source"],
                type: l.type === "rental" ? "rental" : l.type === "sale" ? "sale" : "unknown",
            }))
            .filter((l: PropertyListing) => l.url.startsWith("http"));
    } catch (e: any) {
        console.log(`[property-search] Structuring error: ${e.message}`);
        return [];
    }
}

// --- Main export ---
export async function searchProperties(
    params: PropertySearchParams,
    onStep?: (step: string, detail: string, meta?: Record<string, unknown>) => void
): Promise<PropertySearchResult> {
    const startTime = Date.now();
    const step = onStep || (() => { });

    const type = params.recommendation === "buy" ? "properties for sale" : "rental listings";
    step("searching", `Searching 3 AI sources for ${type} in ${params.location}...`);

    // Run all 3 in parallel
    const [mistralResult, perplexityResult, exaResult] = await Promise.allSettled([
        searchMistral(params),
        searchPerplexity(params),
        searchExa(params),
    ]);

    const mistral = mistralResult.status === "fulfilled" ? mistralResult.value : { raw: "", success: false, elapsedMs: 0 };
    const perplexity = perplexityResult.status === "fulfilled" ? perplexityResult.value : { raw: "", citations: [], success: false, elapsedMs: 0 };
    const exa = exaResult.status === "fulfilled" ? exaResult.value : { results: [], success: false, elapsedMs: 0 };

    const sourceStatus = [
        `Mistral ${mistral.success ? "✓" : "✗"}`,
        `Perplexity ${perplexity.success ? "✓" : "✗"}`,
        `Exa ${exa.success ? `✓ (${exa.results.length} listings)` : "✗"}`,
    ].join(" · ");
    step("sources", sourceStatus, { mistral: mistral.success, perplexity: perplexity.success, exa: exa.success });

    // Structure all results into uniform cards
    step("structuring", "Mistral AI is organizing listing results...");
    const listings = await structureListings(
        mistral.raw,
        perplexity.raw,
        exa.results,
        params
    );

    // Build summary
    const totalSources = [mistral.success, perplexity.success, exa.success].filter(Boolean).length;
    const summary = listings.length > 0
        ? `Found ${listings.length} ${type} from ${totalSources} AI sources`
        : `No specific listings found. Try searching directly on local property portals.`;

    const elapsed = Date.now() - startTime;
    step("done", `${summary} (${(elapsed / 1000).toFixed(1)}s)`, { count: listings.length });

    console.log(`[property-search] Done in ${(elapsed / 1000).toFixed(1)}s: ${listings.length} listings from ${totalSources} sources`);

    return {
        listings,
        summary,
        sources: { mistral: mistral.success, perplexity: perplexity.success, exa: exa.success },
        elapsedMs: elapsed,
    };
}
