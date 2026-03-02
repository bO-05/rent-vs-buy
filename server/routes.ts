import type { Express } from "express";
import { type Server } from "http";
import { searchRealEstateData } from "./services/perplexity";
import { searchRealEstateExa } from "./services/exa";
import {
  orchestrateResearch,
  processLocationData,
  completeResearchWithToolResults,
  mistralWebSearch,
  routerClassifyQuery,
  type MistralTool,
  type MistralToolCall,
} from "./services/mistral";
import { streamAdvisorNarration, streamAdvisorChat } from "./services/advisor";
import { transcribeAudio } from "./services/voxtral";
import { getDemoCacheResponse } from "./demo-cache";

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

// Fetch exchange rate from free API. Returns rate to multiply fromCurrency amount to get toCurrency amount.
async function fetchExchangeRate(fromCurrency: string, toCurrency: string): Promise<number | null> {
  if (!fromCurrency || !toCurrency || fromCurrency === toCurrency) return null;
  try {
    const response = await fetch(`https://api.exchangerate-api.com/v4/latest/${fromCurrency}`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const data = await response.json();
    const rate = data.rates?.[toCurrency];
    if (typeof rate === "number" && rate > 0) {
      console.log(`[currency] ${fromCurrency} → ${toCurrency} = ${rate}`);
      return rate;
    }
    return null;
  } catch (e: any) {
    console.log(`[currency] Exchange rate fetch failed: ${e.message}`);
    return null;
  }
}

// --- Tool Definitions for Mistral Function Calling ---
const researchTools: MistralTool[] = [
  {
    type: "function",
    function: {
      name: "search_real_estate_data",
      description:
        "Search the web in real-time for current real estate data including property prices, rental rates, mortgage rates, taxes, and market trends for a specific location worldwide.",
      parameters: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: "The location to research (e.g., 'Austin, Texas, USA' or 'Lisbon, Portugal')",
          },
          is_non_resident: {
            type: "boolean",
            description: "Whether the prospective buyer is a non-resident/foreign buyer",
          },
        },
        required: ["location", "is_non_resident"],
      },
    },
  },
];

// --- Tool Executor ---
async function executeToolCall(
  toolCall: MistralToolCall,
  routeLog: (msg: string) => void
): Promise<string> {
  const { name, arguments: argsStr } = toolCall.function;
  const args = JSON.parse(argsStr);

  switch (name) {
    case "search_real_estate_data": {
      routeLog(`Tool: search_real_estate_data("${args.location}", nonResident=${args.is_non_resident})`);
      try {
        const result = await withTimeout(
          searchRealEstateData(args.location, args.is_non_resident === true),
          45000,
          "Perplexity search"
        );
        routeLog(`Tool result: Perplexity ${result.success ? "success" : "failed"}, ${result.text.length} chars, ${result.citations.length} citations`);
        if (!result.success || result.text.length < 50) {
          return JSON.stringify({ success: false, error: "No real-time data found for this location" });
        }
        return JSON.stringify({
          success: true,
          research_text: result.text,
          citations: result.citations,
          elapsed_ms: result.elapsedMs,
        });
      } catch (e: any) {
        routeLog(`Tool error: Perplexity failed: ${e.message}`);
        return JSON.stringify({ success: false, error: e.message });
      }
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // --- Main Research Endpoint (Agentic Pipeline with SSE Progress) ---
  app.post("/api/research-location", async (req, res) => {
    const routeStart = Date.now();
    const log = (msg: string) => {
      const elapsed = ((Date.now() - routeStart) / 1000).toFixed(1);
      console.log(`[research] [${elapsed}s] ${msg}`);
    };

    try {
      const { location, isNonResident } = req.body;

      if (!location || typeof location !== "string" || location.trim().length < 2) {
        return res.status(400).json({ message: "Please provide a valid location name" });
      }

      const locationTrimmed = location.trim();
      log(`Starting multi-agent research for "${locationTrimmed}" (nonResident=${isNonResident})`);

      // --- Demo Cache Bypass ---
      if (req.body.demo) {
        const cached = getDemoCacheResponse(locationTrimmed);
        if (cached) {
          log(`Demo cache HIT for "${locationTrimmed}"`);
          return res.json(cached);
        }
      }

      // --- SSE headers ---
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const sendStep = (agent: string, detail: string, meta?: Record<string, unknown>) => {
        res.write(`data: ${JSON.stringify({ type: "step", agent, detail, ...meta })}\n\n`);
      };

      // ==========================================
      // STEP 1: ROUTER AGENT (mistral-small)
      // ==========================================
      sendStep("router", `Analyzing query — ${locationTrimmed}...`);
      const routerResult = await routerClassifyQuery(locationTrimmed);

      // Use the router's extracted target location instead of raw query
      const searchLocation = routerResult.location || locationTrimmed;
      // Override isNonResident if router detected it from natural language
      const effectiveNonResident = routerResult.isNonResident || isNonResident === true;

      const routerDetail = [
        `${routerResult.queryType.replace(/_/g, " ")} in ${searchLocation}`,
        routerResult.country ? routerResult.country : "",
        effectiveNonResident ? "non-resident" : "resident",
        routerResult.simulationYears ? `${routerResult.simulationYears}yr sim` : "",
        routerResult.mortgageTermYears ? `${routerResult.mortgageTermYears}yr mortgage` : "",
        routerResult.downPaymentPercent ? `${routerResult.downPaymentPercent}% down` : "",
        routerResult.homePrice ? `budget ~${routerResult.userCurrency || ''}${(routerResult.homePrice / 1000000).toFixed(1)}M` : "",
        routerResult.monthlyRent ? `rent ~${routerResult.userCurrency || ''}${routerResult.monthlyRent.toLocaleString()}/mo` : "",
      ].filter(Boolean).join(" · ");
      sendStep("router", routerDetail, {
        elapsedMs: routerResult.elapsedMs,
        extractedLocation: searchLocation,
        isNonResident: effectiveNonResident,
        simulationYears: routerResult.simulationYears,
        mortgageTermYears: routerResult.mortgageTermYears,
        downPaymentPercent: routerResult.downPaymentPercent,
        homePrice: routerResult.homePrice,
        monthlyRent: routerResult.monthlyRent,
        fullScenario: routerResult.fullScenario,
      });

      // ==========================================
      // STEP 2: RESEARCHER AGENT (3 sources parallel)
      // ==========================================
      sendStep("researcher", `Searching 3 data sources in parallel...`);

      // Run ALL 3 sources in parallel using extracted location
      const [perplexitySettled, exaSettled, mistralWebSettled] = await Promise.allSettled([
        withTimeout(
          searchRealEstateData(searchLocation, effectiveNonResident),
          45000,
          "Perplexity"
        ),
        withTimeout(
          searchRealEstateExa(searchLocation, effectiveNonResident),
          15000,
          "Exa"
        ),
        withTimeout(
          mistralWebSearch(searchLocation),
          30000,
          "Mistral Web"
        ),
      ]);

      // Extract results with graceful fallbacks
      const perplexityData = perplexitySettled.status === "fulfilled" ? perplexitySettled.value : null;
      const exaData = exaSettled.status === "fulfilled" ? exaSettled.value : null;
      const mistralWebData = mistralWebSettled.status === "fulfilled" ? mistralWebSettled.value : null;

      const perplexityText = perplexityData?.success ? perplexityData.text : "";
      const perplexityCitations = perplexityData?.citations || [];
      const exaHighlights = exaData?.success ? exaData.highlights : "";
      const exaSources = exaData?.sources || [];
      const mistralWebText = mistralWebData?.success ? mistralWebData.text : "";

      // Stream source results (Mistral first — it's a Mistral hackathon!)
      const sourceSummaries: string[] = [];
      if (mistralWebData?.success) sourceSummaries.push(`Mistral Web ✓`);
      else sourceSummaries.push("Mistral Web ✗");
      if (perplexityData?.success) sourceSummaries.push(`Perplexity ✓ (${perplexityCitations.length} citations)`);
      else sourceSummaries.push("Perplexity ✗");
      if (exaData?.success) sourceSummaries.push(`Exa ✓ (${exaSources.length} results from ${exaSources.map(s => { try { return new URL(s.url).hostname; } catch { return s.url; } }).slice(0, 3).join(", ")})`);
      else if (!process.env.EXA_API_KEY) sourceSummaries.push("Exa — (no key)");
      else sourceSummaries.push("Exa ✗");

      const successCount = [mistralWebData?.success, perplexityData?.success, exaData?.success].filter(Boolean).length;
      sendStep("researcher", sourceSummaries.join(" · "), { sourceCount: successCount });

      // ==========================================
      // STEP 3: ANALYZER AGENT (cross-verify + structure)
      // ==========================================
      sendStep("analyzer", `Cross-verifying data from ${successCount} provider${successCount !== 1 ? "s" : ""}...`);

      // Build combined research text for structuring
      let combinedResearch = "";
      if (mistralWebText) {
        combinedResearch += `=== SOURCE 1: MISTRAL WEB SEARCH (built-in tool results) ===\n${mistralWebText}\n\n`;
      }
      if (perplexityText) {
        combinedResearch += `=== SOURCE 2: PERPLEXITY SONAR (synthesized answer) ===\n${perplexityText}\n`;
        if (perplexityCitations.length > 0) {
          combinedResearch += `Citations: ${perplexityCitations.join(", ")}\n\n`;
        }
      }
      if (exaHighlights) {
        combinedResearch += `=== SOURCE 3: EXA (domain-filtered raw content from ${exaSources.map(s => { try { return new URL(s.url).hostname; } catch { return s.url; } }).join(", ")}) ===\n${exaHighlights}\n\n`;
      }
      if (!combinedResearch) {
        combinedResearch = `No real-time data available. Use market knowledge for "${searchLocation}".`;
      }

      // Try agentic structuring first, then direct structuring as fallback
      let result;

      // First try: Mistral function calling (agentic pipeline)
      let toolCalls: MistralToolCall[] = [];
      let assistantMessage = "";
      try {
        const orchestration = await withTimeout(
          orchestrateResearch(searchLocation, effectiveNonResident, researchTools),
          15000,
          "Orchestration"
        );
        toolCalls = orchestration.toolCalls;
        assistantMessage = orchestration.assistantMessage;
        log(`Orchestrator requested ${toolCalls.length} tool call(s)`);
      } catch (e: any) {
        log(`Orchestration skipped (${e.message}), using direct structuring`);
      }

      if (toolCalls.length > 0) {
        // Build tool results from our already-collected data
        const toolResults = toolCalls.map(tc => ({
          toolCallId: tc.id,
          functionName: tc.function.name,
          result: JSON.stringify({
            success: !!perplexityText,
            research_text: combinedResearch,
            citations: [...perplexityCitations, ...exaSources.map(s => s.url)],
            elapsed_ms: perplexityData?.elapsedMs || 0,
          }),
        }));

        try {
          result = await withTimeout(
            completeResearchWithToolResults(searchLocation, effectiveNonResident, toolResults, toolCalls, assistantMessage),
            45000,
            "Agentic structuring"
          );
        } catch (e: any) {
          log(`Agentic structuring failed (${e.message}), falling back to direct`);
        }
      }

      // Fallback: Direct structuring with combined research
      if (!result) {
        result = await withTimeout(
          processLocationData(searchLocation, combinedResearch, effectiveNonResident),
          45000,
          "Direct structuring"
        );
      }

      // Attach citations from ALL sources
      const allCitations = [
        ...perplexityCitations,
        ...exaSources.map(s => s.url),
      ];
      if (allCitations.length > 0) {
        result.location.citations = allCitations;
        result.location.dataSource = `Multi-source research (${successCount} providers, ${allCitations.length} sources)`;
      }

      // Calculate confidence score
      const totalSources = allCitations.length;
      const confidence = Math.min(100, Math.round(
        (successCount / 3) * 50 +  // 50% weight: # of providers
        Math.min(totalSources, 10) * 5  // 50% weight: # of individual sources (capped at 10)
      ));

      const totalTime = ((Date.now() - routeStart) / 1000).toFixed(1);
      log(`Done in ${totalTime}s. ${successCount} sources. Confidence: ${confidence}%`);

      sendStep("analyzer", `Confidence ${confidence}% — ${totalSources} sources verified across ${successCount} providers`, { confidence });

      // --- Currency conversion: convert user-specified amounts to local currency ---
      let convertedHomePrice = routerResult.homePrice;
      let convertedMonthlyRent = routerResult.monthlyRent;
      const locationCurrency = result.location.currency;  // e.g. "IDR"
      const userCurrency = routerResult.userCurrency;      // e.g. "USD"

      if (userCurrency && locationCurrency && userCurrency !== locationCurrency && (convertedHomePrice || convertedMonthlyRent)) {
        const rate = await fetchExchangeRate(userCurrency, locationCurrency);
        if (rate) {
          if (convertedHomePrice) {
            const original = convertedHomePrice;
            convertedHomePrice = Math.round(convertedHomePrice * rate);
            log(`[currency] Home price: ${userCurrency} ${original.toLocaleString()} → ${locationCurrency} ${convertedHomePrice.toLocaleString()} (rate: ${rate})`);
          }
          if (convertedMonthlyRent) {
            const original = convertedMonthlyRent;
            convertedMonthlyRent = Math.round(convertedMonthlyRent * rate);
            log(`[currency] Monthly rent: ${userCurrency} ${original.toLocaleString()} → ${locationCurrency} ${convertedMonthlyRent.toLocaleString()} (rate: ${rate})`);
          }
          sendStep("analyzer", `Converted ${userCurrency} → ${locationCurrency} (rate: ${rate.toFixed(2)})`);
        } else {
          log(`[currency] Could not fetch rate for ${userCurrency} → ${locationCurrency}, using raw values`);
        }
      }

      // Final result
      sendStep("done", `Research complete — ${result.location.currencySymbol}${result.location.medianHomePrice.toLocaleString()} home, ${result.location.currencySymbol}${result.location.averageMonthlyRent.toLocaleString()}/mo rent`, { agentCount: 4, sourceCount: successCount, confidence });
      const resultMeta = { confidence, sourceCount: successCount, totalCitations: totalSources, elapsedMs: Date.now() - routeStart, simulationYears: routerResult.simulationYears, mortgageTermYears: routerResult.mortgageTermYears, downPaymentPercent: routerResult.downPaymentPercent, homePrice: convertedHomePrice, monthlyRent: convertedMonthlyRent, isNonResident: effectiveNonResident };
      log(`Sending result meta: ${JSON.stringify(resultMeta)}`);
      res.write(`data: ${JSON.stringify({ type: "result", data: { ...result, meta: resultMeta } })}\n\n`);
      res.end();
    } catch (e: any) {
      const totalTime = ((Date.now() - routeStart) / 1000).toFixed(1);
      console.error(`[research] Failed after ${totalTime}s:`, e.message);
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ type: "error", message: e.message || "Research failed" })}\n\n`);
        res.end();
      } else {
        return res.status(500).json({ message: e.message || "Failed to research location." });
      }
    }
  });

  // --- AI Advisor Streaming Endpoint (Ministral 8B via SSE) ---
  app.post("/api/analyze-results", async (req, res) => {
    const start = Date.now();
    try {
      const { location, params, simulationResult } = req.body;
      if (!location || !simulationResult) {
        return res.status(400).json({ message: "Missing location or simulation results" });
      }

      console.log(`[advisor] Streaming narration for ${location.name}...`);

      // SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      let fullText = "";
      await streamAdvisorNarration(
        location,
        simulationResult,
        params,
        (chunk) => {
          fullText += chunk;
          res.write(`data: ${JSON.stringify({ type: "chunk", text: chunk })}\n\n`);
        },
        () => {
          const elapsed = ((Date.now() - start) / 1000).toFixed(1);
          console.log(`[advisor] Done in ${elapsed}s, ${fullText.length} chars`);
          res.write(`data: ${JSON.stringify({ type: "done", elapsedMs: Date.now() - start })}\n\n`);
          res.end();
        },
        (err) => {
          console.error(`[advisor] Failed:`, err.message);
          res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
          res.end();
        }
      );
    } catch (e: any) {
      console.error(`[advisor] Failed:`, e.message);
      if (!res.headersSent) {
        return res.status(500).json({ message: "Could not generate analysis" });
      }
      res.end();
    }
  });

  // --- Advisor Follow-Up Chat (Ministral 8B via SSE) ---
  app.post("/api/advisor-chat", async (req, res) => {
    const start = Date.now();
    try {
      const { messages, locationContext } = req.body;
      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ message: "Missing messages" });
      }

      console.log(`[advisor-chat] Streaming response (${messages.length} messages)...`);

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      let fullText = "";
      await streamAdvisorChat(
        messages,
        locationContext || "",
        (chunk) => {
          fullText += chunk;
          res.write(`data: ${JSON.stringify({ type: "chunk", text: chunk })}\n\n`);
        },
        () => {
          const elapsed = ((Date.now() - start) / 1000).toFixed(1);
          console.log(`[advisor-chat] Done in ${elapsed}s, ${fullText.length} chars`);
          res.write(`data: ${JSON.stringify({ type: "done", elapsedMs: Date.now() - start })}\n\n`);
          res.end();
        },
        (err) => {
          console.error(`[advisor-chat] Failed:`, err.message);
          res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
          res.end();
        }
      );
    } catch (e: any) {
      console.error(`[advisor-chat] Failed:`, e.message);
      if (!res.headersSent) {
        return res.status(500).json({ message: "Chat failed" });
      }
      res.end();
    }
  });

  // --- Smart Voice Location Extraction ---
  app.post("/api/extract-location", async (req, res) => {
    try {
      const { text } = req.body;
      if (!text) return res.status(400).json({ message: "No text" });

      const apiKey = process.env.MISTRAL_API_KEY;
      if (!apiKey) return res.json({ location: text });

      const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "mistral-small-latest",
          messages: [
            { role: "system", content: "Extract ONLY the location/city name from the user's text. Return just the location name, nothing else. If no location is found, return the original text. Examples: 'I want to buy in Austin Texas' → 'Austin, Texas'. 'Can you check prices in Lisbon Portugal' → 'Lisbon, Portugal'. 'Tokyo' → 'Tokyo'." },
            { role: "user", content: text },
          ],
          temperature: 0,
          max_tokens: 50,
        }),
      });

      if (!response.ok) return res.json({ location: text });
      const data = await response.json();
      const extracted = data.choices?.[0]?.message?.content?.trim() || text;
      console.log(`[extract] "${text}" → "${extracted}"`);
      return res.json({ location: extracted });
    } catch {
      return res.json({ location: req.body.text });
    }
  });

  // --- Voice Transcription Endpoint (Voxtral) ---
  app.post("/api/transcribe", async (req, res) => {
    const start = Date.now();
    try {
      // Get raw audio data from request body
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }
      const audioBuffer = Buffer.concat(chunks);

      if (audioBuffer.length < 100) {
        return res.status(400).json({ message: "Audio too short or empty" });
      }

      const contentType = req.headers["content-type"] || "audio/webm";
      console.log(`[voxtral] Received ${audioBuffer.length} bytes (${contentType})`);

      const text = await transcribeAudio(audioBuffer, contentType);

      return res.json({
        text,
        model: "mistral-small-latest",
        elapsedMs: Date.now() - start,
      });
    } catch (e: any) {
      console.error(`[voxtral] Failed:`, e.message);
      return res.status(500).json({
        message: "Transcription failed",
        text: null,
      });
    }
  });

  // --- Property Search Endpoint (Find listings after simulation) ---
  app.post("/api/property-search", async (req, res) => {
    const { location, country, currency, currencySymbol, recommendation, homePrice, monthlyRent, isNonResident, fullScenario } = req.body;

    if (!location || !recommendation) {
      return res.status(400).json({ message: "Location and recommendation (buy/rent) required" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const sendStep = (agent: string, detail: string, meta?: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify({ type: "step", agent, detail, ...meta })}\n\n`);
    };

    try {
      const { searchProperties } = await import("./services/propertySearch");
      const result = await searchProperties({
        location: location || "",
        country: country || "",
        currency: currency || "USD",
        currencySymbol: currencySymbol || "$",
        recommendation: recommendation === "rent" ? "rent" : "buy",
        homePrice: homePrice || 500000,
        monthlyRent: monthlyRent || 2000,
        isNonResident: isNonResident === true,
        fullScenario: fullScenario || "",
      }, sendStep);

      res.write(`data: ${JSON.stringify({ type: "result", data: result })}\n\n`);
      res.end();
    } catch (e: any) {
      console.error(`[property-search] Failed:`, e.message);
      res.write(`data: ${JSON.stringify({ type: "error", message: e.message })}\n\n`);
      res.end();
    }
  });

  return httpServer;
}
