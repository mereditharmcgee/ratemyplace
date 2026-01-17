export interface SurveyItem {
  id: string;
  label: string;
  description: string;
  category: 'building' | 'landlord' | 'value';
}

export const surveyItems: SurveyItem[] = [
  // Building Quality (6 items)
  {
    id: 'building_quality',
    label: 'Building Quality',
    description: 'Overall condition of the building, common areas, and exterior',
    category: 'building'
  },
  {
    id: 'maintenance',
    label: 'Maintenance',
    description: 'How quickly and effectively repairs were handled',
    category: 'building'
  },
  {
    id: 'pest_control',
    label: 'Pest Control',
    description: 'Absence of pests (mice, roaches, bed bugs) and pest management',
    category: 'building'
  },
  {
    id: 'safety',
    label: 'Safety & Security',
    description: 'Building security, locks, lighting, and neighborhood safety',
    category: 'building'
  },
  {
    id: 'noise',
    label: 'Noise Level',
    description: 'Sound insulation and overall quietness of the building',
    category: 'building'
  },
  {
    id: 'amenities',
    label: 'Amenities',
    description: 'Quality of in-unit and building amenities (laundry, parking, etc.)',
    category: 'building'
  },

  // Landlord Experience (5 items)
  {
    id: 'landlord_responsiveness',
    label: 'Responsiveness',
    description: 'How quickly the landlord/management responds to requests',
    category: 'landlord'
  },
  {
    id: 'landlord_communication',
    label: 'Communication',
    description: 'Quality and professionalism of landlord communication',
    category: 'landlord'
  },
  {
    id: 'landlord_fairness',
    label: 'Fairness',
    description: 'Fair treatment and respect for tenant rights',
    category: 'landlord'
  },
  {
    id: 'lease_clarity',
    label: 'Lease Clarity',
    description: 'Clear terms and no hidden fees or surprise charges',
    category: 'landlord'
  },
  {
    id: 'deposit_handling',
    label: 'Deposit Handling',
    description: 'Fair handling of security deposit and move-out process',
    category: 'landlord'
  },

  // Value (1 item)
  {
    id: 'rent_value',
    label: 'Value for Money',
    description: 'Whether the rent is fair for what you receive',
    category: 'value'
  }
];

export const issueItems = [
  {
    id: 'pest',
    label: 'Pest Issues',
    description: 'Did you experience problems with mice, roaches, bed bugs, or other pests?'
  },
  {
    id: 'heat',
    label: 'Heat/Hot Water Issues',
    description: 'Did you have problems with heating or hot water availability?'
  },
  {
    id: 'water',
    label: 'Plumbing Issues',
    description: 'Did you experience leaks, water damage, or plumbing problems?'
  },
  {
    id: 'deposit',
    label: 'Security Deposit Issues',
    description: 'Did you have problems getting your security deposit returned?'
  },
  {
    id: 'eviction',
    label: 'Eviction Threats',
    description: 'Were you threatened with eviction or experienced retaliation?'
  }
];

export function getSurveyItemsByCategory(category: 'building' | 'landlord' | 'value'): SurveyItem[] {
  return surveyItems.filter(item => item.category === category);
}

export function getSurveyItemById(id: string): SurveyItem | undefined {
  return surveyItems.find(item => item.id === id);
}
