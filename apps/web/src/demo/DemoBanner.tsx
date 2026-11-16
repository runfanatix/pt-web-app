import { resetDemo } from './demo.tsx';

/** A small pill, bottom left, so everyone knows this is the offline demo and the trainer can start over. */
export function DemoBanner() {
  return (
    <div className="demo-banner" role="note">
      <span>Demo · works offline · changes stay on this computer</span>
      <a
        href={window.location.href.split('#')[0] + '#/portal'}
        onClick={() => setTimeout(() => window.location.reload(), 0)}
      >
        Client view
      </a>
      <a
        href={window.location.href.split('#')[0]}
        onClick={() => setTimeout(() => window.location.reload(), 0)}
      >
        Trainer view
      </a>
      <button type="button" onClick={resetDemo}>
        Reset demo
      </button>
    </div>
  );
}
