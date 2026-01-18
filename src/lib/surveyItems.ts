// Survey items based on OHQS/PHQS research (v2.0 specification)
// 27 items across three domains: Unit (10), Building (9), Landlord (8)

export interface SurveyItem {
  key: string;
  code: string;
  dimension: string;
  text: string;
  required: boolean;
  allowNA: boolean;
  category: 'unit' | 'building' | 'landlord';
}

// Unit Rating Items (10 items, all required)
export const unitItems: SurveyItem[] = [
  {
    key: 'unit_structural',
    code: 'U1',
    dimension: 'Structural Integrity',
    text: 'Walls, floors, and ceilings were in good condition, without holes, cracks, peeling paint, or water damage.',
    required: true,
    allowNA: false,
    category: 'unit',
  },
  {
    key: 'unit_plumbing',
    code: 'U2',
    dimension: 'Plumbing',
    text: 'Plumbing worked reliably, with adequate water pressure, no leaks, and consistent hot water.',
    required: true,
    allowNA: false,
    category: 'unit',
  },
  {
    key: 'unit_electrical',
    code: 'U3',
    dimension: 'Electrical Systems',
    text: 'Electrical systems worked safely, with enough outlets, no flickering lights, and all fixtures functional.',
    required: true,
    allowNA: false,
    category: 'unit',
  },
  {
    key: 'unit_climate',
    code: 'U4',
    dimension: 'Temperature Control',
    text: 'I could maintain a comfortable temperature year-round, with adequate heat in winter and cooling or ventilation in summer.',
    required: true,
    allowNA: false,
    category: 'unit',
  },
  {
    key: 'unit_ventilation',
    code: 'U5',
    dimension: 'Ventilation & Air Quality',
    text: 'The unit had adequate airflow and ventilation, without persistent stuffiness, odors, or moisture buildup.',
    required: true,
    allowNA: false,
    category: 'unit',
  },
  {
    key: 'unit_pests',
    code: 'U6',
    dimension: 'Pest Control',
    text: 'The unit was free from pest problems, including roaches, mice, rats, and bedbugs.',
    required: true,
    allowNA: false,
    category: 'unit',
  },
  {
    key: 'unit_mold',
    code: 'U7',
    dimension: 'Mold & Moisture',
    text: 'The unit was free from mold, mildew, or persistent moisture problems.',
    required: true,
    allowNA: false,
    category: 'unit',
  },
  {
    key: 'unit_appliances',
    code: 'U8',
    dimension: 'Appliances',
    text: 'Appliances included with the unit worked reliably throughout my tenancy.',
    required: true,
    allowNA: false,
    category: 'unit',
  },
  {
    key: 'unit_layout',
    code: 'U9',
    dimension: 'Layout & Functionality',
    text: "The unit's layout and space were functional for daily living.",
    required: true,
    allowNA: false,
    category: 'unit',
  },
  {
    key: 'unit_accuracy',
    code: 'U10',
    dimension: 'Listing Accuracy',
    text: 'The unit matched what was advertised or shown during viewing.',
    required: true,
    allowNA: false,
    category: 'unit',
  },
];

// Building Rating Items (9 items, 6 required, 3 allow N/A)
export const buildingItems: SurveyItem[] = [
  {
    key: 'building_common_areas',
    code: 'B1',
    dimension: 'Common Areas',
    text: 'Hallways, stairs, lobby, and other shared spaces were kept clean and in good repair.',
    required: true,
    allowNA: false,
    category: 'building',
  },
  {
    key: 'building_security',
    code: 'B2',
    dimension: 'Building Security',
    text: 'The building felt secure, with working locks, adequate lighting, and functional entry systems.',
    required: true,
    allowNA: false,
    category: 'building',
  },
  {
    key: 'building_exterior',
    code: 'B3',
    dimension: 'Exterior & Grounds',
    text: 'The building exterior and grounds were well-maintained, including snow removal, landscaping, and trash areas.',
    required: true,
    allowNA: false,
    category: 'building',
  },
  {
    key: 'building_noise_neighbors',
    code: 'B4',
    dimension: 'Noise - Internal',
    text: 'Noise from adjacent units or building systems was at a reasonable level.',
    required: true,
    allowNA: false,
    category: 'building',
  },
  {
    key: 'building_noise_external',
    code: 'B5',
    dimension: 'Noise - External',
    text: 'Noise from outside the building, such as traffic, construction, or street activity, was at a reasonable level.',
    required: true,
    allowNA: false,
    category: 'building',
  },
  {
    key: 'building_mail',
    code: 'B6',
    dimension: 'Mail & Package Security',
    text: 'Mail delivery was secure, and packages were protected from theft or weather damage.',
    required: true,
    allowNA: false,
    category: 'building',
  },
  {
    key: 'building_laundry',
    code: 'B7',
    dimension: 'Laundry Facilities',
    text: 'Laundry facilities, if provided, were functional and reasonably maintained.',
    required: false,
    allowNA: true,
    category: 'building',
  },
  {
    key: 'building_parking',
    code: 'B8',
    dimension: 'Parking',
    text: 'Parking, if included, matched what was promised and was adequately maintained.',
    required: false,
    allowNA: true,
    category: 'building',
  },
  {
    key: 'building_trash',
    code: 'B9',
    dimension: 'Trash & Recycling',
    text: 'Trash and recycling facilities were adequate and serviced regularly.',
    required: true,
    allowNA: false,
    category: 'building',
  },
];

// Landlord Rating Items (8 items, 6 required, 2 allow N/A)
export const landlordItems: SurveyItem[] = [
  {
    key: 'landlord_maintenance',
    code: 'L1',
    dimension: 'Maintenance Response',
    text: 'Maintenance requests were addressed in a timely manner.',
    required: true,
    allowNA: false,
    category: 'landlord',
  },
  {
    key: 'landlord_communication',
    code: 'L2',
    dimension: 'Communication',
    text: 'The landlord or management was easy to reach and responded to communications promptly.',
    required: true,
    allowNA: false,
    category: 'landlord',
  },
  {
    key: 'landlord_professionalism',
    code: 'L3',
    dimension: 'Professionalism',
    text: 'Interactions with the landlord or management were respectful and professional.',
    required: true,
    allowNA: false,
    category: 'landlord',
  },
  {
    key: 'landlord_lease_clarity',
    code: 'L4',
    dimension: 'Lease Clarity',
    text: 'Lease terms were clear, and the landlord honored all agreements.',
    required: true,
    allowNA: false,
    category: 'landlord',
  },
  {
    key: 'landlord_privacy',
    code: 'L5',
    dimension: 'Privacy & Boundaries',
    text: 'The landlord respected my privacy and provided appropriate notice before entering the unit.',
    required: true,
    allowNA: false,
    category: 'landlord',
  },
  {
    key: 'landlord_deposit',
    code: 'L6',
    dimension: 'Security Deposit',
    text: 'The security deposit was handled fairly, with clear accounting and timely return if applicable.',
    required: true,
    allowNA: false,
    category: 'landlord',
  },
  {
    key: 'landlord_rent_practices',
    code: 'L7',
    dimension: 'Rent Practices',
    text: 'Rent increases, if any, were reasonable and communicated with appropriate notice.',
    required: false,
    allowNA: true,
    category: 'landlord',
  },
  {
    key: 'landlord_non_retaliation',
    code: 'L8',
    dimension: 'Non-Retaliation',
    text: 'I felt comfortable raising concerns or requesting repairs without fear of retaliation.',
    required: true,
    allowNA: false,
    category: 'landlord',
  },
];

// Combined survey items
export const surveyItems: SurveyItem[] = [...unitItems, ...buildingItems, ...landlordItems];

// Response scale labels
export const RESPONSE_OPTIONS = {
  1: { label: 'Strongly Disagree', shortLabel: 'SD', value: 1 },
  2: { label: 'Disagree', shortLabel: 'D', value: 2 },
  3: { label: 'Neutral', shortLabel: 'N', value: 3 },
  4: { label: 'Agree', shortLabel: 'A', value: 4 },
  5: { label: 'Strongly Agree', shortLabel: 'SA', value: 5 },
} as const;

// Helper functions
export function getSurveyItemsByCategory(category: 'unit' | 'building' | 'landlord'): SurveyItem[] {
  return surveyItems.filter((item) => item.category === category);
}

export function getSurveyItemByKey(key: string): SurveyItem | undefined {
  return surveyItems.find((item) => item.key === key);
}

export function getRequiredItems(): SurveyItem[] {
  return surveyItems.filter((item) => item.required);
}

export function getOptionalItems(): SurveyItem[] {
  return surveyItems.filter((item) => item.allowNA);
}

// Supplementary items (not scored, just context)
export const supplementaryItems = {
  wouldRecommend: {
    key: 'would_recommend',
    text: 'Would you recommend this unit to a friend or family member?',
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
      { value: 'maybe', label: 'Maybe / It depends' },
    ],
  },
  tenure: {
    key: 'tenure_months',
    text: 'How long did you live at this address?',
    options: [
      { value: 6, label: 'Less than 6 months' },
      { value: 9, label: '6-12 months' },
      { value: 18, label: '1-2 years' },
      { value: 36, label: '2-3 years' },
      { value: 48, label: '3-5 years' },
      { value: 72, label: 'More than 5 years' },
    ],
  },
  moveOutTiming: {
    key: 'move_out_year',
    text: "When did you move out? (or select 'I still live here')",
    options: [
      { value: 'current', label: 'I still live here' },
      { value: '2026', label: '2026' },
      { value: '2025', label: '2025' },
      { value: '2024', label: '2024' },
      { value: '2023', label: '2023' },
      { value: '2022', label: '2022' },
      { value: '2021', label: '2021' },
      { value: '2020_or_earlier', label: '2020 or earlier' },
    ],
  },
};
