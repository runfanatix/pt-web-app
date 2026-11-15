import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { GymSummary } from '@pt/core';
import { Planner } from './Planner.tsx';
import { bedfordviewLayout } from './test-utils.ts';

const loadLayout = () => Promise.resolve(bedfordviewLayout());

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
    render(<Planner gyms={[bedfordview]} loadLayout={loadLayout} onSignOut={() => {}} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Bedfordview Zone Planner' })).toBeInTheDocument();
    expect(screen.getByText('Virgin Active Bedfordview · 101 Van Buuren Rd')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Gym location' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(7);
  });

  it('switches tab and mode', () => {
    render(<Planner gyms={[bedfordview]} loadLayout={loadLayout} onSignOut={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Session' }));
    expect(screen.getByRole('tab', { name: 'Session' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Edit layout' }));
    expect(screen.getByRole('tab', { name: 'Layout' })).toBeInTheDocument();
  });

  it('loads the plan for the open gym and reloads when the gym changes', async () => {
    const load = vi.fn(() => Promise.resolve(bedfordviewLayout()));
    render(<Planner gyms={[bedfordview, second]} loadLayout={load} onSignOut={() => {}} />);
    expect(
      await screen.findByRole('group', { name: 'Floor plan with training zones and equipment' }),
    ).toBeInTheDocument();
    expect(load).toHaveBeenLastCalledWith('g1');
    fireEvent.change(screen.getByRole('combobox', { name: 'Select gym' }), { target: { value: 'g2' } });
    await waitFor(() => expect(load).toHaveBeenLastCalledWith('g2'));
  });

  it('switching floors changes what is drawn and clears the selection', async () => {
    render(<Planner gyms={[bedfordview]} loadLayout={loadLayout} onSignOut={() => {}} />);
    const map = await screen.findByRole('group', { name: 'Floor plan with training zones and equipment' });
    const before = map.querySelectorAll('g.zone').length;
    fireEvent.click(screen.getByRole('button', { name: 'First floor' }));
    const after = screen
      .getByRole('group', { name: 'Floor plan with training zones and equipment' })
      .querySelectorAll('g.zone').length;
    expect(after).not.toBe(before);
    expect(screen.getByRole('button', { name: 'First floor' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows an error if the plan cannot be loaded', async () => {
    render(
      <Planner
        gyms={[bedfordview]}
        loadLayout={() => Promise.reject(new Error('boom'))}
        onSignOut={() => {}}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the floor plan: boom');
  });

  it('switches gym from the gym bar', () => {
    render(<Planner gyms={[bedfordview, second]} loadLayout={loadLayout} onSignOut={() => {}} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Select gym' }), { target: { value: 'g2' } });
    expect(screen.getByRole('heading', { level: 1, name: 'Second Gym Zone Planner' })).toBeInTheDocument();
  });

  it('explains how to import a gym when the account has none, and can sign out', () => {
    const onSignOut = vi.fn();
    render(<Planner gyms={[]} loadLayout={loadLayout} onSignOut={onSignOut} />);
    expect(screen.getByRole('heading', { name: 'No gym yet' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalled();
  });
});
