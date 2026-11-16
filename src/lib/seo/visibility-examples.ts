/**
 * Client-safe onboarding copy for AI Visibility: the how-to steps, example
 * prompts, and the CSV template. Examples use a fictional brand (Acme Markets)
 * and fictional competitors on reserved .example domains, so they state no
 * facts about real organisations.
 */

export interface VisibilityExample { prompt: string; brandTerms: string; competitors: string }

export const EXAMPLE_BRAND = 'Acme Markets';

export const VISIBILITY_EXAMPLES: VisibilityExample[] = [
  {
    prompt: 'Which forex broker is best for beginners in Indonesia?',
    brandTerms: 'Acme Markets; acmemarkets.example',
    competitors: 'Northwind FX|Northwind; Contoso Trade',
  },
  {
    prompt: 'Is Acme Markets a safe broker to open an account with?',
    brandTerms: 'Acme Markets',
    competitors: 'Northwind FX; Contoso Trade',
  },
  {
    prompt: 'What is the easiest app to start trading gold online?',
    brandTerms: 'Acme Markets; Acme Markets app',
    competitors: 'Northwind FX; Fabrikam Gold|Fabrikam',
  },
];

export const VISIBILITY_GUIDE_STEPS: Array<{ title: string; body: string }> = [
  { title: 'Pick the site', body: 'Choose the site in the top-right selector. Prompts and results are kept per site.' },
  {
    title: 'Add one question per prompt',
    body: 'Write it the way a real customer would ask ChatGPT or Gemini, as a full question, not a keyword. One question per prompt: do not paste several questions into one prompt, because the answer and the mention check then mix them up.',
  },
  {
    title: 'Add brand terms and competitors',
    body: 'Brand terms are the names that count as a mention of you, separated by ";" (your domain always counts). Competitors are separated by ";"; write aliases as Name|alias. Leave brand terms empty to use the site name.',
  },
  { title: 'Run the check', body: 'Admins click Run now. Checks also run weekly when the schedule is enabled on the server. Each prompt is asked once on every configured model.' },
  {
    title: 'Read the results',
    body: 'Mention rate per model shows how often each model names you. In the Prompts table, click a yes/no badge to open the full answer and check it yourself, including the URLs it cited ("cited" means it linked your site). A generic brand term (for example a common word) can match by accident, so verify surprising "yes" results and use more specific terms.',
  },
];

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** CSV template with the import header and the example rows (terms in a cell separated by ";"). */
export function visibilityCsvTemplate(): string {
  const rows = VISIBILITY_EXAMPLES.map(example => [
    example.prompt,
    example.brandTerms.replace(/\s*;\s*/g, ';'),
    example.competitors.replace(/\s*;\s*/g, ';'),
    'yes',
  ].map(csvCell).join(','));
  return ['prompt,brand_terms,competitors,active', ...rows].join('\r\n') + '\r\n';
}
