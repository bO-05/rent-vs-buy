import { useState, useRef, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { InfoTip } from "@/components/InfoTip";
import { MapPin, Search, Globe, Loader2, AlertTriangle, X, Mic, MicOff } from "lucide-react";
import type { LocationResearchResult } from "@shared/schema";

interface LocationSearchProps {
  onLocationResearched: (result: LocationResearchResult) => void;
}

const PROGRESS_MESSAGES = [
  { at: 0, msg: "Searching the web for real estate data..." },
  { at: 5, msg: "Pulling current listings and prices..." },
  { at: 12, msg: "Gathering mortgage rates and taxes..." },
  { at: 20, msg: "Structuring market data..." },
  { at: 35, msg: "Analyzing local market conditions..." },
  { at: 50, msg: "Almost done..." },
];

const CLIENT_TIMEOUT_MS = 90000;

export function LocationSearch({ onLocationResearched }: LocationSearchProps) {
  const [query, setQuery] = useState("");
  const [isNonResident, setIsNonResident] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState("");
  const [progressSteps, setProgressSteps] = useState<{ agent: string; icon: string; detail: string; meta?: any }[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  const updateProgress = useCallback((seconds: number) => {
    let msg = PROGRESS_MESSAGES[0].msg;
    for (const p of PROGRESS_MESSAGES) {
      if (seconds >= p.at) msg = p.msg;
    }
    setProgressMessage(msg);
  }, []);

  const handleCancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsSearching(false);
    setProgressMessage("");
    setProgressSteps([]);
    setElapsedSeconds(0);
  }, []);

  const handleSearch = async () => {
    if (!query.trim() || query.trim().length < 2) return;

    setIsSearching(true);
    setError(null);
    setElapsedSeconds(0);
    setProgressMessage(PROGRESS_MESSAGES[0].msg);
    setProgressSteps([]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const timeoutId = setTimeout(() => {
      controller.abort();
    }, CLIENT_TIMEOUT_MS);

    let seconds = 0;
    timerRef.current = setInterval(() => {
      seconds++;
      setElapsedSeconds(seconds);
      updateProgress(seconds);
    }, 1000);

    try {
      const response = await fetch("/api/research-location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location: query.trim(), isNonResident }),
        signal: controller.signal,
      });

      // Check if SSE or JSON (demo cache returns JSON directly)
      const contentType = response.headers.get("content-type") || "";

      if (contentType.includes("text/event-stream")) {
        // SSE mode: read live progress steps
        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";
        let gotResult = false;

        const agentIcons: Record<string, string> = {
          router: "🧭",
          researcher: "🔍",
          analyzer: "📊",
          done: "✅",
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const parsed = JSON.parse(line.slice(6));
              if (parsed.type === "step") {
                const icon = agentIcons[parsed.agent] || "⏳";
                setProgressMessage(`${icon} ${parsed.detail}`);
                // Accumulate timeline steps
                setProgressSteps(prev => {
                  // Avoid duplicate consecutive steps from same agent
                  const last = prev[prev.length - 1];
                  if (last && last.agent === parsed.agent && last.detail === parsed.detail) return prev;
                  return [...prev, { agent: parsed.agent, icon, detail: parsed.detail, meta: parsed }];
                });
              } else if (parsed.type === "result") {
                gotResult = true;
                onLocationResearched(parsed.data);
              } else if (parsed.type === "error") {
                throw new Error(parsed.message);
              }
            } catch (parseErr: any) {
              if (parseErr.message && !parseErr.message.includes("JSON")) throw parseErr;
            }
          }
        }

        if (!gotResult) {
          throw new Error("Research completed but no data received. Please try again.");
        }
      } else {
        // JSON mode (demo cache)
        if (!response.ok) {
          const err = await response.json().catch(() => ({ message: "Something went wrong" }));
          throw new Error(err.message || `Server error ${response.status}`);
        }
        const result: LocationResearchResult = await response.json();
        onLocationResearched(result);
      }
    } catch (e: any) {
      if (e.name === "AbortError") {
        if (seconds >= CLIENT_TIMEOUT_MS / 1000 - 5) {
          setError("The search took too long. This can happen with uncommon locations. Try a well-known city or be more specific.");
        }
      } else if (e.message?.includes("NetworkError") || e.message?.includes("Failed to fetch")) {
        setError("Connection issue. Please check your internet connection and try again.");
      } else {
        setError(e.message || "Failed to research this location. Please try again.");
      }
    } finally {
      clearTimeout(timeoutId);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      abortControllerRef.current = null;
      setIsSearching(false);
      setProgressMessage("");
      setElapsedSeconds(0);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isSearching) {
      handleSearch();
    }
  };

  // --- Voice Recording ---
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        if (blob.size < 100) {
          setError("Recording too short. Please try again.");
          return;
        }
        setIsTranscribing(true);
        try {
          const resp = await fetch("/api/transcribe", {
            method: "POST",
            headers: { "Content-Type": "audio/webm" },
            body: blob,
          });
          const data = await resp.json();
          if (data.text) {
            // Smart extraction: pull just the location name from the transcribed sentence
            try {
              const extractResp = await fetch("/api/extract-location", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: data.text }),
              });
              const extractData = await extractResp.json();
              setQuery(extractData.location || data.text);
            } catch {
              setQuery(data.text);
            }
            setError(null);
          } else {
            setError("Could not understand the audio. Please try again or type.");
          }
        } catch {
          setError("Voice transcription failed. Please type your location.");
        } finally {
          setIsTranscribing(false);
        }
      };
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
      setError(null);
    } catch {
      setError("Microphone access denied. Please allow microphone and try again.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="location-search" className="text-sm font-medium text-muted-foreground mb-2 block">
          Type any location worldwide
        </Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="location-search"
              data-testid="input-location-search"
              placeholder="e.g. Austin, Texas or Lisbon, Portugal or Canggu, Bali..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="pl-10"
              disabled={isSearching}
            />
          </div>
          <Button
            onClick={handleSearch}
            disabled={isSearching || query.trim().length < 2}
            data-testid="button-search-location"
          >
            {isSearching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant={isRecording ? "destructive" : "outline"}
            size="icon"
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isSearching || isTranscribing}
            title={isRecording ? "Stop recording" : "Voice search (Voxtral)"}
            data-testid="button-voice-search"
          >
            {isTranscribing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isRecording ? (
              <MicOff className="h-4 w-4 animate-pulse" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-1.5">
          <Globe className="h-3.5 w-3.5 text-muted-foreground" />
          <Label className="text-xs font-medium">I'm a non-resident buyer</Label>
          <InfoTip text="Non-resident or foreign buyers often face extra taxes, ownership restrictions, or legal requirements depending on the country." />
        </div>
        <Switch
          data-testid="switch-non-resident"
          checked={isNonResident}
          onCheckedChange={setIsNonResident}
          disabled={isSearching}
        />
      </div>

      {isSearching && (
        <Card className="p-5">
          <div className="space-y-2">
            {/* Timeline of completed steps */}
            {progressSteps.map((step, i) => (
              <div key={i} className="flex items-start gap-2.5 text-xs">
                <span className="flex-shrink-0 mt-0.5">{step.icon}</span>
                <span className={`leading-relaxed ${i === progressSteps.length - 1 ? 'text-foreground font-medium' : 'text-muted-foreground'
                  }`}>{step.detail}</span>
              </div>
            ))}

            {/* Current loading indicator */}
            <div className="flex items-center gap-2.5 text-xs">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary flex-shrink-0" />
              <span className="text-muted-foreground">
                {elapsedSeconds}s elapsed
              </span>
            </div>
          </div>

          <div className="flex justify-end mt-3">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={handleCancel}
              data-testid="button-cancel-search"
            >
              <X className="h-3 w-3 mr-1" />
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {error && !isSearching && (
        <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20">
          <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs text-destructive font-medium">Could not research this location</p>
            <p className="text-xs text-destructive/80 mt-0.5">{error}</p>
            <p className="text-xs text-muted-foreground mt-1">Try being more specific (e.g. "Seminyak, Bali, Indonesia" instead of just "Bali")</p>
          </div>
        </div>
      )}

      {!isSearching && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
          <Card className="p-4 cursor-pointer hover-elevate" onClick={() => { setQuery("Austin, Texas, USA"); }} data-testid="card-suggestion-austin">
            <MapPin className="h-4 w-4 text-primary mx-auto mb-1" />
            <p className="text-xs font-medium">Austin, Texas</p>
            <p className="text-xs text-muted-foreground">USA</p>
          </Card>
          <Card className="p-4 cursor-pointer hover-elevate" onClick={() => { setQuery("Canggu, Bali, Indonesia"); }} data-testid="card-suggestion-bali">
            <MapPin className="h-4 w-4 text-primary mx-auto mb-1" />
            <p className="text-xs font-medium">Canggu, Bali</p>
            <p className="text-xs text-muted-foreground">Indonesia</p>
          </Card>
          <Card className="p-4 cursor-pointer hover-elevate" onClick={() => { setQuery("Lisbon, Portugal"); }} data-testid="card-suggestion-lisbon">
            <MapPin className="h-4 w-4 text-primary mx-auto mb-1" />
            <p className="text-xs font-medium">Lisbon</p>
            <p className="text-xs text-muted-foreground">Portugal</p>
          </Card>
        </div>
      )}
    </div>
  );
}
