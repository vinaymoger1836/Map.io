/**
 * Topographic Terrain Line-of-Sight (LOS) & Mountain Masking Engine.
 *
 * Implements:
 * 1. High-fidelity topographic elevation sampling across Eurasia and global mountain ranges.
 * 2. Ray-tracing line-of-sight checks with Earth curvature and mountain ridge obstruction.
 * 3. Specialized sensor & platform avionics resolution:
 *    - Look-Down / Shoot-Down (LD/SD) AESA Pulse-Doppler clutter rejection
 *    - Terrain-Following Radar (TFR) & TERCOM cruise missile valley ingress
 *    - EO/IR & IRST thermal targeting immunity to radar ground clutter
 *    - Mast-Mounted rotary radar unmasking over ridge lines
 */

import { distanceKm, interpolate } from './geo';
import { type SensorFacet, type PlatformFacet } from './specs';

export interface MountainRegion {
  name: string;
  centerLng: number;
  centerLat: number;
  radiusKm: number;
  baseElevM: number;
  peakElevM: number;
  subPeaks?: { lng: number; lat: number; elevM: number }[];
}

/**
 * Major Strategic Mountain Ranges and Topographic Relief Zones in Eurasia / Global Theater.
 */
export const MAJOR_MOUNTAIN_REGIONS: MountainRegion[] = [
  // 1. Himalayas, Karakoram, & Tibetan Plateau (World's highest relief)
  {
    name: 'Himalayas / Tibetan Plateau',
    centerLng: 86.9,
    centerLat: 28.5,
    radiusKm: 750,
    baseElevM: 3800,
    peakElevM: 8848,
    subPeaks: [
      { lng: 86.92, lat: 27.98, elevM: 8848 }, // Everest
      { lng: 76.51, lat: 35.88, elevM: 8611 }, // K2
      { lng: 88.14, lat: 27.70, elevM: 8586 }, // Kangchenjunga
      { lng: 74.58, lat: 35.23, elevM: 8126 }, // Nanga Parbat
      { lng: 83.93, lat: 28.59, elevM: 8091 }, // Annapurna
    ],
  },
  // 2. Hindu Kush & Pamir Mountains (Central Asia)
  {
    name: 'Hindu Kush & Pamir Mountains',
    centerLng: 71.5,
    centerLat: 36.5,
    radiusKm: 420,
    baseElevM: 2800,
    peakElevM: 7708,
    subPeaks: [
      { lng: 71.84, lat: 36.25, elevM: 7708 }, // Tirich Mir
      { lng: 72.01, lat: 38.92, elevM: 7495 }, // Ismoil Somoni
    ],
  },
  // 3. Tien Shan Mountain Range (Central / East Asia)
  {
    name: 'Tien Shan Mountains',
    centerLng: 78.5,
    centerLat: 42.0,
    radiusKm: 500,
    baseElevM: 2200,
    peakElevM: 7439,
    subPeaks: [
      { lng: 80.13, lat: 42.04, elevM: 7439 }, // Jengish Chokusu
      { lng: 80.18, lat: 42.34, elevM: 7010 }, // Khan Tengri
    ],
  },
  // 4. Zagros Mountains (Iran / Iraq / Persian Gulf littoral)
  {
    name: 'Zagros Mountains',
    centerLng: 51.5,
    centerLat: 32.0,
    radiusKm: 550,
    baseElevM: 1600,
    peakElevM: 4409,
    subPeaks: [
      { lng: 51.44, lat: 30.93, elevM: 4409 }, // Dena
      { lng: 50.07, lat: 32.36, elevM: 4221 }, // Zard-Kuh
      { lng: 48.35, lat: 33.30, elevM: 4050 }, // Oshtoran Kuh
    ],
  },
  // 5. Alborz Mountains (Northern Iran / Caspian Sea littoral)
  {
    name: 'Alborz Mountains',
    centerLng: 52.0,
    centerLat: 36.0,
    radiusKm: 350,
    baseElevM: 1800,
    peakElevM: 5610,
    subPeaks: [
      { lng: 52.11, lat: 35.95, elevM: 5610 }, // Mt Damavand
      { lng: 50.96, lat: 36.42, elevM: 4850 }, // Alam-Kuh
    ],
  },
  // 6. Caucasus Mountain Range (Black Sea - Caspian Sea divide)
  {
    name: 'Caucasus Mountains',
    centerLng: 44.5,
    centerLat: 42.5,
    radiusKm: 450,
    baseElevM: 1800,
    peakElevM: 5642,
    subPeaks: [
      { lng: 42.44, lat: 43.35, elevM: 5642 }, // Mt Elbrus
      { lng: 44.55, lat: 42.70, elevM: 5047 }, // Kazbek
      { lng: 43.06, lat: 43.01, elevM: 5205 }, // Shkhara
    ],
  },
  // 7. Taurus & Pontic Mountains (Anatolia / Turkey)
  {
    name: 'Taurus & Pontic Mountains',
    centerLng: 35.0,
    centerLat: 38.5,
    radiusKm: 480,
    baseElevM: 1400,
    peakElevM: 3917,
    subPeaks: [
      { lng: 35.45, lat: 38.53, elevM: 3917 }, // Mt Erciyes
      { lng: 44.30, lat: 39.70, elevM: 5137 }, // Mt Ararat
      { lng: 37.80, lat: 37.80, elevM: 3756 }, // Demirkazik
    ],
  },
  // 8. The European Alps (Western / Central Europe)
  {
    name: 'European Alps',
    centerLng: 10.0,
    centerLat: 46.5,
    radiusKm: 420,
    baseElevM: 1200,
    peakElevM: 4810,
    subPeaks: [
      { lng: 6.86, lat: 45.83, elevM: 4810 }, // Mont Blanc
      { lng: 7.87, lat: 45.94, elevM: 4634 }, // Monte Rosa
      { lng: 7.66, lat: 45.98, elevM: 4478 }, // Matterhorn
    ],
  },
  // 9. Pyrenees (France / Spain boundary)
  {
    name: 'Pyrenees Mountains',
    centerLng: 0.5,
    centerLat: 42.6,
    radiusKm: 250,
    baseElevM: 1100,
    peakElevM: 3404,
    subPeaks: [
      { lng: 0.65, lat: 42.63, elevM: 3404 }, // Pico Aneto
    ],
  },
  // 10. Carpathian Mountains (Central / Eastern Europe)
  {
    name: 'Carpathian Mountains',
    centerLng: 24.5,
    centerLat: 47.0,
    radiusKm: 450,
    baseElevM: 800,
    peakElevM: 2655,
    subPeaks: [
      { lng: 20.13, lat: 49.16, elevM: 2655 }, // Gerlachovsky Stit
      { lng: 25.56, lat: 45.36, elevM: 2544 }, // Moldoveanu
    ],
  },
  // 11. Scandinavian Mountains (Norway / Sweden)
  {
    name: 'Scandinavian Mountains',
    centerLng: 13.0,
    centerLat: 63.0,
    radiusKm: 550,
    baseElevM: 600,
    peakElevM: 2469,
    subPeaks: [
      { lng: 8.31, lat: 61.64, elevM: 2469 }, // Galdhopiggen
    ],
  },
  // 12. Ural Mountains (Europe - Asia boundary)
  {
    name: 'Ural Mountains',
    centerLng: 59.5,
    centerLat: 60.0,
    radiusKm: 700,
    baseElevM: 500,
    peakElevM: 1895,
    subPeaks: [
      { lng: 60.22, lat: 65.04, elevM: 1895 }, // Mt Narodnaya
    ],
  },
  // 13. Altai Mountains (Russia / Mongolia / China / Kazakhstan)
  {
    name: 'Altai Mountains',
    centerLng: 88.0,
    centerLat: 49.5,
    radiusKm: 450,
    baseElevM: 1400,
    peakElevM: 4506,
    subPeaks: [
      { lng: 86.59, lat: 49.81, elevM: 4506 }, // Belukha
    ],
  },
  // 14. Asir & Sarawat Mountains (Arabian Peninsula)
  {
    name: 'Asir & Sarawat Mountains',
    centerLng: 42.5,
    centerLat: 18.5,
    radiusKm: 380,
    baseElevM: 1200,
    peakElevM: 3000,
    subPeaks: [
      { lng: 42.37, lat: 18.27, elevM: 3000 }, // Jabal Sawda
    ],
  },
  // 15. Taiwan Central Mountain Range
  {
    name: 'Taiwan Central Mountain Range',
    centerLng: 121.0,
    centerLat: 23.8,
    radiusKm: 180,
    baseElevM: 800,
    peakElevM: 3952,
    subPeaks: [
      { lng: 120.96, lat: 23.47, elevM: 3952 }, // Yu Shan
    ],
  },
];

/**
 * Computes high-fidelity terrain elevation in meters Above Sea Level for any geographic coordinate.
 * Uses analytical radial basis functions and subpeak topography profiles.
 */
export function getTerrainElevationM(lngLat: [number, number]): number {
  const [lng, lat] = lngLat;
  let maxElevation = 0;

  for (const region of MAJOR_MOUNTAIN_REGIONS) {
    const distFromCenter = distanceKm([lng, lat], [region.centerLng, region.centerLat]);
    if (distFromCenter > region.radiusKm) continue;

    // Smooth Gaussian falloff from region center
    const normalizedDist = distFromCenter / region.radiusKm;
    const baseContrib = region.baseElevM * Math.exp(-2.5 * normalizedDist * normalizedDist);

    let peakContrib = 0;
    if (region.subPeaks && region.subPeaks.length > 0) {
      for (const peak of region.subPeaks) {
        const dPeak = distanceKm([lng, lat], [peak.lng, peak.lat]);
        if (dPeak < 80) {
          const peakFalloff = Math.exp(-0.5 * Math.pow(dPeak / 25, 2));
          const elev = (peak.elevM - region.baseElevM) * peakFalloff;
          if (elev > peakContrib) {
            peakContrib = elev;
          }
        }
      }
    } else {
      peakContrib = (region.peakElevM - region.baseElevM) * Math.exp(-4 * normalizedDist * normalizedDist);
    }

    const totalRegionElev = baseContrib + peakContrib;
    if (totalRegionElev > maxElevation) {
      maxElevation = totalRegionElev;
    }
  }

  // Base elevation floor for landmasses vs oceans
  return Math.round(maxElevation);
}

export interface TerrainLOSResult {
  /** True if physical terrain or heavy clutter obstructs radar line-of-sight */
  isMasked: boolean;
  /** True if physical mountain rock is directly between scanner and target */
  isObstructedByTerrain: boolean;
  /** Height of the highest obstructing terrain crest (m) */
  obstructionAltitudeM?: number;
  /** Distance along the ray path where obstruction occurs (km) */
  obstructionDistanceKm?: number;
  /** Name of the blocking mountain range */
  blockingMountainName?: string;
  /** Scanner operating altitude above sea level (m) */
  scannerAltitudeM: number;
  /** Target operating altitude above sea level (m) */
  targetAltitudeM: number;
  /** Great-circle standoff distance (km) */
  distanceKm: number;
  /** Ground clutter penalty factor (0.0 clear, 0.4 moderate clutter, 0.9 severe clutter) */
  terrainClutterPenalty: number;
  /** Effective detection range modifier (1.0 = 100%, <1.0 = degraded) */
  rangeModifier: number;
  /** Tactical intelligence explanation of terrain interaction */
  maskingExplanation: string;
  /** List of specialized avionics systems utilized in resolving the check */
  specializedEquipmentUsed: string[];
}

export interface CalculateTerrainLOSParams {
  scannerLngLat: [number, number];
  scannerAltitudeM: number;
  targetLngLat: [number, number];
  targetAltitudeM: number;
  sensorEquipment?: Partial<SensorFacet>;
  platformEquipment?: Partial<PlatformFacet>;
  isGroundTarget?: boolean;
}

/**
 * Calculates continuous Ray-Tracing Line-of-Sight (LOS) across terrain elevations
 * between scanner and target coordinates, incorporating Earth curvature and specialized avionics.
 */
export function calculateTerrainLineOfSight({
  scannerLngLat,
  scannerAltitudeM,
  targetLngLat,
  targetAltitudeM,
  sensorEquipment,
  platformEquipment,
  isGroundTarget = false,
}: CalculateTerrainLOSParams): TerrainLOSResult {
  const distKm = distanceKm(scannerLngLat, targetLngLat);
  const scannerGroundElev = getTerrainElevationM(scannerLngLat);
  const targetGroundElev = getTerrainElevationM(targetLngLat);

  const effectiveScannerAltM = Math.max(scannerGroundElev + 5, scannerAltitudeM);
  const effectiveTargetAltM = Math.max(targetGroundElev + (isGroundTarget ? 2 : 15), targetAltitudeM);

  const specializedUsed: string[] = [];

  // Specialized Platform Avionics
  const isTfr = Boolean(platformEquipment?.terrainFollowing);
  const isTercom = Boolean(platformEquipment?.tercomGuidance);
  const isNoe = Boolean(platformEquipment?.noeCapable);

  // Specialized Sensor Avionics
  const isLookDown = Boolean(sensorEquipment?.lookDownShootDown);
  const isSarGmti = Boolean(sensorEquipment?.sarGmtiCapable);
  const isEoir = Boolean(sensorEquipment?.eoirTracking);
  const isMastRadar = Boolean(sensorEquipment?.mastMountedSensor);

  // Ray-tracing sample steps
  const numSteps = Math.min(30, Math.max(12, Math.round(distKm / 10)));
  let maxObstructionExcessM = 0;
  let highestPeakM = 0;
  let obstructionDistanceKm = 0;
  let blockingRangeName: string | undefined;

  for (let i = 1; i < numSteps; i++) {
    const fraction = i / numSteps;
    const samplePos = interpolate(scannerLngLat, targetLngLat, fraction);
    const sampleDistKm = fraction * distKm;

    // Geometric straight line ray altitude at sample point
    const straightRayAltM = effectiveScannerAltM + fraction * (effectiveTargetAltM - effectiveScannerAltM);

    // Earth curvature elevation drop: (d1 * d2) / 12.74
    const d1 = sampleDistKm;
    const d2 = distKm - sampleDistKm;
    const earthDropM = (d1 * d2) / 12.74;

    const actualRayAltM = straightRayAltM - earthDropM;
    const terrainElevM = getTerrainElevationM(samplePos);

    if (terrainElevM > actualRayAltM) {
      const excess = terrainElevM - actualRayAltM;
      if (excess > maxObstructionExcessM) {
        maxObstructionExcessM = excess;
        highestPeakM = terrainElevM;
        obstructionDistanceKm = sampleDistKm;

        // Find nearest named mountain region
        const matchedRegion = MAJOR_MOUNTAIN_REGIONS.find(
          (r) => distanceKm(samplePos, [r.centerLng, r.centerLat]) <= r.radiusKm
        );
        blockingRangeName = matchedRegion?.name || 'Mountain Ridge';
      }
    }
  }

  const isObstructed = maxObstructionExcessM > 0;

  // 1. Direct Physical Rock Obstruction
  if (isObstructed) {
    // If target has TFR / TERCOM and is in valley, it intentionally exploits this mask
    if (isTercom) {
      specializedUsed.push('🏔️ TERCOM Digital Contour Navigation (Terrain Masked)');
    } else if (isTfr) {
      specializedUsed.push('🏔️ TFR Low-Altitude Penetration (Terrain Masked)');
    } else if (isNoe) {
      specializedUsed.push('🚁 Nap-of-the-Earth (NOE) Ridge Masking');
    }

    // Check if Mast-Mounted sensor on attack helo can unmask over ridge
    if (isMastRadar && maxObstructionExcessM <= 15) {
      specializedUsed.push('🚁 Mast-Mounted Radar (Unmasked above ridge crest)');
      return {
        isMasked: false,
        isObstructedByTerrain: false,
        obstructionAltitudeM: highestPeakM,
        obstructionDistanceKm,
        blockingMountainName: blockingRangeName,
        scannerAltitudeM: effectiveScannerAltM,
        targetAltitudeM: effectiveTargetAltM,
        distanceKm: distKm,
        terrainClutterPenalty: 0.15,
        rangeModifier: 0.85,
        maskingExplanation: `Mast-mounted sensor unmasked over ${blockingRangeName} crest (${highestPeakM} m), maintaining target acquisition.`,
        specializedEquipmentUsed: specializedUsed,
      };
    }

    return {
      isMasked: true,
      isObstructedByTerrain: true,
      obstructionAltitudeM: highestPeakM,
      obstructionDistanceKm,
      blockingMountainName: blockingRangeName,
      scannerAltitudeM: effectiveScannerAltM,
      targetAltitudeM: effectiveTargetAltM,
      distanceKm: distKm,
      terrainClutterPenalty: 1.0,
      rangeModifier: 0.0,
      maskingExplanation: `Radar Line-of-Sight completely blocked by ${blockingRangeName} (Crest: ${highestPeakM} m, Ray clearance: -${maxObstructionExcessM.toFixed(0)} m). Contact masked.`,
      specializedEquipmentUsed: specializedUsed,
    };
  }

  // 2. Clear Geometric LOS — Check Ground / Mountain Clutter Degradation
  let clutterPenalty = 0.0;
  let rangeModifier = 1.0;
  let explanation = 'Clear line-of-sight with unobstructed topographic profile.';

  const isLookDownGeometry = effectiveScannerAltM > effectiveTargetAltM + 1500;
  const isMountainousArea = targetGroundElev > 800 || scannerGroundElev > 800;

  if (isLookDownGeometry && isMountainousArea) {
    if (isLookDown) {
      specializedUsed.push('📡 Look-Down / Shoot-Down (AESA Clutter Rejection)');
      clutterPenalty = 0.05;
      rangeModifier = 0.95;
      explanation = `Scanner look-down geometry over mountainous terrain (${targetGroundElev} m). AESA / Pulse-Doppler LD/SD filtered ground clutter reflections.`;
    } else if (isEoir) {
      specializedUsed.push('🔥 EO/IR IRST Thermal Lock (Clutter Immune)');
      clutterPenalty = 0.0;
      rangeModifier = 1.0;
      explanation = `Optical / IRST thermal sensor tracked target engine plume, completely immune to radar mountain ground clutter.`;
    } else if (isSarGmti && isGroundTarget) {
      specializedUsed.push('🛰️ SAR/GMTI Synthetic Aperture Ground Imaging');
      clutterPenalty = 0.08;
      rangeModifier = 0.92;
      explanation = `SAR/GMTI Doppler imaging resolved ground target against heavy valley clutter.`;
    } else {
      // Conventional radar without look-down suffers heavy mountain backscatter loss
      clutterPenalty = 0.55;
      rangeModifier = 0.45;
      explanation = `Scanner lacks Look-Down/Shoot-Down capability. Heavy mountain ground clutter attenuated radar sensitivity by -55%.`;
    }
  }

  return {
    isMasked: clutterPenalty >= 0.85,
    isObstructedByTerrain: false,
    scannerAltitudeM: effectiveScannerAltM,
    targetAltitudeM: effectiveTargetAltM,
    distanceKm: distKm,
    terrainClutterPenalty: clutterPenalty,
    rangeModifier,
    maskingExplanation: explanation,
    specializedEquipmentUsed: specializedUsed,
  };
}
