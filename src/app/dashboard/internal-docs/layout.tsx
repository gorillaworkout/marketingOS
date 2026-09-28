'use client';

import { InternalDocsProvider } from './InternalDocsState';
import { InternalDocsWorkspace } from './InternalDocsWorkspace';

// Ask lives here so opening a guide changes the child route without remounting the conversation.
export default function InternalDocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <InternalDocsProvider>
      <InternalDocsWorkspace />
      <div hidden>{children}</div>
    </InternalDocsProvider>
  );
}
