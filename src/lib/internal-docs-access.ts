import { NextRequest, NextResponse } from 'next/server';
import { requireFeature, type AuthorizedUser } from './auth';
import { canManageInternalDocs, type InternalDocsPrincipal } from './internal-docs-acl';
import { INTERNAL_DOCS_FEATURE } from './authorization';

export function principalFromUser(user: AuthorizedUser): InternalDocsPrincipal {
  return { role: user.role, departmentName: user.departmentName };
}

/**
 * Signed-in users whose department includes Internal Docs (admins always pass).
 * Company vs IT-only document ACL is applied after this gate.
 */
export async function requireInternalDocsUser(request: NextRequest): Promise<
  { user: AuthorizedUser; principal: InternalDocsPrincipal } | NextResponse
> {
  const user = await requireFeature(request, INTERNAL_DOCS_FEATURE);
  if ('error' in user) return NextResponse.json({ error: user.error }, { status: user.status });
  return { user, principal: principalFromUser(user) };
}

export async function requireInternalDocsManager(request: NextRequest): Promise<
  { user: AuthorizedUser; principal: InternalDocsPrincipal } | NextResponse
> {
  const actor = await requireInternalDocsUser(request);
  if (actor instanceof NextResponse) return actor;
  if (!canManageInternalDocs(actor.principal)) {
    return NextResponse.json({ error: 'Forbidden: only IT and admins can manage FAQ & Guides' }, { status: 403 });
  }
  return actor;
}
