import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildHistoryEntry,
  exercisesFor,
  fmtClock,
  isActive,
  isRunView,
  layoutChanged,
  blankLayout,
  catalogueIndex,
  emptyCatalogue,
  type Catalogue,
  cloneLayout,
  gymTitle as titleOf,
  pdfFileName,
  itemsPerFloor,
  remapItems,
  snapsOf,
  runLogText,
  emptyProfile,
  type ClientRecord,
  type GymSummary,
  type HistoryEntry,
  type ItemSnap,
  type Layout,
  type LibraryExercise,
  type ProgrammeRecord,
  type RunState,
  type TrainerProfile,
} from '@pt/core';
import { TABS, type Mode, type TabId } from './tabs.ts';
import { GymBar } from './components/GymBar.tsx';
import { FloorPlan } from './components/FloorPlan.tsx';
import { FloorTabs, Legend, MuscleChips } from './components/PlanControls.tsx';
import { MachinePopup } from './components/MachinePopup.tsx';
import { RunHud } from './components/RunHud.tsx';
import { RunTab } from './components/RunTab.tsx';
import { SessionTab } from './components/SessionTab.tsx';
import { TemplatesPanel } from './components/TemplatesPanel.tsx';
import { AssignPanel } from './components/clients/AssignPanel.tsx';
import { ClientsTab } from './components/clients/ClientsTab.tsx';
import { ZonesTab } from './components/ZonesTab.tsx';
import { LayoutTab } from './components/LayoutTab.tsx';
import { GymsTab } from './components/GymsTab.tsx';
import { CatalogueTab } from './components/CatalogueTab.tsx';
import { ModelsContext, type CatalogueApi } from './data/catalogueApi.ts';
import type { GymMeta, GymsApi } from './data/gymsApi.ts';
import type { LayoutApi } from './data/layoutApi.ts';
import { useGymData, type GymDataLoader } from './data/useLayout.ts';
import type { ClientsApi, ProfileApi } from './data/clients.ts';
import type { ShareApi } from './data/share.ts';
import { SendActions } from './components/SendActions.tsx';
import { buildShare } from './lib/shareModel.ts';
import { savePdf, type PdfModel } from './lib/pdf.ts';
import type { HistoryApi } from './data/history.ts';
import type { Template, TemplateApi } from './data/templates.ts';
import { copyText } from './lib/clipboard.ts';
import { loadRunInProgress } from './run/runStore.ts';
import { useRun } from './run/useRun.ts';
import { newUid, saveDraft } from './session/sessionState.ts';
import { useSession } from './session/useSession.ts';

interface Props {
  gyms: GymSummary[];
  loadGym: GymDataLoader;
  /** Null until the trainer profile has loaded; templates are unavailable until then. */
  templates: TemplateApi | null;
  /** Null until the trainer profile has loaded; finished runs cannot be saved until then. */
  history: HistoryApi | null;
  /** Null until the trainer profile has loaded. */
  clientsApi?: ClientsApi | null;
  profileApi?: ProfileApi | null;
  shareApi?: ShareApi | null;
  layoutApi?: LayoutApi | null;
  gymsApi?: GymsApi | null;
  catalogueApi?: CatalogueApi | null;
  /** Re-reads the gym list (after one is added, edited or deleted). */
  onGymsChanged?: () => Promise<void>;
  onSignOut: () => void;
}

interface ToastState {
  msg: string;
  /** Offer a "View session" shortcut (when the Session tab is not open). */
  view: boolean;
}

export function Planner({
  gyms,
  loadGym,
  templates,
  history,
  clientsApi = null,
  profileApi = null,
  shareApi = null,
  layoutApi = null,
  gymsApi = null,
  catalogueApi = null,
  onGymsChanged = async () => {},
  onSignOut,
}: Props) {
  const [mode, setMode] = useState<Mode>('plan');
  // A workout in progress that was saved before a reload reopens its own gym and the Run tab.
  const [saved] = useState(() => loadRunInProgress());
  const resumeGym = saved && gyms.some((g) => g.id === saved.gymId) ? saved.gymId : null;
  const [tab, setTab] = useState<TabId>(resumeGym ? 'run' : 'zone');
  const [gymId, setGymId] = useState(resumeGym ?? gyms[0]?.id ?? '');
  const [floorId, setFloorId] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [selZone, setSelZone] = useState<string | null>(null);
  const [selEq, setSelEq] = useState<string | null>(null);
  const [ask, setAsk] = useState<{
    id: string;
    dirty: boolean;
    moved: number;
    dropped: number;
    items: ItemSnap[] | null;
  } | null>(null);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [catalogueError, setCatalogueError] = useState('');
  const [selStruct, setSelStruct] = useState<string | null>(null);
  // Machines copied by Duplicate zone: their exercise links are copied once the layout is saved.
  const copiesRef = useRef<{ from: string; to: string }[]>([]);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [runMsg, setRunMsg] = useState('');
  const [announce, setAnnounce] = useState('');
  // Layout editing works on a copy; nothing reaches the database until Save.
  const [draft, setDraft] = useState<Layout | null>(null);
  const [snapOn, setSnapOn] = useState(true);
  const [part, setPart] = useState(0);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const [clients, setClients] = useState<ClientRecord[] | null>(null);
  const [clientsError, setClientsError] = useState('');
  const [profile, setProfile] = useState<TrainerProfile | null>(null);
  const [past, setPast] = useState<HistoryEntry[] | null>(null);
  const [pastError, setPastError] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hudRef = useRef<HTMLDivElement>(null);
  const gym = gyms.find((g) => g.id === gymId) ?? gyms[0];
  const gymState = useGymData(loadGym, gym?.id ?? null, reload);
  const { session, dispatch } = useSession(gym?.id ?? null);
  const rc = useRun(session.items, gym?.id ?? null);
  const run = rc.run;
  const runLive = isActive(run);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // Tell the trainer a restored workout is waiting, paused, and say when a rest is over (screen readers too).
  useEffect(() => {
    if (!rc.restored) return;
    setRunMsg(
      'Your workout was restored after the page reloaded. It is paused: press Resume when your client is ready.',
    );
    clearTimeout(toastTimer.current);
    setToast({ msg: 'Workout restored and paused. Press Resume to carry on.', view: false });
    toastTimer.current = setTimeout(() => setToast(null), 5000);
    // Once, on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const restEnds = run.restEnds;
  useEffect(() => {
    if (restEnds > 0) setAnnounce('Rest over. Start the next set.');
  }, [restEnds]);

  const data = gymState.status === 'ready' ? gymState.data : null;
  const savedLayout: Layout | null = data?.layout ?? null;
  const editing = mode === 'edit';
  const dirty = !!(savedLayout && draft && layoutChanged(savedLayout, draft));
  const layout: Layout | null = editing && draft ? draft : savedLayout;
  const library: LibraryExercise[] = data?.library ?? [];
  const activeFloor = layout ? (layout.floors.find((f) => f.id === floorId) ?? layout.floors[0]!) : null;
  const equipById = new Map((layout?.equipment ?? []).map((e) => [e.id, e]));
  const zoneName = new Map((layout?.zones ?? []).map((z) => [z.id, z.name]));
  const floorName = new Map((layout?.floors ?? []).map((f) => [f.id, f.name]));
  const placeOf = (e: Layout['equipment'][number]) =>
    ((layout?.floors.length ?? 0) > 1 ? `${floorName.get(e.floor) ?? ''} · ` : '') +
    (zoneName.get(e.zone) ?? '');
  const showRun = isRunView(run, tab === 'run', mode === 'edit');

  // Past runs for the Run tab.
  const refreshPast = async () => {
    if (!history) return;
    try {
      setPast(await history.list());
      setPastError('');
    } catch (err) {
      setPastError(`Could not load past runs: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  useEffect(() => {
    void refreshPast();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history]);

  // Saved clients and the trainer's business details (for the privacy notice).
  const refreshClients = async () => {
    if (!clientsApi) return;
    try {
      setClients(await clientsApi.list());
      setClientsError('');
    } catch (err) {
      setClientsError(`Could not load clients: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  useEffect(() => {
    void refreshClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientsApi]);
  useEffect(() => {
    if (!profileApi) return;
    let live = true;
    profileApi.get().then(
      (pr) => live && setProfile(pr),
      () => live && setProfile(emptyProfile()),
    );
    return () => {
      live = false;
    };
  }, [profileApi]);

  // The equipment catalogue (manufacturers and models), for tagging machines with what they really are.
  const refreshCatalogue = async () => {
    if (!catalogueApi) return;
    try {
      setCatalogue(await catalogueApi.load());
      setCatalogueError('');
    } catch (err) {
      setCatalogueError(`Could not load the catalogue: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  useEffect(() => {
    void refreshCatalogue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogueApi]);
  const models = useMemo(() => catalogueIndex(catalogue ?? emptyCatalogue()), [catalogue]);

  // Keep the sticky planner panel clear of the run bar.
  useEffect(() => {
    const set = () =>
      document.documentElement.style.setProperty('--hudh', `${hudRef.current?.offsetHeight ?? 0}px`);
    set();
    window.addEventListener('resize', set);
    return () => {
      window.removeEventListener('resize', set);
      document.documentElement.style.removeProperty('--hudh');
    };
  });

  // Follow the current machine: switch to its floor, centre it, and announce it for screen readers.
  useEffect(() => {
    const it = run.cur ? session.items.find((i) => i.uid === run.cur) : undefined;
    const e = it ? equipById.get(it.eid) : undefined;
    if (!it || !e || !layout) return;
    setFloorId(e.floor);
    setAnnounce(
      `Now at ${e.name}: ${it.exercise}. Step ${Math.min(run.order.length + 1, session.items.length)} of ${session.items.length}.`,
    );
    const sc = document.querySelector<HTMLElement>('.mapscroll');
    const svg = document.getElementById('map');
    const f = layout.floors.find((x) => x.id === e.floor);
    if (sc && svg && f && sc.scrollWidth > sc.clientWidth && typeof sc.scrollTo === 'function') {
      const x = (e.x / f.w) * svg.getBoundingClientRect().width;
      sc.scrollTo({ left: Math.max(0, x - sc.clientWidth / 2), behavior: 'smooth' });
    }
    // Only when the current step changes, not on every tick or edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.cur]);

  if (!gym) {
    return (
      <div className="wrap">
        <p className="eyebrow">PT Planner</p>
        <h1>No gym yet</h1>
        <p className="lede">
          Your account has no gyms. Import one with <code>scripts/import-prototype.ts</code> (see
          docs/05-import-script.md).
        </p>
        <button type="button" className="btn" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    );
  }

  const gymTitle = [gym.name, gym.branch].filter(Boolean).join(' ');
  const gymLine = [gymTitle, gym.address].filter(Boolean).join(', ');
  const sending = clients?.find((r) => r.client.id === session.meta.clientId)?.client;

  function say(msg: string, view = false) {
    clearTimeout(toastTimer.current);
    setToast({ msg, view });
    toastTimer.current = setTimeout(() => setToast(null), 3400);
  }
  function chooseMode(m: Mode) {
    if (m === mode) return;
    if (m === 'edit' && runLive) return say('Finish or reset the live run before editing the layout.');
    if (m === 'plan' && dirty) return say('Save or discard your layout changes first.');
    setDraft(null);
    setSelZone(null);
    setSelEq(null);
    setSelStruct(null);
    setPart(0);
    setMode(m);
  }
  async function saveLayout(): Promise<boolean> {
    if (!draft || !layoutApi || !gym) return false;
    setSaving(true);
    try {
      await layoutApi.save(gym.id, draft);
      const kept = new Set(draft.equipment.map((e) => e.id));
      // Machines that no longer exist drop out of the unsent routine.
      for (const it of session.items) if (!kept.has(it.eid)) dispatch({ type: 'remove', uid: it.uid });
      // A duplicated zone's machines get the same exercises as the ones they were copied from.
      const copies = copiesRef.current.filter((c) => kept.has(c.to));
      copiesRef.current = [];
      let linkFailed = false;
      for (const c of copies) {
        for (const x of library.filter((q) => q.equipmentIds.includes(c.from))) {
          try {
            await layoutApi.setLink(x.id, c.to, true);
          } catch {
            linkFailed = true;
          }
        }
      }
      setDraft(null);
      setSelZone(null);
      setSelEq(null);
      setSelStruct(null);
      setReload((n) => n + 1);
      say(linkFailed ? 'Layout saved, but some exercise links could not be copied.' : 'Layout saved.');
      return true;
    } catch (err) {
      say(`Could not save the layout: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    } finally {
      setSaving(false);
    }
  }
  function discardLayout() {
    setDraft(null);
    copiesRef.current = [];
    setSelZone(null);
    setSelEq(null);
    setSelStruct(null);
    say('Changes discarded.');
  }
  async function linkExercise(exerciseId: string, equipmentId: string, linked: boolean) {
    if (!layoutApi) return;
    try {
      await layoutApi.setLink(exerciseId, equipmentId, linked);
      setReload((n) => n + 1);
    } catch (err) {
      say(`Could not change the link: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  /** Where the open session's exercises would land at another gym. Nothing happens until the trainer agrees. */
  async function planSwitch(id: string) {
    if (!session.items.length) return { items: null, moved: 0, dropped: 0 };
    const target = await loadGym(id);
    const candidates = target.layout.equipment.map((e) => ({ id: e.id, name: e.name, type: e.type }));
    const links = Object.fromEntries(target.library.map((x) => [x.id, x.equipmentIds]));
    const old = new Map([...equipById].map(([k, e]) => [k, { name: e.name, type: e.type }]));
    const r = remapItems(snapsOf(session.items), candidates, links, old);
    return { items: r.items, moved: r.moved, dropped: r.skipped };
  }
  async function requestSwitch(id: string, title?: string) {
    if (id === '__manage') return setTab('gyms');
    if (id === gym!.id) return setAsk(null);
    if (runLive) return say('End or reset the live run before changing gym.');
    try {
      const plan = await planSwitch(id);
      if (dirty || plan.dropped)
        return setAsk({ id, dirty, moved: plan.moved, dropped: plan.dropped, items: plan.items });
      await doSwitch(id, '', plan.items, title);
    } catch (err) {
      say(`Could not open that gym: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  /** Opens a gym. The open routine goes with the trainer, remapped onto the machines of the gym they open. */
  async function doSwitch(
    id: string,
    how: 'save' | 'discard' | '',
    items: ItemSnap[] | null,
    title?: string,
  ) {
    if (how === 'save' && !(await saveLayout())) return;
    if (items) saveDraft(id, { ...session, items: items.map((q) => ({ ...q, uid: newUid() })) });
    const target = gyms.find((g) => g.id === id);
    setAsk(null);
    openGym(id);
    say(`Opened ${title ?? (target ? titleOf(target) : 'the gym')}.`);
  }
  function uniqueName(name: string, branch: string): string {
    const taken = new Set(gyms.map((g) => titleOf(g).toLowerCase()));
    if (!taken.has(titleOf({ name, branch }).toLowerCase())) return name;
    let i = 2;
    while (taken.has(titleOf({ name: `${name} ${i}`, branch }).toLowerCase())) i += 1;
    return `${name} ${i}`;
  }
  /** Makes a gym (blank, or a copy of the plan on screen), saves its layout, and opens it. */
  async function createGym(meta: GymMeta, start: 'blank' | 'copy') {
    if (!gymsApi || !layoutApi) return;
    const copy = start === 'copy' && layout ? cloneLayout(layout, newUid) : null;
    const lay = copy?.layout ?? blankLayout(newUid());
    const name = uniqueName(meta.name, meta.branch);
    const id = await gymsApi.create({ ...meta, name });
    try {
      await layoutApi.save(id, lay);
      await gymsApi.copyLinks(copy?.machines ?? []);
    } catch (err) {
      await gymsApi.remove(id).catch(() => {});
      throw err;
    }
    await onGymsChanged();
    // A copy of what is on screen takes the unsaved edits with it; the gym it came from goes back to as it was saved.
    if (copy) await doSwitch(id, 'discard', null, titleOf({ name, branch: meta.branch }));
    else await requestSwitch(id, titleOf({ name, branch: meta.branch }));
  }
  async function duplicateGym(id: string): Promise<string | null> {
    const src = gyms.find((g) => g.id === id);
    if (!src || !gymsApi || !layoutApi) return null;
    const data = await loadGym(id);
    const copy = cloneLayout(data.layout, newUid);
    const branch = src.branch ? `${src.branch} copy` : '';
    const name = uniqueName(src.branch ? src.name : `${src.name} copy`, branch);
    const newId = await gymsApi.create({
      name,
      branch,
      address: src.address,
      phone: src.phone,
      notes: src.notes,
    });
    try {
      await layoutApi.save(newId, copy.layout);
      await gymsApi.copyLinks(copy.machines);
    } catch (err) {
      await gymsApi.remove(newId).catch(() => {});
      throw err;
    }
    await onGymsChanged();
    say(`Duplicated as "${titleOf({ name, branch })}". Open it when you want to edit it.`);
    return newId;
  }
  function openGym(id: string) {
    copiesRef.current = [];
    setDraft(null);
    setGymId(id);
    setFloorId(null);
    setFilter('all');
    setSelZone(null);
    setSelEq(null);
    setSelStruct(null);
  }
  function changeFloor(id: string) {
    setFloorId(id);
    setSelZone(null);
    setSelEq(null);
    setSelStruct(null);
  }
  function addExercise(eid: string, x: LibraryExercise) {
    dispatch({ type: 'add', eid, exercise: x });
    say(`Added ${x.name} (${session.items.length + 1} in session)`, true);
  }
  function focusFirstFloor(eid: string | undefined) {
    const e = eid ? equipById.get(eid) : undefined;
    if (e) setFloorId(e.floor);
  }

  /** Puts stored exercises into the session, remapped onto the open gym, and tells the trainer what moved. */
  async function applySnaps(
    snaps: ItemSnap[],
    opts: {
      label: string;
      how: 'replace' | 'append';
      stay?: boolean;
      title?: string;
      notes?: string;
      client?: { id: string; name: string };
    },
  ) {
    if (!layout) return;
    if (runLive) return say('Finish or reset the live run first.');
    const candidates = layout.equipment.map((e) => ({ id: e.id, name: e.name, type: e.type }));
    const present = new Set(candidates.map((c) => c.id));
    const links = Object.fromEntries(library.map((x) => [x.id, x.equipmentIds]));
    const missing = [...new Set(snaps.map((i) => i.eid).filter((id) => id && !present.has(id)))];
    let oldInfo = new Map<string, { name: string; type: string }>();
    if (missing.length && templates) {
      try {
        oldInfo = await templates.equipmentInfo(missing);
      } catch {
        /* without the old machine names the remap falls back to exercise links */
      }
    }
    const r = remapItems(snaps, candidates, links, oldInfo);
    dispatch(
      opts.how === 'replace'
        ? { type: 'load', items: r.items, title: opts.title, notes: opts.notes }
        : { type: 'append', items: r.items },
    );
    if (opts.client)
      dispatch({ type: 'meta', patch: { clientId: opts.client.id, client: opts.client.name } });
    setSelEq(null);
    focusFirstFloor(r.items[0]?.eid);
    if (!opts.stay) setTab('session');
    const bits = [
      `${opts.how === 'replace' ? 'Loaded' : 'Added'} "${opts.label}" (${r.items.length} exercise${r.items.length === 1 ? '' : 's'})`,
    ];
    if (r.moved) bits.push(`${r.moved} moved to matching equipment`);
    if (r.skipped) bits.push(`${r.skipped} skipped: no matching equipment here`);
    say(bits.join('. ') + '.');
  }

  const applyTemplate = (t: Template, how: 'replace' | 'append', stay = false) =>
    applySnaps(t.items, { label: t.name, how, stay, title: t.name, notes: t.notes });

  /** Opens a client's programme in the session, for that client. */
  const openProgramme = (p: ProgrammeRecord, client: { id: string; name: string }) =>
    applySnaps(p.items, { label: p.title, how: 'replace', title: p.title, notes: p.notes, client });

  /* ---------------------------------------------------------------- live run */

  function entryFor(r: RunState, id: string, allowEmpty = false): HistoryEntry | null {
    return buildHistoryEntry({
      id,
      run: r,
      items: session.items,
      meta: session.meta,
      equipment: equipById,
      place: placeOf,
      gym: { id: gym!.id, name: gymTitle },
      allowEmpty,
    });
  }

  /** Saves a finished run to history. The same id is reused if the run is undone and finished again. */
  async function saveRun(r: RunState) {
    const id = r.histId || newUid();
    const entry = entryFor(r, id);
    if (!entry) return say('Workout finished.');
    rc.markSaved(id);
    if (!history)
      return say(
        `Workout finished: ${fmtClock(r.total)}. History is not available yet, so it was not saved.`,
      );
    try {
      await history.save(entry);
      say(`Workout finished: ${fmtClock(r.total)}. Saved to history.`);
      await refreshPast();
      // A client's record is kept for five years after their last workout.
      if (entry.clientId && clientsApi) {
        try {
          await clientsApi.extendRetention(entry.clientId, entry.date);
          await refreshClients();
        } catch {
          /* the workout is saved; the keep-until date is refreshed on the next one */
        }
      }
    } catch (err) {
      say(`Workout finished, but it could not be saved: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function startRun() {
    if (!session.items.length) return;
    rc.start();
    setSelEq(null);
    setRunMsg('');
  }
  function nextStep() {
    const r = rc.next();
    if (r.status === 'finished') void saveRun(r);
  }
  function endRun() {
    const r = rc.finish();
    if (r.status === 'finished') void saveRun(r);
  }
  function resetRun() {
    rc.reset();
    setRunMsg('');
    setAnnounce('');
  }
  async function copyLog() {
    const entry = entryFor(run, run.histId || 'live', true);
    if (!entry) return;
    const ok = await copyText(runLogText(entry));
    setRunMsg(
      ok ? 'Workout log copied.' : 'Could not copy. Select the text in Past runs and copy it by hand.',
    );
  }
  async function copyEntry(e: HistoryEntry) {
    const ok = await copyText(runLogText(e));
    setRunMsg(ok ? `Log for "${e.title}" copied.` : 'Could not copy the log.');
  }
  /** The finished workout as a results PDF. The route map is drawn only for the gym that is open. */
  function pdfEntry(e: HistoryEntry) {
    const pdf: PdfModel = {
      title: e.title,
      client: e.clientName,
      coach: e.coach,
      date: e.date,
      notes: '',
      gym: e.gymName,
      plannedSecs: e.plannedMin * 60,
      layout: e.gymId === gym!.id ? layout : null,
      actual: { totalMs: e.totalMs },
      items: e.steps.map((s) => ({
        eid: s.eid,
        exercise: s.exercise,
        machine: s.machine,
        zone: s.zone,
        sets: s.sets,
        reps: s.reps,
        rest: s.rest,
        note: '',
        cue: '',
        ms: s.ms,
        done: s.done,
      })),
    };
    try {
      savePdf(
        pdf,
        pdfFileName({ client: e.clientName, date: e.date }, 'results', new Date().toISOString().slice(0, 10)),
      );
      setRunMsg('Results PDF saved.');
    } catch (err) {
      setRunMsg(`The PDF could not be made: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  async function deleteEntry(e: HistoryEntry) {
    if (!history) return;
    try {
      await history.remove(e.id);
      setRunMsg(`Deleted "${e.title}".`);
      await refreshPast();
    } catch (err) {
      setRunMsg(`Could not delete: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** A tap on a machine: during a live run it jumps to that machine; otherwise it opens the exercises pop-up. */
  function selectMachine(id: string | null) {
    if (id && runLive && mode === 'plan') {
      const res = rc.jumpToMachine(id);
      const name = equipById.get(id)?.name ?? 'machine';
      say(
        res.outcome === 'jumped'
          ? `Now at ${name}`
          : res.outcome === 'here'
            ? `Already at ${name}`
            : `${name} is not in the routine or is already done`,
      );
      return;
    }
    setSelEq(id);
  }

  const popupEq = mode === 'plan' && !runLive && selEq ? equipById.get(selEq) : undefined;
  const hint =
    mode === 'edit'
      ? 'Drag a zone or a machine to move it, pull the grips to resize a zone. Nothing is kept until you press Save layout.'
      : runLive
        ? 'Workout running. Tap a machine on the plan to jump to it, or use Set done and Done, next on the bar above. The rest between sets counts down and buzzes when it is over.'
        : run.status === 'finished'
          ? 'Workout finished. Copy the log from the Run tab, or reset to run it again.'
          : tab === 'run'
            ? 'Blue machines are in your routine. Press Start workout to begin. You can still tap a machine to add more exercises.'
            : 'Click a machine to see its exercises and add one to the session. Click a zone to label all of its equipment.';
  const gymNames = Object.fromEntries(gyms.map((g) => [g.id, [g.name, g.branch].filter(Boolean).join(' ')]));
  const showHud = showRun && session.items.length > 0;

  return (
    <ModelsContext.Provider value={models}>
      <div className="wrap">
        <header className="top">
          <div>
            <p className="eyebrow">{[gymTitle, gym.address].filter(Boolean).join(' · ')}</p>
            <h1>{gym.branch || gym.name} Zone Planner</h1>
            <p className="lede">
              Click a machine on the plan, pick an exercise from its pop-up, and it lands in your session.
            </p>
          </div>
          <div className="topright">
            <div className="seg" role="group" aria-label="Mode">
              <button type="button" aria-pressed={mode === 'plan'} onClick={() => chooseMode('plan')}>
                Plan session
              </button>
              <button type="button" aria-pressed={mode === 'edit'} onClick={() => chooseMode('edit')}>
                Edit layout
              </button>
            </div>
            <button type="button" className="btn sm" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </header>

        {showHud && layout && (
          <div ref={hudRef}>
            <RunHud
              run={run}
              items={session.items}
              equipById={equipById}
              title={session.meta.title}
              client={session.meta.client}
              onStart={startRun}
              onPause={rc.pause}
              onResume={rc.resume}
              onBack={rc.back}
              onNext={nextStep}
              onCompleteSet={rc.completeSet}
              onSkipRest={rc.skipRest}
              onCopyLog={() => void copyLog()}
              onReset={resetRun}
            />
          </div>
        )}
        <p className="sr" role="status" aria-live="polite">
          {announce}
        </p>

        <GymBar
          gyms={gyms}
          gymId={gym.id}
          onChange={(id) => void requestSwitch(id)}
          disabled={runLive}
          ask={
            ask
              ? {
                  target: titleOf(gyms.find((g) => g.id === ask.id) ?? gym),
                  dirty: ask.dirty,
                  moved: ask.moved,
                  dropped: ask.dropped,
                  onGo: (how) => void doSwitch(ask.id, how, ask.items),
                  onCancel: () => setAsk(null),
                }
              : null
          }
          edit={
            editing && layoutApi
              ? { dirty, saving, onSave: () => void saveLayout(), onDiscard: discardLayout }
              : null
          }
        />

        <main className="grid">
          <section className="mapcol" aria-label="Gym floor map">
            {layout && activeFloor && (
              <>
                <FloorTabs
                  floors={layout.floors}
                  floorId={activeFloor.id}
                  counts={itemsPerFloor(session.items, equipById)}
                  onChange={changeFloor}
                />
                <MuscleChips filter={filter} onChange={setFilter} />
              </>
            )}
            <div className="mapscroll">
              {gymState.status === 'loading' && (
                <div className="map-placeholder">Loading the floor plan…</div>
              )}
              {gymState.status === 'error' && (
                <div className="map-placeholder" role="alert">
                  {`Could not load the floor plan: ${gymState.message}`}
                </div>
              )}
              {layout && activeFloor && (
                <FloorPlan
                  layout={layout}
                  floorId={activeFloor.id}
                  filter={filter}
                  selZone={selZone}
                  selEq={selEq}
                  items={editing ? undefined : session.items}
                  run={showRun && !editing ? run : null}
                  onSelectZone={(id) => {
                    setSelZone(id);
                    setSelStruct(null);
                    setPart(0);
                  }}
                  onSelectEq={(id) => {
                    setSelStruct(null);
                    selectMachine(id);
                  }}
                  edit={
                    editing
                      ? {
                          snap: snapOn,
                          part,
                          selStruct,
                          onSelectStruct: (id) => {
                            setSelStruct(id);
                            setSelZone(null);
                            setSelEq(null);
                          },
                          onLayout: setDraft,
                        }
                      : null
                  }
                />
              )}
            </div>
            <Legend run={showRun} />
            <p className="hint">{hint}</p>
          </section>
          <aside className="panel" aria-label="Planner panel">
            <div className="tabs" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  id={`tab-${t.id}`}
                  aria-selected={tab === t.id}
                  aria-controls="panelBody"
                  onClick={() => setTab(t.id)}
                >
                  {t.id === 'zone' && mode === 'edit' ? 'Layout' : t.label}
                  {t.id === 'session' ? ` (${session.items.length})` : ''}
                  {t.id === 'run' && runLive ? ' ●' : ''}
                </button>
              ))}
            </div>
            <div id="panelBody" role="tabpanel" aria-labelledby={`tab-${tab}`} className="panel-body">
              {tab === 'zone' && editing && layout && activeFloor && (
                <LayoutTab
                  layout={layout}
                  floorId={activeFloor.id}
                  snap={snapOn}
                  onSnap={setSnapOn}
                  selZone={selZone}
                  selEq={selEq}
                  part={part}
                  onPart={setPart}
                  onSelectZone={(id) => {
                    setSelZone(id);
                    if (id) setSelStruct(null);
                  }}
                  onSelectEq={(id) => {
                    setSelEq(id);
                    if (id) setSelStruct(null);
                  }}
                  selStruct={selStruct}
                  onSelectStruct={(id) => {
                    setSelStruct(id);
                    if (id) {
                      setSelZone(null);
                      setSelEq(null);
                    }
                  }}
                  onGoToFloor={(id) => setFloorId(id)}
                  catalogue={catalogue}
                  onOpenCatalogue={() => setTab('catalogue')}
                  onCopies={(c) => {
                    copiesRef.current = [...copiesRef.current, ...c];
                  }}
                  onChange={setDraft}
                  library={library}
                  savedEquipment={new Set((savedLayout?.equipment ?? []).map((e) => e.id))}
                  onLink={(x, e, on) => void linkExercise(x, e, on)}
                  say={say}
                />
              )}
              {tab === 'zone' && !editing && layout && activeFloor && (
                <ZonesTab
                  layout={layout}
                  library={library}
                  floorId={activeFloor.id}
                  selEq={selEq}
                  onSelectEq={setSelEq}
                  onAdd={addExercise}
                />
              )}
              {tab === 'session' && layout && (
                <SessionTab
                  meta={session.meta}
                  items={session.items}
                  layout={layout}
                  library={library}
                  dispatch={dispatch}
                  clients={clients ?? []}
                >
                  {clientsApi && clients ? (
                    <AssignPanel
                      clients={clients}
                      items={session.items}
                      title={session.meta.title}
                      notes={session.meta.notes}
                      gymId={gym.id}
                      api={clientsApi}
                      selectedId={session.meta.clientId}
                      onAssigned={refreshClients}
                    />
                  ) : null}
                  {session.items.length > 0 && (
                    <section className="share" aria-label="Send to your client">
                      <h3>Send to your client</h3>
                      <SendActions
                        key={session.meta.clientId}
                        pdf={
                          buildShare({
                            title: session.meta.title,
                            client: session.meta.client,
                            coach: session.meta.coach,
                            date: session.meta.date,
                            notes: session.meta.notes,
                            gym: gymLine,
                            items: snapsOf(session.items),
                            layout,
                            library,
                            models,
                          }).pdf
                        }
                        whatsapp={sending?.whatsapp ?? ''}
                        email={sending?.email ?? ''}
                      />
                      <p className="sub">
                        To send a link the client opens on their phone, assign the programme to them and share
                        it from their profile in the Clients tab.
                      </p>
                    </section>
                  )}
                  {templates ? (
                    <TemplatesPanel
                      api={templates}
                      gymId={gym.id}
                      gymNames={gymNames}
                      items={session.items}
                      title={session.meta.title}
                      notes={session.meta.notes}
                      onUse={(t, how) => void applyTemplate(t, how)}
                    />
                  ) : null}
                </SessionTab>
              )}
              {tab === 'run' && layout && (
                <RunTab
                  run={run}
                  items={session.items}
                  equipById={equipById}
                  templates={templates}
                  history={past}
                  historyError={pastError}
                  onStart={startRun}
                  onEnd={endRun}
                  onReset={resetRun}
                  onGo={rc.go}
                  onCopyLog={() => void copyLog()}
                  onLoadTemplate={(t) => void applyTemplate(t, 'replace', true)}
                  onCopyEntry={(e) => void copyEntry(e)}
                  onDeleteEntry={(e) => void deleteEntry(e)}
                  onPdfEntry={pdfEntry}
                  status={runMsg}
                  place={placeOf}
                />
              )}
              {tab === 'clients' && (
                <ClientsTab
                  clients={clients}
                  error={clientsError}
                  api={clientsApi}
                  profile={profile}
                  profileApi={profileApi}
                  onProfileSaved={setProfile}
                  onChanged={refreshClients}
                  onOpenProgramme={(prog, client) => void openProgramme(prog, client)}
                  say={say}
                  shareApi={shareApi}
                  shareContext={{ gymId: gym.id, gymLine, layout, library }}
                />
              )}
              {!layout && (tab === 'zone' || tab === 'session' || tab === 'run') && (
                <p className="hint">Waiting for the floor plan…</p>
              )}
              {tab === 'catalogue' && (
                <CatalogueTab
                  catalogue={catalogue}
                  error={catalogueError}
                  api={catalogueApi}
                  onChanged={refreshCatalogue}
                />
              )}
              {tab === 'gyms' && (
                <GymsTab
                  gyms={gyms}
                  openId={gym.id}
                  dirty={dirty}
                  api={gymsApi}
                  disabled={runLive}
                  onCreate={createGym}
                  onDuplicate={duplicateGym}
                  onOpen={(id) => void requestSwitch(id)}
                  onChanged={onGymsChanged}
                  say={say}
                />
              )}
              {tab !== 'zone' &&
                tab !== 'session' &&
                tab !== 'run' &&
                tab !== 'clients' &&
                tab !== 'gyms' &&
                tab !== 'catalogue' && (
                  <p className="hint">{TABS.find((t) => t.id === tab)?.label} tab: not built yet.</p>
                )}
            </div>
          </aside>
        </main>

        {popupEq && layout && (
          <MachinePopup
            equipment={popupEq}
            place={placeOf(popupEq)}
            exercises={exercisesFor(library, popupEq.id)}
            inSession={session.items
              .filter((it) => it.eid === popupEq.id && it.xid)
              .reduce<Record<string, number>>((m, it) => ({ ...m, [it.xid!]: (m[it.xid!] ?? 0) + 1 }), {})}
            onAdd={(x) => addExercise(popupEq.id, x)}
            onClose={() => setSelEq(null)}
          />
        )}

        {toast && (
          <div className="toast" role="status" aria-live="polite">
            {toast.msg}
            {toast.view && tab !== 'session' && (
              <button type="button" className="link" onClick={() => setTab('session')}>
                View session
              </button>
            )}
          </div>
        )}
      </div>
    </ModelsContext.Provider>
  );
}
