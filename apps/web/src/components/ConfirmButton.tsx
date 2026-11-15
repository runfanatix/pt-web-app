import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  onConfirm: () => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
}

/**
 * Destructive action with the prototype's two-tap pattern: the first tap arms it ("Tap again to confirm"),
 * the second tap does it, and it disarms itself after 4 seconds. No browser confirm() dialogs.
 */
export function ConfirmButton({
  onConfirm,
  children,
  className = 'btn danger sm',
  disabled,
  ...rest
}: Props) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      aria-label={armed ? 'Tap again to confirm' : rest['aria-label']}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          timer.current = setTimeout(() => setArmed(false), 4000);
          return;
        }
        clearTimeout(timer.current);
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? 'Tap again to confirm' : children}
    </button>
  );
}
