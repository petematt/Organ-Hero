import { OpposingOrganistDef } from '../campaign/schedule';
import { SONGS } from '../game/songs';
import { MatchSimulation } from './match';
import { SongId } from './types';

export class OpposingOrganistController {
  public profile: OpposingOrganistDef;
  public cooldownSec: number;
  public activeSongId: SongId | null = null;
  public songRemainingSec: number = 0;

  constructor(profile: OpposingOrganistDef) {
    this.profile = profile;
    this.cooldownSec = profile.playIntervalSec * 0.75; // Initial lead-in
  }

  public step(dtSec: number, sim: MatchSimulation): void {
    if (sim.phase !== 'PLAYING') return;

    if (this.songRemainingSec > 0) {
      this.songRemainingSec -= dtSec;
      if (this.songRemainingSec <= 0) {
        this.activeSongId = null;
      }
    }

    this.cooldownSec -= dtSec;
    if (this.cooldownSec <= 0) {
      this.cooldownSec = this.profile.playIntervalSec;
      this.triggerRivalSong(sim);
    }
  }

  private triggerRivalSong(sim: MatchSimulation): void {
    const songId =
      this.profile.favoredSongs[
        Math.floor(sim.rng.next() * this.profile.favoredSongs.length)
      ] ?? 'charge';

    this.activeSongId = songId;
    this.songRemainingSec = 8.0;

    const sDef = SONGS[songId];
    sim.spawnCallout(
      `⚡ ${this.profile.name.toUpperCase()}: ${sDef.buttonTitle}! ⚡`,
      { x: 380, y: 40 },
      '#f43f5e',
      3.2
    );

    // Provide a counter-cue window for the player to jam the rival!
    const counterSong: SongId =
      songId === 'hold_the_line'
        ? 'charge'
        : songId === 'charge'
        ? 'hold_the_line'
        : 'grudge_toccata';

    const loadout = sim.getActiveSongLoadout();
    if (loadout.includes(counterSong)) {
      sim.triggerCue(
        'RIVAL_ORGANIST_ATTACK',
        counterSong,
        'home',
        `RIVAL ORGANIST ATTACK! PLAY ${SONGS[counterSong].buttonTitle} TO COUNTER-JAM!`
      );
    }
  }

  public onPlayerCounterHit(sim: MatchSimulation): void {
    if (this.songRemainingSec > 0) {
      this.songRemainingSec = 0;
      this.activeSongId = null;
      sim.spawnCallout(
        '★ ACOUSTIC DOMINANCE! RIVAL SILENCED! ★',
        { x: 380, y: 70 },
        '#38bdf8',
        2.8
      );
    }
  }
}
