'use client';

import { useParams } from 'next/navigation';
import { InternalDocsWorkspace } from '../InternalDocsWorkspace';

export default function InternalDocPage() {
  const params = useParams<{ id: string }>();
  const documentId = typeof params.id === 'string' ? params.id : '';
  return <InternalDocsWorkspace documentId={documentId} />;
}
