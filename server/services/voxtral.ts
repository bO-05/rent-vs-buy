/**
 * Voxtral voice transcription service.
 * Uses the Mistral chat completions API with audio input for transcription.
 */

export async function transcribeAudio(audioBuffer: Buffer, mimeType: string = "audio/webm"): Promise<string> {
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) throw new Error("MISTRAL_API_KEY not configured");

    const startTime = Date.now();
    console.log(`[voxtral] Starting transcription (${audioBuffer.length} bytes, ${mimeType})...`);

    // Convert audio buffer to base64 data URL
    const base64Audio = audioBuffer.toString("base64");
    const audioDataUrl = `data:${mimeType};base64,${base64Audio}`;

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
                            text: "Transcribe this audio exactly. Return ONLY the transcribed text, nothing else. If the audio mentions a location or place name, make sure to capture it accurately.",
                        },
                    ],
                },
            ],
            temperature: 0.1,
            max_tokens: 256,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        const elapsed = Date.now() - startTime;
        console.error(`[voxtral] API error ${response.status} after ${elapsed}ms: ${errorText.slice(0, 300)}`);
        throw new Error(`Transcription failed: ${response.status}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content?.trim() || "";
    const elapsed = Date.now() - startTime;
    console.log(`[voxtral] Transcribed in ${elapsed}ms: "${text.slice(0, 100)}"`);

    return text;
}
