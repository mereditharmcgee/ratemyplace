import { RELEASE_ID } from './release';

export interface PublicHealth {
  status: 'ok';
  release: string;
}

export function buildPublicHealth(release: string = RELEASE_ID): PublicHealth {
  return { status: 'ok', release };
}
