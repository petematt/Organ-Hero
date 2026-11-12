import { GameConfig } from '../config';
import { clamp, SeededRNG } from './rng';
import { BezierPath, Team, Vec2 } from './types';

export const RINK_WIDTH = 1000;
export const RINK_HEIGHT = 425;
export const RINK_CORNER_RADIUS = 70;
export const CENTER_X = RINK_WIDTH / 2; // 500
export const CENTER_Y = RINK_HEIGHT / 2; // 212.5
export const HOME_GOAL_X = 55;
export const AWAY_GOAL_X = RINK_WIDTH - 55; // 945
export const GOAL_HALF_WIDTH = 34;
export const BLUE_LINE_HOME_X = 340;
export const BLUE_LINE_AWAY_X = 660;

export function isBehindOwnBlueLine(pos: Vec2, team: Team): boolean {
  return team === 'home' ? pos.x < BLUE_LINE_HOME_X : pos.x > BLUE_LINE_AWAY_X;
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  if (len < 1e-6) return { x: 1, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

export function getOpponentGoalPos(team: Team): Vec2 {
  return team === 'home'
    ? { x: AWAY_GOAL_X, y: CENTER_Y }
    : { x: HOME_GOAL_X, y: CENTER_Y };
}

export function getOwnGoalPos(team: Team): Vec2 {
  return team === 'home'
    ? { x: HOME_GOAL_X, y: CENTER_Y }
    : { x: AWAY_GOAL_X, y: CENTER_Y };
}

/**
 * Generates a quadratic Bezier attack path from startPos to a shooting spot in front of the opponent's goal.
 */
export function createCurvedPathToGoal(
  startPos: Vec2,
  team: Team,
  rng: SeededRNG
): BezierPath {
  const goalPos = getOpponentGoalPos(team);
  const targetX = team === 'home' ? goalPos.x - 50 : goalPos.x + 50;
  const targetY = clamp(goalPos.y + rng.range(-28, 28), 90, RINK_HEIGHT - 90);
  const p2 = { x: targetX, y: targetY };

  const midX = (startPos.x + p2.x) * 0.5;
  const lateralOffset = rng.sign() * rng.range(55, 120);
  const midY = clamp(
    (startPos.y + p2.y) * 0.5 + lateralOffset,
    45,
    RINK_HEIGHT - 45
  );

  return {
    p0: { x: startPos.x, y: startPos.y },
    p1: { x: midX, y: midY },
    p2,
  };
}

/**
 * Evaluates a quadratic Bezier curve at parameter t in [0, 1].
 */
export function evalBezier(path: BezierPath, t: number): Vec2 {
  const u = 1 - clamp(t, 0, 1);
  const tt = clamp(t, 0, 1);
  return {
    x: u * u * path.p0.x + 2 * u * tt * path.p1.x + tt * tt * path.p2.x,
    y: u * u * path.p0.y + 2 * u * tt * path.p1.y + tt * tt * path.p2.y,
  };
}

/**
 * Computes goalie block rebound velocity.
 * Features a high chance (55%) of knocking the puck straight up or down (90 degrees from the goal direction / along the goal line),
 * and otherwise deflecting into the corners / side boards (30-48 degrees from the goal line),
 * always steering away from the dangerous center slot (y = CENTER_Y).
 */
export function computeReboundVelocity(
  goalieTeam: Team,
  puckY: number,
  incomingSpeed: number,
  cfg: GameConfig,
  rng: SeededRNG
): Vec2 {
  const outSpeed = Math.max(260, incomingSpeed * cfg.reboundSpeedRatio);

  // High chance (55%) of knocking the puck straight up or down (90 degrees from the direction of the goal),
  // otherwise kicking toward the corners / boards (30 to 48 degrees from the goal line).
  const isVerticalKick = rng ? rng.rollAgainst(0.55) : true;
  const angleDeg = isVerticalKick
    ? (rng ? rng.range(0, 12) : 5)
    : (rng ? rng.range(30, 48) : 40);
  const angleFromGoalLine = (angleDeg * Math.PI) / 180;

  // Horizontal direction: away from own net toward center ice
  const dirX = goalieTeam === 'home' ? 1 : -1;

  // Vertical direction: AWAY from horizontal center line (toward nearest boards / corner)
  let dirY: number;
  if (Math.abs(puckY - CENTER_Y) < 1e-3) {
    dirY = rng ? rng.sign() : 1;
  } else {
    // If puck is in top half (puckY < CENTER_Y), kick UP (-1); if in bottom half, kick DOWN (+1)
    dirY = puckY < CENTER_Y ? -1 : 1;
  }

  const vx = dirX * Math.sin(angleFromGoalLine) * outSpeed;
  const vy = dirY * Math.cos(angleFromGoalLine) * outSpeed;
  return { x: vx, y: vy };
}

/**
 * Applies exponential friction decay to a loose puck velocity.
 */
export function applyPuckFriction(vel: Vec2, dtSec: number, cfg: GameConfig): Vec2 {
  const decay = Math.exp(-cfg.puckFrictionPerSec * dtSec);
  const nx = vel.x * decay;
  const ny = vel.y * decay;
  const speed = Math.hypot(nx, ny);
  if (speed < 4) return { x: 0, y: 0 };
  if (speed > 900) {
    return { x: (nx / speed) * 900, y: (ny / speed) * 900 };
  }
  return { x: nx, y: ny };
}

/**
 * Reflects a puck off the boards and rounded corners (radius 70) with restitution.
 */
export function collidePuckWithBoards(
  pos: Vec2,
  vel: Vec2,
  radius: number,
  restitution: number
): { pos: Vec2; vel: Vec2; bounced: boolean } {
  let x = pos.x;
  let y = pos.y;
  let vx = vel.x;
  let vy = vel.y;
  let bounced = false;

  const cr = RINK_CORNER_RADIUS;
  const minX = radius;
  const maxX = RINK_WIDTH - radius;
  const minY = radius;
  const maxY = RINK_HEIGHT - radius;

  // Check if in one of the 4 corner quadrants
  const inLeft = x < cr;
  const inRight = x > RINK_WIDTH - cr;
  const inTop = y < cr;
  const inBottom = y > RINK_HEIGHT - cr;

  if ((inLeft || inRight) && (inTop || inBottom)) {
    const cx = inLeft ? cr : RINK_WIDTH - cr;
    const cy = inTop ? cr : RINK_HEIGHT - cr;
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.hypot(dx, dy);
    const maxCornerDist = cr - radius;
    if (d > maxCornerDist && d > 1e-5) {
      const nx = dx / d;
      const ny = dy / d;
      x = cx + nx * maxCornerDist;
      y = cy + ny * maxCornerDist;
      const dot = vx * nx + vy * ny;
      if (dot > 0) {
        vx = vx - (1 + restitution) * dot * nx;
        vy = vy - (1 + restitution) * dot * ny;
        bounced = true;
      }
    }
    return { pos: { x, y }, vel: { x: vx, y: vy }, bounced };
  }

  if (x < minX) {
    x = minX;
    if (vx < 0) {
      vx = -vx * restitution;
      bounced = true;
    }
  } else if (x > maxX) {
    x = maxX;
    if (vx > 0) {
      vx = -vx * restitution;
      bounced = true;
    }
  }

  if (y < minY) {
    y = minY;
    if (vy < 0) {
      vy = -vy * restitution;
      bounced = true;
    }
  } else if (y > maxY) {
    y = maxY;
    if (vy > 0) {
      vy = -vy * restitution;
      bounced = true;
    }
  }

  return { pos: { x, y }, vel: { x: vx, y: vy }, bounced };
}

/**
 * Clamps a skater inside the rink boards and cancels inward wall velocity.
 */
export function clampSkaterToBoards(
  pos: Vec2,
  vel: Vec2,
  radius: number
): { pos: Vec2; vel: Vec2 } {
  const res = collidePuckWithBoards(pos, vel, radius, 0);
  return { pos: res.pos, vel: res.vel };
}

export const POST_RADIUS = 4.5;

export interface PostCollisionResult {
  hit: boolean;
  postPos: Vec2 | null;
  pos: Vec2;
  vel: Vec2;
}

/**
 * Checks and resolves collision between the puck and the red goalposts.
 * Posts are located at top and bottom of each goal mouth.
 */
export function collidePuckWithGoalPosts(
  pos: Vec2,
  vel: Vec2,
  puckRadius: number,
  restitution: number = 0.88
): PostCollisionResult {
  const minDist = puckRadius + POST_RADIUS;
  const postYCoords = [CENTER_Y - GOAL_HALF_WIDTH, CENTER_Y + GOAL_HALF_WIDTH];
  const postXCoords = [HOME_GOAL_X, AWAY_GOAL_X];

  for (const px of postXCoords) {
    for (const py of postYCoords) {
      const dx = pos.x - px;
      const dy = pos.y - py;
      const d = Math.hypot(dx, dy);
      if (d < minDist && d > 1e-4) {
        const nx = dx / d;
        const ny = dy / d;
        const newPos = {
          x: px + nx * minDist,
          y: py + ny * minDist,
        };
        const dot = vel.x * nx + vel.y * ny;
        if (dot < 0) {
          const newVel = {
            x: vel.x - (1 + restitution) * dot * nx,
            y: vel.y - (1 + restitution) * dot * ny,
          };
          return { hit: true, postPos: { x: px, y: py }, pos: newPos, vel: newVel };
        }
      }
    }
  }

  return { hit: false, postPos: null, pos, vel };
}

