// Survey items based on OHQS/PHQS research (v2.0 specification)
// 27 items across three domains: Unit (10), Building (9), Landlord (8)

export interface SurveyItemHelp {
  description: string;
  examples: {
    high: string;  // What a 5 looks like
    mid: string;   // What a 3 looks like
    low: string;   // What a 1 looks like
  };
}

export interface SurveyItem {
  key: string;
  code: string;
  dimension: string;
  text: string;
  required: boolean;
  allowNA: boolean;
  category: 'unit' | 'building' | 'landlord';
  help: SurveyItemHelp;
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
    help: {
      description: 'Consider the physical condition of walls, floors, ceilings, doors, and windows. Look for cracks, holes, water stains, peeling paint, warped floors, or damaged surfaces.',
      examples: {
        high: 'Everything in excellent condition. No visible damage, paint intact, floors level, doors and windows work smoothly.',
        mid: 'Minor cosmetic issues like small nail holes or slight scuffs, but nothing affecting structural integrity or livability.',
        low: 'Major problems: large cracks, holes in walls, water damage, peeling paint, warped floors, doors that don\'t close properly.',
      },
    },
  },
  {
    key: 'unit_plumbing',
    code: 'U2',
    dimension: 'Plumbing',
    text: 'Plumbing worked reliably, with adequate water pressure, no leaks, and consistent hot water.',
    required: true,
    allowNA: false,
    category: 'unit',
    help: {
      description: 'Think about water pressure in showers and sinks, hot water availability and consistency, any leaks under sinks or around toilets, and drain speed.',
      examples: {
        high: 'Strong water pressure, hot water always available within reasonable time, no leaks anywhere, drains work perfectly.',
        mid: 'Occasional minor issues like slow drains or brief hot water delays, but generally functional.',
        low: 'Frequent problems: low water pressure, no hot water or runs out quickly, visible leaks, clogged drains, running toilets.',
      },
    },
  },
  {
    key: 'unit_electrical',
    code: 'U3',
    dimension: 'Electrical Systems',
    text: 'Electrical systems worked safely, with enough outlets, no flickering lights, and all fixtures functional.',
    required: true,
    allowNA: false,
    category: 'unit',
    help: {
      description: 'Consider the number and placement of outlets, whether lights flicker or dim, if circuit breakers trip frequently, and if all switches and outlets work.',
      examples: {
        high: 'Plenty of outlets where needed, all lights and switches work perfectly, no electrical issues whatsoever.',
        mid: 'Could use more outlets in some rooms, but everything works safely. Maybe one minor issue that was fixed.',
        low: 'Not enough outlets, flickering lights, frequent breaker trips, outlets that don\'t work, exposed wiring, or safety concerns.',
      },
    },
  },
  {
    key: 'unit_climate',
    code: 'U4',
    dimension: 'Temperature Control',
    text: 'I could maintain a comfortable temperature year-round, with adequate heat in winter and cooling or ventilation in summer.',
    required: true,
    allowNA: false,
    category: 'unit',
    help: {
      description: 'Think about heating in winter (was it warm enough?), cooling in summer (AC or good ventilation?), and your ability to control the temperature.',
      examples: {
        high: 'Always comfortable. Heat works great in winter, AC or good airflow in summer, easy to adjust temperature.',
        mid: 'Generally okay but some discomfort during extreme weather. Maybe heat takes a while to warm up or summer gets a bit stuffy.',
        low: 'Serious issues: freezing in winter, unbearably hot in summer, heat doesn\'t work, no way to cool down, no temperature control.',
      },
    },
  },
  {
    key: 'unit_ventilation',
    code: 'U5',
    dimension: 'Ventilation & Air Quality',
    text: 'The unit had adequate airflow and ventilation, without persistent stuffiness, odors, or moisture buildup.',
    required: true,
    allowNA: false,
    category: 'unit',
    help: {
      description: 'Consider air circulation, bathroom and kitchen exhaust fans, window placement for cross-ventilation, and any lingering odors or humidity issues.',
      examples: {
        high: 'Fresh air, good circulation, exhaust fans work well, no stuffiness or odors, windows allow good airflow.',
        mid: 'Adequate but not great. Maybe bathroom gets steamy or kitchen odors linger longer than ideal.',
        low: 'Stuffy, stale air, no exhaust fans or they don\'t work, persistent odors, moisture buildup on windows, poor air quality.',
      },
    },
  },
  {
    key: 'unit_pests',
    code: 'U6',
    dimension: 'Pest Control',
    text: 'The unit was free from pest problems, including roaches, mice, rats, and bedbugs.',
    required: true,
    allowNA: false,
    category: 'unit',
    help: {
      description: 'Think about any encounters with cockroaches, mice, rats, bedbugs, ants, or other pests during your tenancy.',
      examples: {
        high: 'Never saw any pests during entire tenancy. No signs of mice, roaches, bedbugs, or other infestations.',
        mid: 'Occasional minor issue (like a few ants in summer) that was quickly resolved and didn\'t persist.',
        low: 'Ongoing pest problems: regular sightings of roaches or mice, bedbug infestation, pests that management failed to address.',
      },
    },
  },
  {
    key: 'unit_mold',
    code: 'U7',
    dimension: 'Mold & Moisture',
    text: 'The unit was free from mold, mildew, or persistent moisture problems.',
    required: true,
    allowNA: false,
    category: 'unit',
    help: {
      description: 'Look for visible mold or mildew (especially in bathrooms, around windows, or in closets), musty smells, or condensation problems.',
      examples: {
        high: 'No mold or mildew anywhere. Bathroom stays dry, no musty smells, windows don\'t condensate excessively.',
        mid: 'Minor mildew in bathroom that\'s manageable with regular cleaning, but no serious mold issues.',
        low: 'Visible mold growth, persistent musty smell, mold keeps returning after cleaning, moisture problems causing damage.',
      },
    },
  },
  {
    key: 'unit_appliances',
    code: 'U8',
    dimension: 'Appliances',
    text: 'Appliances included with the unit worked reliably throughout my tenancy.',
    required: true,
    allowNA: false,
    category: 'unit',
    help: {
      description: 'Consider the stove/oven, refrigerator, dishwasher, microwave, garbage disposal, and any other appliances that came with the unit.',
      examples: {
        high: 'All appliances worked perfectly the entire time. No breakdowns, everything functioned as expected.',
        mid: 'Appliances worked but showed their age. Maybe one needed a repair that was handled reasonably.',
        low: 'Appliances frequently broke down, didn\'t work properly (oven uneven, fridge not cold enough), or weren\'t repaired when reported.',
      },
    },
  },
  {
    key: 'unit_layout',
    code: 'U9',
    dimension: 'Layout & Functionality',
    text: "The unit's layout and space were functional for daily living.",
    required: true,
    allowNA: false,
    category: 'unit',
    help: {
      description: 'Think about room sizes, closet space, kitchen workspace, bathroom layout, and how well the space worked for your daily routine.',
      examples: {
        high: 'Well-designed layout. Rooms are good sizes, plenty of storage, kitchen functional, everything flows well.',
        mid: 'Layout works but has quirks. Maybe closets are small or kitchen is tight, but you made it work.',
        low: 'Poorly designed. Rooms too small, no storage, awkward layout that makes daily life difficult, wasted space.',
      },
    },
  },
  {
    key: 'unit_accuracy',
    code: 'U10',
    dimension: 'Listing Accuracy',
    text: 'The unit matched what was advertised or shown during viewing.',
    required: true,
    allowNA: false,
    category: 'unit',
    help: {
      description: 'Compare what you saw in the listing/tour to what you got: photos, described amenities, stated square footage, included features.',
      examples: {
        high: 'Everything exactly as advertised. Photos were accurate, all promised amenities present, no surprises.',
        mid: 'Mostly accurate with minor differences. Maybe lighting made it look bigger in photos, but nothing misleading.',
        low: 'Significantly misrepresented. Photos were misleading, promised amenities missing, hidden problems not disclosed.',
      },
    },
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
    help: {
      description: 'Think about hallways, stairwells, lobby, elevators, and any other shared indoor spaces. Were they clean and well-maintained?',
      examples: {
        high: 'Always clean and well-lit. Floors swept, walls in good condition, no trash or debris, repairs done promptly.',
        mid: 'Generally acceptable but not spotless. Occasional mess that gets cleaned up, minor wear and tear.',
        low: 'Dirty, poorly lit, trash accumulates, broken fixtures not repaired, graffiti, general neglect.',
      },
    },
  },
  {
    key: 'building_security',
    code: 'B2',
    dimension: 'Building Security',
    text: 'The building felt secure, with working locks, adequate lighting, and functional entry systems.',
    required: true,
    allowNA: false,
    category: 'building',
    help: {
      description: 'Consider entry door locks, intercom/buzzer systems, hallway lighting, and your overall sense of security in the building.',
      examples: {
        high: 'Very secure. All locks work, good lighting everywhere, secure entry system, felt safe at all hours.',
        mid: 'Reasonably secure but not perfect. Maybe a light was out occasionally or buzzer was finicky.',
        low: 'Security concerns. Broken locks, main door often propped open, poor lighting, non-functional intercom, felt unsafe.',
      },
    },
  },
  {
    key: 'building_exterior',
    code: 'B3',
    dimension: 'Exterior & Grounds',
    text: 'The building exterior and grounds were well-maintained, including snow removal, landscaping, and trash areas.',
    required: true,
    allowNA: false,
    category: 'building',
    help: {
      description: 'Think about the building\'s outside appearance, landscaping, snow/ice removal in winter, and outdoor trash/recycling areas.',
      examples: {
        high: 'Well-maintained exterior, landscaping neat, snow removed promptly, trash areas clean and organized.',
        mid: 'Acceptable but basic maintenance. Snow removal takes a day or two, landscaping minimal but tidy.',
        low: 'Neglected exterior, overgrown landscaping, snow/ice not cleared (safety hazard), trash overflowing, eyesore.',
      },
    },
  },
  {
    key: 'building_noise_neighbors',
    code: 'B4',
    dimension: 'Noise - Internal',
    text: 'Noise from adjacent units or building systems was at a reasonable level.',
    required: true,
    allowNA: false,
    category: 'building',
    help: {
      description: 'Consider noise from neighbors (footsteps, music, voices), building systems (heating, plumbing), and general sound insulation.',
      examples: {
        high: 'Very quiet. Rarely heard neighbors, good soundproofing between units, building systems quiet.',
        mid: 'Some noise but livable. Occasionally hear neighbors during normal activities, nothing excessive.',
        low: 'Very noisy. Thin walls, hear everything from neighbors, loud building systems, disrupts sleep or work.',
      },
    },
  },
  {
    key: 'building_noise_external',
    code: 'B5',
    dimension: 'Noise - External',
    text: 'Noise from outside the building, such as traffic, construction, or street activity, was at a reasonable level.',
    required: true,
    allowNA: false,
    category: 'building',
    help: {
      description: 'Think about street noise, traffic, nearby bars/restaurants, construction, sirens, or other external sounds.',
      examples: {
        high: 'Very quiet location or excellent sound insulation. Outside noise rarely noticeable inside.',
        mid: 'Some street noise but manageable. Typical city sounds, nothing that seriously disrupts daily life.',
        low: 'Extremely noisy. Constant traffic, frequent sirens, loud nightlife, construction, disrupts sleep and peace.',
      },
    },
  },
  {
    key: 'building_mail',
    code: 'B6',
    dimension: 'Mail & Package Security',
    text: 'Mail delivery was secure, and packages were protected from theft or weather damage.',
    required: true,
    allowNA: false,
    category: 'building',
    help: {
      description: 'Consider your mailbox security, package delivery options, whether packages were stolen or left in weather.',
      examples: {
        high: 'Secure mailboxes, packages kept in secure area or locker, never had theft or weather damage issues.',
        mid: 'Basic mail security. Packages left in lobby which is reasonably secure, occasional concern but no actual problems.',
        low: 'Mail/package theft occurred, packages left outside in weather, broken mailboxes, no secure delivery option.',
      },
    },
  },
  {
    key: 'building_laundry',
    code: 'B7',
    dimension: 'Laundry Facilities',
    text: 'Laundry facilities, if provided, were functional and reasonably maintained.',
    required: false,
    allowNA: true,
    category: 'building',
    help: {
      description: 'If your building had shared laundry, consider machine availability, working condition, cleanliness, and cost. Select N/A if you had in-unit laundry or no building facilities.',
      examples: {
        high: 'Machines always available and working, clean facilities, reasonable prices, well-maintained.',
        mid: 'Usually functional but occasional out-of-order machines. Basic cleanliness, acceptable wait times.',
        low: 'Machines frequently broken, dirty facilities, long waits, overpriced, or laundry room felt unsafe.',
      },
    },
  },
  {
    key: 'building_parking',
    code: 'B8',
    dimension: 'Parking',
    text: 'Parking, if included, matched what was promised and was adequately maintained.',
    required: false,
    allowNA: true,
    category: 'building',
    help: {
      description: 'If parking was included or available, consider spot availability, safety, lighting, snow clearing, and whether it matched what was promised. Select N/A if parking wasn\'t relevant to you.',
      examples: {
        high: 'Assigned spot always available, well-lit, secure, properly maintained and cleared of snow.',
        mid: 'Parking available but not perfect. Maybe shared lot gets full occasionally or snow clearing is slow.',
        low: 'Parking problems: spot not available as promised, unsafe area, never cleared of snow, damage to vehicle.',
      },
    },
  },
  {
    key: 'building_trash',
    code: 'B9',
    dimension: 'Trash & Recycling',
    text: 'Trash and recycling facilities were adequate and serviced regularly.',
    required: true,
    allowNA: false,
    category: 'building',
    help: {
      description: 'Think about trash room/bin accessibility, pickup frequency, overflow issues, recycling options, and cleanliness.',
      examples: {
        high: 'Convenient trash access, regular pickup, never overflows, recycling available, area kept clean.',
        mid: 'Adequate but basic. Occasional overflow before pickup day, functional but not ideal location.',
        low: 'Trash overflows regularly, infrequent pickup, no recycling, smelly or pest-attracting conditions, inconvenient access.',
      },
    },
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
    help: {
      description: 'Think about how quickly maintenance issues were acknowledged and resolved. Consider both emergency and non-emergency repairs.',
      examples: {
        high: 'Requests acknowledged same day, repairs completed quickly, emergencies handled immediately.',
        mid: 'Reasonable response time (few days for non-emergencies), eventually fixed but not lightning fast.',
        low: 'Requests ignored or took weeks/months, had to follow up repeatedly, some issues never fixed.',
      },
    },
  },
  {
    key: 'landlord_communication',
    code: 'L2',
    dimension: 'Communication',
    text: 'The landlord or management was easy to reach and responded to communications promptly.',
    required: true,
    allowNA: false,
    category: 'landlord',
    help: {
      description: 'Consider how easy it was to contact your landlord/management and how quickly they responded to calls, emails, or messages.',
      examples: {
        high: 'Always responsive. Returns calls/emails within a day, clear communication channels, easy to reach.',
        mid: 'Generally reachable but may take a few days to respond. Gets back to you eventually.',
        low: 'Very hard to reach. Ignores messages, no response for days/weeks, unclear how to contact them.',
      },
    },
  },
  {
    key: 'landlord_professionalism',
    code: 'L3',
    dimension: 'Professionalism',
    text: 'Interactions with the landlord or management were respectful and professional.',
    required: true,
    allowNA: false,
    category: 'landlord',
    help: {
      description: 'Think about how you were treated in all interactions. Were they respectful, courteous, and businesslike?',
      examples: {
        high: 'Always professional and respectful. Courteous communication, treated you as a valued tenant.',
        mid: 'Generally professional, maybe occasionally curt or slow, but nothing disrespectful.',
        low: 'Rude, dismissive, aggressive, or unprofessional behavior. Made you feel uncomfortable or unwelcome.',
      },
    },
  },
  {
    key: 'landlord_lease_clarity',
    code: 'L4',
    dimension: 'Lease Clarity',
    text: 'Lease terms were clear, and the landlord honored all agreements.',
    required: true,
    allowNA: false,
    category: 'landlord',
    help: {
      description: 'Consider whether the lease was clear and understandable, and whether the landlord followed through on all promises and terms.',
      examples: {
        high: 'Clear, straightforward lease. All verbal promises put in writing, landlord honored every agreement.',
        mid: 'Lease was standard, mostly clear. No major issues with honoring terms, maybe minor confusion resolved.',
        low: 'Confusing lease, hidden fees, landlord didn\'t honor promises, tried to change terms mid-lease.',
      },
    },
  },
  {
    key: 'landlord_privacy',
    code: 'L5',
    dimension: 'Privacy & Boundaries',
    text: 'The landlord respected my privacy and provided appropriate notice before entering the unit.',
    required: true,
    allowNA: false,
    category: 'landlord',
    help: {
      description: 'Think about whether the landlord gave proper notice before entering (typically 24-48 hours required by law), and respected your space and privacy.',
      examples: {
        high: 'Always gave proper advance notice, respected your schedule, never entered without permission.',
        mid: 'Usually gave notice, maybe once entered with short notice for legitimate emergency.',
        low: 'Entered without notice, showed up unannounced, didn\'t respect boundaries, made you feel surveilled.',
      },
    },
  },
  {
    key: 'landlord_deposit',
    code: 'L6',
    dimension: 'Security Deposit',
    text: 'The security deposit was handled fairly, with clear accounting and timely return if applicable.',
    required: true,
    allowNA: false,
    category: 'landlord',
    help: {
      description: 'Consider how the security deposit was handled at move-in and move-out. Was it returned on time with clear documentation of any deductions?',
      examples: {
        high: 'Full deposit returned promptly (within legal timeframe), clear itemized statement, fair deductions if any.',
        mid: 'Deposit returned but took longer than ideal, or minor disagreement about deductions that was resolved.',
        low: 'Deposit withheld unfairly, excessive deductions, no itemization, had to fight to get money back, or never returned.',
      },
    },
  },
  {
    key: 'landlord_rent_practices',
    code: 'L7',
    dimension: 'Rent Practices',
    text: 'Rent increases, if any, were reasonable and communicated with appropriate notice.',
    required: false,
    allowNA: true,
    category: 'landlord',
    help: {
      description: 'If you experienced a rent increase, was it reasonable and communicated properly? Select N/A if rent never increased during your tenancy.',
      examples: {
        high: 'Increases were modest and market-appropriate, given with plenty of advance notice, clearly communicated.',
        mid: 'Increase was noticeable but not outrageous, adequate notice given, understandable reasoning.',
        low: 'Excessive increases, short notice, felt like price gouging, or increases used to push you out.',
      },
    },
  },
  {
    key: 'landlord_non_retaliation',
    code: 'L8',
    dimension: 'Non-Retaliation',
    text: 'I felt comfortable raising concerns or requesting repairs without fear of retaliation.',
    required: true,
    allowNA: false,
    category: 'landlord',
    help: {
      description: 'Think about whether you felt safe reporting problems or requesting repairs. Did you worry about rent increases, non-renewal, or other consequences?',
      examples: {
        high: 'Completely comfortable reporting issues. Landlord welcomed feedback and fixed problems without any negative consequences.',
        mid: 'Generally comfortable, maybe slight hesitation but no actual retaliation experienced.',
        low: 'Afraid to report issues. Experienced or feared retaliation like rent increase, eviction threats, or harassment after complaints.',
      },
    },
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
