export interface ExaResult {
    highlights: string;
    sources: { url: string; title: string }[];
    success: boolean;
    elapsedMs: number;
}

const TRUSTED_DOMAINS = [
    // Market data / global stats
    "numbeo.com",
    "globalpropertyguide.com",
    "statista.com",
    "knightfrank.com",
    "savills.com",
    "tradingeconomics.com",

    // North America
    "zillow.com",
    "redfin.com",
    "realtor.com",
    "trulia.com",
    "apartments.com",
    "realtor.ca",

    // UK & Europe
    "rightmove.co.uk",
    "zoopla.co.uk",
    "idealista.com",
    "seloger.com",
    "immobilienscout24.de",
    "funda.nl",

    // Asia-Pacific
    "domain.com.au",
    "realestate.com.au",
    "propertyguru.com.sg",
    "99.co",
    "magicbricks.com",
    "99acres.com",
    "ddproperty.com",
    "lamudi.com",

    // Middle East
    "bayut.com",
    "propertyfinder.ae",

    // Africa
    "property24.com",

    // Latin America
    "properati.com",
    "zapimoveis.com.br",
];

// Map a location string to a geographic hint so regional portals get surfaced
export function getGeoHint(location: string): string {
    const loc = location.toLowerCase();
    const hints: [RegExp, string][] = [
        // Asia-Pacific
        [/singapore|malaysia|thailand|indonesia|philippines|vietnam|hong kong|taiwan|japan|korea|india|sri lanka|bangladesh|myanmar|cambodia|laos/, "Asia-Pacific"],
        [/china|beijing|shanghai|shenzhen|guangzhou/, "Asia China"],
        [/australia|sydney|melbourne|brisbane|perth|auckland|new zealand/, "Oceania Australia"],
        // Middle East
        [/dubai|abu dhabi|uae|saudi|qatar|bahrain|oman|kuwait|riyadh|jeddah/, "Middle East Gulf"],
        // Europe
        [/uk|london|manchester|birmingham|edinburgh|united kingdom|britain/, "United Kingdom"],
        [/france|paris|lyon|marseille/, "France Europe"],
        [/germany|berlin|munich|frankfurt|hamburg/, "Germany Europe"],
        [/spain|madrid|barcelona|valencia/, "Spain Europe"],
        [/italy|rome|milan|florence/, "Italy Europe"],
        [/switzerland|zurich|geneva|bern|basel/, "Switzerland Europe"],
        [/netherlands|amsterdam|rotterdam/, "Netherlands Europe"],
        [/portugal|lisbon|porto/, "Portugal Europe"],
        [/ireland|dublin/, "Ireland Europe"],
        // North America
        [/usa|united states|america|new york|los angeles|chicago|houston|phoenix|philadelphia|san antonio|san diego|dallas|san jose|austin|jacksonville|san francisco|seattle|denver|washington|boston|nashville|miami/, "United States"],
        [/canada|toronto|vancouver|montreal|ottawa|calgary/, "Canada"],
        [/mexico|mexico city|cancun|guadalajara/, "Mexico Latin America"],
        // Latin America
        [/brazil|sao paulo|rio de janeiro|brasilia/, "Brazil Latin America"],
        [/argentina|buenos aires/, "Argentina Latin America"],
        [/colombia|bogota|medellin/, "Colombia Latin America"],
        [/chile|santiago/, "Chile Latin America"],
        // Africa
        [/south africa|cape town|johannesburg|durban/, "South Africa"],
        [/nigeria|lagos|abuja/, "Nigeria Africa"],
        [/kenya|nairobi/, "Kenya Africa"],
        [/egypt|cairo/, "Egypt Africa"],
    ];
    for (const [pattern, hint] of hints) {
        if (pattern.test(loc)) return hint;
    }
    return "";
}

export async function searchRealEstateExa(
    location: string,
    isNonResident: boolean
): Promise<ExaResult> {
    const apiKey = process.env.EXA_API_KEY;
    if (!apiKey) {
        return { highlights: "", sources: [], success: false, elapsedMs: 0 };
    }

    const startTime = Date.now();
    console.log(`[exa] Starting domain-filtered search for "${location}"`);

    const geoHint = getGeoHint(location);
    const query = `current ${new Date().getFullYear()} median home price average rent mortgage rate property tax ${location} ${geoHint} real estate market data${isNonResident ? " foreign buyer restrictions" : ""}`;

    const TIMEOUT_MS = 15000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const response = await fetch("https://api.exa.ai/search", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
            },
            body: JSON.stringify({
                query,
                type: "auto",
                num_results: 12,
                include_domains: TRUSTED_DOMAINS,
                contents: {
                    highlights: {
                        num_sentences: 5,
                        highlights_per_url: 3,
                    },
                },
            }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text().catch(() => "unknown");
            const elapsed = Date.now() - startTime;
            console.log(`[exa] API error ${response.status} after ${elapsed}ms: ${errorText.slice(0, 200)}`);
            return { highlights: "", sources: [], success: false, elapsedMs: elapsed };
        }

        const data = await response.json();
        const results = data.results || [];
        const elapsed = Date.now() - startTime;

        // Merge all highlights into a single text block
        const allHighlights: string[] = [];
        const sources: { url: string; title: string }[] = [];

        for (const r of results) {
            if (r.highlights && Array.isArray(r.highlights)) {
                allHighlights.push(`[${r.title || r.url}]:\n${r.highlights.join("\n")}`);
            }
            sources.push({ url: r.url, title: r.title || r.url });
        }

        const highlightText = allHighlights.join("\n\n");

        console.log(
            `[exa] Completed in ${elapsed}ms: ${results.length} results, ${sources.length} sources from [${sources.map((s) => new URL(s.url).hostname).join(", ")}]`
        );

        return {
            highlights: highlightText,
            sources,
            success: highlightText.length > 50,
            elapsedMs: elapsed,
        };
    } catch (e: any) {
        clearTimeout(timeoutId);
        const elapsed = Date.now() - startTime;

        if (e.name === "AbortError") {
            console.log(`[exa] Timed out after ${elapsed}ms`);
        } else {
            console.log(`[exa] Error after ${elapsed}ms: ${e.message}`);
        }

        return { highlights: "", sources: [], success: false, elapsedMs: elapsed };
    }
}
