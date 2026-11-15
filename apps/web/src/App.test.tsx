import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { App } from './App.tsx';

describe('App shell', () => {
  it('shows the title, gym bar and all seven tabs', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Bedfordview Zone Planner' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Gym location' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(7);
  });

  it('switches tab and mode', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'Session' }));
    expect(screen.getByRole('tab', { name: 'Session' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Edit layout' }));
    expect(screen.getByRole('tab', { name: 'Layout' })).toBeInTheDocument();
  });
});
