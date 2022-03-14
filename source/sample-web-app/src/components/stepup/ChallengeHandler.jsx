// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { Container, Form, Label } from 'semantic-ui-react';

import "./ChallengeHandler.css";

class CognitoCustomAuth extends Component {
  constructor(props) {
    super(props);

    this.state = {
      answer: ''
    };

    this.handleSubmit = this.handleSubmit.bind(this);
    this.handleChange = this.handleChange.bind(this);
  }

  handleChange(e, {name, value}) {
    this.setState({ [name]: value });
  }

  handleSubmit() {
    const { answer } = this.state;
    this.props.handleChallenge(answer);
  }

  render() {
    const { answer } = this.state;
    const { showMessage, message } = this.props;

    return (
      <Container>
        { showMessage && (
          <Label pointing="below" color="orange">{message}</Label>
        )}
        <Form onSubmit={this.handleSubmit}>
          <Form.Group>
            <Form.Input
              placeholder="Enter OTP"
              name="answer"
              value={answer}
              onChange={this.handleChange}
            />
            <Form.Button content="Submit" />
          </Form.Group>
        </Form>
      </Container>
    );
  }
}

// Runtime type checking for React props
CognitoCustomAuth.propTypes = {
  handleChallenge: PropTypes.func,
  showMessage: PropTypes.bool,
  message: PropTypes.string
};

export default CognitoCustomAuth;
