import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AuditLogTable from '../../components/admin/AuditLogTable';
import BugReportsTable from '../../components/admin/BugReportsTable';
import BuildingsTable from '../../components/admin/BuildingsTable';
import DisputesQueue from '../../components/admin/DisputesQueue';
import LandlordsTable from '../../components/admin/LandlordsTable';
import ManagersTable from '../../components/admin/ManagersTable';
import RecordCorrectionsQueue from '../../components/admin/RecordCorrectionsQueue';
import ReviewsTable from '../../components/admin/ReviewsTable';
import UsersTable from '../../components/admin/UsersTable';

/**
 * Phase 28 (A11Y-07): the admin row headers were click-only divs. Each header keeps its markup
 * and its cursor-pointer class (the admin e2e specs index `.cursor-pointer`), and gains a native
 * button laid over it: named by the row's title, reporting aria-expanded, and pointing
 * aria-controls at the panel while the panel is rendered. The audit log keeps its row click and
 * makes the date a button. Filter and sort chips report aria-pressed.
 *
 * Every row here is fictional.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

function json(data: unknown) {
  return { ok: true, json: async () => data };
}

/** Answers each request with the body of the first route whose prefix it starts with. */
function stubFetch(routes: [prefix: string, body: unknown][]) {
  const fetchMock = vi.fn(async (input: string) => {
    const url = String(input);
    const route = routes.find(([prefix]) => url.startsWith(prefix));
    return json(route ? route[1] : {});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/**
 * The shared contract: a collapsed, named button over a .cursor-pointer header; a click opens it
 * and points aria-controls at a panel in the document; Enter and Space on the focused button
 * toggle it as well; collapsing drops aria-controls along with the panel.
 */
async function expectRowDisclosure(name: string) {
  const user = userEvent.setup();
  const button = await screen.findByRole('button', { name, expanded: false });
  expect(button.getAttribute('type')).toBe('button');
  expect(button.hasAttribute('aria-controls')).toBe(false);
  // Laid over the header, which keeps the class the e2e specs select it by; the button itself
  // must not add a second .cursor-pointer per row.
  const header = button.parentElement!;
  expect(header.classList.contains('cursor-pointer')).toBe(true);
  expect(header.classList.contains('relative')).toBe(true);
  expect(header.lastElementChild).toBe(button);
  expect(button.classList.contains('cursor-pointer')).toBe(false);
  expect(header.querySelectorAll('.cursor-pointer')).toHaveLength(0);

  await user.click(button);
  await waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('true'));
  const panelId = button.getAttribute('aria-controls');
  expect(panelId).toBeTruthy();
  const panel = document.getElementById(panelId!);
  expect(panel).not.toBeNull();
  expect(header.contains(panel)).toBe(false);
  expect(document.activeElement).toBe(button);

  await user.keyboard('{Enter}');
  await waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('false'));
  expect(button.hasAttribute('aria-controls')).toBe(false);
  expect(document.getElementById(panelId!)).toBeNull();

  await user.keyboard('{Enter}');
  await waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('true'));
  expect(document.getElementById(button.getAttribute('aria-controls')!)).not.toBeNull();

  await user.keyboard(' ');
  await waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('false'));
  return button;
}

const pressed = (name: RegExp | string) => screen.getByRole('button', { name, pressed: true });
const notPressed = (name: RegExp | string) => screen.getByRole('button', { name, pressed: false });

describe('ReviewsTable', () => {
  const review = {
    id: 'review-x1',
    user_id: 'user-x1',
    user_email: 'renter@example.com',
    building_id: 'building-x1',
    building_address: '12 Example Rd',
    building_slug: '12-example-rd',
    building_city: 'Boston',
    building_state: 'MA',
    building_landlord_id: null,
    building_landlord_name: null,
    landlord_name: null,
    review_title: 'A fictional review',
    review_text: 'Fictional text.',
    comments: '',
    overall_score: 3.5,
    status: 'approved',
    is_verified: 0,
    created_at: 1_735_689_600,
    move_in_year: 2024,
    move_in_season: 'fall',
    unit_type: '1br',
    unit_number: null,
    rent_amount: null,
    would_recommend_new: 'yes',
  };

  function stub() {
    return stubFetch([
      ['/api/admin/reviews/', { review }],
      ['/api/admin/reviews', { reviews: [review], statusCounts: { all: 1, pending: 0, approved: 1, rejected: 0, flagged: 0 }, total: 1 }],
      ['/api/admin/landlords', { landlords: [] }],
    ]);
  }

  it('toggles the row from a native button and still fetches the details on first open', async () => {
    const fetchMock = stub();
    render(<ReviewsTable />);
    await expectRowDisclosure('12 Example Rd');
    const detailCalls = fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith('/api/admin/reviews/'));
    expect(detailCalls).toEqual(['/api/admin/reviews/review-x1']);
  });

  it('shows the expanded controls once open', async () => {
    stub();
    render(<ReviewsTable />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '12 Example Rd', expanded: false }));
    expect(await screen.findByRole('button', { name: 'Reset to Pending' })).toBeTruthy();
  });

  it('reports the selected status chip as pressed', async () => {
    stub();
    render(<ReviewsTable />);
    await screen.findByRole('button', { name: '12 Example Rd' });
    expect(pressed(/^All \(/)).toBeTruthy();
    expect(notPressed(/^Pending \(/)).toBeTruthy();
    await userEvent.setup().click(notPressed(/^Pending \(/));
    expect(pressed(/^Pending \(/)).toBeTruthy();
    expect(notPressed(/^All \(/)).toBeTruthy();
  });
});

describe('BuildingsTable', () => {
  const building = {
    id: 'building-x1',
    address: '12 Example Rd',
    slug: '12-example-rd',
    neighborhood: null,
    city: 'Boston',
    state: 'MA',
    zip_code: null,
    latitude: null,
    longitude: null,
    year_built: null,
    unit_count: null,
    building_type: null,
    landlord_id: null,
    landlord_name: null,
    property_manager_id: null,
    property_manager_name: null,
    created_at: 1,
    admin_notes: null,
    owner_name: null,
    owner_entity: null,
    owner_website: null,
    review_count: 0,
    avg_score: null,
  };

  it('toggles the row from a native button', async () => {
    stubFetch([
      [
        '/api/admin/buildings',
        { buildings: [building], total: 1, offset: 0, limit: 100, stats: { total_buildings: 1, with_reviews: 0, with_landlords: 0, total_reviews: 0 } },
      ],
      ['/api/admin/landlords', { landlords: [] }],
      ['/api/admin/managers', { managers: [] }],
    ]);
    render(<BuildingsTable />);
    await expectRowDisclosure('12 Example Rd');
  });
});

describe('LandlordsTable', () => {
  it('toggles the row from a native button', async () => {
    stubFetch([
      [
        '/api/admin/landlords',
        {
          landlords: [
            {
              id: 'landlord-x1',
              name: 'Example Property Co',
              slug: 'example-property-co',
              description: null,
              website: null,
              phone: null,
              email: null,
              admin_notes: null,
              building_count: 1,
              review_count: 0,
              avg_score: null,
              created_at: 1,
              cities: ['Boston'],
              states: ['MA'],
            },
          ],
          total: 1,
          stats: { total_landlords: 1, total_buildings: 1, total_reviews: 0, high_rated: 0 },
        },
      ],
    ]);
    render(<LandlordsTable />);
    await expectRowDisclosure('Example Property Co');
  });
});

describe('ManagersTable', () => {
  it('toggles the row from a native button', async () => {
    stubFetch([
      [
        '/api/admin/managers',
        {
          managers: [
            {
              id: 'manager-x1',
              name: 'Example Management',
              slug: 'example-management',
              company_name: null,
              description: null,
              website: null,
              phone: null,
              email: null,
              building_count: 1,
              review_count: 0,
              avg_score: null,
              created_at: 1,
            },
          ],
        },
      ],
    ]);
    render(<ManagersTable />);
    await expectRowDisclosure('Example Management');
  });
});

describe('DisputesQueue', () => {
  const dispute = {
    id: 'dispute-x1',
    review_id: 'review-x1',
    landlord_name: 'Example Property Co',
    landlord_email: 'owner@example.com',
    landlord_phone: '555-0100',
    dispute_reasons: JSON.stringify(['Factually incorrect information']),
    dispute_explanation: null,
    status: 'pending',
    resolution_outcome: null,
    resolution_notes: null,
    resolved_by: null,
    resolved_at: null,
    created_at: 1_735_689_600,
    updated_at: 1_735_689_600,
    building_address: '12 Example Rd',
    review_text: 'Fictional text.',
    review_title: 'A fictional review',
    review_overall_score: 3.5,
  };

  it('toggles the row from a native button', async () => {
    stubFetch([['/api/disputes', { disputes: [dispute] }]]);
    render(<DisputesQueue />);
    await expectRowDisclosure('12 Example Rd');
  });

  it('reports the status and sort chips as pressed', async () => {
    stubFetch([['/api/disputes', { disputes: [dispute] }]]);
    render(<DisputesQueue />);
    await screen.findByRole('button', { name: '12 Example Rd' });
    expect(pressed(/^Pending \(/)).toBeTruthy();
    expect(notPressed(/^Resolved \(/)).toBeTruthy();
    expect(pressed('Oldest First')).toBeTruthy();
    expect(notPressed('Newest First')).toBeTruthy();
    const user = userEvent.setup();
    await user.click(notPressed('Newest First'));
    expect(pressed('Newest First')).toBeTruthy();
    expect(notPressed('Oldest First')).toBeTruthy();
    await user.click(notPressed(/^All \(/));
    expect(pressed(/^All \(/)).toBeTruthy();
    expect(notPressed(/^Pending \(/)).toBeTruthy();
  });
});

describe('BugReportsTable', () => {
  const bug = {
    id: 'bug-x1',
    user_id: null,
    user_email: null,
    email: null,
    category: 'ui',
    description: 'The example page shows a blank panel',
    url: null,
    status: 'new',
    created_at: 1_735_689_600,
    resolved_at: null,
    admin_notes: null,
  };

  it('toggles the row from a native button named by the report', async () => {
    stubFetch([['/api/admin/bug-reports', { bugs: [bug] }]]);
    render(<BugReportsTable />);
    await expectRowDisclosure('The example page shows a blank panel');
  });

  it('reports the status chip as pressed', async () => {
    stubFetch([['/api/admin/bug-reports', { bugs: [bug] }]]);
    render(<BugReportsTable />);
    await screen.findByRole('button', { name: 'The example page shows a blank panel' });
    expect(pressed(/^New \(/)).toBeTruthy();
    expect(notPressed(/^All \(/)).toBeTruthy();
    await userEvent.setup().click(notPressed(/^All \(/));
    expect(pressed(/^All \(/)).toBeTruthy();
    expect(notPressed(/^New \(/)).toBeTruthy();
  });
});

describe('AuditLogTable', () => {
  const log = {
    id: 7,
    created_at: 1_735_689_600,
    admin_user_id: 'admin-x1',
    admin_email: 'admin@example.com',
    admin_ip: '192.0.2.1',
    action_type: 'review_approved',
    entity_type: 'review',
    entity_id: 'review-x1-0000',
    old_value: JSON.stringify({ status: 'pending' }),
    new_value: JSON.stringify({ status: 'approved' }),
    notes: 'Fictional note',
  };

  function stub() {
    stubFetch([['/api/admin/audit', { logs: [log], pages: 1, total: 1, filters: { actionTypes: [], adminUsers: [] } }]]);
  }

  async function firstRow() {
    await screen.findByText('admin@example.com');
    return screen.getAllByRole('row')[1];
  }

  it('makes the date a button that toggles the details once per press', async () => {
    stub();
    render(<AuditLogTable />);
    const row = await firstRow();
    const button = within(row).getByRole('button', { expanded: false });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.className).toContain('text-left');
    expect(row.querySelector('td')!.contains(button)).toBe(true);
    expect(within(row).getByText('Click to expand')).toBeTruthy();
    expect(button.hasAttribute('aria-controls')).toBe(false);

    const user = userEvent.setup();
    await user.click(button);
    // One toggle, not two: the row's own click handler must not undo it.
    await waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('true'));
    const details = document.getElementById(button.getAttribute('aria-controls')!);
    expect(details?.textContent).toContain('Fictional note');

    await user.keyboard('{Enter}');
    await waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('false'));
    expect(button.hasAttribute('aria-controls')).toBe(false);
    expect(within(row).getByText('Click to expand')).toBeTruthy();
  });

  it('keeps the row click for the mouse, and the button follows it', async () => {
    stub();
    render(<AuditLogTable />);
    const row = await firstRow();
    const button = within(row).getByRole('button', { expanded: false });
    const user = userEvent.setup();
    await user.click(within(row).getByText('Review Approved'));
    await waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('true'));
    expect(document.getElementById(button.getAttribute('aria-controls')!)).not.toBeNull();
    await user.click(within(row).getByText('Review Approved'));
    await waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('false'));
  });
});

describe('RecordCorrectionsQueue', () => {
  const correction = {
    id: 'corr-x1',
    building_id: 'building-x1',
    record_kind: 'assessment',
    claim: 'The fictional value on file needs a second look.',
    has_contact_email: 0,
    has_pull: 0,
    status: 'pending',
    resolution: null,
    resolution_notes: null,
    resolved_by: null,
    resolved_at: null,
    created_at: 1_735_689_600,
    building_address: '12 Example Rd',
    building_slug: '12-example-rd',
  };

  it('points the Open button at the panel it opens', async () => {
    stubFetch([['/api/admin/records/corrections', { data: [correction] }]]);
    render(<RecordCorrectionsQueue />);
    const user = userEvent.setup();
    const open = await screen.findByRole('button', { name: 'Open 12 Example Rd', expanded: false });
    expect(open.hasAttribute('aria-controls')).toBe(false);
    await user.click(open);
    const close = await screen.findByRole('button', { name: 'Close 12 Example Rd', expanded: true });
    const panel = document.getElementById(close.getAttribute('aria-controls')!);
    expect(panel).not.toBeNull();
    expect(within(panel!).getByRole('button', { name: 'Re-pull from source' })).toBeTruthy();
    await user.click(close);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open 12 Example Rd' }).hasAttribute('aria-controls')).toBe(false));
  });

  it('reports the status chip as pressed', async () => {
    stubFetch([['/api/admin/records/corrections', { data: [correction] }]]);
    render(<RecordCorrectionsQueue />);
    await screen.findByRole('button', { name: 'Open 12 Example Rd' });
    expect(pressed(/^Pending/)).toBeTruthy();
    expect(notPressed(/^Resolved/)).toBeTruthy();
    await userEvent.setup().click(notPressed(/^Resolved/));
    expect(pressed(/^Resolved/)).toBeTruthy();
    expect(notPressed(/^Pending/)).toBeTruthy();
  });
});

describe('UsersTable', () => {
  it('reports the selected filter chip as pressed', async () => {
    stubFetch([
      [
        '/api/admin/users',
        { users: [{ id: 'user-x1', email: 'renter@example.com', is_admin: 0, email_verified: 1, created_at: 1, review_count: 0 }] },
      ],
    ]);
    render(<UsersTable currentUserId="admin-x1" />);
    await screen.findByText('renter@example.com');
    expect(pressed(/^All \(/)).toBeTruthy();
    expect(notPressed(/^Admins \(/)).toBeTruthy();
    expect(notPressed(/^Verified \(/)).toBeTruthy();
    await userEvent.setup().click(notPressed(/^Verified \(/));
    expect(pressed(/^Verified \(/)).toBeTruthy();
    expect(notPressed(/^All \(/)).toBeTruthy();
  });
});
