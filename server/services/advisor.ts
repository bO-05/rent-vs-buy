import type { LocationData } from "@shared/schema";

/**
 * Build the advisor system + user prompts.
 * Shared between streaming and non-streaming paths.
 */
function buildAdvisorPrompts(
    location: LocationData,
    simulationResult: {
        buyWinsProbability: number;
        breakEvenYear: number | null;
        breakEvenOptimistic: number | null;
        breakEvenPessimistic: number | null;
        buyWins10yr: number;
        finalBuyMedian: number;
        finalRentMedian: number;
        finalDifferenceMedian: number;
        expectedNpvDifferential: number;
        sensitivityData: { variable: string; low: number; high: number; baseMedian: number }[];
    },
    params: {
        homePrice: number;
        monthlyRent: number;
        downPaymentPercent: number;
        mortgageRate: number;
        mortgageTermYears: number;
    }
): { system: string; user: string } {
    const currSym = location.currencySymbol || "$";

    const system = `You are a concise financial advisor. Given simulation data, write a SHORT analysis.

FORMAT (exactly this structure, in plain text):
1. One sentence verdict: who wins (renting or buying) and by how much.
2. Two to three short sentences explaining why — reference the most impactful factors.
3. One sentence practical takeaway for the user.

STRICT RULES:
- 80 words MAXIMUM. Do not exceed this.
- No markdown: no asterisks, no hashes, no bullets, no backticks.
- Write in plain flowing text only.
- Be direct and specific with numbers.`;

    const user = `Location: ${location.name}, ${location.country}
Currency: ${currSym}
Home price: ${currSym}${params.homePrice.toLocaleString()}
Monthly rent: ${currSym}${params.monthlyRent.toLocaleString()}
Down payment: ${params.downPaymentPercent}%
Mortgage rate: ${params.mortgageRate}%
Term: ${params.mortgageTermYears} years

Simulation (2,000 Monte Carlo scenarios, 30yr):
- Buying wins: ${simulationResult.buyWinsProbability.toFixed(1)}% of scenarios
- Breakeven: Year ${simulationResult.breakEvenYear ?? "Never"}
- Buyer wealth 30yr: ${currSym}${Math.round(simulationResult.finalBuyMedian).toLocaleString()}
- Renter wealth 30yr: ${currSym}${Math.round(simulationResult.finalRentMedian).toLocaleString()}
- Net advantage: ${currSym}${Math.round(simulationResult.expectedNpvDifferential).toLocaleString()}
- Price/rent ratio: ${location.priceToRentRatio?.toFixed(1)}x
- Key factors: ${simulationResult.sensitivityData.slice(0, 3).map((s: any) => s.variable).join(", ")}

Write your 80-word analysis now.`;

    return { system, user };
}

/**
 * Stream advisor narration via SSE using Mistral's streaming API.
 */
export async function streamAdvisorNarration(
    location: LocationData,
    simulationResult: any,
    params: any,
    onChunk: (text: string) => void,
    onDone: () => void,
    onError: (err: Error) => void
): Promise<void> {
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) { onError(new Error("MISTRAL_API_KEY not configured")); return; }

    const { system, user } = buildAdvisorPrompts(location, simulationResult, params);

    try {
        const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: "ministral-8b-latest",
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: user },
                ],
                temperature: 0.5,
                max_tokens: 200,
                stream: true,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            onError(new Error(`Advisor API error ${response.status}: ${errorText.slice(0, 200)}`));
            return;
        }

        const reader = response.body?.getReader();
        if (!reader) { onError(new Error("No response body")); return; }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                const data = line.slice(6).trim();
                if (data === "[DONE]") { onDone(); return; }

                try {
                    const parsed = JSON.parse(data);
                    const delta = parsed.choices?.[0]?.delta?.content;
                    if (delta) onChunk(delta);
                } catch { }
            }
        }
        onDone();
    } catch (e: any) {
        onError(e);
    }
}

/**
 * Chat with the advisor — multi-turn conversation with simulation context.
 */
export async function streamAdvisorChat(
    messages: { role: string; content: string }[],
    locationContext: string,
    onChunk: (text: string) => void,
    onDone: () => void,
    onError: (err: Error) => void
): Promise<void> {
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) { onError(new Error("MISTRAL_API_KEY not configured")); return; }

    const systemMessage = `You are a friendly, expert financial advisor helping a user understand their rent-vs-buy simulation results. You have full context of their scenario below.

${locationContext}

Rules:
- Answer follow-up questions concisely (2-4 sentences max unless they ask for detail)
- You can adjust recommendations if they mention new information (e.g., "what if rates drop to 5%?")
- Reference specific numbers from the simulation when relevant
- Be direct and practical
- Do NOT use any markdown formatting. Write only in plain text.`;

    const fullMessages = [
        { role: "system", content: systemMessage },
        ...messages.map(m => ({ role: m.role, content: m.content })),
    ];

    try {
        const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: "ministral-8b-latest",
                messages: fullMessages,
                temperature: 0.6,
                max_tokens: 512,
                stream: true,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            onError(new Error(`Chat API error ${response.status}`));
            return;
        }

        const reader = response.body?.getReader();
        if (!reader) { onError(new Error("No response body")); return; }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                const data = line.slice(6).trim();
                if (data === "[DONE]") { onDone(); return; }
                try {
                    const parsed = JSON.parse(data);
                    const delta = parsed.choices?.[0]?.delta?.content;
                    if (delta) onChunk(delta);
                } catch { }
            }
        }
        onDone();
    } catch (e: any) {
        onError(e);
    }
}
