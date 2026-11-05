// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { Container, Form, Label } from 'semantic-ui-react';

import "./ChallengeHandler.css";

// Step-up re-authentication form.  Re-authentication is a two-stage flow: first the user re-enters
// their password (stage 1); once Cognito accepts it and creates the MFA challenge, the form collects
// the current code from the user's authenticator app (stage 2).
class ReauthHandler extends Component {
  constructor(props) {
    super(props);

    this.state = {
      password: '',
      mfaCode: ''
    };

    this.handlePasswordSubmit = this.handlePasswordSubmit.bind(this);
    this.handleMfaSubmit = this.handleMfaSubmit.bind(this);
    this.handleChange = this.handleChange.bind(this);
  }

  handleChange(e, { name, value }) {
    this.setState({ [name]: value });
  }

  handlePasswordSubmit() {
    // Capture the submitted password in a local and clear it from component state before handing it
    // off, so the secret never lingers in the controlled input across wrong-password retries, the MFA
    // stage, a session-ending reset, or successful completion.  onPassword runs from the setState
    // callback, after the field has been emptied.
    const { password } = this.state;
    this.setState({ password: '' }, () => this.props.onPassword(password));
  }

  handleMfaSubmit() {
    this.props.onMfaCode(this.state.mfaCode);
  }

  render() {
    const { password, mfaCode } = this.state;
    const { mfaRequired } = this.props;

    // stage 2: Cognito has created the MFA challenge
    if (mfaRequired) {
      return (
        <Container>
          <Label pointing="below" color="orange">Enter the current code from your authenticator app.</Label>
          <Form onSubmit={this.handleMfaSubmit}>
            <Form.Group>
              <Form.Input
                placeholder="MFA code"
                name="mfaCode"
                value={mfaCode}
                onChange={this.handleChange}
              />
              <Form.Button content="Verify" />
            </Form.Group>
          </Form>
        </Container>
      );
    }

    // stage 1: collect the password and start re-authentication
    return (
      <Container>
        <Label pointing="below" color="orange">
          Re-authenticate to continue: re-enter your password.
        </Label>
        <Form onSubmit={this.handlePasswordSubmit}>
          <Form.Group>
            <Form.Input
              type="password"
              placeholder="Password"
              name="password"
              value={password}
              onChange={this.handleChange}
            />
            <Form.Button content="Re-authenticate" />
          </Form.Group>
        </Form>
      </Container>
    );
  }
}

// Runtime type checking for React props
ReauthHandler.propTypes = {
  mfaRequired: PropTypes.bool,
  mfaType: PropTypes.string,
  onPassword: PropTypes.func,
  onMfaCode: PropTypes.func
};

export default ReauthHandler;
