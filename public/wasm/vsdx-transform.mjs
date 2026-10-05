// @ts-check
// 2-D affine transforms between Visio shape frames, and how a placed box maps onto draw.io's
// geometry (centre, size, rotation, flip). Coordinates are inches with y up.
import { numberOf } from './vsdx-model.mjs';

/** @typedef {import('./vsdx-model.mjs').Shape} Shape */
/** @typedef {import('./vsdx-model.mjs').VisioDocument} VisioDocument */
/**
 * [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f
 * @typedef {[number, number, number, number, number, number]} Matrix
 */
/** @typedef {[number, number]} Point */
/**
 * A box after a transform: centre, size, rotation (radians, counter-clockwise, y up) and mirroring.
 * @typedef {{ cx: number, cy: number, w: number, h: number, angle: number, mirrored: boolean }} Placement
 */

export const EPSILON = 1e-9;

/** @type {Matrix} */
export const IDENTITY = [1, 0, 0, 1, 0, 0];

/**
 * @param {Matrix} m
 * @param {Matrix} n
 * @returns {Matrix} m after n
 */
export function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/**
 * @param {Matrix} m
 * @returns {Matrix}
 */
export function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < EPSILON) return IDENTITY;
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

/**
 * @param {Matrix} m
 * @param {number} x
 * @param {number} y
 * @returns {Point}
 */
export function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/**
 * @param {number} x
 * @param {number} y
 * @returns {Matrix}
 */
export function translate(x, y) {
  return [1, 0, 0, 1, x, y];
}

/**
 * @param {number} angle  radians, counter-clockwise
 * @returns {Matrix}
 */
export function rotate(angle) {
  return [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0];
}

/**
 * @param {number} sx
 * @param {number} sy
 * @returns {Matrix}
 */
export function scaleBy(sx, sy) {
  return [sx, 0, 0, sy, 0, 0];
}

/**
 * Shape-local coordinates -> parent coordinates: flip and rotate about the pin.
 * @param {VisioDocument} doc
 * @param {Shape} shape
 * @returns {Matrix}
 */
export function localToParent(doc, shape) {
  const pinX = numberOf(doc, shape, 'PinX', 0);
  const pinY = numberOf(doc, shape, 'PinY', 0);
  const locPinX = numberOf(doc, shape, 'LocPinX', 0);
  const locPinY = numberOf(doc, shape, 'LocPinY', 0);
  const angle = numberOf(doc, shape, 'Angle', 0);
  const flipX = numberOf(doc, shape, 'FlipX', 0) ? -1 : 1;
  const flipY = numberOf(doc, shape, 'FlipY', 0) ? -1 : 1;
  return multiply(
    translate(pinX, pinY),
    multiply(rotate(angle), multiply(scaleBy(flipX, flipY), translate(-locPinX, -locPinY)))
  );
}

/**
 * Where a w x h local box ends up. A mirrored box is expressed as "flip horizontally, then
 * rotate", which is how draw.io applies its flipH and rotation styles.
 * @param {Matrix} m
 * @param {number} w
 * @param {number} h
 * @returns {Placement}
 */
export function placementOf(m, w, h) {
  const widthScale = Math.hypot(m[0], m[1]);
  const heightScale = Math.hypot(m[2], m[3]);
  const mirrored = m[0] * m[3] - m[1] * m[2] < 0;
  const [cx, cy] = apply(m, w / 2, h / 2);
  return {
    cx,
    cy,
    w: w * widthScale,
    h: h * heightScale,
    angle: mirrored ? Math.atan2(-m[1], -m[0]) : Math.atan2(m[1], m[0]),
    mirrored,
  };
}

/**
 * Page point -> fractions of the placed box measured from its top left, in the unflipped,
 * unrotated frame that draw.io's exitX/entryX constraints use.
 * @param {Placement} placement
 * @param {number} x
 * @param {number} y
 */
export function fractionIn(placement, x, y) {
  const dx = x - placement.cx;
  const dy = y - placement.cy;
  const cos = Math.cos(-placement.angle);
  const sin = Math.sin(-placement.angle);
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;
  const u = 0.5 + localX / (placement.w || 1);
  return { x: placement.mirrored ? 1 - u : u, y: 0.5 - localY / (placement.h || 1) };
}

/**
 * @param {number} numerator
 * @param {number} denominator
 * @param {number} [fallback]  when the denominator is zero
 */
export function safeRatio(numerator, denominator, fallback = 1) {
  return Math.abs(denominator) > EPSILON ? numerator / denominator : fallback;
}
