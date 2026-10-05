import { useEffect, useState } from 'react';
import type { AdminCleanupPreviewResponse } from '../../lib/api-types';

interface Props {
  /** Called after a cleanup deleted rows, so the list can reload. */
  onDeleted: () => void;
}

type Preview = AdminCleanupPreviewResponse['data'];

async function fetchPreview(): Promise<Preview | null> {
  const res = await fetch('/api/admin/cleanup');
  if (!res.ok) return null;
  const body = (await res.json()) as AdminCleanupPreviewResponse;
  return body.data;
}

/**
 * Deletes orphan buildings only: user-added rows outside Boston and New Haven with no
 * reviews and no saves (the predicate is `orphanBuildingsWhere`). Seeded parcels are never
 * touched, and the label carries the count so the admin sees the scope before clicking.
 */
export default function OrphanCleanupButton({ onDeleted }: Props) {
  const [count, setCount] = useState<number | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    fetchPreview().then((preview) => setCount(preview ? preview.count : null)).catch(() => setCount(null));
  }, []);

  const run = async () => {
    setWorking(true);
    try {
      const preview = await fetchPreview();
      if (!preview) {
        alert('Could not load the cleanup preview.');
        return;
      }
      setCount(preview.count);
      if (preview.count === 0) {
        alert('No user-added buildings outside Boston and New Haven without reviews or saves.');
        return;
      }
      const listed = preview.sample.slice(0, 5).map((b) => `- ${b.address}${b.city ? `, ${b.city}` : ''}`).join('\n');
      const more = preview.count > 5 ? `\n...and ${preview.count - 5} more` : '';
      const message =
        `Delete ${preview.count} user-added building(s) outside Boston and New Haven with no reviews and no saves?\n\n` +
        `${listed}${more}\n\nSeeded buildings are not affected. This cannot be undone.`;
      if (!confirm(message)) return;

      const res = await fetch('/api/admin/cleanup', { method: 'POST' });
      const body = (await res.json()) as { data?: { deleted: number }; error?: string };
      if (res.ok && body.data) {
        alert(`Deleted ${body.data.deleted} building(s).`);
        setCount(0);
        onDeleted();
      } else {
        alert(body.error || 'Cleanup failed');
      }
    } catch {
      alert('Cleanup failed');
    } finally {
      setWorking(false);
    }
  };

  return (
    <button
      type="button"
      onClick={run}
      disabled={working || count === 0}
      className="px-4 py-2 bg-orange-100 text-orange-700 rounded-[6px] hover:bg-orange-200 disabled:opacity-50 text-left"
    >
      {working
        ? 'Cleaning...'
        : `Delete user-added buildings outside Boston and New Haven with no reviews and no saves (${count ?? '…'})`}
    </button>
  );
}
