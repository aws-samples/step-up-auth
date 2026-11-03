// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Focused coverage for the step-up re-authentication form. The submitted password must not remain in
// component state (and therefore in the controlled input) after submission: the same ReauthHandler
// instance stays mounted while the flow switches to the MFA stage and back, so a lingering value
// would repopulate the password field and stay available to component inspection.

import ReauthHandler from '../../src/components/stepup/ReauthHandler';

// Drive the submit handler without a DOM, mirroring React's setState semantics (merge the update,
// then run the callback) so the test exercises the real handler logic.
function mountStub(props) {
  const handler = new ReauthHandler(props);
  handler.setState = (update, cb) => {
    handler.state = { ...handler.state, ...update };
    if (cb) cb();
  };
  return handler;
}

describe('ReauthHandler password form', () => {
  it('clears the submitted password from component state before handing it off', () => {
    const onPassword = jest.fn();
    const handler = mountStub({ onPassword });

    // the user typed a password into the controlled input
    handler.state = { password: 'super-secret-password', mfaCode: '' };
    handler.handlePasswordSubmit();

    // the password reached the action handler...
    expect(onPassword).toHaveBeenCalledWith('super-secret-password');
    // ...but no longer lives in component state, so the controlled input renders empty
    expect(handler.state.password).toBe('');
  });

  it('empties the password field before onPassword runs, not after', () => {
    let passwordAtCallTime;
    const handler = mountStub({
      onPassword: () => { passwordAtCallTime = handler.state.password; }
    });

    handler.state = { password: 'another-secret', mfaCode: '' };
    handler.handlePasswordSubmit();

    expect(passwordAtCallTime).toBe('');
  });
});
