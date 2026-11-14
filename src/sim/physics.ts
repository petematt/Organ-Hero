import { GameConfig } from '../config';
import { clamp, SeededRNG } from './rng';
import { AttackArchetype, AttackRoute, BezierPath, Team, Vec2 } from './types';

export const RINK_WIDTH = 1000;
export const RINK_HEIGHT = 425;
export const RINK_CORNER_RADIUS = 70;
export const CENTER_X = RINK_WIDTH / 2; // 500
export const CENTER_Y = RINK_HEIGHT / 2; // 212.5
export const HOME_GOAL_X = 100;
export const AWAY_GOAL_X = RINK_WIDTH - 100; // 900
export const GOAL_HALF_WIDTH = 34;
export const NET_DEPTH = 24;
export const BLUE_LINE_HOME_X = 340;
export const BLUE_LINE_AWAY_X = 660;

export function isBehindOwnBlueLine(pos: Vec2, team: Team): boolean {
  return team === 'home' ? pos.x < BLUE_LINE_HOME_X : pos.x > BLUE_LINE_AWAY_X;
}

export function isBehindOpponentGoalLine(
  pos: Vec2,
  team: Team,
  margin: number = 0
): boolean {
  return team === 'home'
    ? pos.x >= AWAY_GOAL_X - margin
    : pos.x <= HOME_GOAL_X + margin;
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
 * Generates an attack route with one of 4 archetypes:
 * - BEHIND_NET_LOOP: Drive deep into corner/wing, loop behind the goal, wrap around opposite post.
 * - CORNER_CYCLE: Drive into deep corner boards, protect puck, dish centering feed to slot.
 * - WIDE_WING: Flank down outer boards and cut across at 45 degrees.
 * - DIRECT_SLOT: Direct power drive into the high/low slot.
 */
export function createAttackRoute(
  startPos: Vec2,
  team: Team,
  rng: SeededRNG,
  focus: number = 0.5,
  aggression: number = 0.5
): AttackRoute {
  const oppGoal = getOpponentGoalPos(team);
  const dirX = team === 'home' ? 1 : -1;

  // Weight archetypes based on focus and aggression
  const wrapWeight = 0.32 + focus * 0.15;
  const cycleWeight = 0.20 + (1 - aggression) * 0.10;
  const wingWeight = 0.18;
  const slotWeight = 0.30 + aggression * 0.20;

  const total = wrapWeight + cycleWeight + wingWeight + slotWeight;
  const roll = rng.next() * total;

  let archetype: AttackArchetype = 'DIRECT_SLOT';
  if (roll < wrapWeight) {
    archetype = 'BEHIND_NET_LOOP';
  } else if (roll < wrapWeight + cycleWeight) {
    archetype = 'CORNER_CYCLE';
  } else if (roll < wrapWeight + cycleWeight + wingWeight) {
    archetype = 'WIDE_WING';
  } else {
    archetype = 'DIRECT_SLOT';
  }

  const waypoints: Vec2[] = [];
  let shotTriggerDist = 145;
  let setupPassTarget: Vec2 | undefined;

  const topSide = startPos.y < CENTER_Y;

  switch (archetype) {
    case 'BEHIND_NET_LOOP': {
      // Loop behind the net and cut around to the opposite post (wrap-around)
      const entryY = topSide ? 62 : RINK_HEIGHT - 62;
      const exitY = topSide ? RINK_HEIGHT - 75 : 75;

      waypoints.push(
        // 1. Deep offensive wing entry
        { x: clamp(oppGoal.x - dirX * 35, 45, RINK_WIDTH - 45), y: entryY },
        // 2. Behind the net apex (comfortable wide clearance behind the cage)
        { x: clamp(oppGoal.x + dirX * 45, 35, RINK_WIDTH - 35), y: CENTER_Y },
        // 3. Wrap exit around far post
        { x: clamp(oppGoal.x - dirX * 25, 45, RINK_WIDTH - 45), y: exitY },
        // 4. Cut into slot for wrap shot or backdoor feed
        { x: clamp(oppGoal.x - dirX * 65, 45, RINK_WIDTH - 45), y: exitY + (topSide ? -35 : 35) }
      );
      shotTriggerDist = 88;
      setupPassTarget = { x: oppGoal.x - dirX * 90, y: exitY };
      break;
    }
    case 'CORNER_CYCLE': {
      // Carry into deep corner boards to draw defenders, setup centering feed
      const cornerY = topSide ? 48 : RINK_HEIGHT - 48;
      waypoints.push(
        { x: clamp(oppGoal.x - dirX * 15, 45, RINK_WIDTH - 45), y: cornerY },
        { x: clamp(oppGoal.x - dirX * 10, 45, RINK_WIDTH - 45), y: cornerY + (topSide ? 40 : -40) },
        { x: clamp(oppGoal.x - dirX * 70, 45, RINK_WIDTH - 45), y: CENTER_Y + (topSide ? 35 : -35) }
      );
      shotTriggerDist = 125;
      setupPassTarget = { x: oppGoal.x - dirX * 115, y: CENTER_Y };
      break;
    }
    case 'WIDE_WING': {
      // Wide board rush cutting sharply across the crease
      const wingY = topSide ? 52 : RINK_HEIGHT - 52;
      waypoints.push(
        { x: clamp(CENTER_X + dirX * 80, 50, RINK_WIDTH - 50), y: wingY },
        { x: clamp(oppGoal.x - dirX * 85, 45, RINK_WIDTH - 45), y: wingY },
        { x: clamp(oppGoal.x - dirX * 48, 45, RINK_WIDTH - 45), y: CENTER_Y + (topSide ? -22 : 22) }
      );
      shotTriggerDist = 135;
      break;
    }
    case 'DIRECT_SLOT':
    default: {
      // Direct power drive into the high or low danger slot
      const slotY = clamp(CENTER_Y + rng.range(-32, 32), 100, RINK_HEIGHT - 100);
      waypoints.push(
        { x: clamp(oppGoal.x - dirX * 150, 45, RINK_WIDTH - 45), y: clamp(startPos.y, 95, RINK_HEIGHT - 95) },
        { x: clamp(oppGoal.x - dirX * 80, 45, RINK_WIDTH - 45), y: slotY }
      );
      shotTriggerDist = 145;
      break;
    }
  }

  return {
    archetype,
    waypoints,
    currentWaypointIndex: 0,
    shotTriggerDist,
    setupPassTarget,
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

/**
 * Applies steering acceleration/inertia to skater velocity instead of snapping instantly.
 * Produces realistic turning arcs, preserves momentum around turns, and prevents stopping on a dime.
 */
export function applySkaterSteering(
  currentVel: Vec2,
  desiredVel: Vec2,
  dtSec: number,
  agility: number = 8.5
): Vec2 {
  const blend = 1 - Math.exp(-Math.max(1, agility) * Math.max(0, dtSec));
  return {
    x: currentVel.x + (desiredVel.x - currentVel.x) * blend,
    y: currentVel.y + (desiredVel.y - currentVel.y) * blend,
  };
}

/**
 * Solid obstacle collision resolution for skaters against goal net cages.
 * Keeps skaters from clipping through the back/sides of the nets when looping behind the goal.
 */
export function collideSkaterWithGoalNets(
  pos: Vec2,
  vel: Vec2,
  radius: number
): { pos: Vec2; vel: Vec2 } {
  let x = pos.x;
  let y = pos.y;
  let vx = vel.x;
  let vy = vel.y;

  const nets = [
    // Home net cage
    { minX: HOME_GOAL_X - NET_DEPTH, maxX: HOME_GOAL_X, minY: CENTER_Y - GOAL_HALF_WIDTH, maxY: CENTER_Y + GOAL_HALF_WIDTH },
    // Away net cage
    { minX: AWAY_GOAL_X, maxX: AWAY_GOAL_X + NET_DEPTH, minY: CENTER_Y - GOAL_HALF_WIDTH, maxY: CENTER_Y + GOAL_HALF_WIDTH },
  ];

  for (const net of nets) {
    const cx = clamp(x, net.minX, net.maxX);
    const cy = clamp(y, net.minY, net.maxY);
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.hypot(dx, dy);

    if (d < radius) {
      if (d > 1e-5) {
        const nx = dx / d;
        const ny = dy / d;
        x = cx + nx * radius;
        y = cy + ny * radius;
        const dot = vx * nx + vy * ny;
        if (dot < 0) {
          vx -= dot * nx;
          vy -= dot * ny;
        }
      } else {
        // Skater center is inside net bounding box: push outward toward shallowest edge
        const leftDist = Math.abs(x - net.minX);
        const rightDist = Math.abs(net.maxX - x);
        const topDist = Math.abs(y - net.minY);
        const botDist = Math.abs(net.maxY - y);
        const minDist = Math.min(leftDist, rightDist, topDist, botDist);
        if (minDist === leftDist) {
          x = net.minX - radius;
          if (vx > 0) vx = 0;
        } else if (minDist === rightDist) {
          x = net.maxX + radius;
          if (vx < 0) vx = 0;
        } else if (minDist === topDist) {
          y = net.minY - radius;
          if (vy > 0) vy = 0;
        } else {
          y = net.maxY + radius;
          if (vy < 0) vy = 0;
        }
      }
    }
  }

  return { pos: { x, y }, vel: { x: vx, y: vy } };
}

/**
 * Physical collision between loose pucks and the goal net cage.
 * Allows shots into the open front mouth to enter the net, but reflects pucks
 * hitting the back or sides of the net structure.
 */
export function collidePuckWithGoalNets(
  pos: Vec2,
  vel: Vec2,
  radius: number,
  restitution: number = 0.55
): { pos: Vec2; vel: Vec2; bounced: boolean } {
  let x = pos.x;
  let y = pos.y;
  let vx = vel.x;
  let vy = vel.y;
  let bounced = false;

  const nets = [
    // Home net: open front mouth faces right (+x)
    { minX: HOME_GOAL_X - NET_DEPTH, maxX: HOME_GOAL_X, minY: CENTER_Y - GOAL_HALF_WIDTH, maxY: CENTER_Y + GOAL_HALF_WIDTH, mouthSide: 'right' as const },
    // Away net: open front mouth faces left (-x)
    { minX: AWAY_GOAL_X, maxX: AWAY_GOAL_X + NET_DEPTH, minY: CENTER_Y - GOAL_HALF_WIDTH, maxY: CENTER_Y + GOAL_HALF_WIDTH, mouthSide: 'left' as const },
  ];

  for (const net of nets) {
    const isEnteringMouth =
      net.mouthSide === 'right'
        ? (vx < 0 && x >= net.maxX - radius && y >= net.minY && y <= net.maxY)
        : (vx > 0 && x <= net.minX + radius && y >= net.minY && y <= net.maxY);

    if (isEnteringMouth) {
      continue;
    }

    const cx = clamp(x, net.minX, net.maxX);
    const cy = clamp(y, net.minY, net.maxY);
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.hypot(dx, dy);

    if (d < radius && d > 1e-5) {
      const nx = dx / d;
      const ny = dy / d;
      x = cx + nx * radius;
      y = cy + ny * radius;
      const dot = vx * nx + vy * ny;
      if (dot < 0) {
        vx = vx - (1 + restitution) * dot * nx;
        vy = vy - (1 + restitution) * dot * ny;
        bounced = true;
      }
    }
  }

  return { pos: { x, y }, vel: { x: vx, y: vy }, bounced };
}

