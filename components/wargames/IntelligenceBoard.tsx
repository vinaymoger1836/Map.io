'use client';
import { useEffect, useMemo, useState } from 'react';
import type { WarSimSession } from '@/lib/warSimTypes';
import type { SimulationCommand } from '@/lib/warsim/contracts';
import { toENU } from '@/lib/warsim/physics/coordinates';
import styles from './TacticalViewport.module.css';

interface Props { session: WarSimSession; dispatch: (c: SimulationCommand) => void;
  selectedContactId: string | null; onSelectContact: (id: string | null) => void; onClearSelection: () => void; onClose: () => void }

export function IntelligenceBoard({ session: s, dispatch, selectedContactId, onSelectContact, onClearSelection, onClose }: Props) {
  const intel = s.intelView;
  const iso = s.activeFaction === 'player' ? s.playerIso : s.enemyIso;
  const contacts = s.activeFaction === 'player' ? s.fogOfWarContacts.playerContacts : s.fogOfWarContacts.enemyContacts;
  const target = contacts.find(c => c.contactId === selectedContactId) ?? contacts[0];
  const [asset, setAsset] = useState(''), [support, setSupport] = useState(''), [radius, setRadius] = useState(1200);
  const [longitude, setLongitude] = useState(''), [latitude, setLatitude] = useState('');
  const [onLoss, setOnLoss] = useState<'hold' | 'abort' | 'continue-local'>('hold');
  const [delaySec, setDelaySec] = useState(0);
  const [shooter, setShooter] = useState('');
  const friendly = s.entities.filter(e => e.status !== 'destroyed');
  useEffect(() => {
    setAsset(friendly.find(e => e.id.includes('scout'))?.id ?? friendly[0]?.id ?? ''); setSupport(friendly.find(e => e.id.includes('scout'))?.id ?? friendly[0]?.id ?? '');
    setShooter(friendly.find(e => (e.magazines[0] ?? 0) > 0)?.id ?? '');
  }, [s.id, s.activeFaction]);
  const scopeOptions = useMemo(() => [
    { id: `${iso}:hq`, label: 'Command group / HQ' }, { id: `${iso}:faction`, label: 'Faction picture' },
    { id: `${iso}:coalition`, label: 'Coalition picture' }, ...friendly.map(e => ({ id: `${e.id}:local`, label: `${e.name} / local` }))
  ], [iso, friendly.map(e => e.id).join('|')]);
  const scope = s.observerScope ?? `${iso}:hq`;
  const selectedSensor = intel?.sensors.find(x => x.actorId === asset);
  const sensorCondition = s.physical?.actors.find(a => a.id === asset)?.condition?.sensor ?? 100;
  const selectedLink = intel?.links.find(x => x.from === `${asset}:local`);
  const coverage = intel?.coverage.slice(-4).reverse() ?? [];
  const targetEvidence = intel?.tracks.find(t => t.id === target?.contactId);
  const coord = target?.lastKnownLngLat ?? friendly[0]?.lngLat ?? s.physical?.origin.slice(0, 2) as [number, number] | undefined;
  const collection = () => {
    if (!s.physical || !asset || !coord) return;
    const lng = longitude === '' ? coord[0] : Number(longitude), lat = latitude === '' ? coord[1] : Number(latitude);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) return;
    const center = toENU([lng, lat, 0], s.physical.origin);
    dispatch({ type: 'requestPhysicalCollection', args: [asset, center, radius] });
  };
  return <aside className={styles.intelPanel} aria-label="Intelligence and coordination board">
    <div className={styles.intelHead}><div><div className={styles.eyebrow}>INTELLIGENCE / COORDINATION</div><h2>Knowledge picture</h2></div><button onClick={onClose}>Close</button></div>
    <label>Observer scope<select aria-label="Observer scope" value={scope} onChange={e => { onClearSelection(); dispatch({ type: 'setObserverScope', args: [e.target.value] }); }}>
      {scopeOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select></label>
    <p>Observations reach local sensors first. Links deliver reports to headquarters and faction views after simulated delay.</p>
    <div className={styles.eyebrow}>CONTACT ASSESSMENTS / {contacts.length}</div>
    {contacts.map(c => <button key={c.contactId} className={styles.intelRow} onClick={() => onSelectContact(c.contactId)}>
      <strong>{c.knownName ?? 'Unknown contact'}</strong><span>{c.trackState?.toUpperCase() ?? 'TRACK'} · {(c.confidence! * 100).toFixed(0)}% confidence · ±{Math.round(c.uncertaintyM ?? 0)} m</span>
      <small>Observed {c.decayTimerSec.toFixed(1)} s ago · revision {c.revision}</small>
    </button>)}
    {!contacts.length && <p>No contact in this scope. Select a sensor or request area collection.</p>}
    {target && <div className={styles.intelDetail}><strong>{target.knownName}</strong><div>Evidence: {target.evidenceIds?.slice(-4).join(', ') ?? 'none'}</div>
      <div>Sources: {targetEvidence?.sourceIds.join(', ') ?? target.sourceIds?.join(', ') ?? 'unknown'}</div>
      <div>Position: {target.lastKnownLngLat.map(n => n.toFixed(4)).join(', ')}</div>
      <div className={styles.eyebrow}>REPORT HISTORY</div>
      {targetEvidence?.history.map(report => <div className={styles.intelEntry} key={report.id}>{report.sourceId} / {report.modality}
        <small>Observed T+{report.collectedSec.toFixed(1)} / received T+{report.receivedSec.toFixed(1)} / uncertainty {Math.round(report.uncertaintyM)} m</small></div>)}</div>}
    <div className={styles.eyebrow}>COLLECTION PLANNER</div>
    <label>Sensor asset<select aria-label="Collection asset" value={asset} onChange={e => setAsset(e.target.value)}>{friendly.map(e => <option value={e.id} key={e.id}>{e.name}</option>)}</select></label>
    <div className={styles.intelStats}><span>Emission: {selectedSensor?.mode ?? '—'}</span><span>Link: {selectedLink?.active ? 'online' : 'offline'}</span><span>Time: {selectedSensor?.sensorTime.toFixed(1) ?? '—'}%</span></div>
    {sensorCondition < 30 && <p>Sensor damaged: collection and active emission are blocked until repaired.</p>}
    <p>Data link latency: {((selectedLink?.latencyTicks ?? 0) / 10).toFixed(1)} s; queued reports: {intel?.messages.filter(m => m.from === `${asset}:local` && m.status === 'queued').length ?? 0}.</p>
    <div className={styles.intelActions}>
      <button disabled={!asset || selectedSensor?.mode !== 'active' && sensorCondition < 30} onClick={() => dispatch({ type: 'setPhysicalEmission', args: [asset, selectedSensor?.mode === 'active' ? 'passive' : 'active'] })}>{selectedSensor?.mode === 'active' ? 'Go passive' : 'Activate sensor'}</button>
      <button disabled={!asset} onClick={() => dispatch({ type: 'setPhysicalLink', args: [asset, !selectedLink?.active] })}>{selectedLink?.active ? 'Disconnect link' : 'Reconnect link'}</button>
    </div>
    <p>Search center defaults to the selected contact estimate. Enter coordinates to search elsewhere.</p>
    <div className={styles.intelCoords}><label>Longitude<input aria-label="Search longitude" type="number" step="0.001" value={longitude} onChange={e => setLongitude(e.target.value)} placeholder={coord?.[0].toFixed(3)} /></label>
      <label>Latitude<input aria-label="Search latitude" type="number" step="0.001" value={latitude} onChange={e => setLatitude(e.target.value)} placeholder={coord?.[1].toFixed(3)} /></label></div>
    <label>Area radius <span>{radius} m</span><input aria-label="Search radius" type="range" min="100" max="9000" step="100" value={radius} onChange={e => setRadius(+e.target.value)} /></label>
    <button onClick={collection} disabled={!asset || sensorCondition < 30}>Request collection</button>
    {intel?.tasks.slice(-4).reverse().map(task => <div className={styles.intelEntry} key={task.id}>{task.id} · {task.status}
      <small>{task.assetId} · {task.evidenceIds.length} observation(s)</small></div>)}
    <div className={styles.eyebrow}>RECENT COVERAGE</div>
    {coverage.length ? coverage.map(c => <div className={styles.intelEntry} key={c.id}>{c.result} · {c.sensorId}<small>T+{(c.observedTick / 10).toFixed(1)} · area radius {c.radiusM.toFixed(0)} m</small></div>) : <p>No area report has reached this scope.</p>}
    <div className={styles.eyebrow}>COORDINATED STRIKE</div>
    <label>Shooter<select aria-label="Mission shooter" value={shooter} onChange={e => setShooter(e.target.value)}>{friendly.map(e => <option value={e.id} key={e.id}>{e.name}</option>)}</select></label>
    <label>Support sensor<select aria-label="Mission support" value={support} onChange={e => setSupport(e.target.value)}>{friendly.map(e => <option value={e.id} key={e.id}>{e.name}</option>)}</select></label>
    <label>If support is lost<select aria-label="Mission fallback" value={onLoss} onChange={e => setOnLoss(e.target.value as typeof onLoss)}>
      <option value="hold">Hold and resume</option><option value="abort">Abort and release</option><option value="continue-local">Continue on local track</option>
    </select></label>
    <label>Execution delay <span>{delaySec} s</span><input aria-label="Mission delay" type="range" min="0" max="30" step="1" value={delaySec} onChange={e => setDelaySec(+e.target.value)} /></label>
    <button disabled={!target || !shooter || !support || shooter === support || (s.physical?.actors.find(a => a.id === shooter)?.condition?.strikeLauncher ?? 100) < 30 || (s.physical?.actors.find(a => a.id === support)?.condition?.sensor ?? 100) < 30} onClick={() => target && dispatch({ type: 'planPhysicalStrike', args: [shooter, target.contactId, support, target.revision ?? 0, onLoss, delaySec] })}>Reserve coordinated strike</button>
    {intel?.missions.slice(-4).reverse().map(m => <div className={styles.intelEntry} key={m.id}><strong>{m.id} · {m.status}</strong><small>{m.reason}</small>
      {m.notBeforeTick !== undefined && <small>Earliest launch T+{(m.notBeforeTick / 10).toFixed(1)} {m.outcome ? `· outcome: ${m.outcome} at T+${((m.completedTick ?? 0) / 10).toFixed(1)}` : ''}</small>}
      <small>Support: {m.supportId} · evidence {m.evidenceIds.slice(-2).join(', ')}</small>
      {!['executed', 'aborted'].includes(m.status) && <button onClick={() => dispatch({ type: 'cancelPhysicalMission', args: [m.id] })}>Cancel mission</button>}</div>)}
    <p>Reserved rounds: {intel?.reservations.filter(r => r.resource === 'strike-round').length ?? 0}. Sensor channels: {intel?.reservations.filter(r => r.resource === 'sensor-channel').length ?? 0}.</p>
    <div className={styles.eyebrow}>SHARING</div>
    <p>Faction and coalition pictures receive each report once by evidence ID.</p>
    <button onClick={() => dispatch({ type: 'setCoalitionSharing', args: [!intel?.links.some(l => l.to === `${iso}:coalition` && l.active)] })}>
      {intel?.links.some(l => l.to === `${iso}:coalition` && l.active) ? 'Disable coalition sharing' : 'Enable coalition sharing'}
    </button>
  </aside>;
}
