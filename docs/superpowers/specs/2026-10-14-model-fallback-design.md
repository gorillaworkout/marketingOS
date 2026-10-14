# Automatic LLM model fallback — design

Date: 2026-10-14
Status: Approved

## Problem

Every LLM call in MarketingOS goes through the 9router/llmdupoin gateway with
exactly one model. When that model is down (a 503 or 5xx, a timeout, an empty
reply, a dropped stream), the feature fails for the user. One example:
`ag/gemini-3.1-pro-low`, the hardcoded Event Plan default, answers 503.

## Model selection (verified)

`src/lib/model-routing.ts` → `resolveFeatureModel(userId, feature)` returns the user's
`task_model_preferences` row if it is allowed. Otherwise it returns the
`feature_model_assignments.default_model` row, or the hardcoded
`DEFAULT_FEATURE_ASSIGNMENTS` when no row exists (around line 76). The fallback
runs after that. The chosen model always comes first.

## Behaviour

1. **Scope.** Every LLM-calling feature uses this behavior.
   - Non-streaming calls go through `callApi` in `src/lib/openai.ts`. This covers
     Event Plan, Social Post, Video Script, FAQ Ask (`internal-docs`), Article
     Market News, Market Research, knowledge analysis, chat import, AI Research
     memory, and so on.
   - Streaming calls are the AI Research chat (fast and deep) in
     `src/app/api/ai-research/chat/route.ts`.
2. **Order.** The chosen model runs first. After it come `cc/claude-sonnet-5-5`,
   `cx/gpt-5.6-sol`, `ag/gemini-3-flash`, and `cc/claude-opus-5-5`, without
   duplicates and skipping any model that already failed in this request
   (`buildFallbackChain`).
3. **Failure before any tokens.** A network error, a non-2xx status, a timeout, or an
   empty reply sends the request to the next model with the same messages. The
   timeout is 150 s for non-streaming calls and 60 s to the first token for
   streaming calls. The user sees no error.
4. **Failure mid-stream.** A dropped connection or a stall of 60 s or more
   between chunks sends the request to the next model. It gets the original
   messages, then the partial assistant text as an `assistant` message, then a
   `user` instruction. The instruction tells the model to continue from exactly
   where the text stopped, without repeating it and without a preamble. It also
   quotes the last 200 characters of the partial text. The new model's tokens go
   to the same SSE stream, and the stored answer is the joined text. Usage from
   all attempts is merged.
5. **UI label.** A small English note appears under the answer:
   - `Continued by GPT-5.6 Sol after Claude Sonnet 5.5 failed` when any switch
     happened after text had arrived.
   - `Answered by GPT-5.6 Sol (Claude Sonnet 5.5 unavailable)` when every switch
     happened before any text.

   AI Research gets the label from the `done` event (`fallbackLabel`,
   `answeredBy`) and stores it on the assistant message, so it is still there
   after a reload. Event Plan, Social Post, and FAQ Ask show it from their final
   result. The `done` event's `model` stays as the user's chosen model so the
   model selector does not jump.
6. **Admin log.** Every switch writes a row to `model_fallback_events` (migration
   `031_model_fallback_events.sql`) with the feature, failed model, error
   (truncated to 1,000 characters), fallback model, `after_partial`, user, and time.
   Admins read the log at `GET /api/admin/model-fallbacks?limit=100`. A failure
   to log never breaks the user's request.
7. **Errors.** The user sees an error only when every model in the chain fails
   (`AllModelsFailedError`). A user abort (Stop) is final and never falls back.
8. **Event Plan default.** The hardcoded default changes from
   `ag/gemini-3.1-pro-low` to `cc/claude-sonnet-5-5`. The DB row is updated by
   migration 030 (PR #107).

## SSE compatibility

The `: ping` keepalives (about every 10 s, PR #105) come from the session, not
from the model fetch, so they keep running while models switch. A single
`done` event still ends the stream (PR #106). A new informational
`model-fallback` event is emitted on each switch. Older clients ignore it.

## Code

- `src/lib/model-fallback.ts` holds the pure logic: `GLOBAL_FALLBACK_ORDER`,
  `buildFallbackChain`, `buildContinuationMessages`, `formatFallbackLabel`,
  `runWithModelFallback`, and `streamWithModelFallback`.
- `src/lib/model-fallback-log.ts` writes and lists the admin log rows.
- `src/lib/openai.ts`: `callApi` wraps `callApiOnce` in the fallback, and JSON
  repair retries stay on the model that answered.
- `src/app/api/ai-research/chat/route.ts`: `streamChatCompletionOnce` returns
  its failures and partial text instead of emitting errors, and
  `streamChatCompletion` wraps it.

## Tests

`tests/model-fallback.test.ts` covers the order, skipping failed models,
transparent retry, logging, the all-fail error, abort, continuation messages,
mid-stream appends across several models, and the labels.
