import type { APIContext } from 'astro';
import { getDB } from '../../../../../lib/db';

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

function inferOwnerEntity(ownerName: string): string | null {
  const upper = ownerName.toUpperCase();
  if (upper.includes('LLC')) return 'llc';
  if (upper.includes('TRUST') || upper.includes('TRUSTEE') || upper.includes('TRSTEE')) return 'trust';
  if (upper.includes('CORP') || upper.includes('INC') || upper.includes('INCORPORATED')) return 'corporation';
  if (upper.includes('PARTNERSHIP') || upper.includes(' LP') || upper.includes('L.P.')) return 'partnership';
  if (upper.includes('REIT')) return 'reit';
  if (upper.includes('AUTHORITY') || upper.includes('CITY OF') || upper.includes('COMMONWEALTH')) return 'other';
  return 'individual';
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

function parseStreetAddress(address: string): { number: string; street: string } | null {
  // Handle addresses like "123 Main St", "123-125 Main St", "123A Main St"
  const match = address.match(/^(\d+[\-\d]*[A-Z]?)\s+(.+)/i);
  if (!match) return null;
  return { number: match[1], street: match[2] };
}

function normalizeStreetName(street: string): string {
  // Remove city/state/zip suffix, normalize for matching
  return street
    .replace(/,.*$/, '')          // Remove everything after comma
    .replace(/\b(apt|unit|#)\s*\S+/i, '')  // Remove apt/unit numbers
    .trim()
    .toUpperCase();
}

export async function GET(context: APIContext): Promise<Response> {
  if (!context.locals.user?.isAdmin) {
    return new Response(JSON.stringify({ error: 'Admin access required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const buildingId = context.params.id;
  if (!buildingId) {
    return new Response(JSON.stringify({ error: 'Building ID required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const db = getDB((context.locals as any).runtime);
  const building = await db.prepare('SELECT * FROM buildings WHERE id = ?')
    .bind(buildingId)
    .first<{ id: string; address: string; city: string; zip_code: string }>();

  if (!building) {
    return new Response(JSON.stringify({ error: 'Building not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Parse the street number and name from the address
  const parsed = parseStreetAddress(building.address);
  if (!parsed) {
    return new Response(JSON.stringify({
      error: 'Could not parse address',
      address: building.address,
      results: [],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const streetName = normalizeStreetName(parsed.street);
  // Extract just the primary street number (before any dash or letter)
  const primaryNumber = parsed.number.replace(/[-A-Z].*/i, '');

  try {
    // Query Boston Assessing API with filters
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
          return new Response(JSON.stringify({
            address: building.address,
            searchedFor: { number: primaryNumber, street: streetName },
            results: [],
            message: 'No matching records found in Boston Assessing database',
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({
          address: building.address,
          searchedFor: { number: primaryNumber, street: streetName },
          fuzzyMatch: true,
          results: broadRecords.map(formatResult),
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response(JSON.stringify({
      address: building.address,
      searchedFor: { number: primaryNumber, street: streetName },
      results: records.map(formatResult),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('Assessing API error:', err);
    return new Response(JSON.stringify({
      error: 'Failed to query assessing database',
      details: err instanceof Error ? err.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

function formatResult(record: AssessingRecord) {
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
