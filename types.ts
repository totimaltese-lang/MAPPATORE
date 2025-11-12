export interface PixelCoords {
  x: number;
  y: number;
}

export interface RealCoords {
  x: number;
  y: number;
}

export interface Point {
  name: string;
  pixelCoords: PixelCoords;
  realCoords: RealCoords;
  distance: number;
  bearing: number;
}

export interface Area {
  name: string;
  points: Point[];
  realArea: number;
}

export enum AppState {
  UPLOAD_IMAGE = 'UPLOAD_IMAGE',
  CALIBRATE_START = 'CALIBRATE_START',
  CALIBRATE_END = 'CALIBRATE_END',
  SET_ORIGIN = 'SET_ORIGIN',
  READY = 'READY',
  NAMING_POINT = 'NAMING_POINT',
  DEFINING_AREA = 'DEFINING_AREA',
  NAMING_AREA = 'NAMING_AREA',
}