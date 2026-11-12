import { useMemo, useState } from 'preact/hooks';
import { COPY } from './copy';
import { addressIndex, findAddresses, fmtInt, plural } from './compute';
import type { Buildings } from './data';

interface Props { buildings: Buildings | null; onOpen: (b: number) => void }
const ADDRESS_ORDER = new Intl.Collator('en', { numeric: true });

/**
 * Looks a building up by street. It searches every building already loaded, whatever the owner-type filter says,
 * and opens the same building panel as the map and the table. The panel is a modal dialog, so focus moves into it.
 */
export function FindBuilding({ buildings, onOpen }: Props) {
  const [q, setQ] = useState('');
  const index = useMemo(() => (buildings ? addressIndex(buildings.addr) : null), [buildings]);
  const found = useMemo(() => {
    if (!index || !buildings) return null;
    const r = findAddresses(index, q);
    if (!r) return null;
    // in address order, except when the typed number fits nothing: then the closest numbers come first
    return r.numberMissed ? r : { ...r, hits: [...r.hits].sort((a, b) => ADDRESS_ORDER.compare(buildings.addr[a], buildings.addr[b])) };
  }, [index, buildings, q]);
  const none = found !== null && (found.hits.length === 0 || found.numberMissed);

  return (
    <div class="find">
      <label class="search">
        <span>{COPY.findBuilding}</span>
        <input id="find-building" type="search" value={q} placeholder={COPY.findPlaceholder} autocomplete="off" spellcheck={false}
          onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      </label>
      {q.trim() !== '' && !buildings && <p class="loading" role="status">{COPY.loading}</p>}
      {/* one live region: the no-match line and the number of matches are both read out */}
      <div role="status" id="find-status">
        {none && <p class="find-none">{COPY.findNone}</p>}
        {found && found.hits.length > 0 && (
          <p class="find-status" translate={false}>{fmtInt(found.hits.length)} {plural(found.hits.length, COPY.findMatches)}</p>
        )}
      </div>
      {found && buildings && found.hits.length > 0 && (
        <ul class="find-results" translate={false} aria-label={COPY.findBuilding}>
          {found.hits.map((b) => (
            <li>
              <button type="button" class="link-button" onClick={() => onOpen(b)} aria-label={`${COPY.viewRecords}: ${buildings.addr[b]}`}>{buildings.addr[b]}</button>
              <span class="muted">{buildings.ownerStrings[buildings.owner[b]]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
