// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Once step-up completes, the transfer panel must show only "Complete! Invoke API again." and not the
// re-authentication form. A form left on screen invites the user to sign in again, which replaces the
// elevated token and replays the challenge that was already used up.
jest.mock('aws-amplify/auth', () => ({
  signIn: jest.fn(),
  signOut: jest.fn(),
  confirmSignIn: jest.fn(),
  fetchAuthSession: jest.fn()
}));

jest.mock('aws-amplify/api', () => ({
  get: jest.fn(),
  post: jest.fn()
}));

jest.mock('../../src/config', () => ({
  __esModule: true,
  default: { REST_API_ENDPOINTS: [{ name: 'stepup-api' }] }
}));

import { StepUp } from '../../src/components/stepup/StepUp';
import ReauthHandler from '../../src/components/stepup/ReauthHandler';

// true if the rendered element tree contains an element of the given component type
function containsType(node, type) {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some((n) => containsType(n, type));
  if (node.type === type) return true;
  return containsType(node.props && node.props.children, type);
}

// true if the rendered element tree contains the given text
function containsText(node, text) {
  if (node === null || node === undefined || typeof node === 'boolean') return false;
  if (typeof node === 'string' || typeof node === 'number') return String(node).includes(text);
  if (Array.isArray(node)) return node.some((n) => containsText(n, text));
  return containsText(node.props && node.props.children, text);
}

function render(props) {
  return new StepUp({ stepUpError: '', stepUpErrorOrigin: '', ...props }).renderChallengeResponse();
}

describe('StepUp challenge response', () => {
  it('shows the re-authentication form while step-up is pending', () => {
    const el = render({ steppedUp: false, reauthMfaRequired: false });
    expect(containsType(el, ReauthHandler)).toBe(true);
    expect(containsText(el, 'Complete! Invoke API again.')).toBe(false);
  });

  it('shows only the completion message once step-up has completed', () => {
    const el = render({ steppedUp: true, reauthMfaRequired: false });
    expect(containsText(el, 'Complete! Invoke API again.')).toBe(true);
    expect(containsType(el, ReauthHandler)).toBe(false);
  });

  it('keeps the form and the error when a re-authentication attempt fails', () => {
    const el = render({ steppedUp: false, stepUpError: 'Incorrect username or password.' });
    expect(containsType(el, ReauthHandler)).toBe(true);
    expect(containsText(el, 'Incorrect username or password.')).toBe(true);
  });
});
