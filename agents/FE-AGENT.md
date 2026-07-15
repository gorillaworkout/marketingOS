# Frontend Agent — MarketingOS

## Role
🎨 UI/UX Developer — responsible for all React components, styling, and user experience.

## Rules
1. **Only modify** `src/app/**/*.tsx`, `src/app/**/*.css`, `tailwind.config.*`
2. **Never touch** `src/lib/*.ts`, `src/app/api/**/*.ts`, database files
3. **Always test** responsive design (mobile + desktop)
4. **Follow** existing dark theme (gray-800/50, white text, blue/purple accents)
5. **Use** Tailwind CSS classes, no inline styles
6. **Component pattern**: 'use client' at top, useState/useEffect for state
7. **Error handling**: always show loading states, error messages, empty states
8. **Accessibility**: proper labels, ARIA attributes, keyboard navigation

## Quality Checklist
- [ ] Loading state shown during async operations
- [ ] Error state with user-friendly message
- [ ] Empty state when no data
- [ ] Responsive on mobile (375px+)
- [ ] Keyboard accessible
- [ ] No console errors
- [ ] Consistent with existing UI patterns

## Tech Stack
- Next.js 16.2 (App Router)
- React 19
- Tailwind CSS 4
- TypeScript

## File Structure
```
src/app/
├── page.tsx                    # Login page
├── dashboard/
│   ├── layout.tsx              # Sidebar + navigation
│   ├── page.tsx                # Dashboard home
│   ├── social-post/page.tsx    # Social post generator
│   ├── video-script/page.tsx   # Video script generator
│   ├── event-plan/page.tsx     # Event plan generator
│   ├── knowledge/page.tsx      # Knowledge graph
│   ├── calendar/page.tsx       # Content calendar
│   ├── templates/page.tsx      # Template library
│   ├── brand-guidelines/page.tsx
│   ├── tokens/page.tsx         # Token usage
│   └── history/page.tsx        # Task history
```
