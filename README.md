# PulseSearch

A small RAG (Retrieval-Augmented Generation) demo with real-time streaming and transparent diagnostics.

**Live demo:** (https://pulse-search-9gcwtxxn0-izonicy.vercel.app/)

## The idea

RAG is everywhere now but most tutorials hide the details. I wanted to build something where you can trace the full path: query comes in → chunks get retrieved → prompt gets assembled → tokens stream back. The whole app is under 200 lines of application code so nothing is hidden.

The pipeline:

1. You type a question
2. It searches a local knowledge base using lexical similarity scoring
3. The top chunks get bundled into a prompt
4. Response streams back token-by-token via SSE
5. A diagnostics panel shows you retrieval scores, latency, and which chunks were used

If you don't have an API key, it falls back to a deterministic local response generator so you can still test the full interaction loop.

## Run it

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

### Optional: API key for real LLM responses

Create `.env.local`:

```
OPENAI_API_KEY=sk-your-key-here
```

Without this it uses the local fallback mode.

## Structure

```
src/
├── app/
│   ├── page.tsx                # query input + streaming viewer + diagnostics
│   └── api/ask/route.ts        # POST handler: retrieval → LLM → SSE stream
├── lib/
│   └── retrieval.ts            # lexical scoring + top-k ranking
└── data/
    └── knowledgeBase.ts        # in-memory document store
```

## Stack

Next.js 15 App Router, TypeScript, OpenAI Node SDK. SSE streaming via Web ReadableStream. No vector database — the retrieval runs in-process on a local dataset.

## Design choices

- **SSE over WebSockets**: For one-directional token streaming, SSE is simpler and works through standard HTTP proxies. No extra dependencies.
- **No vector DB**: Eliminating Pinecone/Chroma/etc. makes this trivially runnable. The focus is on the RAG logic, not infrastructure.
- **Fallback mode**: The app should work without any external API calls. Makes development iteration faster.

## Validation

```bash
npm run lint
npm run build
```

## More docs

See `docs/` for deep dives on [retrieval](docs/retrieval.md), [streaming](docs/streaming.md), [performance](docs/perf.md), and [evaluation](docs/evaluation.md).
