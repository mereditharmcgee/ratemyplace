import {
  bedroomOptions,
  bathroomOptions,
  amenityOptions,
  utilityOptions,
  parkingTypeOptions,
  petTypeOptions,
} from '../../../lib/formOptions';
import type { Building, UnitDetails } from './types';

interface Props {
  building: Building | null;
  unitDetails: UnitDetails;
  onChange: (details: UnitDetails) => void;
  onNext: () => void;
}

export default function UnitDetailsStep({ building, unitDetails, onChange, onNext }: Props) {
  return (
    <div className="space-y-6">
      {building && (
        <div className="bg-paper p-4 rounded-lg mb-6">
          <div className="font-medium">{building.address}</div>
          <div className="text-sm text-gray-500">
            {building.neighborhood && `${building.neighborhood}, `}
            {building.city}
          </div>
        </div>
      )}

      {/* Move-in date */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          When did you move in?
        </label>
        <div className="grid grid-cols-2 gap-3">
          <select
            value={unitDetails.moveInMonth}
            onChange={(e) => onChange({ ...unitDetails, moveInMonth: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          >
            <option value="">Month</option>
            <option value="1">January</option>
            <option value="2">February</option>
            <option value="3">March</option>
            <option value="4">April</option>
            <option value="5">May</option>
            <option value="6">June</option>
            <option value="7">July</option>
            <option value="8">August</option>
            <option value="9">September</option>
            <option value="10">October</option>
            <option value="11">November</option>
            <option value="12">December</option>
          </select>
          <select
            value={unitDetails.moveInYear}
            onChange={(e) => onChange({ ...unitDetails, moveInYear: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          >
            <option value="">Year</option>
            {Array.from({ length: new Date().getFullYear() - 1999 }, (_, i) => new Date().getFullYear() - i).map((year) => (
              <option key={year} value={year.toString()}>{year}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Unit Number <span className="text-gray-400">(optional)</span>
          </label>
          <input
            type="text"
            value={unitDetails.unitNumber}
            onChange={(e) => onChange({ ...unitDetails, unitNumber: e.target.value })}
            placeholder="e.g., 2A, 301"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          />
        </div>

        <div className="col-span-2 sm:col-span-1">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Square Footage <span className="text-gray-400">(optional)</span>
          </label>
          <input
            type="number"
            value={unitDetails.squareFootage}
            onChange={(e) => onChange({ ...unitDetails, squareFootage: e.target.value })}
            placeholder="e.g., 750"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Bedrooms</label>
          <select
            value={unitDetails.bedrooms}
            onChange={(e) => onChange({ ...unitDetails, bedrooms: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          >
            {bedroomOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Bathrooms</label>
          <select
            value={unitDetails.bathrooms}
            onChange={(e) => onChange({ ...unitDetails, bathrooms: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          >
            {bathroomOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Monthly Rent <span className="text-gray-400">(optional)</span>
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
            <input
              type="number"
              value={unitDetails.rentAmount}
              onChange={(e) => onChange({ ...unitDetails, rentAmount: e.target.value })}
              placeholder="e.g., 2500"
              className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
          </div>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">
          Amenities <span className="text-gray-400">(select all that apply)</span>
        </label>
        <div className="grid grid-cols-2 gap-2">
          {amenityOptions.map((amenity) => (
            <label
              key={amenity.id}
              className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
                unitDetails.amenities.includes(amenity.id)
                  ? 'border-teal-500 bg-teal-50'
                  : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <input
                type="checkbox"
                checked={unitDetails.amenities.includes(amenity.id)}
                onChange={(e) => {
                  if (e.target.checked) {
                    onChange({ ...unitDetails, amenities: [...unitDetails.amenities, amenity.id] });
                  } else {
                    onChange({
                      ...unitDetails,
                      amenities: unitDetails.amenities.filter((a) => a !== amenity.id),
                    });
                  }
                }}
                className="rounded border-gray-300 text-teal-700 focus:ring-teal-500"
              />
              <span className="text-sm text-gray-700">{amenity.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">
          Utilities Included in Rent <span className="text-gray-400">(select all that apply)</span>
        </label>
        <div className="grid grid-cols-2 gap-2">
          {utilityOptions.map((utility) => (
            <label
              key={utility.id}
              className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
                unitDetails.utilitiesIncluded.includes(utility.id)
                  ? 'border-teal-500 bg-teal-50'
                  : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <input
                type="checkbox"
                checked={unitDetails.utilitiesIncluded.includes(utility.id)}
                onChange={(e) => {
                  if (e.target.checked) {
                    onChange({
                      ...unitDetails,
                      utilitiesIncluded: [...unitDetails.utilitiesIncluded, utility.id],
                    });
                  } else {
                    onChange({
                      ...unitDetails,
                      utilitiesIncluded: unitDetails.utilitiesIncluded.filter((u) => u !== utility.id),
                    });
                  }
                }}
                className="rounded border-gray-300 text-teal-700 focus:ring-teal-500"
              />
              <span className="text-sm text-gray-700">{utility.label}</span>
            </label>
          ))}
        </div>
      </div>

      {unitDetails.utilitiesIncluded.length < utilityOptions.length && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Estimated Monthly Utility Cost <span className="text-gray-400">(for utilities not included)</span>
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
            <input
              type="number"
              value={unitDetails.estimatedMonthlyUtilities}
              onChange={(e) => onChange({ ...unitDetails, estimatedMonthlyUtilities: e.target.value })}
              placeholder="e.g., 150"
              className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Approximate monthly cost for utilities you paid separately
          </p>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Laundry Situation</label>
          <select
            value={unitDetails.laundryType}
            onChange={(e) => onChange({ ...unitDetails, laundryType: e.target.value as any })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          >
            <option value="in_unit">In-unit washer/dryer</option>
            <option value="in_building">Building laundry (free)</option>
            <option value="coin_op">Building laundry (coin-op/paid)</option>
            <option value="none">No building laundry</option>
          </select>
        </div>

        {unitDetails.laundryType === 'coin_op' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Cost per Load (wash + dry) <span className="text-gray-400">(optional)</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
              <input
                type="number"
                step="0.25"
                value={unitDetails.laundryCostPerLoad}
                onChange={(e) => onChange({ ...unitDetails, laundryCostPerLoad: e.target.value })}
                placeholder="e.g., 3.50"
                className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Total cost for one wash + one dry cycle
            </p>
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Parking Situation <span className="text-gray-400">(optional)</span>
        </label>
        <select
          value={unitDetails.parkingType}
          onChange={(e) => onChange({ ...unitDetails, parkingType: e.target.value })}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
        >
          <option value="">Select...</option>
          {parkingTypeOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">
          Pets Allowed <span className="text-gray-400">(select all that apply)</span>
        </label>
        <div className="grid grid-cols-2 gap-2">
          {petTypeOptions.map((pet) => (
            <label
              key={pet.id}
              className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
                unitDetails.petTypes.includes(pet.id)
                  ? 'border-teal-500 bg-teal-50'
                  : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <input
                type="checkbox"
                checked={unitDetails.petTypes.includes(pet.id)}
                onChange={(e) => {
                  if (e.target.checked) {
                    onChange({ ...unitDetails, petTypes: [...unitDetails.petTypes, pet.id] });
                  } else {
                    onChange({
                      ...unitDetails,
                      petTypes: unitDetails.petTypes.filter((p) => p !== pet.id),
                    });
                  }
                }}
                className="rounded border-gray-300 text-teal-700 focus:ring-teal-500"
              />
              <span className="text-sm text-gray-700">{pet.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onNext}
          className="px-6 py-2 bg-teal-700 text-white font-semibold rounded-[4px] hover:bg-teal-800"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
