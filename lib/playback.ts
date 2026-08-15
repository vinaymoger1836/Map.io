/**
 * Interactive Battle Playback & Animation Engine
 *
 * Transforms static engagement assessments and multi-phase theater operations
 * into time-continuous 4D trajectories (aircraft ingress, standoff releases,
 * in-flight cruise missiles, SAM interceptor launches, flak bursts, and objective impacts).
 */

import { distanceKm, interpolate, bearingDeg, greatCirclePath } from './geo';
import { type Assessment } from './engagement';
import { type TheaterAssessment } from './theaterEngagement';

/* ------------------------------------------------------------------ */
/* Types & Interfaces                                                  */
/* ------------------------------------------------------------------ */

export interface TimelineSegment {
  id: string;
  phaseNumber: number;
  title: string;
  category: 'oca' | 'sead' | 'strike' | 'standoff';
  attackerLabel: string;
  targetLabel: string;
  weaponName: string;
  originLngLat: [number, number];
  targetLngLat: [number, number];
  releaseLngLat?: [number, number];

  // Time boundaries in seconds
  startTimeSec: number;
  releaseTimeSec: number;
  impactTimeSec: number;
  egressEndTimeSec: number;

  salvoSize: number;
  platformCount: number;
  color: string;

  interceptions: Array<{
    timeSec: number;
    lngLat: [number, number];
    samLabel: string;
    samLngLat: [number, number];
    kills: number;
  }>;

  impactHits: number;
  targetDestroyed: boolean;
}

export interface PlaybackEvent {
  id: string;
  timeSec: number;
  timeFormatted: string;
  title: string;
  detail: string;
  phaseNumber: number;
  badge?: {
    text: string;
    variant: string;
  };
}

export interface PlaybackModel {
  totalDurationSec: number;
  segments: TimelineSegment[];
  events: PlaybackEvent[];
}

export interface PlaybackEntity {
  id: string;
  type: 'aircraft' | 'munition' | 'interceptor';
  label: string;
  count: number;
  lngLat: [number, number];
  headingDeg: number;
  color: string;
  status: 'ingress' | 'egress' | 'munition-flight' | 'terminal';
}

export interface PlaybackTrail {
  id: string;
  color: string;
  coordinates: [number, number][];
  type: 'strike' | 'interceptor';
}

export interface PlaybackEffect {
  id: string;
  lngLat: [number, number];
  type: 'intercept' | 'impact' | 'suppression';
  label: string;
  ageSec: number;
  opacity: number;
  radius: number;
}

export interface PlaybackFrame {
  timeSec: number;
  timeFormatted: string;
  progress: number;
  activePhaseNumber: number;
  activeStatusText: string;
  entities: PlaybackEntity[];
  trails: PlaybackTrail[];
  effects: PlaybackEffect[];
  activeEventIndex: number;
}

/* ------------------------------------------------------------------ */
/* Model Builders                                                      */
/* ------------------------------------------------------------------ */

const PHASE_COLORS = ['#4DD0E1', '#FF8A65', '#FFD54F', '#BA68C8', '#4FC3F7', '#81C784', '#FF80AB', '#FFB74D'];

export function formatTimeSec(totalSec: number): string {
  const mins = Math.floor(totalSec / 60);
  const secs = Math.floor(totalSec % 60);
  return `T+${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Builds a playback model from a Single-Raid Assessment.
 */
export function buildRaidPlaybackModel(assessment: Assessment): PlaybackModel {
  const totalKm = assessment.distanceKm;
  const speedKmh = assessment.speedKmh || 900;
  const isStandoff = Boolean(assessment.raid.standoff?.enabled);
  const releaseKm = assessment.releaseKm ?? totalKm;
  const standoffRange = totalKm - releaseKm;

  const aircraftSpeedKmh = speedKmh;
  const munitionSpeedKmh = assessment.raid.standoff?.munitionSpeedKmh ?? 950;

  const ingressSec = releaseKm > 0 ? (releaseKm / aircraftSpeedKmh) * 3600 : 0;
  const munitionSec = isStandoff && standoffRange > 0 ? (standoffRange / munitionSpeedKmh) * 3600 : (totalKm / speedKmh) * 3600;
  const impactTimeSec = isStandoff ? ingressSec + munitionSec : ingressSec || munitionSec;
  const egressEndTimeSec = isStandoff && releaseKm > 0 ? ingressSec * 2 : impactTimeSec;

  const totalDurationSec = Math.max(impactTimeSec + 30, egressEndTimeSec);

  const interceptions: TimelineSegment['interceptions'] = [];
  const events: PlaybackEvent[] = [];

  // Map engagements
  for (const eng of assessment.engagements) {
    if (eng.silent || eng.rounds <= 0) continue;
    const entryRatio = totalKm > 0 ? eng.entryKm / totalKm : 0;
    const tSec = entryRatio * impactTimeSec;
    const interceptLngLat = interpolate(assessment.raid.from, assessment.raid.to, entryRatio);

    interceptions.push({
      timeSec: tSec,
      lngLat: interceptLngLat,
      samLabel: eng.unitLabel,
      samLngLat: interceptLngLat,
      kills: Math.round(eng.killed),
    });
  }

  // Battle log events
  for (let i = 0; i < assessment.battleLog.length; i++) {
    const b = assessment.battleLog[i];
    const frac = totalKm > 0 ? b.distanceKm / totalKm : 0;
    const tSec = frac * impactTimeSec;

    events.push({
      id: b.id,
      timeSec: tSec,
      timeFormatted: b.timeFormatted,
      title: b.title,
      detail: b.detail,
      phaseNumber: 1,
      badge: b.badge,
    });
  }

  const segment: TimelineSegment = {
    id: 'seg-single-raid',
    phaseNumber: 1,
    title: isStandoff ? 'Stand-Off Strike Mission' : 'Direct Penetration Strike',
    category: isStandoff ? 'standoff' : 'strike',
    attackerLabel: assessment.raid.label,
    targetLabel: 'Target Objective',
    weaponName: assessment.raid.standoff?.weaponName ?? assessment.raid.spec.name,
    originLngLat: assessment.raid.from,
    targetLngLat: assessment.raid.to,
    releaseLngLat: assessment.releaseLngLat,
    startTimeSec: 0,
    releaseTimeSec: ingressSec,
    impactTimeSec,
    egressEndTimeSec,
    salvoSize: assessment.standoffLaunched ?? assessment.raid.count,
    platformCount: assessment.raid.count,
    color: '#E4B363',
    interceptions,
    impactHits: Math.round(assessment.leakers.stated),
    targetDestroyed: Math.round(assessment.leakers.stated) >= 2,
  };

  return {
    totalDurationSec,
    segments: [segment],
    events,
  };
}

/**
 * Builds a playback model from a Multi-Phase Theater Assessment.
 */
export function buildTheaterPlaybackModel(assessment: TheaterAssessment): PlaybackModel {
  const segments: TimelineSegment[] = [];
  const events: PlaybackEvent[] = [];

  const phaseNumbers = Array.from(new Set(assessment.phases.map((p) => p.phaseNumber))).sort((a, b) => a - b);
  let cumulativeTimeSec = 0;
  const PHASE_DURATION_SEC = 90; // Each phase takes ~90 seconds of normalized mission time

  for (const pNum of phaseNumbers) {
    const phaseStartSec = cumulativeTimeSec;
    const phaseReports = assessment.phases.filter((p) => p.phaseNumber === pNum);

    for (let tIdx = 0; tIdx < phaseReports.length; tIdx++) {
      const rep = phaseReports[tIdx];
      const task = rep.task;
      const pathSpec = rep.pathSpec;

      const originLngLat = pathSpec?.ingress?.[0] ?? [0, 0];
      const targetLngLat = pathSpec?.targetPoint ?? [0, 0];
      const releaseLngLat = pathSpec?.releasePoint;

      const distKm = distanceKm(originLngLat, targetLngLat);
      const isStandoff = Boolean(releaseLngLat);

      const ingressSec = isStandoff ? phaseStartSec + 35 : phaseStartSec;
      const impactTimeSec = phaseStartSec + 75;
      const egressEndTimeSec = isStandoff ? phaseStartSec + 90 : impactTimeSec;

      const interceptions: TimelineSegment['interceptions'] = [];

      // Interceptions from phase report
      if (rep.munitionsIntercepted > 0) {
        const midFrac = 0.65;
        const interceptLngLat = interpolate(originLngLat, targetLngLat, midFrac);
        interceptions.push({
          timeSec: phaseStartSec + 55,
          lngLat: interceptLngLat,
          samLabel: 'Defending Air Defense',
          samLngLat: interceptLngLat,
          kills: rep.munitionsIntercepted,
        });
      }

      // Add phase battle events
      for (const b of rep.battleLog) {
        events.push({
          id: b.id,
          timeSec: phaseStartSec + 20,
          timeFormatted: b.timeFormatted,
          title: b.title,
          detail: b.detail,
          phaseNumber: pNum,
          badge: b.badge,
        });
      }

      segments.push({
        id: `seg-${rep.task.id}`,
        phaseNumber: pNum,
        title: rep.task.title,
        category: rep.task.category,
        attackerLabel: rep.attackerLabel,
        targetLabel: rep.targetLabel,
        weaponName: rep.weaponName,
        originLngLat,
        targetLngLat,
        releaseLngLat,
        startTimeSec: phaseStartSec,
        releaseTimeSec: ingressSec,
        impactTimeSec,
        egressEndTimeSec,
        salvoSize: rep.salvoCommitted,
        platformCount: rep.attackerPlatformsSurviving || 1,
        color: PHASE_COLORS[(pNum - 1) % PHASE_COLORS.length],
        interceptions,
        impactHits: rep.munitionsImpacted,
        targetDestroyed: rep.targetDestroyed,
      });
    }

    cumulativeTimeSec += PHASE_DURATION_SEC;
  }

  return {
    totalDurationSec: Math.max(60, cumulativeTimeSec),
    segments,
    events,
  };
}

/* ------------------------------------------------------------------ */
/* Frame Calculation                                                  */
/* ------------------------------------------------------------------ */

export function calculatePlaybackFrame(model: PlaybackModel, timeSec: number): PlaybackFrame {
  const clampedTime = Math.max(0, Math.min(model.totalDurationSec, timeSec));
  const progress = model.totalDurationSec > 0 ? clampedTime / model.totalDurationSec : 0;
  const timeFormatted = formatTimeSec(clampedTime);

  const entities: PlaybackEntity[] = [];
  const trails: PlaybackTrail[] = [];
  const effects: PlaybackEffect[] = [];

  let activePhaseNumber = 1;
  let activeStatusText = 'Mission Ingress Active';

  for (const seg of model.segments) {
    if (clampedTime < seg.startTimeSec) continue;

    // Determine phase number
    if (clampedTime >= seg.startTimeSec && clampedTime <= seg.egressEndTimeSec) {
      activePhaseNumber = seg.phaseNumber;
      activeStatusText = `${seg.title} — Active`;
    }

    const { originLngLat, targetLngLat, releaseLngLat } = seg;
    const isStandoff = Boolean(releaseLngLat);

    // 1. Aircraft Ingress / Egress
    if (clampedTime <= seg.egressEndTimeSec) {
      const ingressTotalSec = seg.releaseTimeSec - seg.startTimeSec;

      if (clampedTime <= seg.releaseTimeSec && ingressTotalSec > 0) {
        // Ingressing towards release point / target
        const ingressFrac = (clampedTime - seg.startTimeSec) / ingressTotalSec;
        const dest = isStandoff && releaseLngLat ? releaseLngLat : targetLngLat;
        const currentCoord = interpolate(originLngLat, dest, ingressFrac);
        const heading = bearingDeg(originLngLat, dest);

        entities.push({
          id: `${seg.id}-aircraft-ingress`,
          type: 'aircraft',
          label: `${seg.attackerLabel} (${seg.platformCount}x)`,
          count: seg.platformCount,
          lngLat: currentCoord,
          headingDeg: heading,
          color: seg.color,
          status: 'ingress',
        });

        // Trail
        const breadcrumb = greatCirclePath(originLngLat, currentCoord, 16);
        trails.push({
          id: `${seg.id}-trail-ingress`,
          color: seg.color,
          coordinates: breadcrumb,
          type: 'strike',
        });
      } else if (isStandoff && releaseLngLat && clampedTime > seg.releaseTimeSec && clampedTime <= seg.egressEndTimeSec) {
        // Egressing safely back to origin
        const egressTotalSec = seg.egressEndTimeSec - seg.releaseTimeSec;
        const egressFrac = (clampedTime - seg.releaseTimeSec) / egressTotalSec;
        const currentCoord = interpolate(releaseLngLat, originLngLat, egressFrac);
        const heading = bearingDeg(releaseLngLat, originLngLat);

        entities.push({
          id: `${seg.id}-aircraft-egress`,
          type: 'aircraft',
          label: `${seg.attackerLabel} (Egress)`,
          count: seg.platformCount,
          lngLat: currentCoord,
          headingDeg: heading,
          color: seg.color,
          status: 'egress',
        });
      }
    }

    // 2. Munitions In-Flight
    if (clampedTime >= seg.releaseTimeSec && clampedTime <= seg.impactTimeSec) {
      const munitionStartSec = seg.releaseTimeSec;
      const munitionTotalSec = seg.impactTimeSec - munitionStartSec;
      const munitionFrac = munitionTotalSec > 0 ? (clampedTime - munitionStartSec) / munitionTotalSec : 1;

      const launchCoord = isStandoff && releaseLngLat ? releaseLngLat : originLngLat;
      const currentMunitionCoord = interpolate(launchCoord, targetLngLat, munitionFrac);
      const heading = bearingDeg(launchCoord, targetLngLat);

      entities.push({
        id: `${seg.id}-munition`,
        type: 'munition',
        label: `${seg.weaponName} (${seg.salvoSize}x)`,
        count: seg.salvoSize,
        lngLat: currentMunitionCoord,
        headingDeg: heading,
        color: '#FFB020',
        status: munitionFrac > 0.85 ? 'terminal' : 'munition-flight',
      });

      const munitionTrail = greatCirclePath(launchCoord, currentMunitionCoord, 16);
      trails.push({
        id: `${seg.id}-trail-munition`,
        color: '#FFB020',
        coordinates: munitionTrail,
        type: 'strike',
      });
    }

    // 3. SAM Interception Trails & Bursts
    for (let icIdx = 0; icIdx < seg.interceptions.length; icIdx++) {
      const ic = seg.interceptions[icIdx];
      const interceptLaunchSec = Math.max(seg.releaseTimeSec, ic.timeSec - 8);

      if (clampedTime >= interceptLaunchSec && clampedTime <= ic.timeSec) {
        // Interceptor missile rushing towards intercept coordinate
        const icFrac = (clampedTime - interceptLaunchSec) / (ic.timeSec - interceptLaunchSec);
        const currentIcCoord = interpolate(ic.samLngLat, ic.lngLat, icFrac);
        const icHeading = bearingDeg(ic.samLngLat, ic.lngLat);

        entities.push({
          id: `${seg.id}-ic-${icIdx}`,
          type: 'interceptor',
          label: `${ic.samLabel} Interceptor`,
          count: 1,
          lngLat: currentIcCoord,
          headingDeg: icHeading,
          color: '#E8833A',
          status: 'terminal',
        });

        trails.push({
          id: `${seg.id}-ic-trail-${icIdx}`,
          color: '#E8833A',
          coordinates: [ic.samLngLat, currentIcCoord],
          type: 'interceptor',
        });
      }

      // Explosion / Flak Burst when intercept occurs
      if (clampedTime >= ic.timeSec && clampedTime <= ic.timeSec + 12) {
        const age = clampedTime - ic.timeSec;
        effects.push({
          id: `${seg.id}-burst-${icIdx}`,
          lngLat: ic.lngLat,
          type: 'intercept',
          label: `💥 ${ic.kills} Intercepted`,
          ageSec: age,
          opacity: Math.max(0, 1 - age / 12),
          radius: 8 + age * 2,
        });
      }
    }

    // 4. Target Impact Explosions
    if (clampedTime >= seg.impactTimeSec && clampedTime <= seg.impactTimeSec + 20) {
      const age = clampedTime - seg.impactTimeSec;
      effects.push({
        id: `${seg.id}-impact`,
        lngLat: targetLngLat,
        type: seg.impactHits > 0 ? 'impact' : 'suppression',
        label: seg.impactHits > 0 ? `🎯 ${seg.impactHits} IMPACTS — ${seg.targetLabel}` : `🛡️ Defence Held`,
        ageSec: age,
        opacity: Math.max(0, 1 - age / 20),
        radius: 12 + age * 3,
      });
    }
  }

  // Find active event index in battle log
  let activeEventIndex = 0;
  for (let i = 0; i < model.events.length; i++) {
    if (model.events[i].timeSec <= clampedTime) {
      activeEventIndex = i;
    }
  }

  return {
    timeSec: clampedTime,
    timeFormatted,
    progress,
    activePhaseNumber,
    activeStatusText,
    entities,
    trails,
    effects,
    activeEventIndex,
  };
}
