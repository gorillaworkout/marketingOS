// src/app/i/[slug]/not-found.tsx
// PUBLIC. Never import @/lib/auth.
import '../invitation.css';

export default function InvitationNotFound() {
  return (
    <div className="pg-dpm-inv">
      <main style={{ maxWidth: 560, margin: '0 auto', padding: '96px 20px' }}>
        <p className="eyebrow">Invitation</p>
        <h1>This invitation link is not valid.</h1>
        <p className="to">Please check the link you were sent, or contact the DPM event team.</p>
      </main>
    </div>
  );
}
