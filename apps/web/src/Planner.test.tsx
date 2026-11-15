import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { GymSummary } from '@pt/core';
import { Planner } from './Planner.tsx';

const bedfordview: GymSummary = {
  id: 'g1',
  name: 'Virgin Active',
  branch: 'Bedfordview',
  address: '101 Van Buuren Rd',
  phone: '',
  notes: '',
};
const second: GymSummary = { ...bedfordview, id: 'g2', name: 'Second Gym', branch: '', address: '1 Main St' };

describe('Planner shell', () => {
  it('shows the title from the gym, the gym bar and all seven tabs', () => {
    render(<Planner gyms={[bedfordview]} onSignOut={() => {}} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Bedfordview Zone Planner' })).toBeInTheDocument();
    expect(screen.getByText('Virgin Active Bedfordview · 101 Van Buuren Rd')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Gym location' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(7);
  });

  it('switches tab and mode', () => {
    render(<Planner gyms={[bedfordview]} onSignOut={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Session' }));
    expect(screen.getByRole('tab', { name: 'Session' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Edit layout' }));
    expect(screen.getByRole('tab', { name: 'Layout' })).toBeInTheDocument();
  });

  it('switches gym from the gym bar', () => {
    render(<Planner gyms={[bedfordview, second]} onSignOut={() => {}} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Select gym' }), { target: { value: 'g2' } });
    expect(screen.getByRole('heading', { level: 1, name: 'Second Gym Zone Planner' })).toBeInTheDocument();
  });

  it('explains how to import a gym when the account has none, and can sign out', () => {
    const onSignOut = vi.fn();
    render(<Planner gyms={[]} onSignOut={onSignOut} />);
    expect(screen.getByRole('heading', { name: 'No gym yet' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalled();
  });
});
