'use client';
import { useEffect, useRef, useState } from 'react';
import type { WarSimSession } from '@/lib/warSimTypes';
import type { SimulationCommand } from '@/lib/warsim/contracts';
import { TacticalScene } from '@/lib/warsim/tactical/scene';
import styles from './TacticalViewport.module.css';
import { IntelligenceBoard } from './IntelligenceBoard';

interface Props {
  session: WarSimSession; selectedId: string | null; selectedContactId: string | null;
  onSelect: (id: string | null) => void; onSelectContact: (id: string | null) => void;
  dispatch: (command: SimulationCommand) => void; onClose: () => void; onExit: () => void;
  runtimeError: string | null;
}
export default function TacticalViewport(p: Props) {
  const host = useRef<HTMLDivElement>(null), scene = useRef<TacticalScene | null>(null), latest = useRef(p); latest.current = p;
  const [error, setError] = useState(''), [sound, setSound] = useState(false), [quality, setQuality] = useState('balanced');
  const [intelOpen, setIntelOpen] = useState(false);
  const [heading, setHeading] = useState(0), [speed, setSpeed] = useState(8);
  const s = p.session;
  const contacts = s.activeFaction === 'player' ? s.fogOfWarContacts.playerContacts : s.fogOfWarContacts.enemyContacts;
  const selected = s.entities.find(e => e.id === p.selectedId) ?? s.entities[0];
  const target = contacts.find(c => c.contactId === p.selectedContactId) ?? contacts[0];
  const actor = s.physical?.actors.find(a => a.id === selected?.id);
  useEffect(() => {
    setError(''); setSound(false);
    try { scene.current = new TacticalScene(host.current!, latest.current.session, (id, contact) => {
      if (contact) latest.current.onSelectContact(id); else latest.current.onSelect(id);
    }, setError); scene.current.quality(false); }
    catch (e) { setError(`Unable to start 3D graphics: ${String(e)}`); }
    return () => { scene.current?.dispose(); scene.current = null; };
  }, [s.id, s.activeFaction]);
  useEffect(() => { scene.current?.update(s); }, [s]);
  useEffect(() => { scene.current?.focus(selected?.id ?? null); }, [selected?.id, s.id, s.activeFaction]);
  useEffect(() => { scene.current?.quality(quality === 'high'); }, [quality, s.id, s.activeFaction]);
  useEffect(() => { if (actor) { setHeading(actor.course); setSpeed(actor.desiredSpeed); } }, [actor?.id]); // local order drafts survive new snapshots
  const send = (command: SimulationCommand) => p.dispatch(command);
  return <section className={styles.viewport} aria-label="Tactical view">
    <div className={styles.canvas} ref={host} />
    <div className={styles.vignette} />
    <header className={styles.header}>
      <div><div className={styles.eyebrow}>TACTICAL / {s.activeFaction === 'player' ? 'BLUE' : 'RED'} FORCE</div><h1>{s.physical ? 'GLASSWATER' : s.name}</h1><p>{s.physical ? 'Coastal encounter · synthetic physical model' : 'Theater visualization · legacy simulation model'}</p></div>
      <div className={styles.toolbar}>
        <button onClick={() => scene.current?.overview()}>Overview</button>
        <button onClick={() => scene.current?.focus(selected?.id ?? null)}>Follow selected</button>
        {s.physical && <button onClick={() => setIntelOpen(open => !open)}>Intel & coordination</button>}
        <select aria-label="Graphics quality" value={quality} onChange={e => setQuality(e.target.value)}><option value="balanced">Balanced graphics</option><option value="high">High graphics</option></select>
        <button aria-pressed={sound} onClick={async () => { try { await scene.current?.audioEnabled(!sound); setSound(!sound); } catch { setError('Audio could not start.'); } }}>Sound {sound ? 'on' : 'off'}</button>
        <button onClick={p.onClose}>Command map</button>
      </div>
    </header>
    {!intelOpen && <aside className={styles.assets}>
      <div className={styles.eyebrow}>FRIENDLY PLATFORMS</div>
      {s.entities.map(e => <button key={e.id} className={e.id === selected?.id ? styles.selected : ''} onClick={() => { p.onSelect(e.id); scene.current?.focus(e.id); }}><span>{e.name}</span><small>{e.status === 'destroyed' ? 'LOST' : `${e.speedKmh.toFixed(0)} km/h · ${e.currentFuelPct.toFixed(0)}% fuel`}</small></button>)}
      <div className={styles.eyebrow}>OBSERVED CONTACTS / {contacts.length}</div>
      {contacts.map(c => <button key={c.contactId} className={c.contactId === target?.contactId ? styles.hostile : ''} onClick={() => p.onSelectContact(c.contactId)}><span>{c.knownName ?? 'Unclassified track'}</span><small>{c.domain.toUpperCase()} · updated T+{c.lastDetectedSimTimeSec.toFixed(1)}</small></button>)}
      <p>Contact markers show reported positions. Drag to orbit, right-drag to pan, scroll to zoom.</p>
    </aside>}
    {intelOpen && s.physical && <IntelligenceBoard session={s} dispatch={send} selectedContactId={p.selectedContactId}
      onSelectContact={p.onSelectContact} onClearSelection={() => { p.onSelect(null); p.onSelectContact(null); }} onClose={() => setIntelOpen(false)} />}
    <aside className={styles.orders}>
      <div className={styles.eyebrow}>SELECTED PLATFORM</div><h2>{selected?.name ?? 'No platform selected'}</h2>
      {actor && <><div className={styles.stats}><div><strong>{actor.rounds}</strong><small>STRIKE ROUNDS</small></div><div><strong>{actor.interceptors}</strong><small>DEFENSIVE ROUNDS</small></div><div><strong>{actor.health}%</strong><small>INTEGRITY</small></div></div>
        <label>Course <span>{heading.toFixed(0)}°</span><input aria-label="Course" type="range" min="0" max="359" value={heading} onChange={e => setHeading(+e.target.value)} /></label>
        <label>Speed <span>{speed} m/s</span><input aria-label="Vessel speed" type="range" min="0" max="16" value={speed} onChange={e => setSpeed(+e.target.value)} /></label>
        <button disabled={actor.health <= 0} onClick={() => send({ type: 'setPhysicalCourse', args: [actor.id, heading, speed] })}>Apply course & speed</button>
        <button className={styles.fire} disabled={!target || actor.rounds < 1 || actor.health <= 0 || actor.cooldown > s.simTimeSec || target.trackState === 'lost'} onClick={() => target && send({ type: 'launchPhysical', args: [actor.id, target.contactId, target.revision] })}>Launch guided round</button>
        <p>Defensive fire is automatic inside 1.8 km. Start time to advance launched rounds.</p></>}
      {target && <p>Track: {target.trackState ?? 'legacy'} · ±{Math.round(target.uncertaintyM ?? 0)} m · {((target.confidence ?? 0) * 100).toFixed(0)}% confidence</p>}
      <div className={styles.eyebrow}>ENGAGEMENT LOG</div>
      <div className={styles.log} aria-live="polite">{s.eventLog.slice(-5).reverse().map(e => <div key={e.id}><time>{e.timeFormatted}</time> {e.title}</div>)}{!s.eventLog.length && <p>Awaiting orders.</p>}</div>
    </aside>
    {(error || p.runtimeError) && <div className={styles.error} role="alert">{error || p.runtimeError}<button onClick={p.onClose}>Return to command map</button></div>}
    <footer className={styles.footer}>
      <div><div className={styles.eyebrow}>SIMULATION TIME</div><strong data-testid="tactical-time">T+{s.simTimeSec.toFixed(1).padStart(6, '0')}</strong></div>
      <button className={styles.play} onClick={() => send({ type: 'togglePlay', args: [] })}>{s.status === 'running' ? 'Pause time' : 'Start time'}</button>
      <select aria-label="Tactical time multiplier" value={s.timeMultiplier} onChange={e => send({ type: 'setSpeedMultiplier', args: [+e.target.value] })}>{[1, 3, 5, 10, 30].map(n => <option key={n} value={n}>{n}× speed</option>)}</select>
      <span className={styles.model}>METRE SCALE · {s.physical ? 'CONTINUOUS COLLISION' : 'OBSERVER VIEW'}</span>
      <button onClick={() => { p.onSelect(null); p.onSelectContact(null); send({ type: 'switchActiveFaction', args: [] }); }}>Switch faction</button>
      <button onClick={p.onExit}>Exit simulation</button>
    </footer>
  </section>;
}
