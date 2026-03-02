/**
 * Demo cache: pre-cached API responses for instant demo presentations.
 * Avoids the 15-45s API call latency during hackathon demos.
 *
 * Usage: POST /api/research-location with { location: "San Francisco", demo: true }
 * Or navigate to ?demo=sf to auto-load a cached location.
 */

import type { LocationResearchResult } from "@shared/schema";

const DEMO_LOCATIONS: Record<string, LocationResearchResult> = {
    "san francisco": {
        location: {
            id: "san-francisco-ca",
            name: "San Francisco, California",
            country: "United States",
            region: "California",
            currency: "USD",
            currencySymbol: "$",
            medianHomePrice: 1350000,
            averageMonthlyRent: 3200,
            priceToRentRatio: 35.2,
            description: "San Francisco is one of the most expensive housing markets in the US, driven by the tech industry. High demand, limited supply, and strict zoning laws keep prices elevated. The market has cooled slightly from its 2022 peak but remains among the nation's priciest.",
            dataSource: "Demo data (representative of Q1 2025 market conditions)",
            listingCount: 450,
            warnings: [
                "Extremely high price-to-rent ratio — historically favors renting",
                "Prop 13 limits property tax increases but starting rates are still significant",
                "Subject to earthquake risk — earthquake insurance is additional",
            ],
        },
        recommendedParams: {
            downPaymentPercent: 20,
            mortgageRate: 6.8,
            mortgageTermYears: 30,
            propertyTaxRate: 1.2,
            maintenanceRate: 1.0,
            insuranceRate: 0.35,
            rentGrowthMu: 3.5,
            rentGrowthSigma: 0.10,
            homeAppreciationMu: 4.5,
            homeAppreciationSigma: 0.14,
            investmentReturnMu: 8,
            investmentReturnSigma: 0.16,
            inflationRate: 3.2,
            purchaseTaxRate: 0.1,
            legalFeesPercent: 0.5,
            agencyFeePercent: 5,
            sellingTaxRate: 1,
            isNonResident: false,
            nonResidentExtraPercent: 0,
            correlationHomeRent: 0.55,
            correlationHomeInvestment: 0.35,
            correlationRentInvestment: 0.20,
        },
    },

    "london": {
        location: {
            id: "london-uk",
            name: "London, United Kingdom",
            country: "United Kingdom",
            region: "Greater London",
            currency: "GBP",
            currencySymbol: "£",
            medianHomePrice: 520000,
            averageMonthlyRent: 2100,
            priceToRentRatio: 20.6,
            description: "London remains one of Europe's most expensive property markets. Strong demand from domestic and international buyers, combined with limited housing stock, sustains high prices. Stamp duty and council tax add significant ongoing costs.",
            dataSource: "Demo data (representative of Q1 2025 market conditions)",
            listingCount: 800,
            warnings: [
                "Stamp duty can be 5-12% for higher-priced properties",
                "Non-UK residents face a 2% surcharge on stamp duty",
                "Leasehold properties common — check lease length and ground rent",
            ],
        },
        recommendedParams: {
            downPaymentPercent: 25,
            mortgageRate: 4.5,
            mortgageTermYears: 25,
            propertyTaxRate: 0.5,
            maintenanceRate: 1.0,
            insuranceRate: 0.3,
            rentGrowthMu: 3,
            rentGrowthSigma: 0.08,
            homeAppreciationMu: 3.5,
            homeAppreciationSigma: 0.10,
            investmentReturnMu: 7,
            investmentReturnSigma: 0.15,
            inflationRate: 3.5,
            purchaseTaxRate: 5,
            legalFeesPercent: 1.5,
            agencyFeePercent: 2,
            sellingTaxRate: 0,
            isNonResident: false,
            nonResidentExtraPercent: 2,
            correlationHomeRent: 0.50,
            correlationHomeInvestment: 0.30,
            correlationRentInvestment: 0.20,
        },
    },

    "tokyo": {
        location: {
            id: "tokyo-japan",
            name: "Tokyo, Japan",
            country: "Japan",
            region: "Kanto",
            currency: "JPY",
            currencySymbol: "¥",
            medianHomePrice: 85000000,
            averageMonthlyRent: 250000,
            priceToRentRatio: 28.3,
            description: "Tokyo offers a unique combination of ultra-low mortgage rates and steady but moderate appreciation. The market is mature and relatively stable compared to Western cities. Japan's population dynamics create long-term uncertainty, but central Tokyo remains in strong demand.",
            dataSource: "Demo data (representative of Q1 2025 market conditions)",
            listingCount: 1200,
            warnings: [
                "Extremely low mortgage rates (under 2%) — a major advantage for buyers",
                "Depreciation of building value is standard in Japan",
                "Properties typically lose building value over 20-30 years",
                "Land value tends to hold better than building value",
            ],
        },
        recommendedParams: {
            downPaymentPercent: 20,
            mortgageRate: 1.8,
            mortgageTermYears: 35,
            propertyTaxRate: 1.4,
            maintenanceRate: 1.5,
            insuranceRate: 0.3,
            rentGrowthMu: 2,
            rentGrowthSigma: 0.06,
            homeAppreciationMu: 3,
            homeAppreciationSigma: 0.08,
            investmentReturnMu: 6,
            investmentReturnSigma: 0.14,
            inflationRate: 2.5,
            purchaseTaxRate: 3,
            legalFeesPercent: 1,
            agencyFeePercent: 3,
            sellingTaxRate: 5,
            isNonResident: false,
            nonResidentExtraPercent: 0,
            correlationHomeRent: 0.45,
            correlationHomeInvestment: 0.25,
            correlationRentInvestment: 0.15,
        },
    },

    "bali": {
        location: {
            id: "bali-indonesia",
            name: "Bali, Indonesia",
            country: "Indonesia",
            region: "Bali",
            currency: "IDR",
            currencySymbol: "Rp",
            medianHomePrice: 3500000000,
            averageMonthlyRent: 15000000,
            priceToRentRatio: 19.4,
            description: "Bali has become a popular destination for remote workers and digital nomads. The property market is growing rapidly but regulations around foreign ownership remain complex. Most foreigners use leasehold arrangements.",
            dataSource: "Demo data (representative of Q1 2025 market conditions)",
            listingCount: 350,
            warnings: [
                "Foreigners cannot directly own freehold property — leasehold is standard",
                "Leasehold typically 25-30 years with extension options",
                "IDR is volatile — currency risk is significant for foreign buyers",
                "Property market is less regulated than developed markets",
            ],
        },
        recommendedParams: {
            downPaymentPercent: 30,
            mortgageRate: 9,
            mortgageTermYears: 20,
            propertyTaxRate: 0.5,
            maintenanceRate: 2,
            insuranceRate: 0.5,
            rentGrowthMu: 5,
            rentGrowthSigma: 0.15,
            homeAppreciationMu: 6,
            homeAppreciationSigma: 0.18,
            investmentReturnMu: 10,
            investmentReturnSigma: 0.20,
            inflationRate: 4,
            purchaseTaxRate: 5,
            legalFeesPercent: 2,
            agencyFeePercent: 5,
            sellingTaxRate: 5,
            isNonResident: true,
            nonResidentExtraPercent: 5,
            correlationHomeRent: 0.60,
            correlationHomeInvestment: 0.40,
            correlationRentInvestment: 0.25,
        },
    },
};

/**
 * Look up a demo location by query string (case-insensitive, partial match).
 */
export function getDemoCacheResponse(query: string): LocationResearchResult | null {
    const normalized = query.toLowerCase().trim();

    // Exact match first
    if (DEMO_LOCATIONS[normalized]) {
        return DEMO_LOCATIONS[normalized];
    }

    // Partial match (e.g., "san fran" matches "san francisco")
    for (const [key, value] of Object.entries(DEMO_LOCATIONS)) {
        if (key.includes(normalized) || normalized.includes(key)) {
            return value;
        }
    }

    return null;
}

/**
 * Get all available demo location names.
 */
export function getDemoLocationNames(): string[] {
    return Object.values(DEMO_LOCATIONS).map((l) => l.location.name);
}
