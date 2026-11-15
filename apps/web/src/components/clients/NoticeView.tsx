import {
  NOTICE_EFFECTIVE,
  NOTICE_IS_DRAFT,
  NOTICE_VERSION,
  missingProfileFields,
  noticeSections,
  type TrainerProfile,
} from '@pt/core';

interface Props {
  profile: TrainerProfile;
  onClose: () => void;
}

/** The privacy notice a client reads, filled in with the trainer's details. */
export function NoticeView({ profile, onClose }: Props) {
  const missing = missingProfileFields(profile);
  const name = profile.businessName.trim() || '[BUSINESS / TRAINER NAME]';
  return (
    <article className="notice-view" aria-label="Privacy notice">
      <div className="noticebar">
        <h3>Privacy notice for {name}</h3>
        <button type="button" className="btn sm" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="sub">
        Version {NOTICE_VERSION}, effective {NOTICE_EFFECTIVE}
      </p>
      {NOTICE_IS_DRAFT && (
        <p className="callout warn" role="note">
          Draft wording. Items in [square brackets] must be filled in, and an attorney must review this notice
          before real clients use it.
        </p>
      )}
      {missing.length > 0 && (
        <p className="callout warn" role="note">
          Not filled in yet: {missing.join(', ')}. Add these under &ldquo;Your business details&rdquo;.
        </p>
      )}
      {noticeSections(profile).map((s) => (
        <section key={s.heading}>
          <h4>{s.heading}</h4>
          {s.blocks.map((b, i) =>
            b.kind === 'p' ? (
              <p key={i}>{b.text}</p>
            ) : b.kind === 'ul' ? (
              <ul key={i}>
                {b.items.map((it) => (
                  <li key={it}>{it}</li>
                ))}
              </ul>
            ) : (
              <table key={i} className="notice-table">
                <thead>
                  <tr>
                    <th>{b.head[0]}</th>
                    <th>{b.head[1]}</th>
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map(([a, c]) => (
                    <tr key={a}>
                      <td>{a}</td>
                      <td>{c}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ),
          )}
        </section>
      ))}
    </article>
  );
}
