-- Official Dupoin Futures voice guideline for users who have none.
-- Idempotent: a user with any brand_guidelines row is skipped.
-- Does not update or delete existing guidelines.

INSERT INTO brand_guidelines (
  id,
  user_id,
  brand_name,
  tone_of_voice,
  target_market,
  key_messages,
  do_list,
  dont_list,
  examples
)
SELECT
  gen_random_uuid()::text,
  u.id,
  'Dupoin Futures',
  'Professional, stable, trustworthy — clarity over decoration',
  'Indonesian and regional traders plus B2B partners interested in next-generation multi-channel trading software, systems, and liquidity services',
  'Trusted broker; fast execution; local support; next-gen multi-channel trading and liquidity',
  '["Use data-driven claims with clear context","Include appropriate risk / investment disclaimers","Prefer clarity and calm confidence over hype","Stay aligned with Dupoin Blue #2EB5C4 and official brand voice","Use the official Dupoin logo (graphical mark + wordmark), never invent logos"]',
  '["Promise guaranteed profits or risk-free returns","Use overly aggressive or fear-based language","Mention competitors by name","Invent, redraw, or AI-generate Dupoin logos / alternate wordmarks","Use off-brand teal or unspecified logo colors"]',
  'Trade with clarity. Dupoin brings fast execution and local support so you can focus on decisions — not noise. Trading involves risk.'
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM brand_guidelines bg WHERE bg.user_id = u.id
);
