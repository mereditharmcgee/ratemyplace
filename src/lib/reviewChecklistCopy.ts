// The "Before you submit" box on the review form's last step and on the edit form: what to
// leave out of a review, and the box a reviewer ticks to say they understand they may be
// identified. Both forms, the unit tests and the e2e specs read these strings from here, so
// an edit lands everywhere at once. The Terms of Service checkbox carries links, so its
// sentence stays in `components/reviews/ReviewAcknowledgements.tsx`.
//
// A client leaf (`clientLeafModules.test.ts`): both review islands import it, so it has no
// runtime imports.

export const REVIEW_CHECKLIST_COPY = {
  heading: 'Before you submit',
  intro: 'Your landlord may be able to identify you based on details in your review. Leave these out of your title and comments:',
  items: [
    'Names of people, including you, your neighbors and building staff',
    'Unit or apartment numbers',
    'Exact dates',
    'Other details that point to you, like a unique feature of your unit or an event only you were part of',
  ],
  identifyAcknowledgement: 'I understand my landlord may be able to identify me based on details in my review.',
  /** Under Submit on the new-review form while either box is unticked. */
  submitHint: 'Check both boxes above to submit your review.',
  /** Under Save Changes on the edit form while either box is unticked. */
  saveHint: 'Check both boxes above to save your changes.',
} as const;
