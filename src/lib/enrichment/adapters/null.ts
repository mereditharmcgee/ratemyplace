import type { CityAdapter, BuildingRecord, EnrichResponse } from '../types';

export class NullAdapter implements CityAdapter {
  async enrich(building: BuildingRecord): Promise<EnrichResponse> {
    return {
      address: building.address,
      results: [],
      unsupported: true,
      message: 'No auto-research data available for this city.',
    };
  }
}
