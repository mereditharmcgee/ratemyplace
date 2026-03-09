// Shared form constants for ReviewForm and ReviewEditForm

export const bedroomOptions = [
  { value: 'studio', label: 'Studio' },
  { value: '1', label: '1 Bedroom' },
  { value: '2', label: '2 Bedrooms' },
  { value: '3', label: '3 Bedrooms' },
  { value: '4', label: '4 Bedrooms' },
  { value: '5+', label: '5+ Bedrooms' },
];

export const bathroomOptions = [
  { value: '1', label: '1 Bathroom' },
  { value: '1.5', label: '1.5 Bathrooms' },
  { value: '2', label: '2 Bathrooms' },
  { value: '2.5', label: '2.5 Bathrooms' },
  { value: '3+', label: '3+ Bathrooms' },
];

export const amenityOptions = [
  { id: 'ac', label: 'Air Conditioning' },
  { id: 'in_unit_laundry', label: 'In-Unit Laundry' },
  { id: 'dishwasher', label: 'Dishwasher' },
  { id: 'balcony', label: 'Balcony/Patio' },
  { id: 'storage', label: 'Storage Space' },
  { id: 'pet_friendly', label: 'Pet Friendly' },
  { id: 'doorman', label: 'Doorman/Concierge' },
  { id: 'gym', label: 'Gym/Fitness Center' },
  { id: 'pool', label: 'Pool' },
  { id: 'elevator', label: 'Elevator' },
];

export const utilityOptions = [
  { id: 'heat', label: 'Heat' },
  { id: 'hot_water', label: 'Hot Water' },
  { id: 'electricity', label: 'Electricity' },
  { id: 'gas', label: 'Gas' },
  { id: 'water', label: 'Water/Sewer' },
  { id: 'trash', label: 'Trash' },
  { id: 'internet', label: 'Internet' },
];

export const laundryTypeOptions = [
  { value: 'in_unit', label: 'In-unit washer/dryer' },
  { value: 'in_building', label: 'Building laundry (free)' },
  { value: 'coin_op', label: 'Building laundry (coin-op/paid)' },
  { value: 'none', label: 'No building laundry' },
];

export const parkingTypeOptions = [
  { value: 'included', label: 'Included with rent' },
  { value: 'available', label: 'Available for extra cost' },
  { value: 'street', label: 'Street parking only' },
  { value: 'none', label: 'No parking available' },
];

export const petTypeOptions = [
  { id: 'dogs', label: 'Dogs' },
  { id: 'cats', label: 'Cats' },
  { id: 'small_animals', label: 'Small Animals (hamsters, fish, etc.)' },
  { id: 'no_pets', label: 'No pets allowed' },
];

export const pestTypeOptions = [
  { id: 'roaches', label: 'Cockroaches' },
  { id: 'mice', label: 'Mice' },
  { id: 'rats', label: 'Rats' },
  { id: 'bedbugs', label: 'Bedbugs' },
  { id: 'ants', label: 'Ants' },
  { id: 'flies', label: 'Flies/Gnats' },
  { id: 'other', label: 'Other' },
];
