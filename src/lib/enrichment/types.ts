export interface EnrichResult {
  address: string;
  city: string;
  zipCode?: string;
  owner?: string;
  ownerEntityInferred?: string | null;
  yearBuilt?: number | null;
  yearRemodeled?: number | null;
  unitCount?: number | null;
  residentialUnits?: number | null;
  commercialUnits?: number | null;
  propertyType?: string;
  buildingType?: string;
  rawBuildingType?: string;
  totalValue?: number | null;
  grossArea?: number | null;
  livingArea?: number | null;
  structureClass?: string;
  overallCondition?: string;
}

export interface EnrichResponse {
  address: string;
  searchedFor?: { number: string; street: string };
  results: EnrichResult[];
  fuzzyMatch?: boolean;
  unsupported?: boolean;
  message?: string;
  source?: string;
}

export interface BuildingRecord {
  id: string;
  address: string;
  city: string | null;
  state: string | null;
  zip_code: string | null;
}

export interface CityAdapter {
  enrich(building: BuildingRecord): Promise<EnrichResponse>;
}
