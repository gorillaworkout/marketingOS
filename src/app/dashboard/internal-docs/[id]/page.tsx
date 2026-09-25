import { InternalDocsWorkspace } from '../InternalDocsWorkspace';

export default async function InternalDocPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ highlight?: string | string[] }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const raw = query.highlight;
  const highlight = (Array.isArray(raw) ? raw[0] : raw || '').slice(0, 180);
  return <InternalDocsWorkspace documentId={id} highlight={highlight} />;
}
