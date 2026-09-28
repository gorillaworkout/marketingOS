import { LoadingState, PageHeader, PageStack } from '@/components/ui/dashboard';

export function InternalDocsLoading() {
  return (
    <PageStack>
      <PageHeader
        eyebrow="Guidance"
        title="FAQ & Guides"
        description="Ask a question first. Open a source link to read the guide or PDF."
      />
      <LoadingState label="Loading FAQ & Guides" />
    </PageStack>
  );
}
