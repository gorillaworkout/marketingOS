# Content Studio v2

SEO articles keep the existing draft, review, and publish flow. These fields are added on the New article form and stored on the draft.

## Brief

- Subkeywords are optional, up to 8, each 40 characters. The model is asked to use them naturally in a heading or the body. After generation the editor shows each keyword as used in a heading, used in the article, or missing. A missing keyword does not block publishing.
- User intent is Informational, Navigational, Commercial, or Transactional. Informational is a guide with an FAQ. Navigational stays short and points to the page. Commercial compares options. Transactional leads with the benefit and the steps to sign up or buy.
- Audience language is Bahasa Indonesia (`id`, the default) or English (`en`). The studio UI stays in English.
- Include table asks for one Markdown table when a comparison or a set of steps reads better that way.

## Article shape

The body has exactly one H1, then H2 and H3. H4 is allowed. The editor warns when the H1 is missing or repeated, a level is skipped, or a heading is deeper than H4. The warning does not block save or publish.

The meta title is at most 65 characters and the meta description is at most 155. Generated text is truncated to those limits. The editor shows a live counter and stops further typing at the limit. Saving an older article trims those two fields to the same limits. HTML export already sends the meta title and description, and now renders Markdown tables as HTML tables. That HTML is what gets pasted into the ICA draft.

## Data

Migration `054_content_studio_v2.sql` adds `subkeywords`, `search_intent`, `audience_language`, and `include_table` to `seo_content_drafts`. Rollback: `db/rollbacks/054_content_studio_v2_down.sql`.
