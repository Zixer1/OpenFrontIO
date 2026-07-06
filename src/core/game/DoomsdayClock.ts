/**
 * Doomsday Clock threshold math, shared by the authoritative sim
 * (DoomsdayClockExecution) and the client HUD readout so the two always agree.
 *
 * The required share of the map rises in WAVES (a battle-royale zone): one flat
 * grace at the very start, then each wave grows the share up LINEARLY over
 * rampSeconds to its level, followed by a flat pauseSeconds hold before the next
 * wave. So the bar climbs smoothly and briefly rests, it never jumps. Levels
 * track the ofstats FFA territory median and are the same for every preset; the
 * presets only change the pace (slower or faster). A side below the bar gets a
 * warn countdown, then bleeds troops. Integer-only and floored, deterministic.
 */

export type DoomsdayClockSpeed = "slow" | "normal" | "fast" | "veryfast";

/** In selector order. */
export const DOOMSDAY_CLOCK_SPEEDS: DoomsdayClockSpeed[] = [
  "slow",
  "normal",
  "fast",
  "veryfast",
];

interface WaveSchedule {
  /** Flat 0% for this long at the very start (the one grace period). */
  graceSeconds: number;
  /** Per-wave: wave i grows its share up linearly over rampSeconds[i]. */
  rampSeconds: number[];
  /** Per-wave: flat hold after wave i's ramp before the next one starts. */
  pauseSeconds: number[];
  /** Share (basis points, 100 = 1%) reached at the end of each ramp, ascending. */
  levels: number[];
}

// Grace once, then per wave a [ramp up over rampSeconds[i]] + [hold for
// pauseSeconds[i]]. The share rises linearly during each ramp and is flat during
// the grace and every pause. Ramps/pauses are PER WAVE (not uniform) so the curve
// can be shaped, not just paced.
//
// Balance rationale (OFM 2026 Summer data): with a uniform cadence the cull was
// heavily front-loaded (~75% of eliminations in the first half — 85% of deaths are
// doom-driven) while the late game stalled (only ~7% of deaths in the last third)
// until the final squeeze. So the early waves are LOWER and come LATER (breathing
// room for smaller/newer players), and the late waves are STEEPER with no pauses
// (a continuous endgame squeeze that breaks the stalemate and ends games sooner).
// Levels are shared across presets (near the ofstats FFA territory median, then a
// final 55% squeeze only one side can hold → single winner with the crown
// exemption); presets only change the pace. NOTE: values are data-informed
// PLAYTEST STARTING POINTS — tune against live dev-lobby curves.
const LEVELS = [250, 450, 1000, 2000, 3200, 5500]; // 2.5, 4.5, 10, 20, 32, 55%
const SCHEDULES: Record<DoomsdayClockSpeed, WaveSchedule> = {
  // grace 6:40; reaches 2.5/4.5/10/20/32/55% at ~11:40/17:00/21:10/23:55/25:55/27:35.
  normal: {
    graceSeconds: 400,
    rampSeconds: [300, 270, 220, 150, 120, 100],
    pauseSeconds: [50, 50, 30, 15, 0, 0],
    levels: LEVELS,
  },
  // grace 8:00; reaches at ~14:00/20:20/25:20/28:40/31:10/33:10.
  slow: {
    graceSeconds: 480,
    rampSeconds: [360, 320, 260, 180, 150, 120],
    pauseSeconds: [60, 60, 40, 20, 0, 0],
    levels: LEVELS,
  },
  // grace 5:00; reaches at ~8:40/12:40/15:40/17:40/19:10/20:20.
  fast: {
    graceSeconds: 300,
    rampSeconds: [220, 200, 160, 110, 90, 70],
    pauseSeconds: [40, 40, 20, 10, 0, 0],
    levels: LEVELS,
  },
  // grace 3:30; reaches at ~6:00/8:50/10:55/12:45/13:53/14:43.
  veryfast: {
    graceSeconds: 210,
    rampSeconds: [150, 140, 110, 80, 60, 50],
    pauseSeconds: [30, 30, 15, 8, 0, 0],
    levels: LEVELS,
  },
};

function schedule(speed: DoomsdayClockSpeed): WaveSchedule {
  return SCHEDULES[speed] ?? SCHEDULES.normal;
}

/**
 * Required share of the map (basis points) at `elapsed` game seconds: 0 through
 * the grace, then a linear ramp to each successive level with a flat pause after
 * each. Integer-only (floored) so every client agrees.
 */
function requiredBasisPoints(
  speed: DoomsdayClockSpeed,
  elapsed: number,
): number {
  const s = schedule(speed);
  if (elapsed <= s.graceSeconds) return 0;
  let t = elapsed - s.graceSeconds;
  let prev = 0;
  for (let i = 0; i < s.levels.length; i++) {
    const ramp = s.rampSeconds[i];
    const target = s.levels[i];
    if (t < ramp) return prev + Math.floor(((target - prev) * t) / ramp); // ramping
    t -= ramp;
    if (t < s.pauseSeconds[i]) return target; // in the pause: hold
    t -= s.pauseSeconds[i];
    prev = target;
  }
  return s.levels[s.levels.length - 1];
}

/**
 * Base minimum tiles one player must own at `elapsed` game seconds. One floored
 * integer ratio, so every client agrees.
 */
export function doomsdayClockRequiredTiles(
  speed: DoomsdayClockSpeed,
  land: number,
  elapsed: number,
): number {
  if (land <= 0) return 0;
  return Math.floor((requiredBasisPoints(speed, elapsed) * land) / 10000);
}

/**
 * Threshold a whole side must hold: the base per-player share scaled by the
 * side's headcount, so a team of N must hold N× what a solo player holds (FFA
 * sides are size 1, i.e. unscaled). Capped at the whole map. Shared by the sim
 * and the HUD so the two always agree.
 */
export function doomsdayClockSideRequiredTiles(
  speed: DoomsdayClockSpeed,
  land: number,
  elapsed: number,
  sideSize: number,
): number {
  const base = doomsdayClockRequiredTiles(speed, land, elapsed);
  return Math.min(land, base * Math.max(1, sideSize));
}

export interface DoomsdayClockWaveState {
  /** Required share right now, as a percent of the map (ramps during a wave). */
  currentPercent: number;
  /** The share the current (or next) ramp climbs to. */
  targetPercent: number;
  /** True while the share is actively ramping up. */
  growing: boolean;
  /** Seconds until the next ramp begins (0 while growing or once done). */
  secondsToNextGrowth: number;
  /** Within 5s before or after a ramp starting (the orange cue window). */
  waveFlash: boolean;
  /** True once the final level has been reached. */
  done: boolean;
}

/**
 * Display-only companion for the HUD: the live share, whether it is ramping or
 * holding, and the cue window. Lives here so the schedule is defined once.
 */
export function doomsdayClockWaveState(
  speed: DoomsdayClockSpeed,
  elapsed: number,
): DoomsdayClockWaveState {
  const s = schedule(speed);
  const currentPercent = requiredBasisPoints(speed, elapsed) / 100;
  const n = s.levels.length;
  const last = s.levels[n - 1] / 100;

  // Grace: flat 0; the first ramp starts at graceSeconds.
  if (elapsed <= s.graceSeconds) {
    return {
      currentPercent: 0,
      targetPercent: s.levels[0] / 100,
      growing: false,
      secondsToNextGrowth: s.graceSeconds - elapsed,
      waveFlash: s.graceSeconds - elapsed <= 5,
      done: false,
    };
  }

  // Walk the per-wave ramp/pause segments to locate the current wave.
  let t = elapsed - s.graceSeconds;
  for (let i = 0; i < n; i++) {
    const ramp = s.rampSeconds[i];
    const pause = s.pauseSeconds[i];
    const isLast = i === n - 1;
    if (t < ramp) {
      // Ramping up toward level i.
      return {
        currentPercent,
        targetPercent: s.levels[i] / 100,
        growing: true,
        secondsToNextGrowth: 0,
        waveFlash: t <= 5, // just started ramping
        done: false,
      };
    }
    t -= ramp;
    if (t < pause) {
      // Holding after level i; next ramp begins in (pause - t)s.
      return {
        currentPercent,
        targetPercent: (isLast ? s.levels[i] : s.levels[i + 1]) / 100,
        growing: false,
        secondsToNextGrowth: isLast ? 0 : pause - t,
        waveFlash: !isLast && pause - t <= 5, // next ramp imminent
        done: isLast,
      };
    }
    t -= pause;
  }
  // Past the final level.
  return {
    currentPercent,
    targetPercent: last,
    growing: false,
    secondsToNextGrowth: 0,
    waveFlash: false,
    done: true,
  };
}

export interface DoomsdayClockDrainConfig {
  drainStartPercent: number;
  drainMaxPercent: number;
  drainRampSeconds: number;
}

/**
 * Troops a skulled side loses this second: a LINEAR ramp from drainStartPercent
 * up to drainMaxPercent over drainRampSeconds. It is a percentage of the side's
 * MAX troop capacity (not current), so it outpaces troop income from the first
 * second and accelerates as it grows, driving the side to zero in ~55s from full
 * troops (sooner with fewer troops or a shrinking territory). The caller caps it
 * at the side's current troops (removeTroops does, and the HUD shows
 * min(current, this)). Shared by the sim and the HUD.
 */
export function doomsdayClockDrain(
  maxTroops: number,
  secondsPastWarn: number,
  cfg: DoomsdayClockDrainConfig,
): number {
  const t = Math.max(0, secondsPastWarn);
  const r = cfg.drainRampSeconds;
  const span = cfg.drainMaxPercent - cfg.drainStartPercent;
  const pct =
    r <= 0 || t >= r
      ? cfg.drainMaxPercent
      : cfg.drainStartPercent + Math.floor((span * t) / r);
  return Math.max(1, Math.floor((maxTroops * pct) / 100));
}
