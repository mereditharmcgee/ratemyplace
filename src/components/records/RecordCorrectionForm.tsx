interface Props { buildingId: string }

export default function RecordCorrectionForm({ buildingId }: Props) {
  return <p className="text-sm text-gray-500" data-building-id={buildingId}>The report form is coming shortly.</p>;
}
