# ai-chatbot

A standalone AI chatbot service for PeoplePay360. This is a **separate codebase** — its own `package.json`, its own process, its own port — that talks to the main PeoplePay360 application only over HTTP. Nothing in here imports Prisma, touches PostgreSQL, runs SQL, or reaches outside this folder on the filesystem.

```
PeoplePay360 (unmodified)  <-- HTTP -->  ai-chatbot (this folder)  <-- HTTP -->  PeoplePay360 API
      (frontend)                                                                    (backend)
```

The main application works exactly the same whether this service is running, disabled, misconfigured, or deleted entirely.

## Status: scaffold with placeholders

This was built **before** being connected to the real PeoplePay360 project. Every place that needs to know a real API route, schema field name, or auth mechanism is marked `TODO(real-project)`. Search for that string to find every placeholder:

```
grep -rn "TODO(real-project)" .
```

The four files that matter once you connect the real project:

| File | What to change |
|---|---|
| [server/adapters/peoplepay360.adapter.js](server/adapters/peoplepay360.adapter.js) | `ENDPOINTS` map — real routes for employee/attendance/leave/payroll/contract data |
| [server/middleware/auth.js](server/middleware/auth.js) | How the host frontend's auth token/employee id is actually shaped |
| [server/tools/*.tools.js](server/tools) | Field names picked off each adapter response (`pickProfileFields`, `pickPayslipFields`, etc.) |
| [server/services/privacy.service.js](server/services/privacy.service.js) | `MASK_LAST4_PATTERN` / `DROP_PATTERN` — make sure they match the *real* sensitive field names in your schema (bank account, national ID, etc.) |

Everything else — provider abstraction, intent architecture, confirmation flow, privacy scrubbing, navigation registry — is structural and does not need to change.

## Running it standalone

```bash
cd ai-chatbot
npm install
cp .env.example .env   # fill in GEMINI_API_KEY and/or OLLAMA_* if you want live LLM calls
npm start               # http://localhost:4500
npm test                # 17 unit tests, no network required
```

With `AI_ENABLED=false` (the default with no `.env`), the service still boots and still answers registered quick actions/trigger-matched free text — it just can't do free-form LLM reasoning or phrase answers in natural language (see "Hardcoded-first, LLM-fallback" below).

## Architecture

```
User -> Chatbot UI -> POST /api/chat/message -> intent.service (trigger match, then LLM if needed)
                                               -> chat.service (routing + confirmation + privacy)
                                               -> tools/*.tools.js (one function per capability)
                                               -> adapters/peoplepay360.adapter.js (the only HTTP client to the main app)
                                               -> PeoplePay360 API -> existing services -> database
```

- **`ai/intents/intent-map.js`** — the single source of truth for every capability (domain → action). Nothing outside this file can register a new one. Also defines the A/B/C/D quick-action menus and which menu follows which action.
- **`server/services/intent.service.js`** — two-stage detection: (1) regex trigger match against intent-map, zero network calls, instant; (2) if nothing matches, ask the LLM to classify — but it can only return an actionId from the same registry, never invent one.
- **`server/services/chat.service.js`** — the orchestrator. Routes by confidence, enforces the confirm-before-mutate flow, and is the *only* place tools get invoked.
- **`server/tools/*.tools.js`** — one function per capability, each calling the adapter and returning only the minimal fields needed (data minimization).
- **`server/adapters/peoplepay360.adapter.js`** — the only file allowed to know PeoplePay360's real HTTP surface. Forwards the caller's own auth header; never authenticates on its own behalf.
- **`server/services/privacy.service.js`** — masks/drops sensitive fields, refuses credential-related requests before any LLM call, and does a final scrub on every outgoing payload and log line.
- **`server/providers/`** — `ai.provider.js` is the only entry point services use to call an LLM. It picks `AI_PROVIDER`, falls back to the other provider on failure, and never throws — callers always get `{ ok, text, providerUsed }` or a controlled failure.

## Hardcoded-first, LLM-fallback (quick actions)

Every A/B/C/D button maps to a real entry in `ACTIONS` (intent-map.js). Selecting one calls `handleQuickAction`, which goes straight to the registered tool — **no LLM call is required for this to work**. The LLM is only used afterward, to phrase the verified numbers in natural language (and that phrasing step itself degrades to a plain template if AI is disabled or every provider fails).

If a quick action or free-text message doesn't match anything in the registry, it falls through to `runGeneralLlm`, which is clearly flagged in the response (`verified: false`, sources mention "AI-generated / not verified").

## Confirmation flow for mutations

`LEAVE.create_leave_request` is the only mutating action registered. `chat.service` never lets the LLM execute it directly:

1. Validate required entities are present (asks a clarifying question if not).
2. Run a read-only pre-check (`validateLeaveRequest` — balance/date-range sanity).
3. Return a `CONFIRMATION` response with a short-lived `confirmationId`.
4. Only `POST /api/chat/confirm` with that exact id actually calls the write endpoint.

See the test `mutating action requires explicit confirmation before it is executed` in [tests/chat.service.test.js](tests/chat.service.test.js) for the full round-trip against a mocked backend.

## Privacy rules enforced in code (not just in this doc)

- `privacy.service.isCredentialRequest()` refuses password/OTP/token requests *before* intent detection or any LLM call runs.
- `privacy.service.maskSensitiveFields()` runs in the adapter (every response from the main API) and again in `response.service.build()` (every response leaving this service) — masks bank-account/national-ID-shaped fields to last-4, drops password/token/secret-shaped fields entirely.
- `privacy.service.redact()` scrubs secret-shaped values out of anything logged (`console.error` calls only ever log `redact(err.message)`, never a raw error/stack).
- Permission is never decided here: an upstream 401/403 from the adapter becomes a generic "you don't have access to this information" — no partial data, no explanation of why.
- Conversation context (`context.service.js`) stores only `{ lastIntent, lastAction, lastPeriod }` per conversation, in memory, with a TTL — never raw personal data.

## Integration with the main app (the one adapter you'll need there)

This folder needs **zero changes** to the existing PeoplePay360 codebase to run and be tested on its own. To actually surface it to users, the host frontend needs one small addition — not a refactor:

```jsx
// somewhere in the host app's root layout, e.g. App.jsx
import Chatbot from '<path-to>/ai-chatbot/client/Chatbot';

<Chatbot
  apiBaseUrl={process.env.REACT_APP_AI_CHATBOT_URL}   // e.g. http://localhost:4500
  getAuthContext={() => ({ token: getAuthToken(), employeeId: currentUser.id })}
  onNavigate={(path) => navigate(path)}
/>
```

`Chatbot.jsx` calls `GET /api/chat/status` on mount; if the service is unreachable it renders nothing, so a down/misconfigured chatbot is invisible to end users rather than broken. If you're not using React on the host side, `client/api.js` is a framework-agnostic fetch wrapper you can call from anywhere.

On the backend side, no new route needs to exist on the main app **unless** its current auth token isn't forwardable as a plain `Authorization` header to another service (e.g. it's an httpOnly cookie). If so, the one legitimate "small integration adapter" mentioned in the spec would be a single route on the main app that mints a short-lived, chatbot-scoped token the frontend can pass along instead — nothing more.

## Test cases covered

`npm test` covers: credential refusal, AI-disabled degradation, a full quick-action round trip through a mocked backend, permission-denied handling, and the confirm-before-mutate flow. See [tests/](tests/) for all 17 cases. Cases that need a live Gemini/Ollama key (fallback-between-providers, general HR Q&A) aren't exercised by the automated suite — try them manually once `GEMINI_API_KEY` or `OLLAMA_BASE_URL` is set.
