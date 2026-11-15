import { SongId } from '../sim/types';

interface StaffNote {
  x: number;
  /** Y coordinate on viewBox 0..36 (staff lines at 8, 13, 18, 23, 28) */
  y: number;
  /** Secondary chord tones on the same stem */
  chordY?: number[];
  /** Open notehead (half/whole) vs filled quarter/eighth */
  open?: boolean;
  /** Draw ledger line at C4 (33) or A5 (3) */
  ledgerY?: number;
  /** Staccato dot above/below notehead */
  staccato?: boolean;
  /** Sharp sign before notehead */
  sharp?: boolean;
  /** Flat sign before notehead */
  flat?: boolean;
  /** Stem direction ('up' | 'down' | 'none') */
  stem?: 'up' | 'down' | 'none';
  /** Single eighth flag on standalone note */
  flag?: boolean;
}

interface StaffBeam {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface SongNotationSpec {
  title: string;
  effect: string;
  barlineX: number;
  notes: StaffNote[];
  beams?: StaffBeam[];
  slur?: string;
}

const SONG_NOTATION: Record<SongId, SongNotationSpec> = {
  charge: {
    title: 'Charge! Fanfare',
    effect: 'Boosts offense Focus & Aggression',
    barlineX: 98,
    notes: [
      { x: 38, y: 23, stem: 'up' }, // G4
      { x: 56, y: 15.5, stem: 'up' }, // C5
      { x: 74, y: 10.5, stem: 'up' }, // E5
      { x: 112, y: 5.5, chordY: [15.5], stem: 'down' }, // G5 + C5
      { x: 134, y: 10.5, stem: 'down', flag: true }, // E5
      { x: 156, y: 5.5, chordY: [10.5, 15.5], open: true, stem: 'down' }, // G5 fanfare chord
    ],
    beams: [{ x1: 41, y1: 11, x2: 77, y2: 3 }],
  },
  hold_the_line: {
    title: 'Hold the Line',
    effect: 'Boosts defending Goalie & Defense',
    barlineX: 88,
    notes: [
      { x: 42, y: 30.5, chordY: [20.5], stem: 'up' }, // D4 + A4
      { x: 66, y: 33, chordY: [23], ledgerY: 33, stem: 'up' }, // C4 + G4
      { x: 104, y: 25.5, stem: 'up' }, // F4
      { x: 126, y: 23, stem: 'up' }, // G4
      { x: 152, y: 30.5, chordY: [20.5], open: true, stem: 'up' }, // D4 resolve
    ],
    beams: [{ x1: 107, y1: 12.5, x2: 129, y2: 10.5 }],
  },
  grudge_toccata: {
    title: 'Grudge Toccata',
    effect: 'Spikes Aggression, sparks brawls',
    barlineX: 94,
    notes: [
      { x: 38, y: 13, stem: 'down' }, // D5
      { x: 58, y: 15.5, sharp: true, stem: 'down' }, // C#5
      { x: 78, y: 13, open: true, stem: 'down' }, // D5
      { x: 108, y: 15.5, stem: 'down' }, // C5
      { x: 124, y: 18, flat: true, stem: 'down' }, // Bb4
      { x: 140, y: 20.5, stem: 'down' }, // A4
      { x: 156, y: 23, stem: 'down' }, // G4
    ],
    beams: [
      { x1: 35, y1: 27, x2: 55, y2: 28.5 },
      { x1: 105, y1: 28, x2: 153, y2: 34 },
    ],
  },
  power_play_polka: {
    title: 'Power Play Polka',
    effect: 'Boosts PP cycle & one-timers',
    barlineX: 100,
    notes: [
      { x: 38, y: 25.5, staccato: true, stem: 'up' }, // F4 oom
      { x: 56, y: 15.5, chordY: [20.5], staccato: true, stem: 'up' }, // C5 pah
      { x: 74, y: 33, ledgerY: 33, staccato: true, stem: 'up' }, // C4 oom
      { x: 90, y: 13, staccato: true, stem: 'up' }, // D5 pah
      { x: 114, y: 25.5, stem: 'up' }, // F4
      { x: 134, y: 10.5, stem: 'up' }, // E5
      { x: 156, y: 8, chordY: [15.5, 20.5], open: true, stem: 'down' }, // F5 polka chord
    ],
    beams: [
      { x1: 41, y1: 11, x2: 59, y2: 4.5 },
      { x1: 77, y1: 16, x2: 93, y2: 3.5 },
      { x1: 117, y1: 11, x2: 137, y2: 3 },
    ],
  },
  kill_the_clock: {
    title: 'Kill the Clock',
    effect: 'Boosts PK goalie & clears',
    barlineX: 102,
    notes: [
      { x: 38, y: 20.5, staccato: true, stem: 'up' }, // A4 tick
      { x: 56, y: 28, staccato: true, stem: 'up' }, // E4 tock
      { x: 74, y: 20.5, staccato: true, stem: 'up' }, // A4 tick
      { x: 90, y: 28, staccato: true, stem: 'up' }, // E4 tock
      { x: 116, y: 18, flat: true, staccato: true, stem: 'up' }, // Bb4
      { x: 134, y: 28, staccato: true, stem: 'up' }, // E4
      { x: 156, y: 20.5, chordY: [28, 15.5], open: true, stem: 'up' }, // Am lock
    ],
    beams: [
      { x1: 41, y1: 9, x2: 93, y2: 13 },
      { x1: 119, y1: 7, x2: 137, y2: 14 },
    ],
  },
  madeyalook: {
    title: 'Madeyalook',
    effect: 'Rattles opposing goalie on shots',
    barlineX: 94,
    notes: [
      { x: 38, y: 5.5, stem: 'down' }, // G5
      { x: 58, y: 10.5, stem: 'down' }, // E5
      { x: 78, y: 3, ledgerY: 3, stem: 'down' }, // A5
      { x: 110, y: 5.5, stem: 'down' }, // G5
      { x: 130, y: 10.5, stem: 'down' }, // E5
      { x: 154, y: 15.5, chordY: [23], open: true, stem: 'down' }, // C5 resolve
    ],
    beams: [
      { x1: 35, y1: 20, x2: 55, y2: 23 },
      { x1: 107, y1: 20, x2: 127, y2: 23 },
    ],
  },
  underdog_draw: {
    title: 'Underdog Draw',
    effect: 'Tilts faceoffs to trailing team',
    barlineX: 98,
    notes: [
      { x: 40, y: 18, flat: true, stem: 'up' }, // Bb4
      { x: 60, y: 13, stem: 'up' }, // D5
      { x: 80, y: 8, stem: 'up' }, // F5
      { x: 118, y: 3, chordY: [13, 18], ledgerY: 3, open: true, stem: 'down' }, // Bb5
      { x: 152, y: 3, ledgerY: 3, open: true, stem: 'down' },
    ],
    beams: [{ x1: 43, y1: 6.5, x2: 83, y2: 1.5 }],
  },
  second_wind: {
    title: 'Second Wind',
    effect: 'Restores 40% skater stamina',
    barlineX: 100,
    notes: [
      { x: 40, y: 28, stem: 'up' }, // E4
      { x: 62, y: 20.5, stem: 'up' }, // A4
      { x: 84, y: 15.5, sharp: true, stem: 'up' }, // C#5
      { x: 122, y: 10.5, chordY: [20.5, 28], open: true, stem: 'up' }, // E5 waltz
      { x: 154, y: 10.5, open: true, stem: 'down' },
    ],
    slur: 'M 40 33 Q 64 36 86 22',
  },
  tic_tac_toe: {
    title: 'Tic-Tac-Toe Polka',
    effect: 'Sharpens passes & one-timers',
    barlineX: 96,
    notes: [
      { x: 42, y: 15.5, staccato: true, stem: 'up' }, // C5
      { x: 68, y: 10.5, staccato: true, stem: 'up' }, // E5
      { x: 116, y: 5.5, chordY: [15.5, 23], staccato: true, stem: 'down' }, // G5 1-timer
      { x: 150, y: 5.5, chordY: [10.5, 15.5], open: true, stem: 'down' },
    ],
    beams: [{ x1: 45, y1: 4.5, x2: 71, y2: 2 }],
  },
  the_fortress: {
    title: 'The Fortress',
    effect: 'Locks in clean glove saves',
    barlineX: 94,
    notes: [
      { x: 54, y: 33, chordY: [23, 15.5], ledgerY: 33, open: true, stem: 'up' }, // C4+G4+C5
      { x: 128, y: 23, chordY: [18, 10.5], flat: true, open: true, stem: 'up' }, // G4+Bb4+Eb5
    ],
  },
  sirens_waltz: {
    title: "The Siren's Waltz",
    effect: 'Causes carrier panic turnovers',
    barlineX: 102,
    notes: [
      { x: 42, y: 8, sharp: true, stem: 'down' }, // F#5
      { x: 64, y: 10.5, stem: 'down' }, // E5
      { x: 84, y: 13, stem: 'down' }, // D5
      { x: 124, y: 15.5, chordY: [25.5], sharp: true, open: true, stem: 'down' }, // C5 + F#4 tritone
      { x: 154, y: 15.5, open: true, stem: 'down' },
    ],
    slur: 'M 42 3.5 Q 64 0.5 85 7.5',
  },
  overtime_overture: {
    title: 'Overtime Overture',
    effect: 'Speed surge (+35% in last 30s)',
    barlineX: 104,
    notes: [
      { x: 36, y: 30.5, stem: 'up' }, // D4
      { x: 52, y: 25.5, stem: 'up' }, // F4
      { x: 68, y: 20.5, stem: 'up' }, // A4
      { x: 86, y: 13, stem: 'up' }, // D5
      { x: 120, y: 8, stem: 'down', flag: true }, // F5
      { x: 150, y: 3, chordY: [13, 20.5], ledgerY: 3, open: true, stem: 'down' }, // A5 + D5
    ],
    beams: [{ x1: 39, y1: 16, x2: 89, y2: 3 }],
  },
};

export function getSongTitleCase(songId: SongId): string {
  return SONG_NOTATION[songId]?.title ?? songId;
}

export function getSongEffectLine(songId: SongId): string {
  return SONG_NOTATION[songId]?.effect ?? '';
}

/**
 * Renders a crisp, engraved 5-line musical staff SVG for a given song's actual organ melody.
 * Uses pure vector geometry (<line>, <ellipse>, <path>) with aria-hidden="true" so screen readers
 * and text assertions see clean semantic copy without music-symbol character noise.
 */
export function renderSongStaffSvg(songId: SongId): string {
  const spec = SONG_NOTATION[songId] ?? SONG_NOTATION.charge;
  const staffLines = [8, 13, 18, 23, 28]
    .map(
      (y) =>
        `<line x1="6" y1="${y}" x2="178" y2="${y}" stroke="#5c4b37" stroke-width="0.75" stroke-opacity="0.72" />`
    )
    .join('');

  // Stylized engraved treble G-clef vector path (no text/unicode)
  const trebleClef = `
    <path
      d="M 19 31 C 16 31 15 28.5 17 27 C 19 25.5 21.5 27.5 20 29.2 C 18.8 30.5 16.5 29.8 18.2 27.8 M 19.2 30.5 L 19.2 5.5 C 19.2 3.2 22.8 3.5 22.5 6.8 C 22.2 10.5 14.5 14.5 14.5 20.8 C 14.5 25.2 18.2 27.5 22 26.2 C 25.2 25.1 26.2 21.2 23.6 18.8 C 21.2 16.6 17.6 18.2 17.8 21.2 C 18 23.4 20.2 24.4 21.8 23.3"
      fill="none"
      stroke="#292018"
      stroke-width="1.35"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  `;

  const noteElements: string[] = [];

  for (const n of spec.notes) {
    const allYs = [n.y, ...(n.chordY ?? [])];
    const minY = Math.min(...allYs);
    const maxY = Math.max(...allYs);

    if (n.ledgerY !== undefined) {
      noteElements.push(
        `<line x1="${n.x - 5.5}" y1="${n.ledgerY}" x2="${n.x + 5.5}" y2="${n.ledgerY}" stroke="#3d3122" stroke-width="0.95" />`
      );
    }

    if (n.sharp) {
      const sx = n.x - 7.5;
      const sy = n.y;
      noteElements.push(
        `<path d="M ${sx - 1.3} ${sy - 3.8} V ${sy + 3.8} M ${sx + 1.3} ${sy - 4.2} V ${sy + 3.4} M ${sx - 2.6} ${sy - 1} L ${sx + 2.6} ${sy - 2} M ${sx - 2.6} ${sy + 1.8} L ${sx + 2.6} ${sy + 0.8}" stroke="#292018" stroke-width="0.85" fill="none" />`
      );
    }

    if (n.flat) {
      const fx = n.x - 7;
      const fy = n.y;
      noteElements.push(
        `<path d="M ${fx - 1.2} ${fy - 5.5} V ${fy + 2.2} C ${fx + 2.2} ${fy + 1.5} ${fx + 2.4} ${fy - 1.8} ${fx - 1.2} ${fy - 0.6}" stroke="#292018" stroke-width="0.9" fill="none" stroke-linecap="round" />`
      );
    }

    for (const cy of allYs) {
      if (n.open) {
        noteElements.push(
          `<ellipse cx="${n.x}" cy="${cy}" rx="3.5" ry="2.35" transform="rotate(-18 ${n.x} ${cy})" fill="#fcf8ee" stroke="#231b12" stroke-width="1.35" />`
        );
      } else {
        noteElements.push(
          `<ellipse cx="${n.x}" cy="${cy}" rx="3.4" ry="2.35" transform="rotate(-18 ${n.x} ${cy})" fill="#231b12" />`
        );
      }
    }

    if (n.stem === 'up') {
      const sx = n.x + 3.0;
      const topY = Math.min(minY - 12.5, 16);
      noteElements.push(
        `<line x1="${sx}" y1="${maxY - 0.5}" x2="${sx}" y2="${topY}" stroke="#231b12" stroke-width="1.15" />`
      );
      if (n.flag) {
        noteElements.push(
          `<path d="M ${sx} ${topY} C ${sx + 4.5} ${topY + 2.5} ${sx + 5} ${topY + 6.5} ${sx + 2.2} ${topY + 9.5}" fill="none" stroke="#231b12" stroke-width="1.2" stroke-linecap="round" />`
        );
      }
    } else if (n.stem === 'down') {
      const sx = n.x - 3.0;
      const botY = Math.max(maxY + 12.5, 20);
      noteElements.push(
        `<line x1="${sx}" y1="${minY + 0.5}" x2="${sx}" y2="${botY}" stroke="#231b12" stroke-width="1.15" />`
      );
      if (n.flag) {
        noteElements.push(
          `<path d="M ${sx} ${botY} C ${sx + 4.5} ${botY - 2.5} ${sx + 5} ${botY - 6.5} ${sx + 2.2} ${botY - 9.5}" fill="none" stroke="#231b12" stroke-width="1.2" stroke-linecap="round" />`
        );
      }
    }

    if (n.staccato) {
      const dotY = n.stem === 'down' ? minY - 4.5 : maxY + 4.5;
      noteElements.push(`<circle cx="${n.x}" cy="${dotY}" r="1.1" fill="#231b12" />`);
    }
  }

  const beamsHtml = (spec.beams ?? [])
    .map(
      (b) =>
        `<line x1="${b.x1}" y1="${b.y1}" x2="${b.x2}" y2="${b.y2}" stroke="#231b12" stroke-width="2.6" stroke-linecap="butt" />`
    )
    .join('');

  const slurHtml = spec.slur
    ? `<path d="${spec.slur}" fill="none" stroke="#231b12" stroke-width="1.05" stroke-linecap="round" />`
    : '';

  return `
    <svg class="sheet-staff-svg" viewBox="0 0 184 36" width="184" height="36" aria-hidden="true" focusable="false">
      ${staffLines}
      <line x1="6.5" y1="8" x2="6.5" y2="28" stroke="#292018" stroke-width="1.2" />
      ${trebleClef}
      <line x1="${spec.barlineX}" y1="8" x2="${spec.barlineX}" y2="28" stroke="#4a3b2a" stroke-width="0.95" />
      ${beamsHtml}
      ${noteElements.join('')}
      ${slurHtml}
      <line x1="173.5" y1="8" x2="173.5" y2="28" stroke="#292018" stroke-width="0.95" />
      <line x1="177" y1="8" x2="177" y2="28" stroke="#292018" stroke-width="2.4" />
    </svg>
  `;
}
