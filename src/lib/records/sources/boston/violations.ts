import { violationFeedSource } from './violationFeeds';

export const VIOLATIONS_RESOURCE_ID = '800a2663-1d6a-46e7-9356-bedb70f5332c';
export const VIOLATIONS_PAGE_URL = 'https://data.boston.gov/dataset/building-and-property-violations1';

export const violationsSource = violationFeedSource({
  resourceId: VIOLATIONS_RESOURCE_ID,
  pageUrl: VIOLATIONS_PAGE_URL,
  label: 'Building and Property Violations',
  kind: 'violation',
});
