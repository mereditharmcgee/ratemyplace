# RateMyPlace Boston

A public health-focused tenant housing review platform for Boston renters.

## About

Tenants rate their apartment unit, building, and landlord using a structured survey: a 27-item rating instrument grounded in validated housing quality research (OHQS, PHQS, WHO LARES) plus 5 ancillary context questions (32 total). The platform addresses information asymmetry in rental markets by giving tenants a way to research landlords before signing a lease.

## Features

- 27-item evidence-based rating instrument plus 5 ancillary survey questions (32 total)
- Weighted scoring with health/safety priority factors
- Building and landlord profile pages with aggregate scores
- Privacy-preserving score aggregation
- Email-verified anonymous reviews
- Landlord dispute submission system
- Admin moderation dashboard
- Public records panel on Boston building pages, from City of Boston open data: property assessments, building permits, building and property violations, Public Works code enforcement, 311 service requests, and RentSmart (never part of a score)
- A page for every whole-building rental parcel in Boston, so a building can be found before anyone reviews it
- Readers can ask for a building's city records, and ask for newer ones once they are a month old
- "Report a record error" form on every records panel
- Owner of record lists that gather the Boston buildings held under one owner name in the city's assessing data
- Map of reviewed buildings, colored by score
- Tenant dashboard with saved buildings and review history

## Tech Stack

- **Framework**: Astro 5
- **Hosting**: Cloudflare Pages
- **Scheduled jobs**: a separate Cloudflare Cron Worker (`workers/records-scheduler/`) that fetches city records
- **Database**: Cloudflare D1 (SQLite)
- **Auth**: Lucia + Google OAuth
- **Email**: Resend
- **Styling**: Tailwind CSS 4

## Development

```bash
# Install the locked dependency set
npm ci

# Start dev server
npm run dev

# Run Astro/TypeScript diagnostics
npm run check

# Run tests
npm test

# Build for production
npm run build
```

## Links

- **Production**: https://ratemyplace.org
- **Methodology**: /methodology (citations and scoring approach)

## License

All rights reserved.
