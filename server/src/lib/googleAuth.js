import { OAuth2Client } from 'google-auth-library';
import { env, googleAuthEnabled } from './env.js';

/**
 * Google sign-in, kept to identity only.
 *
 * `email` is the only claim the rest of the app uses — matched against the
 * existing unique User.email column, exactly like password login — so the
 * scope requested is the minimum that proves who the person is:
 *   - no `profile` scope, since name/picture are never stored or shown
 *   - `access_type: 'online'`, since no refresh token is ever needed —
 *     nothing here calls a Google API after the initial identity check
 */
const SCOPES = ['openid', 'email'];

export const oauthClient = googleAuthEnabled
  ? new OAuth2Client(env.googleClientId, env.googleClientSecret, env.googleCallbackUrl)
  : null;

/** The URL to send the browser to. `state` must be verified on the callback. */
export function buildGoogleAuthUrl(state) {
  return oauthClient.generateAuthUrl({
    access_type: 'online',
    scope: SCOPES,
    state,
    prompt: 'select_account',
  });
}

/**
 * Exchanges the authorization code for tokens and verifies the ID token's
 * signature, issuer, audience and expiry against Google's own keys.
 *
 * Returns the verified claims (`email`, `email_verified`, `sub`, ...) or
 * throws — the caller decides what an invalid/expired/forged response means
 * for the user, this function only answers "is this really Google, and who
 * does Google say signed in".
 */
export async function verifyGoogleCode(code) {
  const { tokens } = await oauthClient.getToken(code);
  const ticket = await oauthClient.verifyIdToken({
    idToken: tokens.id_token,
    audience: env.googleClientId,
  });
  return ticket.getPayload();
}
