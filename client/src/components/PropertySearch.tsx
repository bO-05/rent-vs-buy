import { useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Search,
    Home,
    Building,
    ExternalLink,
    Loader2,
    Sparkles,
    MapPin,
    X,
    ChevronDown,
    ChevronUp,
} from "lucide-react";

interface PropertyListing {
    title: string;
    price: string;
    url: string;
    snippet: string;
    source: "mistral" | "perplexity" | "exa";
    type: "sale" | "rental" | "unknown";
}

interface PropertySearchProps {
    location: string;
    country: string;
    currency: string;
    currencySymbol: string;
    recommendation: "buy" | "rent";
    homePrice: number;
    monthlyRent: number;
    isNonResident: boolean;
    fullScenario?: string;
}

const SOURCE_COLORS: Record<string, string> = {
    mistral: "bg-orange-100 text-orange-800 border-orange-200",
    perplexity: "bg-blue-100 text-blue-800 border-blue-200",
    exa: "bg-purple-100 text-purple-800 border-purple-200",
};

const SOURCE_LABELS: Record<string, string> = {
    mistral: "Mistral AI",
    perplexity: "Perplexity",
    exa: "Exa",
};

export function PropertySearch({
    location,
    country,
    currency,
    currencySymbol,
    recommendation,
    homePrice,
    monthlyRent,
    isNonResident,
    fullScenario,
}: PropertySearchProps) {
    const [isSearching, setIsSearching] = useState(false);
    const [listings, setListings] = useState<PropertyListing[]>([]);
    const [summary, setSummary] = useState("");
    const [hasSearched, setHasSearched] = useState(false);
    const [steps, setSteps] = useState<{ agent: string; detail: string }[]>([]);
    const [expanded, setExpanded] = useState(true);
    const [error, setError] = useState("");

    const isRent = recommendation === "rent";
    const searchLabel = isRent ? "Rental Listings" : "Properties for Sale";
    const searchIcon = isRent ? Building : Home;
    const SearchIcon = searchIcon;

    const handleSearch = useCallback(async () => {
        setIsSearching(true);
        setListings([]);
        setSummary("");
        setSteps([]);
        setError("");
        setHasSearched(true);
        setExpanded(true);

        try {
            const response = await fetch("/api/property-search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    location,
                    country,
                    currency,
                    currencySymbol,
                    recommendation,
                    homePrice,
                    monthlyRent,
                    isNonResident,
                    fullScenario: fullScenario || "",
                }),
            });

            if (!response.ok) {
                throw new Error("Property search failed");
            }

            const reader = response.body?.getReader();
            if (!reader) throw new Error("No response stream");

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
                        if (parsed.type === "step") {
                            setSteps((prev) => [...prev, { agent: parsed.agent, detail: parsed.detail }]);
                        } else if (parsed.type === "result") {
                            setListings(parsed.data.listings || []);
                            setSummary(parsed.data.summary || "");
                        } else if (parsed.type === "error") {
                            setError(parsed.message);
                        }
                    } catch { }
                }
            }
        } catch (e: any) {
            setError(e.message || "Search failed");
        } finally {
            setIsSearching(false);
        }
    }, [location, country, currency, currencySymbol, recommendation, homePrice, monthlyRent, isNonResident, fullScenario]);

    return (
        <Card className="overflow-hidden">
            {/* Header */}
            <div
                className="p-4 flex items-center justify-between cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => hasSearched && setExpanded(!expanded)}
            >
                <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <h3 className="font-semibold text-sm">
                        {hasSearched ? searchLabel : `Find ${searchLabel} in ${location}`}
                    </h3>
                    {hasSearched && listings.length > 0 && (
                        <Badge variant="secondary" className="text-xs">
                            {listings.length} found
                        </Badge>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {!hasSearched && (
                        <Button
                            size="sm"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleSearch();
                            }}
                            disabled={isSearching}
                            className="gap-1.5"
                        >
                            {isSearching ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Search className="h-3.5 w-3.5" />
                            )}
                            {isSearching ? "Searching..." : `Search with AI`}
                        </Button>
                    )}
                    {hasSearched && (
                        <>
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleSearch();
                                }}
                                disabled={isSearching}
                                className="gap-1 text-xs"
                            >
                                {isSearching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                                Refresh
                            </Button>
                            {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                        </>
                    )}
                </div>
            </div>

            {/* Progress steps */}
            {isSearching && steps.length > 0 && (
                <div className="px-4 pb-3 space-y-1">
                    {steps.map((s, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="text-primary">●</span>
                            <span>{s.detail}</span>
                        </div>
                    ))}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground animate-pulse">
                        <Loader2 className="h-3 w-3 animate-spin text-primary" />
                        <span>Searching...</span>
                    </div>
                </div>
            )}

            {/* Results */}
            {expanded && hasSearched && !isSearching && (
                <div className="border-t">
                    {error && (
                        <div className="p-4 text-sm text-destructive flex items-center gap-2">
                            <X className="h-4 w-4" />
                            {error}
                        </div>
                    )}

                    {summary && (
                        <div className="px-4 pt-3 pb-2">
                            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                                <MapPin className="h-3 w-3" />
                                {summary}
                            </p>
                        </div>
                    )}

                    {listings.length > 0 ? (
                        <div className="p-4 pt-2 grid gap-3">
                            {listings.map((listing, i) => (
                                <div
                                    key={i}
                                    className="group flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
                                >
                                    {/* Icon */}
                                    <div className={`mt-0.5 p-2 rounded-md ${isRent ? "bg-chart-2/10" : "bg-primary/10"}`}>
                                        <SearchIcon className={`h-4 w-4 ${isRent ? "text-chart-2" : "text-primary"}`} />
                                    </div>

                                    {/* Content */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <h4 className="text-sm font-medium leading-tight truncate">
                                                    {listing.title}
                                                </h4>
                                                <p className="text-sm font-bold text-primary mt-0.5">
                                                    {listing.price}
                                                </p>
                                            </div>
                                            <Badge
                                                variant="outline"
                                                className={`shrink-0 text-[10px] ${SOURCE_COLORS[listing.source] || ""}`}
                                            >
                                                {SOURCE_LABELS[listing.source] || listing.source}
                                            </Badge>
                                        </div>

                                        {listing.snippet && (
                                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                                {listing.snippet}
                                            </p>
                                        )}

                                        {listing.url && (
                                            <a
                                                href={listing.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1.5"
                                            >
                                                <ExternalLink className="h-3 w-3" />
                                                View listing
                                            </a>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        !error && (
                            <div className="p-6 text-center text-sm text-muted-foreground">
                                <SearchIcon className="h-8 w-8 mx-auto mb-2 opacity-30" />
                                <p>No specific listings found for your criteria.</p>
                                <p className="text-xs mt-1">Try searching on local property portals for {location}.</p>
                            </div>
                        )
                    )}

                    {/* Powered by footer */}
                    <div className="px-4 pb-3 pt-1">
                        <p className="text-[10px] text-muted-foreground text-center">
                            Powered by Mistral AI · Perplexity · Exa — results may not reflect current availability
                        </p>
                    </div>
                </div>
            )}
        </Card>
    );
}
