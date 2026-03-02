# Worldwide Rent vs Buy Calculator

## Overview
An AI-powered Monte Carlo simulation calculator for comparing renting vs. buying property anywhere in the world. Built for the **Mistral AI Hackathon** — Mistral AI powers the core intelligence (routing, structuring, web search, advising, and voice transcription), with Perplexity Sonar and Exa providing supplementary real-time data.

Users describe their scenario in natural language (e.g., *"I'm relocating to Geneva as a non-resident, budget $750K USD, 15-year mortgage, 25% down"*); the AI extracts all parameters, researches real estate data from 3 sources in parallel, auto-applies settings, runs a Monte Carlo simulation, and recommends real property listings.

## Architecture
- **Frontend**: React + TypeScript with Vite, shadcn/ui components, Recharts
- **Backend**: Express.js with three AI service integrations:
  - **Mistral AI** (`server/services/mistral.ts`): Core intelligence — smart router agent (scenario detection, parameter extraction, currency detection), data structuring (JSON mode), web search (via official SDK `@mistralai/mistralai`), and orchestration
  - **Perplexity Sonar** (`server/services/perplexity.ts`): Real-time web search for current property prices, rental rates, mortgage rates, taxes, and transaction costs with citations
  - **Exa** (`server/services/exa.ts`): Domain-filtered semantic search across 30+ trusted real estate portals worldwide with geographic-aware query tuning
  - **AI Advisor** (`server/services/advisor.ts`): Ministral 8B streaming financial advisor with follow-up chat
  - **Voxtral** (`server/services/voxtral.ts`): Voice-to-text transcription for spoken queries
  - **Property Search** (`server/services/propertySearch.ts`): Context-aware property finder (searches rentals if rent wins, for-sale if buy wins)
- **Simulation Engine**: Client-side Monte Carlo with:
  - Cholesky decomposition for correlated random variable generation
  - GBM paths for home prices, rent growth, and investment returns
  - Monthly time steps (360 per simulation)
  - NaN/overflow guards (clamp at 0.1x–5x initial)
  - Seeded PRNG for reproducible simulations

## AI Pipeline (4-Agent Architecture)
1. **Router Agent** (Mistral Small) — Analyzes natural language input, extracts 8 parameters:
   - Location, country, non-resident status
   - Simulation years, mortgage term, down payment %
   - Home price, monthly rent (with ranges → midpoint)
   - User's currency (for cross-currency conversion)
2. **Researcher Agent** (3 sources in parallel) — Mistral Web Search, Perplexity Sonar, Exa
3. **Analyzer Agent** (Mistral Large) — Cross-verifies data from all sources, structures into JSON, applies currency conversion via live exchange rates
4. **Advisor Agent** (Ministral 8B) — Streaming financial advice based on simulation results, with follow-up chat

## Smart Features
- **Natural Language Input**: Describe complex scenarios — AI extracts all financial parameters automatically
- **Cross-Currency Conversion**: Say "budget 750K USD" for a Tokyo search — auto-converts to JPY using live exchange rates
- **Non-Resident Detection**: Automatically detects foreign buyer status from context
- **Property Search**: After simulation, search for real listings matching your budget and the simulation's recommendation (rent vs buy)
- **Voice Input**: Speak your scenario via Voxtral transcription
- **Geographic-Aware Search**: Exa queries tuned with regional hints so local portals (bayut.com, propertyguru.com.sg, homegate.ch, etc.) surface for relevant locations

## Key Files
- `client/src/pages/Calculator.tsx` — Main page with location search, simulation, results, URL shareability, citations
- `client/src/components/LocationSearch.tsx` — Free-text location search with AI research
- `client/src/components/ParameterForm.tsx` — 4-tab form: Mortgage, Costs, Growth, Advanced
- `client/src/components/ResultsChart.tsx` — 4 charts: Projections, Breakeven, Outcomes, Sensitivity
- `client/src/components/ResultsSummary.tsx` — Summary cards with plain-language labels
- `client/src/components/AdvisorChat.tsx` — AI financial advisor with streaming + follow-up
- `client/src/components/PropertySearch.tsx` — Context-aware property finder with 3 AI sources
- `client/src/lib/simulation.ts` — Monte Carlo engine with Cholesky GBM
- `server/routes.ts` — All API endpoints (research, advisor, voice, property search)
- `server/services/mistral.ts` — Mistral AI integration (router, structurer, web search, orchestrator)
- `server/services/perplexity.ts` — Perplexity Sonar real-time web search
- `server/services/exa.ts` — Exa domain-filtered semantic search with geo-aware tuning
- `server/services/advisor.ts` — Ministral 8B streaming financial advisor
- `server/services/voxtral.ts` — Voxtral voice transcription
- `server/services/propertySearch.ts` — Multi-source property listing search

## Environment Variables
```
MISTRAL_API_KEY=     # Mistral AI — core intelligence (REQUIRED)
PERPLEXITY_API_KEY=  # Perplexity Sonar — real-time web research
EXA_API_KEY=         # Exa — domain-filtered property data
```

## API Endpoints
| Endpoint | Method | Description |
|---|---|---|
| `/api/research-location` | POST | Research location data (SSE stream with 4-agent pipeline) |
| `/api/analyze-results` | POST | AI financial advisor (SSE stream) |
| `/api/advisor-chat` | POST | Follow-up chat with advisor (SSE stream) |
| `/api/transcribe` | POST | Voxtral voice-to-text transcription |
| `/api/property-search` | POST | Context-aware property listings (SSE stream) |

## Running Locally
```bash
npm install
npm run dev      # Express + Vite dev server on port 5000
```

## Deploying to Production

### Option 1: Render.com (Recommended — free tier available)
1. Push code to GitHub
2. Go to [render.com](https://render.com) → New Web Service
3. Connect your GitHub repo
4. Settings:
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Environment**: Node
5. Add environment variables: `MISTRAL_API_KEY`, `PERPLEXITY_API_KEY`, `EXA_API_KEY`
6. Deploy

### Option 2: Railway.app
1. Push to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Railway auto-detects Node.js, uses `npm run build` and `npm start`
4. Add environment variables in the dashboard
5. Deploy — gets a public URL automatically

### Option 3: Vercel (with serverless functions)
> Note: This app uses Express SSE streaming, which works best on long-running servers (Render/Railway). Vercel serverless has a 10s timeout on free tier.

### Option 4: VPS (DigitalOcean, AWS EC2, etc.)
```bash
git clone <repo-url>
cd Rent-vs-Buy
npm install
npm run build
# Set environment variables
export MISTRAL_API_KEY=xxx
export PERPLEXITY_API_KEY=xxx
export EXA_API_KEY=xxx
npm start          # Runs production server on port 5000
```

## Simulation Features
- Correlated shocks via Cholesky decomposition of 3×3 correlation matrix
- GBM with drift-volatility parameterization for all stochastic variables
- Location-specific costs determined by real-time web research (purchase tax, legal fees, selling tax, agency fees)
- Non-resident buyer toggle with extra costs
- Breakeven requires 2+ consecutive positive years
- Sensitivity analysis (Tornado chart) via one-at-a-time variation
- Inflation-adjusted real terminal values
- Expected NPV differential discounted at 4%

## Shareability
- URL encoding with base64-encoded parameters + location data
- Seed lock toggle for reproducibility
- CSV and JSON export of results
