'use client';
import { useEffect, useRef, useState } from 'react';
import type { WarSimSession } from '@/lib/warSimTypes';
import type { SimulationCommand } from '@/lib/warsim/contracts';
import { TacticalScene } from '@/lib/warsim/tactical/scene';
import styles from './TacticalViewport.module.css';
import { IntelligenceBoard } from './IntelligenceBoard';
import { CAPABILITIES, condition } from '@/lib/warsim/physics/readiness';
import type { FactionReplay } from '@/lib/warsim/replay';

interface Props {
  session: WarSimSession; selectedId: string | null; selectedContactId: string | null;
  onSelect: (id: string | null) => void; onSelectContact: (id: string | null) => void;
  dispatch: (command: SimulationCommand) => void; onClose: () => void; onExit: () => void;
  getReplay: () => FactionReplay | null;
  runtimeError: string | null; onDismissRuntimeError: () => void;
}
export default function TacticalViewport(p: Props) {
  const host = useRef<HTMLDivElement>(null), scene = useRef<TacticalScene | null>(null), latest = useRef(p); latest.current = p;
  const [error, setError] = useState(''), [sound, setSound] = useState(false), [quality, setQuality] = useState('balanced');
  const [intelOpen, setIntelOpen] = useState(false);
  const [replay, setReplay] = useState<FactionReplay | null>(null), [replayIndex, setReplayIndex] = useState(0);
  const [heading, setHeading] = useState(0), [speed, setSpeed] = useState(8);
  const frame = replay?.frames[replayIndex];
  const s = frame?.session ?? p.session;
  const contacts = s.activeFaction === 'player' ? s.fogOfWarContacts.playerContacts : s.fogOfWarContacts.enemyContacts;
  const selected = s.entities.find(e => e.id === p.selectedId) ?? s.entities[0];
  const target = contacts.find(c => c.contactId === p.selectedContactId) ?? contacts[0];
  const actor = s.physical?.actors.find(a => a.id === selected?.id);
  const reservedRounds = s.intelView?.reservations.filter(r => r.assetId === actor?.id && r.resource === 'strike-round').length ?? 0;
  useEffect(() => {
    setError(''); setSound(false);
    try { scene.current = new TacticalScene(host.current!, latest.current.session, (id, contact) => {
      if (contact) latest.current.onSelectContact(id); else latest.current.onSelect(id);
    }, setError); scene.current.quality(false); }
    catch (e) { setError(`Unable to start 3D graphics: ${String(e)}`); }
    return () => { scene.current?.dispose(); scene.current = null; };
  }, [s.id, s.activeFaction]);
  useEffect(() => { scene.current?.update(frame ? { ...s, status: 'paused' } : s); }, [s, frame]);
  useEffect(() => { setReplay(null); }, [p.session.id, p.session.activeFaction]);
  useEffect(() => { scene.current?.focus(selected?.id ?? null); }, [selected?.id, s.id, s.activeFaction]);
  useEffect(() => { scene.current?.quality(quality === 'high'); }, [quality, s.id, s.activeFaction]);
  useEffect(() => { if (actor) { setHeading(actor.course); setSpeed(actor.desiredSpeed); } }, [actor?.id]); // local order drafts survive new snapshots
  const send = (command: SimulationCommand) => p.dispatch(command);
  const openReplay = () => {
    const archive = p.getReplay();
    if (!archive?.frames.length) return;
    setReplay(archive); setReplayIndex(archive.frames.length - 1);
  };
  const exportReplay = () => {
    if (!replay) return;
    const blob = new Blob([JSON.stringify(replay, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `warsim-aar-${p.session.id}-${replay.faction}.json`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className={styles.viewport} aria-label="Tactical view">
    <div className={styles.canvas} ref={host} />
    <div className={styles.vignette} />
    <header className={styles.header}>
      <div><div className={styles.eyebrow}>TACTICAL / {s.activeFaction === 'player' ? 'BLUE' : 'RED'} FORCE</div><h1>{s.physical ? 'GLASSWATER' : s.name}</h1><p>{s.physical ? `${s.name.includes('Joint probe') ? 'Joint probe' : 'Coastal encounter'} · synthetic physical model` : 'Theater visualization · legacy simulation model'}</p></div>
      <div className={styles.toolbar}>
        <button onClick={() => scene.current?.overview()}>Overview</button>
        <button onClick={() => scene.current?.focus(selected?.id ?? null)}>Follow selected</button>
        {s.physical && <button disabled={Boolean(replay)} onClick={() => setIntelOpen(open => !open)}>Intel & coordination</button>}
        {s.physical?.objectives && <button disabled={p.session.status === 'running'} onClick={openReplay}>Replay & AAR</button>}
        <select aria-label="Graphics quality" value={quality} onChange={e => setQuality(e.target.value)}><option value="balanced">Balanced graphics</option><option value="high">High graphics</option></select>
        <button aria-pressed={sound} onClick={async () => { try { await scene.current?.audioEnabled(!sound); setSound(!sound); } catch { setError('Audio could not start.'); } }}>Sound {sound ? 'on' : 'off'}</button>
        <button onClick={p.onClose}>Command map</button>
      </div>
    </header>
    {!replay && !intelOpen && <aside className={styles.assets}>
      <div className={styles.eyebrow}>FRIENDLY PLATFORMS</div>
      {s.entities.map(e => <button key={e.id} className={e.id === selected?.id ? styles.selected : ''} onClick={() => { p.onSelect(e.id); scene.current?.focus(e.id); }}><span>{e.name}</span><small>{e.status === 'destroyed' ? 'LOST' : `${e.speedKmh.toFixed(0)} km/h · ${e.currentFuelPct.toFixed(0)}% fuel · ${e.status === 'in_repair' ? 'REPAIRING' : e.damage === 'damaged' ? 'DAMAGED' : 'READY'}`}</small></button>)}
      <div className={styles.eyebrow}>OBSERVED CONTACTS / {contacts.length}</div>
      {contacts.map(c => <button key={c.contactId} className={c.contactId === target?.contactId ? styles.hostile : ''} onClick={() => p.onSelectContact(c.contactId)}><span>{c.knownName ?? 'Unclassified track'}</span><small>{c.domain.toUpperCase()} · updated T+{c.lastDetectedSimTimeSec.toFixed(1)}</small></button>)}
      <p>Contact markers show reported positions. Drag to orbit, right-drag to pan, scroll to zoom.</p>
    </aside>}
    {!replay && intelOpen && s.physical && <IntelligenceBoard session={s} dispatch={send} selectedContactId={p.selectedContactId}
      onSelectContact={p.onSelectContact} onClearSelection={() => { p.onSelect(null); p.onSelectContact(null); }} onClose={() => setIntelOpen(false)} />}
    {!replay && <aside className={styles.orders}>
      {s.physical?.objectives && <div className={styles.intelEntry}>
        <div className={styles.eyebrow}>SCENARIO OBJECTIVE · {s.physical.objectives.status.toUpperCase()}</div>
        <strong>{s.activeFaction === 'player' ? s.physical.objectives.blueBrief : s.physical.objectives.redBrief}</strong>
        <small>{s.physical.objectives.status === 'ongoing' ? `${Math.max(0, s.physical.objectives.deadlineTick / 10 - s.simTimeSec).toFixed(1)} s remaining`
          : `Concluded T+${((s.physical.objectives.concludedTick ?? 0) / 10).toFixed(1)}`}</small>
        {s.physical.objectives.status === 'ongoing' && <small>Tip: {s.physical.objectives.trainingPrompts[contacts.length ? s.intelView?.reservations.length ? 2 : 1 : 0]}</small>}
      </div>}
      <div className={styles.eyebrow}>SELECTED PLATFORM</div><h2>{selected?.name ?? 'No platform selected'}</h2>
      {actor && <><div className={styles.stats}><div><strong>{actor.rounds}</strong><small>STRIKE ROUNDS</small></div><div><strong>{actor.interceptors}</strong><small>DEFENSIVE ROUNDS</small></div><div><strong>{actor.health.toFixed(0)}%</strong><small>INTEGRITY</small></div></div>
        <div className={styles.eyebrow}>READINESS / {actor.repairKits ?? 0} REPAIR KITS</div>
        {CAPABILITIES.map(capability => <div key={capability} className={styles.intelEntry}>
          <strong>{capability.replace(/([A-Z])/g, ' $1')} · {condition(actor, capability).toFixed(0)}%</strong>
          <small>{condition(actor, capability) < 30 ? 'Unavailable' : condition(actor, capability) < 100 ? 'Degraded' : 'Ready'}</small>
          {condition(actor, capability) < 100 && !actor.repairJob && <button disabled={actor.health <= 0 || actor.speed > .5 || actor.desiredSpeed > .5 || !actor.repairKits} onClick={() => send({ type: 'startPhysicalRepair', args: [actor.id, capability] })}>Repair</button>}
        </div>)}
        {actor.repairJob && <div className={styles.intelEntry}>Repairing {actor.repairJob.capability} · {actor.repairJob.remainingSec.toFixed(1)} s remaining
          <button onClick={() => send({ type: 'cancelPhysicalRepair', args: [actor.id] })}>Cancel repair</button></div>}
        <label>Course <span>{heading.toFixed(0)}°</span><input aria-label="Course" type="range" min="0" max="359" value={heading} onChange={e => setHeading(+e.target.value)} /></label>
        {(actor.domain !== 'land' || actor.groundMobility === 'tracked') && actor.domain !== 'space' && <label>Speed <span>{speed} m/s</span><input aria-label="Vessel speed" type="range" min="0" max={actor.domain === 'air' ? 120 : actor.domain === 'subsurface' ? 8 : actor.domain === 'land' ? 12 : 16} value={speed} onChange={e => setSpeed(+e.target.value)} /></label>}
        <button disabled={actor.health <= 0 || actor.domain === 'land' && actor.groundMobility !== 'tracked' || actor.domain === 'space' || speed > 0 && (!!actor.repairJob || condition(actor, 'propulsion') < 30)} onClick={() => send({ type: 'setPhysicalCourse', args: [actor.id, heading, speed] })}>Apply course & speed</button>
        <button className={styles.fire} disabled={!target || ['sub', 'space'].includes(target.domain) || actor.rounds - reservedRounds < 1 || actor.health <= 0 || condition(actor, 'strikeLauncher') < 30 || actor.cooldown > s.simTimeSec || target.trackState === 'lost' || (target.confidence ?? 0) < .3} onClick={() => target && send({ type: 'launchPhysical', args: [actor.id, target.contactId, target.revision] })}>Launch guided round</button>
        <p>Defensive fire is automatic inside 1.8 km. Start time to advance launched rounds.</p></>}
      {target && <p>Track: {target.trackState ?? 'legacy'} · ±{Math.round(target.uncertaintyM ?? 0)} m · {((target.confidence ?? 0) * 100).toFixed(0)}% confidence{['sub', 'space'].includes(target.domain) ? ' · surface round incompatible' : ''}</p>}
      <div className={styles.eyebrow}>ENGAGEMENT LOG</div>
      <div className={styles.log} aria-live="polite">{s.eventLog.slice(-5).reverse().map(e => <div key={e.id}><time>{e.timeFormatted}</time> {e.title}</div>)}{!s.eventLog.length && <p>Awaiting orders.</p>}</div>
    </aside>}
    {replay && frame && <aside className={styles.replayPanel} role="dialog" aria-label="Recorded replay">
      <div className={styles.intelHead}><div><div className={styles.eyebrow}>RECORDED / {replay.faction.toUpperCase()}</div><h2>Replay & AAR</h2></div>
        <button onClick={() => setReplay(null)}>Close replay</button></div>
      <p>Recorded faction view every {(replay.intervalTicks / 10).toFixed(1)} s. T+{frame.session.simTimeSec.toFixed(1)} / {replay.frames.at(-1)?.session.simTimeSec.toFixed(1)}.</p>
      <input aria-label="Replay time" type="range" min="0" max={replay.frames.length - 1} value={replayIndex}
        onChange={e => setReplayIndex(+e.target.value)} />
      <div className={styles.replayActions}><button disabled={replayIndex === 0} onClick={() => setReplayIndex(n => n - 1)}>Previous</button>
        <button disabled={replayIndex === replay.frames.length - 1} onClick={() => setReplayIndex(n => n + 1)}>Next</button></div>
      <button onClick={exportReplay}>Export faction AAR JSON</button>
      <div className={styles.eyebrow}>RECORDED EVENTS</div>
      {replay.records.filter(r => r.tick <= frame.tick && r.tick >= frame.tick - 100).slice(-8).reverse().map(r =>
        <div className={styles.intelEntry} key={r.id}><strong>T+{(r.tick / 10).toFixed(1)} · {r.title}</strong><small>{r.detail}</small></div>)}
    </aside>}
    {error && <div className={styles.error} role="alert">{error}<button onClick={p.onClose}>Return to command map</button></div>}
    {p.runtimeError && !error && <div className={styles.error} role="alert">{p.runtimeError}<button onClick={p.onDismissRuntimeError}>Dismiss order message</button></div>}
    <footer className={styles.footer}>
      <div><div className={styles.eyebrow}>SIMULATION TIME</div><strong data-testid="tactical-time">T+{s.simTimeSec.toFixed(1).padStart(6, '0')}</strong></div>
      <button className={styles.play} disabled={Boolean(replay) || p.session.status === 'concluded'} onClick={() => send({ type: 'togglePlay', args: [] })}>{s.status === 'running' ? 'Pause time' : 'Start time'}</button>
      <select aria-label="Tactical time multiplier" value={s.timeMultiplier} onChange={e => send({ type: 'setSpeedMultiplier', args: [+e.target.value] })}>{[1, 3, 5, 10, 30].map(n => <option key={n} value={n}>{n}× speed</option>)}</select>
      <span className={styles.model}>METRE SCALE · {s.physical ? 'CONTINUOUS COLLISION' : 'OBSERVER VIEW'}</span>
      <button disabled={Boolean(replay)} onClick={() => { p.onSelect(null); p.onSelectContact(null); send({ type: 'switchActiveFaction', args: [] }); }}>Switch faction</button>
      <button onClick={p.onExit}>Exit simulation</button>
    </footer>
  </section>;
}
