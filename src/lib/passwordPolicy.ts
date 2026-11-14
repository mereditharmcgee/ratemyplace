// The password minimum, in one place: the sign-up page and API, the reset API and the settings
// API read it here. The reset page and the settings tab keep a literal 8, which
// passwordPolicy.test.ts holds equal to PASSWORD_MIN_LENGTH.
//
// LEAF MODULE: no runtime imports (`clientLeafModules.test.ts` enforces it), so a page script
// or island can take the minimum from it without pulling in server code.

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 255;

/**
 * Sign-in's floor. Sign-up accepted 6 characters until March 2026; existing passwords that
 * short must still sign in.
 */
export const LEGACY_SIGNIN_MIN_LENGTH = 6;

/** The hint under the sign-up page's password input. */
export const SIGNUP_PASSWORD_HINT = `At least ${PASSWORD_MIN_LENGTH} characters`;
