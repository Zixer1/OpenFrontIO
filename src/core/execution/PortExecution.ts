import { Execution, Game, Unit, UnitType } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { TradeShipExecution } from "./TradeShipExecution";
import { TrainStationExecution } from "./TrainStationExecution";

export class PortExecution implements Execution {
  private active = true;
  private mg: Game;
  private port: Unit;
  private random: PseudoRandom;
  private checkOffset: number;
  private tradeShipSpawnRejections = 0;
  private lastSentTick = new Map<number, number>();

  constructor(port: Unit) {
    this.port = port;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(mg.ticks());
    this.checkOffset = mg.ticks() % 10;
  }

  tick(ticks: number): void {
    if (this.mg === null || this.random === null || this.checkOffset === null) {
      throw new Error("Not initialized");
    }

    if (!this.port.isActive()) {
      this.active = false;
      return;
    }

    if (this.port.isUnderConstruction()) {
      return;
    }

    if (!this.port.hasTrainStation()) {
      this.createStation();
    }

    // Only check every 10 ticks for performance.
    if ((this.mg.ticks() + this.checkOffset) % 10 !== 0) {
      return;
    }

    if (!this.shouldSpawnTradeShip()) {
      return;
    }

    const port = this.selectBestPort();

    if (port === null) {
      return;
    }

    this.lastSentTick.set(port.id(), this.mg.ticks());
    this.mg.addExecution(
      new TradeShipExecution(this.port.owner(), this.port, port),
    );
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  shouldSpawnTradeShip(): boolean {
    const numTradeShips = this.mg.unitCount(UnitType.TradeShip);
    const spawnRate = this.mg
      .config()
      .tradeShipSpawnRate(this.tradeShipSpawnRejections, numTradeShips);
    for (let i = 0; i < this.port!.level(); i++) {
      if (this.random.chance(spawnRate)) {
        this.tradeShipSpawnRejections = 0;
        return true;
      }
      this.tradeShipSpawnRejections++;
    }
    return false;
  }

  createStation(): void {
    const nearbyFactory = this.mg.hasUnitNearby(
      this.port.tile()!,
      this.mg.config().trainStationMaxRange(),
      UnitType.Factory,
    );
    if (nearbyFactory) {
      this.mg.addExecution(new TrainStationExecution(this.port));
    }
  }

  private selectBestPort(): Unit | null {
    const sourceComponents = new Set<number>();
    for (const neighbor of this.mg.neighbors(this.port.tile())) {
      if (!this.mg.isWater(neighbor)) continue;
      const comp = this.mg.getWaterComponent(neighbor);
      if (comp !== null) sourceComponents.add(comp);
    }

    const cooldown = this.mg.config().tradeShipPortCooldown();
    const ticks = this.mg.ticks();

    const candidates = this.mg
      .players()
      .filter((p) => p !== this.port.owner() && p.canTrade(this.port.owner()))
      .flatMap((p) => p.units(UnitType.Port))
      .filter((p) => {
        const lastSent = this.lastSentTick.get(p.id());
        if (lastSent !== undefined && ticks - lastSent < cooldown) return false;
        for (const comp of sourceComponents) {
          if (this.mg.hasWaterComponent(p.tile(), comp)) return true;
        }
        return false;
      });

    if (candidates.length === 0) return null;

    const scored: { port: Unit; weight: number }[] = [];
    for (const dst of candidates) {
      const dist = this.mg.manhattanDist(this.port.tile(), dst.tile());
      if (dist === 0) continue;
      const gold = Number(
        this.mg.config().tradeShipGold(dist, this.port.owner()),
      );
      const weight =
        (gold / dist) *
        dst.level() *
        (this.port.owner().isFriendly(dst.owner()) ? 2 : 1);
      scored.push({ port: dst, weight });
    }

    if (scored.length === 0) return null;

    let totalWeight = 0;
    for (const s of scored) totalWeight += s.weight;

    let roll = this.random.nextFloat(0, totalWeight);
    for (const s of scored) {
      roll -= s.weight;
      if (roll <= 0) return s.port;
    }
    return scored[scored.length - 1].port;
  }
}
