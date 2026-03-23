Run a comprehensive pre-deploy QA audit of the RateMyPlace Boston application. Walk through every user-facing page and flow, checking all five categories below. Use parallel subagents where possible to speed up the audit.

## Instructions

1. Read the current codebase to understand all pages, components, and API routes
2. Dispatch parallel agents for each QA category below
3. Compile all findings into a single organized report
4. Flag severity levels: CRITICAL (blocks deploy), WARNING (should fix), INFO (nice to fix)

---

## Category 1: Display & UI

Check every page and component for:

- **Overflow**: Content escaping containers, horizontal scroll on mobile, text truncation issues
- **Exposed internals**: Database column names, snake_case variables, internal IDs visible to users (e.g., `had_pest_issues` instead of "Pest Issues")
- **Broken values**: `undefined`, `null`, `NaN`, `[object Object]`, or empty strings where data should display
- **Responsive layout**: Components breaking at mobile (375px), tablet (768px), desktop (1280px)
- **Score display**: Score colors matching the `getScoreColor` convention (emerald >= 4, amber >= 3, orange >= 2, red < 2)
- **Missing images/icons**: Broken image references or missing assets

### Pages to check:
- `/` (homepage/search)
- `/search?q=...` (search results)
- `/building/[slug]` (property detail)
- `/landlord/[slug]` (landlord detail)
- `/property-manager/[slug]` (PM detail)
- `/review/new` and `/review/edit/[id]` (review forms)
- `/profile` (user profile)
- `/map` (map view)
- `/admin/*` (all admin pages)
- `/methodology`, `/about`, `/guidelines`, `/terms`, `/privacy`, `/contact`
- `/dispute`, `/bug-report`
- `/auth/signin`, `/auth/signup`, `/auth/forgot-password`, `/auth/reset-password`
- `/404`

---

## Category 2: Data Consistency

Check that the same data displays correctly across ALL views where it appears:

- **Review counts**: Do counts on search results match building detail page? Do admin review counts match?
- **Scores/averages**: Are aggregate scores consistent between search results, building detail, landlord detail, and admin views?
- **Building info**: Address, neighborhood, unit count — consistent across search, detail, admin, and map?
- **Landlord/PM names**: Same name shown in review cards, building pages, landlord pages, admin panels?
- **User review data**: Profile page review list matches what appears on building pages?
- **Scoring math**: Spot-check that `scoring.ts` weight calculations match what's displayed. Verify domain weights (unit, building, landlord) sum correctly.

---

## Category 3: Empty & Edge States

Check behavior when data is missing or at boundaries:

- **Empty search**: What happens with `?q=` or no query parameter?
- **No results**: Search returning zero matches — is the message helpful?
- **Zero reviews**: Building/landlord/PM pages with no reviews — graceful display?
- **New user**: Profile page with no reviews submitted
- **Missing optional fields**: Reviews without `property_manager_name`, buildings without all enrichment data
- **Long text**: Extremely long building names, review comments, landlord names — do they wrap or overflow?
- **Invalid routes**: `/building/nonexistent-slug`, `/landlord/fake-slug` — proper 404?
- **Form validation**: Empty required fields, invalid email, password too short
- **Pagination boundaries**: First page, last page, page beyond results

---

## Category 4: Security

Audit every API route and page for vulnerabilities:

- **Auth protection**: Every authenticated route checks `context.locals.user`
- **Admin protection**: Every admin route checks `context.locals.user?.isAdmin`
- **SQL injection**: All queries use parameterized bindings (`.bind()`), no string interpolation with user input
- **XSS**: User-generated content (reviews, comments, names) is properly escaped in templates
- **Exposed secrets**: No API keys, database credentials, or internal paths in client-side HTML/JS
- **Error leaks**: API error responses don't expose stack traces, file paths, or internal details
- **CSRF**: Form submissions and state-changing APIs are protected
- **Rate limiting**: Public endpoints (search, contact, auth) have rate limiting
- **Direct object access**: Can users access/modify other users' reviews by changing IDs?

### API routes to audit:
- All `/api/auth/*` routes
- All `/api/admin/*` routes
- `/api/reviews`, `/api/reviews/[id]`, `/api/reviews/user`
- `/api/buildings`, `/api/buildings/[id]/save`, `/api/buildings/saved`
- `/api/disputes`, `/api/disputes/[id]`
- `/api/contact`, `/api/bug-reports`
- `/api/search/*`, `/api/places/*`
- `/api/user/*` (profile, password, email)
- `/api/notifications/*`

---

## Category 5: Search & Filter Logic

Test the search and filtering system:

- **Basic search**: Common queries return expected results (street names, neighborhoods, building names)
- **Autocomplete**: `/api/search/autocomplete` returns relevant suggestions
- **Result accuracy**: Search results match what's in the database
- **Result count**: Displayed count matches actual results shown
- **Sort order**: Results sorted as expected (by relevance, score, or date)
- **Filter combinations**: Multiple filters applied together work correctly
- **Map search**: `/api/buildings/map` returns correct buildings for map bounds
- **Database-first search**: Verify the database search with Google fallback pattern works correctly
- **Pagination**: Page navigation works, no duplicate or missing results across pages

---

## Output Format

Organize findings as:

```
# QA Audit Report — [date]

## CRITICAL (Blocks Deploy)
- [Category] Description of issue — file:line

## WARNING (Should Fix)
- [Category] Description of issue — file:line

## INFO (Nice to Fix)
- [Category] Description of issue — file:line

## Passed Checks
- [Category] Brief summary of what passed
```

If no issues are found, explicitly state "All checks passed" for that category.
