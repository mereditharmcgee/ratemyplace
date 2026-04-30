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

## Tech Stack

- **Framework**: Astro 5
- **Hosting**: Cloudflare Pages
- **Database**: Cloudflare D1 (SQLite)
- **Auth**: Lucia + Google OAuth
- **Email**: Resend
- **Styling**: Tailwind CSS 4

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

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
