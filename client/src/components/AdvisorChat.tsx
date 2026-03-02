import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageSquareText, Send, Loader2, User, Bot, AlertCircle } from "lucide-react";
import type { LocationData, SimulationResult, SimulationInput } from "@shared/schema";

interface ChatMessage {
    role: "user" | "assistant";
    content: string;
}

interface AdvisorChatProps {
    location: LocationData;
    simulationResult: SimulationResult;
    params: SimulationInput;
    currencySymbol: string;
}

function stripMarkdown(text: string): string {
    return text
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/\*(.+?)\*/g, "$1")
        .replace(/^#+\s*/gm, "")
        .replace(/^[-•]\s*/gm, "")
        .replace(/`(.+?)`/g, "$1")
        .trim();
}

export function AdvisorChat({ location, simulationResult, params, currencySymbol }: AdvisorChatProps) {
    const [streamedText, setStreamedText] = useState("");
    const [isStreaming, setIsStreaming] = useState(false);
    const [initialDone, setInitialDone] = useState(false);
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [chatInput, setChatInput] = useState("");
    const [isTyping, setIsTyping] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const hasStarted = useRef(false);

    // Track which params the initial narration was based on
    const initialParamsRef = useRef({ mortgageRate: params.mortgageRate, downPaymentPercent: params.downPaymentPercent });
    const paramsDrifted = initialDone && (
        params.mortgageRate !== initialParamsRef.current.mortgageRate ||
        params.downPaymentPercent !== initialParamsRef.current.downPaymentPercent
    );

    // Build context string for follow-up chat
    const locationContext = `Location: ${location.name}, ${location.country}
Currency: ${currencySymbol}
Home price: ${currencySymbol}${params.homePrice.toLocaleString()}
Monthly rent: ${currencySymbol}${params.monthlyRent.toLocaleString()}
Down payment: ${params.downPaymentPercent}%
Mortgage rate: ${params.mortgageRate}%
Buying wins: ${simulationResult.buyWinsProbability.toFixed(1)}% of scenarios
Breakeven: Year ${simulationResult.breakEvenYear ?? "Never"}
Buyer wealth (30yr): ${currencySymbol}${Math.round(simulationResult.finalBuyMedian).toLocaleString()}
Renter wealth (30yr): ${currencySymbol}${Math.round(simulationResult.finalRentMedian).toLocaleString()}
Net advantage: ${currencySymbol}${Math.round(simulationResult.expectedNpvDifferential).toLocaleString()}`;

    // Auto-scroll
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [streamedText, chatMessages, isTyping]);

    // Stream initial analysis
    useEffect(() => {
        if (hasStarted.current) return;
        hasStarted.current = true;

        const abortController = new AbortController();
        setIsStreaming(true);
        setStreamedText("");

        fetch("/api/analyze-results", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                location,
                params: {
                    homePrice: params.homePrice,
                    monthlyRent: params.monthlyRent,
                    downPaymentPercent: params.downPaymentPercent,
                    mortgageRate: params.mortgageRate,
                    mortgageTermYears: params.mortgageTermYears,
                },
                simulationResult: {
                    buyWinsProbability: simulationResult.buyWinsProbability,
                    breakEvenYear: simulationResult.breakEvenYear,
                    breakEvenOptimistic: simulationResult.breakEvenOptimistic,
                    breakEvenPessimistic: simulationResult.breakEvenPessimistic,
                    buyWins10yr: simulationResult.buyWins10yr,
                    finalBuyMedian: simulationResult.finalBuyMedian,
                    finalRentMedian: simulationResult.finalRentMedian,
                    finalDifferenceMedian: simulationResult.finalDifferenceMedian,
                    expectedNpvDifferential: simulationResult.expectedNpvDifferential,
                    sensitivityData: simulationResult.sensitivityData,
                },
            }),
            signal: abortController.signal,
        })
            .then(async (response) => {
                const reader = response.body?.getReader();
                if (!reader) return;

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
                        try {
                            const parsed = JSON.parse(line.slice(6));
                            if (parsed.type === "chunk") {
                                setStreamedText((prev) => prev + parsed.text);
                            } else if (parsed.type === "done") {
                                setIsStreaming(false);
                                setInitialDone(true);
                            }
                        } catch { }
                    }
                }
                setIsStreaming(false);
                setInitialDone(true);
            })
            .catch(() => {
                setIsStreaming(false);
                setInitialDone(true);
            });

        return () => abortController.abort();
    }, []);

    // Send follow-up chat message
    const sendMessage = useCallback(async () => {
        const text = chatInput.trim();
        if (!text || isTyping) return;

        setChatInput("");
        const userMsg: ChatMessage = { role: "user", content: text };
        const allMessages = [...chatMessages, userMsg];
        setChatMessages(allMessages);
        setIsTyping(true);

        // Include the initial narration as context
        const messagesForApi = [
            { role: "assistant", content: stripMarkdown(streamedText) },
            ...allMessages.map((m) => ({ role: m.role, content: m.content })),
        ];

        try {
            const response = await fetch("/api/advisor-chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    messages: messagesForApi,
                    locationContext,
                }),
            });

            const reader = response.body?.getReader();
            if (!reader) { setIsTyping(false); return; }

            const decoder = new TextDecoder();
            let buffer = "";
            let assistantText = "";

            // Add empty assistant message to fill
            setChatMessages((prev) => [...prev, { role: "assistant", content: "" }]);

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
                        if (parsed.type === "chunk") {
                            assistantText += parsed.text;
                            const current = assistantText;
                            setChatMessages((prev) => {
                                const copy = [...prev];
                                copy[copy.length - 1] = { role: "assistant", content: current };
                                return copy;
                            });
                        }
                    } catch { }
                }
            }
            setIsTyping(false);
        } catch {
            setChatMessages((prev) => [
                ...prev,
                { role: "assistant", content: "Sorry, I couldn't process that. Please try again." },
            ]);
            setIsTyping(false);
        }
    }, [chatInput, chatMessages, isTyping, streamedText, locationContext]);

    return (
        <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 via-transparent to-transparent animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="p-4 pb-3 border-b border-border/50">
                <div className="flex items-center gap-2">
                    <MessageSquareText className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">AI Financial Advisor</h3>
                    <span className="text-xs text-muted-foreground ml-auto">Ministral 8B</span>
                </div>
            </div>

            <div ref={scrollRef} className="max-h-[400px] overflow-y-auto p-4 space-y-4">
                {/* Initial Narration (streamed) */}
                {(streamedText || isStreaming) && (
                    <div className="flex gap-3">
                        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">
                            <Bot className="h-3.5 w-3.5 text-primary" />
                        </div>
                        <div className="flex-1">
                            {/* Verdict Badge */}
                            {initialDone && (() => {
                                const prob = simulationResult.buyWinsProbability;
                                const diff = Math.abs(Math.round(simulationResult.expectedNpvDifferential));
                                const fmtDiff = `${currencySymbol}${diff.toLocaleString()}`;
                                if (prob > 60) return (
                                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-600 mb-2">
                                        🔵 BUY WINS — Save {fmtDiff} over 30 years
                                    </div>
                                );
                                if (prob < 40) return (
                                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 mb-2">
                                        🟢 RENT WINS — Save {fmtDiff} over 30 years
                                    </div>
                                );
                                return (
                                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-600 mb-2">
                                        🟡 TOO CLOSE — Difference is only {fmtDiff}
                                    </div>
                                );
                            })()}
                            <p className="text-sm leading-relaxed text-foreground/90">
                                {stripMarkdown(streamedText)}
                                {isStreaming && <span className="inline-block w-1.5 h-4 bg-primary/60 ml-0.5 animate-pulse" />}
                            </p>
                        </div>
                    </div>
                )}

                {/* Drift warning when What-If sliders changed params */}
                {paramsDrifted && chatMessages.length === 0 && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 text-xs text-muted-foreground">
                        <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                        Parameters changed — try asking below for updated analysis
                    </div>
                )}

                {/* Follow-up Chat Messages */}
                {chatMessages.map((msg, i) => (
                    <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}>
                        {msg.role === "assistant" && (
                            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">
                                <Bot className="h-3.5 w-3.5 text-primary" />
                            </div>
                        )}
                        <div
                            className={`text-sm leading-relaxed max-w-[85%] ${msg.role === "user"
                                ? "bg-primary text-primary-foreground px-3 py-2 rounded-2xl rounded-br-sm"
                                : "text-foreground/90"
                                }`}
                        >
                            {msg.role === "assistant" ? stripMarkdown(msg.content) : msg.content}
                            {msg.role === "assistant" && isTyping && i === chatMessages.length - 1 && (
                                <span className="inline-block w-1.5 h-4 bg-primary/60 ml-0.5 animate-pulse" />
                            )}
                        </div>
                        {msg.role === "user" && (
                            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-muted flex items-center justify-center mt-0.5">
                                <User className="h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Chat Input */}
            {initialDone && (
                <div className="p-3 pt-0">
                    <div className="flex gap-2">
                        <Input
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
                            placeholder="Ask a follow-up: 'What if rates drop to 5%?'"
                            disabled={isTyping}
                            className="text-sm"
                            data-testid="input-advisor-chat"
                        />
                        <Button
                            size="icon"
                            onClick={sendMessage}
                            disabled={!chatInput.trim() || isTyping}
                            data-testid="button-advisor-send"
                        >
                            {isTyping ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Send className="h-4 w-4" />
                            )}
                        </Button>
                    </div>
                </div>
            )}
        </Card>
    );
}
