export type Box = { x: number; y: number; width: number; height: number };

export type CarObservation = Box & {
  trackId: number;
  detectorScore: number;
  observed: true;
};

export type LogoObservation = Box & {
  sponsorId: string;
  trackId: number;
  inliers: number;
  matchRatio: number;
};

export type SampleFrame = {
  time: number;
  cars: CarObservation[];
  logos: LogoObservation[];
};

export type ExposureInterval = {
  sponsorId: string;
  start: number;
  end: number;
  observations: number;
  carTrackIds: number[];
};

export type RunResult = {
  width: number;
  height: number;
  duration: number;
  sampleHz: number;
  elapsedMs: number;
  frames: SampleFrame[];
  exposures: ExposureInterval[];
  engine: string;
};

export type SponsorReference = {
  id: string;
  name: string;
  previewUrl: string;
  width: number;
  height: number;
  fileName: string;
};

export type SpeedGate = { a: [number, number]; b: [number, number] };
export type SpeedResult = {
  trackId: number;
  firstTime: number;
  secondTime: number;
  distanceM: number;
  speedKmh: number;
};
