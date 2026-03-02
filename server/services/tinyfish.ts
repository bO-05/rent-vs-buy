export interface ScrapedListingData {
  rawText: string;
  success: boolean;
  elapsedMs: number;
}

async function parseSSEStream(response: Response, timeoutMs: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body reader available");

  const decoder = new TextDecoder();
  let resultData = "";
  let allText = "";
  let lineBuffer = "";
  const startTime = Date.now();

  try {
    while (true) {
      if (Date.now() - startTime > timeoutMs) {
        reader.cancel();
        console.log(`[tinyfish] SSE stream reading timed out after ${timeoutMs}ms`);
        break;
      }

      const readPromise = reader.read();
      const timeoutPromise = new Promise<{ done: true; value: undefined }>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), Math.max(1000, timeoutMs - (Date.now() - startTime)))
      );

      const { done, value } = await Promise.race([readPromise, timeoutPromise]);
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      allText += chunk;
      lineBuffer += chunk;

      const parts = lineBuffer.split("\n");
      lineBuffer = parts.pop() || "";

      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const jsonStr = trimmed.slice(6).trim();
        if (!jsonStr || jsonStr === "[DONE]") continue;

        try {
          const data = JSON.parse(jsonStr);

          if (data.type === "COMPLETE" && data.status === "COMPLETED") {
            console.log(`[tinyfish] Got COMPLETE event`);
            if (data.resultJson) {
              resultData = typeof data.resultJson === "string"
                ? data.resultJson
                : JSON.stringify(data.resultJson);
            } else if (data.result) {
              resultData = typeof data.result === "string"
                ? data.result
                : JSON.stringify(data.result);
            }
          }

          if (data.type === "ERROR") {
            console.log(`[tinyfish] Got ERROR event: ${JSON.stringify(data).slice(0, 300)}`);
          }
        } catch {}
      }
    }
  } catch (e: any) {
    console.log(`[tinyfish] Stream error: ${e.message}`);
  } finally {
    try { reader.cancel(); } catch {}
  }

  return resultData || allText;
}

export async function scrapeListings(location: string): Promise<ScrapedListingData> {
  const apiKey = process.env.TINYFISH_API_KEY;
  if (!apiKey) throw new Error("TINYFISH_API_KEY not configured");

  const startTime = Date.now();
  console.log(`[tinyfish] Starting scrape for "${location}"`);

  const goal = `Find real estate data for "${location}". I need:
1. Current home/property sale prices (at least 5-10 listing prices if available)
2. Current monthly rental prices (at least 5-10 rental prices if available)
3. The currency used in this market

Return the data as JSON with this exact format:
{
  "location": "${location}",
  "currency": "USD or local currency code",
  "sale_listings": [{"price": number, "description": "brief description"}],
  "rental_listings": [{"monthly_price": number, "description": "brief description"}],
  "median_sale_price": number or null,
  "average_monthly_rent": number or null,
  "total_listings_found": number
}`;

  const TIMEOUT_MS = 90000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.log(`[tinyfish] Aborting after ${TIMEOUT_MS}ms timeout`);
    controller.abort();
  }, TIMEOUT_MS);

  try {
    const response = await fetch("https://agent.tinyfish.ai/v1/automation/run-sse", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({
        url: `https://www.google.com/search?q=${encodeURIComponent(`${location} homes for sale and rent prices`)}`,
        goal,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      const elapsed = Date.now() - startTime;
      console.log(`[tinyfish] API error ${response.status} after ${elapsed}ms: ${errorText.slice(0, 200)}`);
      return { rawText: `TinyFish API error ${response.status}: ${errorText.slice(0, 500)}`, success: false, elapsedMs: elapsed };
    }

    console.log(`[tinyfish] Got response, parsing SSE stream...`);
    const rawText = await parseSSEStream(response, TIMEOUT_MS - (Date.now() - startTime));
    const elapsed = Date.now() - startTime;
    console.log(`[tinyfish] Completed in ${elapsed}ms, got ${rawText.length} chars`);

    return { rawText, success: rawText.length > 10, elapsedMs: elapsed };
  } catch (e: any) {
    clearTimeout(timeoutId);
    const elapsed = Date.now() - startTime;

    if (e.name === "AbortError") {
      console.log(`[tinyfish] Request aborted (timeout) after ${elapsed}ms`);
      return { rawText: `TinyFish request timed out after ${TIMEOUT_MS / 1000}s`, success: false, elapsedMs: elapsed };
    }

    console.log(`[tinyfish] Error after ${elapsed}ms: ${e.message}`);
    return { rawText: `TinyFish error: ${e.message}`, success: false, elapsedMs: elapsed };
  }
}
