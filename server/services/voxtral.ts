/**
 * Voxtral voice transcription service.
 * Uses pixtral-large-latest (multimodal) via raw fetch for audio transcription,
 * with fallback to /v1/audio/transcriptions endpoint.
 */

export async function transcribeAudio(audioBuffer: Buffer, mimeType: string = "audio/webm"): Promise<string> {
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) throw new Error("MISTRAL_API_KEY not configured");

    const startTime = Date.now();
    console.log(`[voxtral] Starting transcription (${audioBuffer.length} bytes, ${mimeType})...`);

    const base64Audio = audioBuffer.toString("base64");
    const audioDataUrl = `data:${mimeType};base64,${base64Audio}`;

    // Approach 1: pixtral-large-latest via chat completions (supports audio_url)
    try {
        const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: "pixtral-large-latest",
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "audio_url",
                                audio_url: { url: audioDataUrl },
                            },
                            {
                                type: "text",
                                text: "Transcribe this audio exactly. Return ONLY the transcribed text, nothing else. If the audio mentions a location or place name, make sure to capture it accurately.",
                            },
                        ],
                    },
                ],
                temperature: 0.1,
                max_tokens: 256,
            }),
        });

        if (response.ok) {
            const data = await response.json();
            const text = data.choices?.[0]?.message?.content?.trim() || "";
            const elapsed = Date.now() - startTime;
            console.log(`[voxtral] Transcribed via pixtral in ${elapsed}ms: "${text.slice(0, 100)}"`);
            return text;
        }

        const errorText = await response.text();
        console.error(`[voxtral] pixtral error ${response.status}: ${errorText.slice(0, 300)}`);
    } catch (e: any) {
        console.error(`[voxtral] pixtral attempt failed: ${e.message}`);
    }

    // Approach 2: Try voxtral-mini-latest with same format
    try {
        console.log(`[voxtral] Trying voxtral-mini-latest...`);
        const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: "voxtral-mini-latest",
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "audio_url",
                                audio_url: { url: audioDataUrl },
                            },
                            {
                                type: "text",
                                text: "Transcribe this audio exactly. Return ONLY the transcribed text.",
                            },
                        ],
                    },
                ],
                temperature: 0.1,
                max_tokens: 256,
            }),
        });

        if (response.ok) {
            const data = await response.json();
            const text = data.choices?.[0]?.message?.content?.trim() || "";
            const elapsed = Date.now() - startTime;
            console.log(`[voxtral] Transcribed via voxtral-mini in ${elapsed}ms: "${text.slice(0, 100)}"`);
            return text;
        }

        const errorText = await response.text();
        console.error(`[voxtral] voxtral-mini error ${response.status}: ${errorText.slice(0, 300)}`);
    } catch (e: any) {
        console.error(`[voxtral] voxtral-mini attempt failed: ${e.message}`);
    }

    // Approach 3: Try dedicated transcription endpoint with file upload
    try {
        console.log(`[voxtral] Trying /v1/audio/transcriptions endpoint...`);
        const blob = new Blob([audioBuffer], { type: mimeType });
        const formData = new FormData();
        formData.append("file", blob, `recording.${mimeType.split("/")[1] || "webm"}`);
        formData.append("model", "voxtral-mini-latest");

        const response = await fetch("https://api.mistral.ai/v1/audio/transcriptions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiKey}` },
            body: formData,
        });

        if (response.ok) {
            const data = await response.json();
            const text = data.text?.trim() || "";
            const elapsed = Date.now() - startTime;
            console.log(`[voxtral] Transcribed via audio endpoint in ${elapsed}ms: "${text.slice(0, 100)}"`);
            return text;
        }

        const errorText = await response.text();
        console.error(`[voxtral] audio endpoint error ${response.status}: ${errorText.slice(0, 300)}`);
    } catch (e: any) {
        console.error(`[voxtral] audio endpoint failed: ${e.message}`);
    }

    const elapsed = Date.now() - startTime;
    throw new Error(`All transcription approaches failed after ${elapsed}ms`);
}
