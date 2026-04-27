import {
  Execution,
  Game,
  isUnit,
  OwnerComp,
  Unit,
  UnitParams,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { WaterPathFinder } from "../pathfinding/PathFinder";
import { PathStatus } from "../pathfinding/types";
import { PseudoRandom } from "../PseudoRandom";

/**
 * Submarine execution — a hidden naval support unit.
 *
 * Submarines have two modes:
 *  • Surfaced — visible to everyone, moves at normal speed.
 *  • Submerged — hidden from enemies, moves slower, can sweep mines / sonar / launch missiles.
 *
 * Submarines do NOT directly attack warships, other subs, or any naval units.
 * Their roles are: recon/sonar, mine sweeping, and mobile missile platform.
 *
 * Submerge/surface transitions, mine sweeps, sonar, and missile launches
 * are initiated by the client sending private HiddenNavalAction messages
 * to the server (not through the normal intent broadcast).
 *
 * The client-side simulation still tracks the sub's position so the OWNER
 * can see and control it. Enemy clients filter submerged subs out of their
 * GameView rendering.
 */
export class SubmarineExecution implements Execution {
  private random: PseudoRandom;
  private submarine: Unit;
  private mg: Game;
  private pathfinder: WaterPathFinder;

  constructor(
    private input: (UnitParams<UnitType.Submarine> & OwnerComp) | Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathfinder = new WaterPathFinder(mg);
    this.random = new PseudoRandom(mg.ticks());
    if (isUnit(this.input)) {
      this.submarine = this.input;
    } else {
      const spawn = this.input.owner.canBuild(
        UnitType.Submarine,
        this.input.patrolTile,
      );
      if (spawn === false) {
        console.warn(
          `Failed to spawn submarine for ${this.input.owner.name()} at ${this.input.patrolTile}`,
        );
        return;
      }
      this.submarine = this.input.owner.buildUnit(
        UnitType.Submarine,
        spawn,
        this.input,
      );
    }
  }

  tick(ticks: number): void {
    if (this.submarine.health() <= 0) {
      this.submarine.delete();
      return;
    }

    // Patrol movement — both surfaced and submerged.
    this.patrol();
  }

  private patrol() {
    if (this.submarine.targetTile() === undefined) {
      this.submarine.setTargetTile(this.randomTile());
      if (this.submarine.targetTile() === undefined) {
        return;
      }
    }

    const result = this.pathfinder.next(
      this.submarine.tile(),
      this.submarine.targetTile()!,
    );
    switch (result.status) {
      case PathStatus.COMPLETE:
        this.submarine.setTargetTile(undefined);
        this.submarine.move(result.node);
        break;
      case PathStatus.NEXT:
        this.submarine.move(result.node);
        break;
      case PathStatus.NOT_FOUND:
        this.submarine.setTargetTile(undefined);
        break;
    }
  }

  private randomTile(): TileRef | undefined {
    let patrolRange = this.mg.config().submarinePatrolRange();
    const maxAttemptBeforeExpand = 500;
    let attempts = 0;
    let expandCount = 0;

    const subComponent = this.mg.getWaterComponent(this.submarine.tile());
    const patrolTile = this.submarine.patrolTile();
    if (patrolTile === undefined) {
      return undefined;
    }

    while (expandCount < 3) {
      const x =
        this.mg.x(patrolTile) +
        this.random.nextInt(-patrolRange / 2, patrolRange / 2);
      const y =
        this.mg.y(patrolTile) +
        this.random.nextInt(-patrolRange / 2, patrolRange / 2);
      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }
      const tile = this.mg.ref(x, y);
      if (!this.mg.isWater(tile) || this.mg.isShoreline(tile)) {
        attempts++;
        if (attempts === maxAttemptBeforeExpand) {
          expandCount++;
          attempts = 0;
          patrolRange = patrolRange + Math.floor(patrolRange / 2);
        }
        continue;
      }
      if (
        subComponent !== null &&
        !this.mg.hasWaterComponent(tile, subComponent)
      ) {
        attempts++;
        if (attempts === maxAttemptBeforeExpand) {
          expandCount++;
          attempts = 0;
          patrolRange = patrolRange + Math.floor(patrolRange / 2);
        }
        continue;
      }
      return tile;
    }
    console.warn(
      `Failed to find random tile for submarine for ${this.submarine.owner().name()}`,
    );
    return undefined;
  }

  isActive(): boolean {
    return this.submarine?.isActive();
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
