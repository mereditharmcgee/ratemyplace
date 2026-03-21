import type { CityAdapter, BuildingRecord, EnrichResponse, EnrichResult } from '../types';
import { inferOwnerEntity, parseStreetAddress, normalizeStreetName } from '../helpers';

const BOSTON_ASSESSING_RESOURCE_ID = 'ee73430d-96c0-423e-ad21-c4cfb54c8961';
const BOSTON_ASSESSING_API = `https://data.boston.gov/api/3/action/datastore_search`;

interface AssessingRecord {
  ST_NUM: string;
  ST_NAME: string;
  CITY: string;
  ZIP_CODE: string;
  OWNER: string;
  YR_BUILT: string;
  RES_UNITS: string;
  COM_UNITS: string;
  LU_DESC: string;
  BLDG_TYPE: string;
  NUM_BLDGS: string;
  GROSS_AREA: string;
  LIVING_AREA: string;
  TOTAL_VALUE: string;
  BED_RMS: string;
  FULL_BTH: string;
  STRUCTURE_CLASS: string;
  OVERALL_COND: string;
  YR_REMODEL: string;
}

function mapBuildingType(luDesc: string): string {
  const desc = luDesc.toUpperCase();
  if (desc.includes('CONDO')) return 'Condo';
  if (desc.includes('SINGLE')) return 'Single Family';
  if (desc.includes('TWO') || desc.includes('2')) return 'Two Family';
  if (desc.includes('THREE') || desc.includes('3')) return 'Three Family';
  if (desc.includes('APT') || desc.includes('APARTMENT')) return 'Apartment';
  if (desc.includes('MIXED')) return 'Mixed Use';
  if (desc.includes('COMMERCIAL') || desc.includes('RETAIL') || desc.includes('OFFICE')) return 'Commercial';
  return luDesc;
}

function formatResult(record: AssessingRecord): EnrichResult {
  const resUnits = parseInt(record.RES_UNITS) || 0;
  const comUnits = parseInt(record.COM_UNITS) || 0;
  const totalUnits = resUnits + comUnits;

  return {
    address: `${record.ST_NUM} ${record.ST_NAME}`,
    city: record.CITY,
    zipCode: record.ZIP_CODE,
    owner: record.OWNER,
    ownerEntityInferred: inferOwnerEntity(record.OWNER),
    yearBuilt: parseInt(record.YR_BUILT) || null,
    yearRemodeled: parseInt(record.YR_REMODEL) || null,
    unitCount: totalUnits || null,
    residentialUnits: resUnits || null,
    commercialUnits: comUnits || null,
    propertyType: record.LU_DESC,
    buildingType: mapBuildingType(record.LU_DESC),
    rawBuildingType: record.BLDG_TYPE,
    totalValue: parseInt(record.TOTAL_VALUE) || null,
    grossArea: parseInt(record.GROSS_AREA) || null,
    livingArea: parseInt(record.LIVING_AREA) || null,
    structureClass: record.STRUCTURE_CLASS,
    overallCondition: record.OVERALL_COND,
  };
}

export class BostonAdapter implements CityAdapter {
  async enrich(building: BuildingRecord): Promise<EnrichResponse> {
    const parsed = parseStreetAddress(building.address);
    if (!parsed) {
      return {
        address: building.address,
        results: [],
        message: 'Could not parse address',
      };
    }

    const streetName = normalizeStreetName(parsed.street);
    // Extract just the primary street number (before any dash or letter)
    const primaryNumber = parsed.number.replace(/[-A-Z].*/i, '');

    // Query Boston Assessing API with exact filters
    const params = new URLSearchParams({
      resource_id: BOSTON_ASSESSING_RESOURCE_ID,
      limit: '10',
      filters: JSON.stringify({ ST_NUM: primaryNumber, ST_NAME: streetName }),
    });

    const response = await fetch(`${BOSTON_ASSESSING_API}?${params}`);
    if (!response.ok) {
      throw new Error(`Assessing API returned ${response.status}`);
    }

    const data = await response.json();
    const records: AssessingRecord[] = data.result?.records || [];

    if (records.length === 0) {
      // Try a broader search with just street name containing the number
      const broadParams = new URLSearchParams({
        resource_id: BOSTON_ASSESSING_RESOURCE_ID,
        limit: '10',
        q: `${primaryNumber} ${streetName}`,
      });

      const broadResponse = await fetch(`${BOSTON_ASSESSING_API}?${broadParams}`);
      if (broadResponse.ok) {
        const broadData = await broadResponse.json();
        const broadRecords: AssessingRecord[] = broadData.result?.records || [];

        if (broadRecords.length === 0) {
          return {
            address: building.address,
            searchedFor: { number: primaryNumber, street: streetName },
            results: [],
            message: 'No matching records found in Boston Assessing database',
            source: 'Boston Assessing',
          };
        }

        return {
          address: building.address,
          searchedFor: { number: primaryNumber, street: streetName },
          fuzzyMatch: true,
          results: broadRecords.map(formatResult),
          source: 'Boston Assessing',
        };
      }
    }

    return {
      address: building.address,
      searchedFor: { number: primaryNumber, street: streetName },
      results: records.map(formatResult),
      source: 'Boston Assessing',
    };
  }
}
