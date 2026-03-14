import { SRSRotationSystem } from './srs';
import { ARSRotationSystem, TGM3RotationSystem } from './ars';
import { NESRotationSystem } from './nes';
import type { RotationSystem } from '../types/rotation-system';
import type { RotationSystemId } from '../types/frame';

const SYSTEMS: Record<RotationSystemId, RotationSystem> = {
  srs: new SRSRotationSystem(),
  ars: new ARSRotationSystem(),
  nes: new NESRotationSystem(),
};

export function getRotationSystem(id: RotationSystemId): RotationSystem {
  return SYSTEMS[id];
}

export { SRSRotationSystem, ARSRotationSystem, NESRotationSystem };
