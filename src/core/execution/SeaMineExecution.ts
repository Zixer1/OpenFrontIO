import {
  Execution,
  Game,
  isUnit,
  OwnerComp,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";

export class SeaMineExecution implements Execution {
  private active = true;
  private mine: Unit;
  private mg: Game;

  constructor(private input: (OwnerComp & { tile: TileRef }) | Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (isUnit(this.input)) {
      this.mine = this.input;
    } else {
      const spawn = this.input.owner.canBuild(
        UnitType.SeaMine,
        this.input.tile,
      );
      if (spawn === false) {
        console.warn(
          `Failed to spawn sea mine for ${this.input.owner.name()} at ${this.input.tile}`,
        );
        this.active = false;
        return;
      }
      this.mine = this.input.owner.buildUnit(UnitType.SeaMine, spawn, {});
    }
  }

  tick(ticks: number): void {
    if (!this.mine.isActive()) {
      this.active = false;
      return;
    }

    const triggerRange = this.mg.config().seaMineTriggerRange();
    const nearby = this.mg.nearbyUnits(
      this.mine.tile(),
      triggerRange,
      [UnitType.Warship, UnitType.Submarine],
      ({ unit }) =>
        isUnit(unit) &&
        unit.owner() !== this.mine.owner() &&
        this.mine.owner().canAttackPlayer(unit.owner(), true),
    );

    if (nearby.length === 0) {
      return;
    }

    // Trigger on the closest enemy ship
    const target = nearby[0].unit;
    const maxHealth = target.info().maxHealth;
    if (typeof maxHealth === "number") {
      const damage = Math.floor(
        maxHealth * this.mg.config().seaMineDamageRatio(),
      );
      target.modifyHealth(-damage, this.mine.owner());
    }

    this.mine.delete(false, this.mine.owner());
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
