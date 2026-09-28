import { LoadingState, PageHeader, PageStack } from '@/components/ui/dashboard';

export function InternalDocsLoading() {
  return (
    <PageStack>
      <PageHeader
        eyebrow="Guidance"
        title="FAQ & Guides"
        description="Ask a question first. Open a citation to read the guide it came from."
      />
      <LoadingState label="Loading FAQ & Guides" />
    </PageStack>
  );
}
