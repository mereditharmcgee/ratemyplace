import type { CityAdapter, BuildingRecord, EnrichResponse, EnrichResult } from '../types';
import { inferOwnerEntity, parseStreetAddress, normalizeStreetName } from '../helpers';

const CT_CAMA_API = 'https://data.ct.gov/resource/pqrn-qghw.json';

interface CtCamaRecord {
  address_number: string;
  street_name: string;
  property_city: string;
  owner: string;
  ayb: string;
  state_use_description: string;
  gross_area_of_primary_building: string;
  living_area: string;
  number_of_buildings: string;
  appraised_total: string;
  condition_description?: string;
  zone?: string;
  total_rooms?: string;
  number_of_bedroom?: string;
}

function mapCtBuildingType(stateUseDesc: string): string {
  const desc = stateUseDesc.toUpperCase();
  if (desc.includes('CONDO')) return 'Condo';
  if (desc.includes('APARTMENT') || desc.includes('MULTI')) return 'Apartment';
  if (desc.includes('RESIDENTIAL') || desc.includes('SINGLE') || desc.includes('TWO') || desc.includes('THREE')) return 'Residential';
  if (desc.includes('COMMERCIAL') || desc.includes('RETAIL') || desc.includes('OFFICE')) return 'Commercial';
  if (desc.includes('MIXED')) return 'Mixed Use';
  if (desc.includes('INDUSTRIAL')) return 'Industrial';
  return stateUseDesc;
}

function formatCtCamaResult(record: CtCamaRecord): EnrichResult {
  return {
    address: `${record.address_number} ${record.street_name}`,
    city: record.property_city,
    owner: record.owner,
    ownerEntityInferred: inferOwnerEntity(record.owner),
    yearBuilt: parseInt(record.ayb) || null,
    yearRemodeled: null,
    unitCount: null,
    residentialUnits: null,
    commercialUnits: null,
    propertyType: record.state_use_description,
    buildingType: mapCtBuildingType(record.state_use_description),
    rawBuildingType: undefined,
    totalValue: parseInt(record.appraised_total) || null,
    grossArea: parseInt(record.gross_area_of_primary_building) || null,
    livingArea: parseInt(record.living_area) || null,
    structureClass: undefined,
    overallCondition: record.condition_description,
  };
}

export class NewHavenAdapter implements CityAdapter {
  async enrich(building: BuildingRecord): Promise<EnrichResponse> {
    const parsed = parseStreetAddress(building.address);
    if (!parsed) {
      return {
        address: building.address,
        results: [],
        message: 'Could not parse address',
        source: 'CT CAMA',
      };
    }

    const streetName = normalizeStreetName(parsed.street);
    // Extract just the primary street number (before any dash or letter suffix)
    const primaryNumber = parsed.number.replace(/[-A-Z].*/i, '');

    // Escape single quotes for SoQL (double them)
    const escapedNumber = primaryNumber.replace(/'/g, "''");
    const escapedStreet = streetName.replace(/'/g, "''");

    // Build exact query using SoQL $where
    const exactUrl = `${CT_CAMA_API}?$where=address_number='${escapedNumber}' AND upper(street_name)='${escapedStreet}'&$limit=10`;

    const exactResponse = await fetch(exactUrl);
    const exactRecords: CtCamaRecord[] = exactResponse.ok ? await exactResponse.json() : [];

    if (exactRecords.length > 0) {
      return {
        address: building.address,
        searchedFor: { number: primaryNumber, street: streetName },
        results: exactRecords.map(formatCtCamaResult),
        source: 'CT CAMA',
      };
    }

    // Broad fallback: $q full-text search filtered to New Haven
    const broadUrl = `${CT_CAMA_API}?$q=${encodeURIComponent(`${primaryNumber} ${streetName}`)}&$where=property_city='NEW HAVEN'&$limit=10`;

    const broadResponse = await fetch(broadUrl);
    const broadRecords: CtCamaRecord[] = broadResponse.ok ? await broadResponse.json() : [];

    if (broadRecords.length > 0) {
      return {
        address: building.address,
        searchedFor: { number: primaryNumber, street: streetName },
        fuzzyMatch: true,
        results: broadRecords.map(formatCtCamaResult),
        source: 'CT CAMA',
      };
    }

    return {
      address: building.address,
      searchedFor: { number: primaryNumber, street: streetName },
      results: [],
      message: 'No matching records found in CT CAMA database',
      source: 'CT CAMA',
    };
  }
}
