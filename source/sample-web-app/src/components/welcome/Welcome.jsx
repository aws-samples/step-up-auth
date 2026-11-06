// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { getCurrentUser, fetchAuthSession } from 'aws-amplify/auth';
import { Segment, Header, Label, Button } from 'semantic-ui-react';

class Welcome extends Component {
  constructor(props) {
    super(props);

    this.state = {
      accessToken: '',
      idToken: '',
      refreshToken: '',
      sessionIdleTime: 0,
      validating: false
    };

    this.validateUserSession.bind(this);
    this.dumpToken.bind(this);
    this.handleClick.bind(this);
    this.startSessionIdleCount.bind(this);
  }

  componentDidMount() {
    // we have previously logged in and we are being redirected again.
    // onHubCapsule() won't fire in this case. So lets invoke validateSession()
    if (this.props.authenticated === undefined || this.props.authenticated === false) {
      this.validateUserSession();
    }

    // this.startSessionIdleCount();
  }

  componentWillUnmount() {
    if (this.interval !== undefined) {
      clearInterval(this.interval);
    }
  }

  startSessionIdleCount(startTime) {
    if (this.interval !== undefined) {
      clearInterval(this.interval);
    }

    this.interval = setInterval(() => {
      this.setState({ sessionIdleTime: (Math.round((Date.now() - startTime) / 1000) / 60).toFixed(1) });
    }, 1000);
  }

  validateUserSession() {
    getCurrentUser()
      .then(_currentAuthUser => {
        console.log('Welcome.validateUserSession():getCurrentUser() found a signed-in user');
        // grab the user session (fetchAuthSession() refreshes expired tokens)
        fetchAuthSession()
          .then(session => {
            console.log('Welcome.validateUserSession():fetchAuthSession() has tokens:', !!(session && session.tokens));
            // tokens are only present when the session is valid
            // if tokens have expired, lets call "logout"
            // otherwise, dispatch AUTH_USER success action and by-pass login screen
            if (session && session.tokens) {
              // fire user is authenticated
              console.log('user session is valid!');

              // the JWT objects expose the decoded claims as .payload (same as Amplify v4).
              // Amplify v6 does not expose the refresh token.
              this.setState({
                accessToken: session.tokens.accessToken,
                idToken: session.tokens.idToken,
                refreshToken: '',
                validating: false
              });

              // when state properties are updated, render() is called automatically
              // we don't need to do anything else here.

              // lets start idle timer count
              // start time is retrieved from iat claim
              // iat = time when token was issued
              const startTime = session.tokens.accessToken.payload.iat * 1000;

              this.startSessionIdleCount(startTime);
            } else {
              // fire user is unauthenticated
              const errorMessage = 'user session invalid. auth required';

              this.setState({
                accessToken: '',
                idToken: '',
                refreshToken: '',
                sessionIdleTime: 0,
                validating: false
              });

              console.log(errorMessage);
            }
          })
          .catch(err => {
            const errorMessage = JSON.stringify(err);

            this.setState({
              accessToken: '',
              idToken: '',
              refreshToken: '',
              sessionIdleTime: 0,
              validating: false
            });

            console.error('Welcome.validateUserSession():fetchAuthSession() errorMessage:', errorMessage);
          });
      })
      .catch(err => {
        const errorMessage = JSON.stringify(err);

        this.setState({
          accessToken: '',
          idToken: '',
          refreshToken: '',
          sessionIdleTime: 0,
          validating: false
        });

        console.error('Welcome.validateUserSession():getCurrentUser() errorMessage:', errorMessage);
      });
  }

  dumpToken(token) {
    if (token == null) {
      return null;
    }

    const jsxElems = Object.keys(token).map((objKey, objIndex) => (
      <div key={objIndex}>
        <Label>{objKey}</Label>
        <Label basic size="small">{JSON.stringify(token[objKey])}</Label>
      </div>
    ));

    return jsxElems;
  }

  handleClick(_event) {
    console.log('Welcome.handleClick() called');
    this.setState({ validating: true });
    // simulate the in-button loading spinner before calling validateUserSession()
    this.validateUserSession();
  }

  render() {
    const {
      sessionIdleTime,
      idToken,
      accessToken,
      validating
    } = this.state;

    return (
      <div>
        <Segment basic textAlign="center" className="welcome-page">

          <Segment basic clearing className="welcome-header">
            <Header as="h4" floated="left">
              Session Idle Time: {sessionIdleTime} m
            </Header>
            <Header as="h4" floated="right" className="welcome-header-right">
              {validating && (
                <Button loading>Please Wait</Button>
              )}
              {!validating && (
                <Button onClick={e => (this.handleClick(e))}>Validate Session</Button>
              )}
            </Header>
          </Segment>

          <Segment.Group horizontal>
            <Segment className="segment-left">
              <Label attached="top">ID Token</Label>
              {this.dumpToken(idToken.payload)}
            </Segment>
            <Segment className="segment-right">
              <Label attached="top">Access Token</Label>
              {this.dumpToken(accessToken.payload)}
            </Segment>
          </Segment.Group>
        </Segment>
      </div>
    );
  }
}

// Runtime type checking for React props
Welcome.propTypes = {
  authenticated: PropTypes.bool
};

export { Welcome };
