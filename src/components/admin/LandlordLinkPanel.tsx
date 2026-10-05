import { useState } from 'react';
import {
  classifyLandlordCandidates,
  keptSeparateNote,
  landlordOptionLabel,
  type LandlordGeo,
} from '../../lib/admin/landlordMatch';

export interface LinkableReview {
  building_id: string;
  building_address: string;
  building_city: string | null;
  building_state: string | null;
  building_landlord_id: string | null;
  building_landlord_name: string | null;
  /** What the tenant typed. */
  landlord_name: string | null;
}

interface Props {
  review: LinkableReview;
  landlords: LandlordGeo[];
  /** The building now belongs to `landlordId`; every review row for it should say so. */
  onLinked: (buildingId: string, landlordId: string, landlordName: string) => void;
  /** A landlord was created, so the shared list is stale. */
  onLandlordCreated: () => void;
}

export const SAME_NAME_WARNING =
  'A landlord with the same name exists elsewhere; keep them separate unless you know they are one company.';

/**
 * "Tenant named landlord" block on an admin review: link the building to an existing
 * landlord or create one. Matching is by name *and* place (`classifyLandlordCandidates`):
 * a same-named landlord in another city is shown as a warning, never preselected.
 */
export default function LandlordLinkPanel({ review, landlords, onLinked, onLandlordCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'select' | 'create'>('select');
  const [selectedId, setSelectedId] = useState('');
  const [newName, setNewName] = useState('');
  const [elsewhere, setElsewhere] = useState<LandlordGeo[]>([]);
  const [processing, setProcessing] = useState(false);

  if (!review.landlord_name) return null;

  const close = () => {
    setOpen(false);
    setMode('select');
    setSelectedId('');
    setNewName('');
    setElsewhere([]);
  };

  const start = () => {
    const tenantName = review.landlord_name ?? '';
    const { exact, elsewhere: others } = classifyLandlordCandidates(
      tenantName,
      { city: review.building_city, state: review.building_state },
      landlords,
    );
    setOpen(true);
    setElsewhere(others);
    setNewName(tenantName);
    if (exact) {
      setMode('select');
      setSelectedId(exact.id);
    } else {
      setMode('create');
      setSelectedId('');
    }
  };

  const link = async () => {
    setProcessing(true);
    try {
      let landlordId = selectedId;
      let landlordName = landlords.find((l) => l.id === selectedId)?.name ?? '';

      if (mode === 'create') {
        const name = newName.trim();
        if (!name) {
          alert('Landlord name is required');
          return;
        }
        // Creating a namesake of a landlord elsewhere is a decision; record it on the new row.
        const namesakes = elsewhere.filter((l) => l.name.trim().toLowerCase() === name.toLowerCase());
        const body: { name: string; admin_notes?: string } = { name };
        if (namesakes.length > 0) body.admin_notes = keptSeparateNote(namesakes);
        const createRes = await fetch('/api/admin/landlords', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const createData = await createRes.json();
        if (!createRes.ok) {
          alert(createData.error || 'Failed to create landlord');
          return;
        }
        landlordId = createData.landlord.id;
        landlordName = name;
        onLandlordCreated();
      }

      if (!landlordId) {
        alert('Please select a landlord');
        return;
      }

      const res = await fetch(`/api/admin/buildings/${review.building_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ landlord_id: landlordId }),
      });
      if (res.ok) {
        onLinked(review.building_id, landlordId, landlordName);
        close();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to link landlord');
      }
    } catch {
      alert('Failed to link landlord');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="mb-4 p-3 rounded-[6px] border border-purple-200 bg-purple-50">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-medium text-purple-800">Tenant named landlord</h4>
          <p className="text-sm text-purple-900 font-semibold mt-0.5">"{review.landlord_name}"</p>
          <p className="text-xs text-purple-600 mt-0.5">
            for {review.building_address}
            {review.building_city ? `, ${review.building_city}` : ''}
            {review.building_state ? `, ${review.building_state}` : ''}
          </p>
        </div>
        {review.building_landlord_id ? (
          <div className="text-right shrink-0">
            <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              Linked to: {review.building_landlord_name}
            </span>
          </div>
        ) : open ? null : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              start();
            }}
            className="shrink-0 px-3 py-1.5 bg-purple-600 text-white rounded-[6px] hover:bg-purple-700 text-sm font-medium"
          >
            Link Landlord
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 pt-3 border-t border-purple-200 space-y-3" onClick={(e) => e.stopPropagation()}>
          {elsewhere.length > 0 && (
            <div role="note" className="p-3 rounded-[6px] border border-amber-300 bg-amber-50 text-sm text-amber-900">
              <p className="font-medium">{SAME_NAME_WARNING}</p>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {elsewhere.map((l) => (
                  <li key={l.id}>
                    <a href={`/admin/landlords?id=${encodeURIComponent(l.id)}`} className="underline hover:text-amber-950">
                      {l.name}
                    </a>
                    {' — '}
                    {[...l.cities, ...l.states].join(', ') || 'no buildings yet'}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => setMode('select')}
              className={`px-3 py-1 rounded text-sm font-medium ${
                mode === 'select' ? 'bg-purple-600 text-white' : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
              }`}
            >
              Choose Existing
            </button>
            <button
              onClick={() => setMode('create')}
              className={`px-3 py-1 rounded text-sm font-medium ${
                mode === 'create' ? 'bg-purple-600 text-white' : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
              }`}
            >
              Create New
            </button>
          </div>

          {mode === 'select' ? (
            <div>
              <select
                aria-label="Existing landlord"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                className="w-full px-3 py-2 border border-purple-300 rounded-[4px] focus:ring-2 focus:ring-purple-500 text-sm"
              >
                <option value="">Select a landlord...</option>
                {landlords.map((l) => (
                  <option key={l.id} value={l.id}>{landlordOptionLabel(l)}</option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <input
                type="text"
                aria-label="New landlord name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New landlord name"
                className="w-full px-3 py-2 border border-purple-300 rounded-[4px] focus:ring-2 focus:ring-purple-500 text-sm"
              />
              <p className="text-xs text-purple-600 mt-1">This will create a new landlord and assign them to this building.</p>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={link}
              disabled={processing}
              className="px-3 py-1.5 bg-purple-600 text-white rounded-[6px] hover:bg-purple-700 disabled:opacity-50 text-sm font-medium"
            >
              {processing ? 'Linking...' : mode === 'create' ? 'Create & Link' : 'Link to Building'}
            </button>
            <button
              onClick={close}
              className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded-[6px] hover:bg-gray-300 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
