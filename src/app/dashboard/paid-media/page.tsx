import { redirect } from 'next/navigation';

/** Paid Media opens on Google Ads (Keyword Trends is the second Paid Media page). */
export default function PaidMediaIndex() {
  redirect('/dashboard/paid-media/google-ads');
}
