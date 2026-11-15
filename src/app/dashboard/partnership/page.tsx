import { redirect } from 'next/navigation';

/** Partnership opens on Competitor Intelligence; Proposal Builder is next to it in the sidebar. Global Trends comes later. */
export default function PartnershipIndex() {
  redirect('/dashboard/partnership/competitor-intelligence');
}
