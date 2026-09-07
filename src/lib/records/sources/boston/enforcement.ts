import { violationFeedSource } from './violationFeeds';

export const ENFORCEMENT_RESOURCE_ID = '90ed3816-5e70-443c-803d-9a71f44470be';
export const ENFORCEMENT_PAGE_URL = 'https://data.boston.gov/dataset/public-works-violations';

export const enforcementSource = violationFeedSource({
  resourceId: ENFORCEMENT_RESOURCE_ID,
  pageUrl: ENFORCEMENT_PAGE_URL,
  label: 'Public Works Code Enforcement',
  kind: 'enforcement_ticket',
});
