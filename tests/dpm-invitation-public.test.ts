// tests/dpm-invitation-public.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file: string) => readFileSync(file, 'utf8');

test('public pages are dynamic, noindex, no-referrer and use the shared open check', () => {
  for (const file of ['src/app/i/[slug]/page.tsx', 'src/app/i/[slug]/thanks/page.tsx']) {
    const source = read(file);
    assert.match(source, /export const dynamic = 'force-dynamic'/, file);
    assert.match(source, /robots: \{ index: false, follow: false \}/, file);
    assert.match(source, /referrer: 'no-referrer'/, file);
    assert.match(source, /isRegistrationOpen\(/, file);
  }
});

test('form follows the approved order and shows allergy questions only when attending', () => {
  const form = read('src/app/i/[slug]/InvitationForm.tsx');
  const order = ['htmlFor="fullName">Full name<', 'htmlFor="email">Email<', 'label="Will you attend?"', 'label="Do you have any food allergies?"', 'htmlFor="allergyNotes">What are you allergic to?<']
    .map(label => form.indexOf(label));
  assert.ok(order.every(i => i > 0), 'all labels present');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'labels in order');
  assert.match(form, /\{attending === 'yes' && \(/);
  assert.match(form, /hasAllergy === 'yes' && \(/);
  assert.match(form, /if \(attending === 'yes'\) \{/, 'hidden answers are not sent');
  assert.match(form, /name="website"/);
});

test('thank you text is the same for new and updated answers and shows no personal data', () => {
  const thanks = read('src/app/i/[slug]/thanks/page.tsx');
  assert.match(thanks, /Your response has been recorded\. You can submit again with the same email to change it\./);
  assert.doesNotMatch(thanks, /updated=|fullName|\.email\b|searchParams/);
});
