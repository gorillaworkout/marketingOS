// src/app/i/[slug]/InvitationForm.tsx
'use client';
// PUBLIC form. Never import @/lib/auth.
import { useId, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ALLERGY_NOTES_MAX, EMAIL_MAX, NAME_MAX } from '@/lib/dpm-invitation/rules';
import type { ResponseFieldErrors } from '@/lib/dpm-invitation/types';

type YesNo = '' | 'yes' | 'no';
const GENERIC = 'Something went wrong. Please try again in a minute.';

function Choice({ name, label, help, value, onChange, error, options }: {
  name: 'attending' | 'hasAllergy'; label: string; help: string; value: YesNo; onChange: (v: YesNo) => void; error?: string; options: Array<[YesNo, string]>;
}) {
  const legendId = useId();
  const helpId = `${name}-help`;
  return (
    <fieldset className="field choice-set">
      <legend className="label" id={legendId}>{label}</legend>
      <div className={`choice${error ? ' is-error' : ''}`} role="radiogroup" aria-labelledby={legendId} aria-describedby={helpId}>
        {options.map(([v, text]) => (
          <label key={v} className={value === v ? 'on' : undefined}>
            <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} />
            {text}
          </label>
        ))}
      </div>
      {error ? <span className="err" id={helpId}>{error}</span> : <span className="help" id={helpId}>{help}</span>}
    </fieldset>
  );
}

export function InvitationForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [attending, setAttending] = useState<YesNo>('');
  const [hasAllergy, setHasAllergy] = useState<YesNo>('');
  const [allergyNotes, setAllergyNotes] = useState('');
  const [website, setWebsite] = useState('');
  const [errors, setErrors] = useState<ResponseFieldErrors>({});
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setFormError('');
    setErrors({});
    // Hidden answers are never sent: not attending sends no allergy fields at all.
    const body: Record<string, string> = { fullName, email, attending, website };
    if (attending === 'yes') {
      body.hasAllergy = hasAllergy;
      if (hasAllergy === 'yes') body.allergyNotes = allergyNotes;
    }
    try {
      const response = await fetch(`/api/public/dpm-invitations/${encodeURIComponent(slug)}/responses`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; fieldErrors?: ResponseFieldErrors; error?: string };
      if (response.ok && data.ok) {
        router.push(`/i/${slug}/thanks`);
        return;
      }
      if (data.fieldErrors) {
        setErrors(data.fieldErrors);
        const first = Object.keys(data.fieldErrors)[0];
        requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus());
      } else {
        setFormError(data.error || GENERIC);
      }
    } catch {
      setFormError(GENERIC);
    }
    setPending(false);
  }

  return (
    <form ref={formRef} onSubmit={submit} noValidate>
      {formError && <div className="notice danger" role="alert">{formError}</div>}
      <div className="field">
        <label className="label" htmlFor="fullName">Full name</label>
        <input className={`input${errors.fullName ? ' is-error' : ''}`} id="fullName" name="fullName" value={fullName} onChange={e => setFullName(e.target.value)}
          autoComplete="name" maxLength={NAME_MAX} required aria-invalid={!!errors.fullName} aria-describedby="fullName-help" />
        {errors.fullName ? <span className="err" id="fullName-help">{errors.fullName}</span> : <span className="help" id="fullName-help">As you would like it to appear on the guest list.</span>}
      </div>
      <div className="field">
        <label className="label" htmlFor="email">Email</label>
        <input className={`input${errors.email ? ' is-error' : ''}`} id="email" name="email" type="email" inputMode="email" value={email} onChange={e => setEmail(e.target.value)}
          autoComplete="email" maxLength={EMAIL_MAX} required aria-invalid={!!errors.email} aria-describedby="email-help" />
        {errors.email ? <span className="err" id="email-help">{errors.email}</span> : <span className="help" id="email-help">If you submit again with the same email, we will update your answer.</span>}
      </div>
      <Choice name="attending" label="Will you attend?" help="Required." value={attending} onChange={setAttending} error={errors.attending} options={[['yes', 'Yes'], ['no', 'No']]} />
      {attending === 'yes' && (
        <Choice name="hasAllergy" label="Do you have any food allergies?" help="Shared with the event organisers and catering only." value={hasAllergy} onChange={setHasAllergy} error={errors.hasAllergy} options={[['no', 'No'], ['yes', 'Yes']]} />
      )}
      {attending === 'yes' && hasAllergy === 'yes' && (
        <div className="field">
          <label className="label" htmlFor="allergyNotes">What are you allergic to?</label>
          <input className={`input${errors.allergyNotes ? ' is-error' : ''}`} id="allergyNotes" name="allergyNotes" value={allergyNotes} onChange={e => setAllergyNotes(e.target.value)}
            maxLength={ALLERGY_NOTES_MAX} placeholder="e.g. peanuts, shellfish, gluten" autoComplete="off" required aria-invalid={!!errors.allergyNotes} aria-describedby="allergyNotes-help" />
          {errors.allergyNotes ? <span className="err" id="allergyNotes-help">{errors.allergyNotes}</span> : <span className="help" id="allergyNotes-help">Up to {ALLERGY_NOTES_MAX} characters.</span>}
        </div>
      )}
      <div className="hp" aria-hidden="true">
        <label htmlFor="website">Leave this field empty</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} />
      </div>
      <div><button className="btn" type="submit" disabled={pending}>{pending ? 'Submitting…' : 'Submit'}</button></div>
    </form>
  );
}
