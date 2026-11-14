import { COPY } from './copy';
import { dayLabel, type Core } from './compute';

export function HowItWorks({ core }: { core: Core }) {
  return (
    <section class="panel how" id="how" aria-labelledby="how-h">
      <h2 id="how-h">{COPY.howHeading}</h2>
      <p class="how-text">{COPY.howPlaceholder}</p>
      <p class="how-text">{COPY.howOrderPlaceholder}</p>
      <p class="how-text" id="rates-note">{COPY.ratesNote}</p>
      <ul>
        {COPY.howPoints.map((p) => <li>{p}</li>)}
      </ul>
      <p class="updated-line">
        {COPY.updated} <time dateTime={core.meta.pulled}>{dayLabel(core.meta.pulled)}</time>. {COPY.dataThrough} {dayLabel(core.meta.dataThrough)}.
      </p>
      <h3>{COPY.sourcesHeading}</h3>
      <ul class="sources">
        {Object.values(core.meta.sources).map((s) => <li><a href={s.url} rel="noopener">{s.name}</a></li>)}
      </ul>
    </section>
  );
}
