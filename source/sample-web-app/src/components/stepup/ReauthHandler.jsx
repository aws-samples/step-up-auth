// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { Container, Form, Label } from 'semantic-ui-react';

import "./ChallengeHandler.css";

// Step-up re-authentication form: the user confirms their identity by re-entering their password and a
// current MFA code.  This produces a freshly authenticated session that the backend accepts for step-up.
class ReauthHandler extends Component {
  constructor(props) {
    super(props);

    this.state = {
      password: '',
      mfaCode: ''
    };

    this.handleSubmit = this.handleSubmit.bind(this);
    this.handleChange = this.handleChange.bind(this);
  }

  handleChange(e, { name, value }) {
    this.setState({ [name]: value });
  }

  handleSubmit() {
    const { password, mfaCode } = this.state;
    this.props.handleReauth(password, mfaCode);
  }

  render() {
    const { password, mfaCode } = this.state;

    return (
      <Container>
        <Label pointing="below" color="orange">
          Re-authenticate to continue: re-enter your password and a current MFA code from your
          authenticator app.
        </Label>
        <Form onSubmit={this.handleSubmit}>
          <Form.Group>
            <Form.Input
              type="password"
              placeholder="Password"
              name="password"
              value={password}
              onChange={this.handleChange}
            />
            <Form.Input
              placeholder="MFA code"
              name="mfaCode"
              value={mfaCode}
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
  handleReauth: PropTypes.func
};

export default ReauthHandler;
