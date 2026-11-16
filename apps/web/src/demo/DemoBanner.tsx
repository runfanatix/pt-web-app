import { resetDemo } from './demo.tsx';

/** A small pill, bottom left, so everyone knows this is the offline demo and the trainer can start over. */
export function DemoBanner() {
  return (
    <div className="demo-banner" role="note">
      <span>Demo · works offline · changes stay on this computer</span>
      <button type="button" onClick={resetDemo}>
        Reset demo
      </button>
    </div>
  );
}
