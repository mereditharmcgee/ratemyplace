import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import LandlordLinkPanel, { SAME_NAME_WARNING, type LinkableReview } from '../../components/admin/LandlordLinkPanel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const aaBoston = { id: 'll-aa', name: 'AA Management', cities: ['Boston', 'Allston'], states: ['MA'] };
const other = { id: 'll-x', name: 'Other Co', cities: [], states: [] };

const review = (city: string, state: string): LinkableReview => ({
  building_id: 'b-1',
  building_address: '333 Humphrey St',
  building_city: city,
  building_state: state,
  building_landlord_id: null,
  building_landlord_name: null,
  landlord_name: 'AA Management',
});

describe('LandlordLinkPanel', () => {
  it('a same-name landlord in another state is a warning and the panel defaults to create', () => {
    const { getByText, getByRole, getByLabelText, queryByLabelText } = render(
      <LandlordLinkPanel review={review('New Haven', 'CT')} landlords={[aaBoston, other]} onLinked={() => {}} onLandlordCreated={() => {}} />,
    );
    fireEvent.click(getByRole('button', { name: 'Link Landlord' }));

    expect(getByText(SAME_NAME_WARNING)).toBeTruthy();
    const note = getByRole('note');
    expect(note.textContent).toContain('AA Management');
    expect(note.textContent).toContain('Boston, Allston, MA');
    expect((getByLabelText('New landlord name') as HTMLInputElement).value).toBe('AA Management');
    expect(queryByLabelText('Existing landlord')).toBeNull();
  });

  it('a same-name landlord in the same city (Boston localities count) is preselected with no warning', () => {
    const { getByRole, getByLabelText, queryByRole } = render(
      <LandlordLinkPanel review={review('Brighton', 'MA')} landlords={[aaBoston, other]} onLinked={() => {}} onLandlordCreated={() => {}} />,
    );
    fireEvent.click(getByRole('button', { name: 'Link Landlord' }));
    expect((getByLabelText('Existing landlord') as HTMLSelectElement).value).toBe('ll-aa');
    expect(queryByRole('note')).toBeNull();
  });

  it('dropdown options carry the landlord cities', () => {
    const { getByRole, getByText } = render(
      <LandlordLinkPanel review={review('Brighton', 'MA')} landlords={[aaBoston, other]} onLinked={() => {}} onLandlordCreated={() => {}} />,
    );
    fireEvent.click(getByRole('button', { name: 'Link Landlord' }));
    expect(getByText('AA Management — Boston, Allston')).toBeTruthy();
    expect(getByText('Other Co — no buildings yet')).toBeTruthy();
  });

  it('creating a namesake records the kept-separate decision in admin_notes', async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (url === '/api/admin/landlords' ? { landlord: { id: 'll-new' } } : { success: true }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const onLinked = vi.fn();
    const { getByRole } = render(
      <LandlordLinkPanel review={review('New Haven', 'CT')} landlords={[aaBoston]} onLinked={onLinked} onLandlordCreated={() => {}} />,
    );
    fireEvent.click(getByRole('button', { name: 'Link Landlord' }));
    fireEvent.click(getByRole('button', { name: 'Create & Link' }));

    await waitFor(() => expect(onLinked).toHaveBeenCalledWith('b-1', 'll-new', 'AA Management'));
    const createBody = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(createBody.name).toBe('AA Management');
    expect(createBody.admin_notes).toMatch(/^Same name as landlord ll-aa \(Boston, Allston, MA\); kept separate \d{4}-\d{2}-\d{2}$/);
  });
});
