/**
 * Interactive Battle Playback & Animation Engine
 *
 * Transforms static engagement assessments and multi-phase theater operations
 * into time-continuous 4D trajectories (individual strike missiles in realistic salvo
 * formations, individual high-speed SAM interceptors from defender positions,
 * aircraft ingress/egress, flak bursts, and target objective impacts).
 */

import { distanceKm, interpolate, bearingDeg, destination, greatCirclePath } from './geo';
import { type Assessment } from './engagement';
import { type TheaterAssessment } from './theaterEngagement';
import { type DeployedUnit } from './warGames';

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
export function buildRaidPlaybackModel(assessment: Assessment, boardUnits: DeployedUnit[] = []): PlaybackModel {
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

  const mainHeading = bearingDeg(assessment.raid.from, assessment.raid.to);
  const perpHeading = (mainHeading + 90) % 360;

  // Map engagements to exact defender units on the board
  for (let engIdx = 0; engIdx < assessment.engagements.length; engIdx++) {
    const eng = assessment.engagements[engIdx];
    if (eng.silent || eng.rounds <= 0) continue;
    const entryRatio = totalKm > 0 ? eng.entryKm / totalKm : 0;
    const tSec = entryRatio * impactTimeSec;
    const interceptLngLat = interpolate(assessment.raid.from, assessment.raid.to, entryRatio);

    // Resolve real position of defender unit from the board
    const defenderUnit = boardUnits.find((u) => u.id === eng.unitId);
    const samLngLat = defenderUnit?.lngLat ?? destination(interceptLngLat, 35, perpHeading);

    interceptions.push({
      timeSec: tSec,
      lngLat: interceptLngLat,
      samLabel: eng.unitLabel || eng.systemName,
      samLngLat,
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
  const PHASE_DURATION_SEC = 90;

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

      const isStandoff = Boolean(releaseLngLat);
      const ingressSec = isStandoff ? phaseStartSec + 35 : phaseStartSec;
      const impactTimeSec = phaseStartSec + 75;
      const egressEndTimeSec = isStandoff ? phaseStartSec + 90 : impactTimeSec;

      const interceptions: TimelineSegment['interceptions'] = [];
      const heading = bearingDeg(originLngLat, targetLngLat);
      const perpHeading = (heading + 90) % 360;

      // Interceptions from phase report using actual defender unit coordinates
      if (rep.interceptions && rep.interceptions.length > 0) {
        for (let i = 0; i < rep.interceptions.length; i++) {
          const icRec = rep.interceptions[i];
          const launchBaseSec = isStandoff ? ingressSec : phaseStartSec;
          const flightWindowSec = impactTimeSec - launchBaseSec;
          const tSec = launchBaseSec + (icRec.entryFraction ?? 0.6) * flightWindowSec;
          interceptions.push({
            timeSec: tSec,
            lngLat: icRec.interceptLngLat ?? interpolate(originLngLat, targetLngLat, 0.65),
            samLabel: icRec.defenderLabel,
            samLngLat: icRec.defenderLngLat, // Exact real coordinates of enemy defender unit!
            kills: icRec.kills,
          });
        }
      } else if (rep.munitionsIntercepted > 0) {
        const midFrac = 0.65;
        const interceptLngLat = interpolate(originLngLat, targetLngLat, midFrac);
        const samLngLat = destination(interceptLngLat, 35, perpHeading);

        interceptions.push({
          timeSec: phaseStartSec + 55,
          lngLat: interceptLngLat,
          samLabel: 'Defending Air Defense',
          samLngLat,
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
/* Frame Calculation with Individual Missiles & Interceptor Salvos    */
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

    // Determine active phase number
    if (clampedTime >= seg.startTimeSec && clampedTime <= seg.egressEndTimeSec) {
      activePhaseNumber = seg.phaseNumber;
      activeStatusText = `${seg.title} — Active`;
    }

    const { originLngLat, targetLngLat, releaseLngLat } = seg;
    const isStandoff = Boolean(releaseLngLat);
    const launchCoord = isStandoff && releaseLngLat ? releaseLngLat : originLngLat;

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

        // Aircraft Ingress Trail
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

    // 2. Individual Strike Munitions In-Flight (Attack Side)
    if (clampedTime >= seg.releaseTimeSec && clampedTime <= seg.impactTimeSec + 2) {
      const heading = bearingDeg(launchCoord, targetLngLat);
      const perpBearing = (heading + 90) % 360;

      const salvoCount = Math.max(1, Math.min(36, seg.salvoSize));

      // Calculate total kills across interceptions for kill attribution
      let totalKills = 0;
      for (const ic of seg.interceptions) {
        totalKills += ic.kills;
      }

      // Map individual missiles in sequential ripple stream directly from the launching platform
      for (let m = 0; m < salvoCount; m++) {
        // Sequential ripple launch stagger (0.75s between VLS / rail launches)
        const staggerSec = m * 0.75;
        const mLaunchSec = seg.releaseTimeSec + staggerSec;

        if (clampedTime < mLaunchSec) continue;

        // Check if this missile gets intercepted
        const isIntercepted = m < totalKills;
        let killTimeSec = seg.impactTimeSec;
        let killCoord = targetLngLat;

        if (isIntercepted) {
          // Attribute to corresponding interception event
          let runningKills = 0;
          for (const ic of seg.interceptions) {
            runningKills += ic.kills;
            if (m < runningKills) {
              killTimeSec = ic.timeSec;
              killCoord = ic.lngLat;
              break;
            }
          }
        }

        // If missile was destroyed earlier, don't draw it past its kill time
        if (isIntercepted && clampedTime > killTimeSec) continue;

        // Base flight time from platform launch to destination/intercept
        const mTotalSec = (isIntercepted ? killTimeSec : seg.impactTimeSec) - seg.releaseTimeSec;
        const progress = mTotalSec > 0 ? (clampedTime - mLaunchSec) / mTotalSec : 1;
        const clampedFrac = Math.min(1, Math.max(0, progress));

        // Core path along great-circle attack corridor (100% anchored at ship launch coordinate)
        const destCoord = isIntercepted ? killCoord : targetLngLat;
        const corePoint = interpolate(launchCoord, destCoord, clampedFrac);

        // Subtle lateral lane breathing (0 at ship launch, 0 at target impact)
        const laneOffsetKm = ((m % 3) - 1) * 3.5 * Math.sin(clampedFrac * Math.PI);
        const mCurrentCoord =
          laneOffsetKm !== 0 && clampedFrac > 0.05 && clampedFrac < 0.95
            ? destination(corePoint, laneOffsetKm, perpBearing)
            : corePoint;

        const mHeading = bearingDeg(launchCoord, destCoord);

        // Individual Munition Entity
        entities.push({
          id: `${seg.id}-m-${m}`,
          type: 'munition',
          label: m === 0 ? `${seg.weaponName} (${seg.salvoSize}x Salvo)` : '',
          count: 1,
          lngLat: mCurrentCoord,
          headingDeg: mHeading,
          color: '#FFB020',
          status: clampedFrac > 0.88 ? 'terminal' : 'munition-flight',
        });

        // Individual Munition Trail from launch platform to current location
        const mTrail = greatCirclePath(launchCoord, mCurrentCoord, Math.max(4, Math.round(16 * clampedFrac)));
        trails.push({
          id: `${seg.id}-trail-m-${m}`,
          color: '#FFB020',
          coordinates: mTrail,
          type: 'strike',
        });
      }
    }

    // 3. Individual SAM Interceptors (Defense Side) & Flak Bursts
    for (let icIdx = 0; icIdx < seg.interceptions.length; icIdx++) {
      const ic = seg.interceptions[icIdx];
      const icCount = Math.max(2, Math.min(8, Math.round(ic.kills * 1.5) || 2));
      const icHeading = bearingDeg(ic.samLngLat, ic.lngLat);
      const icPerpBearing = (icHeading + 90) % 360;

      // Smooth, realistic interceptor flight duration (1.5x to 2x cruise speed, not instantaneous flash)
      const icDistKm = distanceKm(ic.samLngLat, ic.lngLat);
      const strikeDistKm = distanceKm(launchCoord, targetLngLat);
      const strikeDurationSec = Math.max(20, seg.impactTimeSec - seg.releaseTimeSec);
      const distRatio = strikeDistKm > 0 ? icDistKm / strikeDistKm : 0.4;
      const icFlightDurationSec = Math.max(14, Math.min(28, distRatio * strikeDurationSec * 1.2 + 12));

      for (let j = 0; j < icCount; j++) {
        const icStaggerSec = j * 0.5;
        const icLaunchSec = Math.max(seg.releaseTimeSec, ic.timeSec - icFlightDurationSec - icStaggerSec);
        const icImpactSec = ic.timeSec;

        if (clampedTime >= icLaunchSec && clampedTime <= icImpactSec) {
          const icTotalSec = icImpactSec - icLaunchSec;
          const icFrac = icTotalSec > 0 ? (clampedTime - icLaunchSec) / icTotalSec : 1;
          const clampedIcFrac = Math.min(1, Math.max(0, icFrac));

          // Interceptors launch directly from the defending battery / warship (ic.samLngLat)
          const coreIcPoint = interpolate(ic.samLngLat, ic.lngLat, clampedIcFrac);
          const icLaneOffset = ((j % 2 === 0 ? 1 : -1) * (j * 1.2)) * Math.sin(clampedIcFrac * Math.PI);
          const icCurrCoord =
            icLaneOffset !== 0 ? destination(coreIcPoint, icLaneOffset, icPerpBearing) : coreIcPoint;

          entities.push({
            id: `${seg.id}-ic-${icIdx}-${j}`,
            type: 'interceptor',
            label: j === 0 ? `${ic.samLabel} Interceptors` : '',
            count: 1,
            lngLat: icCurrCoord,
            headingDeg: icHeading,
            color: '#4DD0E1',
            status: 'terminal',
          });

          trails.push({
            id: `${seg.id}-ic-trail-${icIdx}-${j}`,
            color: '#4DD0E1',
            coordinates: [ic.samLngLat, icCurrCoord],
            type: 'interceptor',
          });
        }
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
          radius: 10 + age * 2.5,
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
