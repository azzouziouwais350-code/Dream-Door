import type { EntitySpawn, Vec2 } from '../../core/types';
import { CeilingShadow } from './ceilingShadow';
import { Concierge } from './concierge';
import { FalseThreshold } from './falseThreshold';
import { Swimmer } from './swimmer';
import type { Entity } from './types';
import { Watcher } from './watcher';

export * from './types';
export { CeilingShadow, Concierge, FalseThreshold, Swimmer, Watcher };

export function createEntity(spawn: EntitySpawn, index: number, doorPoints: Record<string, Vec2>): Entity {
  const id = `${spawn.kind}_${index}`;
  const pos = { x: spawn.x, y: spawn.y };
  switch (spawn.kind) {
    case 'concierge':
      return new Concierge(id, pos, spawn.patrol, spawn.delay ?? 3);
    case 'ceilingShadow':
      return new CeilingShadow(id, pos, spawn.delay ?? 8);
    case 'watcher':
      return new Watcher(id, pos, spawn.delay ?? 5, spawn.announces);
    case 'swimmer':
      return new Swimmer(id, pos, spawn.water ?? { x: 0, y: 0, w: 2, h: 2 }, spawn.delay ?? 4);
    case 'falseThreshold': {
      const door = spawn.doorId ? doorPoints[spawn.doorId] : undefined;
      return new FalseThreshold(id, spawn.doorId ?? 'false', door ?? pos);
    }
  }
}
