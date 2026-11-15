import { describe, expect, it } from 'vitest';
import { ClientSchema, ConsentSchema, LayoutSchema, ZoneSchema, publicClientView } from './schemas.ts';

const floor = { id: 'f1', name: 'Ground', w: 1000, h: 620 };
const zone = { id: 'z1', name: 'Cardio', cat: 'cardio', x: 0, y: 0, w: 200, h: 100, floor: 'f1' };
const equip = {
  id: 'e1',
  name: 'Treadmill',
  zone: 'z1',
  type: 'cardio',
  x: 10,
  y: 10,
  muscles: ['cardio'],
  notes: '',
  floor: 'f1',
};

describe('ZoneSchema', () => {
  it('enforces the minimum zone size (60 x 50)', () => {
    expect(ZoneSchema.safeParse({ ...zone, w: 59 }).success).toBe(false);
    expect(ZoneSchema.safeParse({ ...zone, h: 49 }).success).toBe(false);
    expect(ZoneSchema.safeParse({ ...zone, w: 60, h: 50 }).success).toBe(true);
  });

  it('allows at most 11 extra parts of at least 16 x 16', () => {
    const part = { x: 0, y: 0, w: 16, h: 16 };
    expect(ZoneSchema.safeParse({ ...zone, parts: Array(11).fill(part) }).success).toBe(true);
    expect(ZoneSchema.safeParse({ ...zone, parts: Array(12).fill(part) }).success).toBe(false);
    expect(ZoneSchema.safeParse({ ...zone, parts: [{ ...part, w: 15 }] }).success).toBe(false);
  });

  it('rejects unknown categories', () => {
    expect(ZoneSchema.safeParse({ ...zone, cat: 'pool' }).success).toBe(false);
  });
});

describe('LayoutSchema', () => {
  it('accepts a valid layout and a blank plan with one floor', () => {
    expect(
      LayoutSchema.safeParse({ floors: [floor], zones: [zone], structs: [], equipment: [equip] }).success,
    ).toBe(true);
    expect(LayoutSchema.safeParse({ floors: [floor], zones: [], structs: [], equipment: [] }).success).toBe(
      true,
    );
  });

  it('needs at least one floor', () => {
    expect(LayoutSchema.safeParse({ floors: [], zones: [], structs: [], equipment: [] }).success).toBe(false);
  });

  it('rejects floor sizes outside 600-2400 x 400-1800', () => {
    expect(
      LayoutSchema.safeParse({ floors: [{ ...floor, w: 599 }], zones: [], structs: [], equipment: [] })
        .success,
    ).toBe(false);
    expect(
      LayoutSchema.safeParse({ floors: [{ ...floor, h: 1801 }], zones: [], structs: [], equipment: [] })
        .success,
    ).toBe(false);
  });

  it('rejects references to unknown floors or zones, and equipment on the wrong floor', () => {
    const base = { floors: [floor, { ...floor, id: 'f2' }], structs: [] };
    expect(
      LayoutSchema.safeParse({ ...base, zones: [{ ...zone, floor: 'nope' }], equipment: [] }).success,
    ).toBe(false);
    expect(
      LayoutSchema.safeParse({ ...base, zones: [zone], equipment: [{ ...equip, zone: 'nope' }] }).success,
    ).toBe(false);
    expect(
      LayoutSchema.safeParse({ ...base, zones: [zone], equipment: [{ ...equip, floor: 'f2' }] }).success,
    ).toBe(false);
  });
});

describe('client privacy', () => {
  const client = ClientSchema.parse({
    id: 'c1',
    name: 'Carla',
    email: 'carla@example.com',
    goals: 'Run 10k',
    privateNotes: 'knee injury',
    emergencyPhone: '082 000 0000',
  });

  it('the public view carries no private notes or contact details', () => {
    const view = publicClientView(client);
    expect(view).toEqual({ name: 'Carla' });
    expect(JSON.stringify(view)).not.toMatch(/knee|082|carla@|Run 10k/);
  });

  it('accepts a YYYY-MM-DD date of birth, a missing one, and nothing else', () => {
    const dob = (v: unknown) => ClientSchema.safeParse({ id: 'c', name: 'A', dateOfBirth: v }).success;
    expect(dob('2012-05-01')).toBe(true);
    expect(dob(null)).toBe(true);
    expect(dob('01/05/2012')).toBe(false);
    expect(dob('2012-5-1')).toBe(false);
    expect(dob('')).toBe(false);
  });

  it('validates email format but allows an empty email', () => {
    expect(ClientSchema.safeParse({ id: 'c', name: 'A', email: 'not-an-email' }).success).toBe(false);
    expect(ClientSchema.safeParse({ id: 'c', name: 'A', email: '' }).success).toBe(true);
  });
});

describe('ConsentSchema', () => {
  it('ties client consents to a client id', () => {
    const base = { purpose: 'training-data', noticeVersion: 'v1' };
    expect(ConsentSchema.safeParse({ ...base, subject: 'client', clientId: 'c1' }).success).toBe(true);
    expect(ConsentSchema.safeParse({ ...base, subject: 'client', clientId: null }).success).toBe(false);
    expect(ConsentSchema.safeParse({ ...base, subject: 'trainer', clientId: null }).success).toBe(true);
    expect(ConsentSchema.safeParse({ ...base, subject: 'trainer', clientId: 'c1' }).success).toBe(false);
  });
});
