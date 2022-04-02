// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React, { Component } from 'react';
import QRCode from 'qrcode.react';
import { Auth } from 'aws-amplify';
import { Segment, Header, Form, Radio, Label, Container, Button } from 'semantic-ui-react';

import "./MFASetting.css";

class MFASetting extends Component {
  constructor(props) {
    super(props);

    this.state = {
      preferredMfaType: 'NOMFA', // values are 'NOMFA', 'SMS', 'TOTP'
      preferredMfaError: false,
      softwareTokenError: false,
      softwareTokenVerified: false,
      softwareTokenCode: '',
      configureSoftwareToken: false,
      qrCodeString: '',
    };

    this.handleMfaTypeChange = this.handleMfaTypeChange.bind(this);
    this.handleChange = this.handleChange.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);
    this.handleSoftTokenConfiguration = this.handleSoftTokenConfiguration.bind(this);
    this.setSoftwareTokenSetting = this.setSoftwareTokenSetting.bind(this);
    this.verifySoftwareTokenSetting = this.verifySoftwareTokenSetting.bind(this);
    this.setPreferredMfaSetting = this.setPreferredMfaSetting.bind(this);
    this.getCurrentMfaSetting = this.getCurrentMfaSetting.bind(this);
  }

  componentDidMount() {
    this.getCurrentMfaSetting();
  }

  handleMfaTypeChange(_, data) {
    const { value } = data;
    this.setPreferredMfaSetting(value);
  }

  handleChange(e, {name, value}) {
    this.setState({ [name]: value });
  }

  handleSubmit() {
    const { softwareTokenCode } = this.state;
    this.verifySoftwareTokenSetting(softwareTokenCode);
  }

  handleSoftTokenConfiguration(event) {
    console.log('handleSoftTokenConfiguration', event);
    const { configureSoftwareToken } = this.state; // get current state of configureSoftwareToken flag

    // toggle the flag
    const toggleConfigureSoftwareToken = !configureSoftwareToken;

    if (toggleConfigureSoftwareToken) {
      this.setSoftwareTokenSetting();
    }

    this.setState({
      configureSoftwareToken: toggleConfigureSoftwareToken
    });
  }

  setSoftwareTokenSetting() {
    Auth.currentAuthenticatedUser().then(user => {
      console.log('MFASetting.setOtpMfaSetting() Auth.currentAuthenticatedUser() result:', user);
      Auth.setupTOTP(user).then((code) => {
        const qrCodeString = `otpauth://totp/AWSCognito:${user.username}?secret=${code}&issuer=AWSCognito`;
        console.log('MFASetting.setSoftwareTokenSetting() Auth.setupTOTP() qrCodeString:', qrCodeString);
        this.setState({
          qrCodeString: qrCodeString,
          softwareTokenError: false
        });
      })
      .catch(err => {
        console.log('MFASetting.setSoftwareTokenSetting() Auth.setupTOTP() error:', err);
        this.setState({
          softwareTokenError: true
        });
      });
    })
    .catch(err => {
      console.log('MFASetting.setOtpMfaSetting() Auth.currentAuthenticatedUser() error:', err);
      this.setState({
        softwareTokenError: true
      });
    });
  }

  verifySoftwareTokenSetting(challengeAnswer) {
    Auth.currentAuthenticatedUser().then(user => {
      console.log('MFASetting.verifySoftwareTokenSetting() Auth.currentAuthenticatedUser() result:', user);
      Auth.verifyTotpToken(user, challengeAnswer).then((resp) => {
        console.log('MFASetting.verifySoftwareTokenSetting() Auth.verifyTotpToken() result:', resp);

        this.setState({
          softwareTokenError: false,
          softwareTokenVerified: true
        });

      }).catch( err => {
        // Token is not verified
        console.log('MFASetting.verifySoftwareTokenSetting() Auth.verifyTotpToken() error:', err);
        this.setState({
          softwareTokenError: true,
          softwareTokenVerified: false
        });
      });
    })
    .catch(err => {
      console.log('MFASetting.verifySoftwareTokenSetting() Auth.currentAuthenticatedUser() error:', err);
      this.setState({
        softwareTokenError: true,
        softwareTokenVerified: false
      });
    });
  }

  setPreferredMfaSetting(type) {
    Auth.currentAuthenticatedUser().then(user => {
      console.log('MFASetting.setPreferredMfaSetting() Auth.currentAuthenticatedUser() result:', user);

      Auth.setPreferredMFA(user, type).then((data) => {
        console.log('MFASetting.setPreferredMfaSetting() Auth.setPreferredMFA() result:', data);
        this.setState({
          preferredMfaType: type,
          preferredMfaError: false
        });
      })
      .catch(err => {
        console.log('MFASetting.setPreferredMfaSetting() Auth.setPreferredMFA() error:', err);
        this.setState({
          preferredMfaType: type,
          preferredMfaError: true
        });
      });
    })
    .catch(err => {
      console.log('MFASetting.setPreferredMfaSetting() Auth.currentAuthenticatedUser() error:', err);
      this.setState({
        preferredMfaType: type,
        preferredMfaError: true
      });
    });
  }

  getCurrentMfaSetting() {
    Auth.currentAuthenticatedUser()
      .then(user => {
        console.log('MFASetting.getCurrentMfaSetting() Auth.currentAuthenticatedUser() result:', user);

        // Will retrieve the current mfa type from cache
        Auth.getPreferredMFA(user,{
          // Optional, by default is false.
          // If set to true, it will get the MFA type from server side instead of from local cache.
          bypassCache: true
        }).then((data) => {
          console.log('MFASetting.getCurrentMfaSetting() Auth.getPreferredMFA(): current preferred MFA type is: ' + data);
          if (data === 'SMS_MFA') {
            this.setState({
              preferredMfaType: 'SMS',
              preferredMfaError: false
            });
          } else if (data === 'SOFTWARE_TOKEN_MFA' ) {
            this.setState({
              preferredMfaType: 'TOTP',
              preferredMfaError: false
            });
          } else {
            this.setState({
              preferredMfaType: 'NOMFA',
              preferredMfaError: false
            });
          }
        });
      })
      .catch(err => {
        console.log('MFASetting.getCurrentMfaSetting() Auth.currentAuthenticatedUser() error:', err);
        this.setState({
          preferredMfaError: true
        });
      });
  }



  /* eslint-disable react/jsx-handler-names */
  render() {
    const { preferredMfaType, preferredMfaError, softwareTokenError, softwareTokenVerified, qrCodeString, softwareTokenCode, configureSoftwareToken } = this.state;

    return (
      <div>
        <Segment basic textAlign="center" className="mfa-setting-page">

          <Segment basic clearing className="mfa-setting-header">
            <Header as="h4" floated="left" className="mfa-setting-header-left">
              Software Token
            </Header>
            <Header as="h4" floated="right" className="mfa-setting-header-right">
              <Form>
                { configureSoftwareToken && (
                  <Form.Field>
                    <Button
                      compact
                      color="yellow"
                      onClick={this.handleSoftTokenConfiguration}>
                      Configure
                    </Button>
                  </Form.Field>
                )}
                { !configureSoftwareToken && (
                  <Form.Field>
                    <Button
                      compact
                      onClick={this.handleSoftTokenConfiguration}>
                      Configure
                    </Button>
                  </Form.Field>
                )}
              </Form>
            </Header>
          </Segment>

          { configureSoftwareToken && (
            <Segment textAlign="center">

                <Container>
                  <QRCode value={qrCodeString}/>
                  <Form onSubmit={this.handleSubmit}>
                    <Form.Group>
                      <Form.Input
                        placeholder="Code from App"
                        width={4}
                        name="softwareTokenCode"
                        value={softwareTokenCode}
                        onChange={this.handleChange}
                      />
                      <Form.Button compact content="Submit" />
                    </Form.Group>
                  </Form>
                </Container>

                { !softwareTokenError && softwareTokenVerified && (
                  <Label as="span" color="green">
                    Software Token successfully configured!
                  </Label>
                )}
                { softwareTokenError && (
                  <Label as="span" color="red">
                    Error ocurred while setting Software Token!
                  </Label>
                )}

            </Segment>
          )}

          <Segment basic clearing className="mfa-setting-header">
            <Header as="h4" floated="left" className="mfa-setting-header-left">
              Select Preferred MFA
            </Header>
            <Header as="h4" floated="right" className="mfa-setting-header-right">
              <Form>
                <Form.Field>
                  <Radio
                    label="SMS"
                    name="radioGroup"
                    value="SMS"
                    checked={this.state.preferredMfaType === 'SMS'}
                    onChange={(event, data) => this.handleMfaTypeChange(event, data)}
                  />
                </Form.Field>
                <Form.Field>
                  <Radio
                    label="Software Token"
                    name="radioGroup"
                    value="TOTP"
                    checked={this.state.preferredMfaType === 'TOTP'}
                    onChange={(event, data) => this.handleMfaTypeChange(event, data)}
                  />
                </Form.Field>
                <Form.Field>
                  <Radio
                    label="None"
                    name="radioGroup"
                    value="NOMFA"
                    checked={this.state.preferredMfaType === 'NOMFA'}
                    onChange={(event, data) => this.handleMfaTypeChange(event, data)}
                  />
                </Form.Field>
              </Form>
            </Header>
          </Segment>

          <Segment textAlign="center">

            {/* NOMFA and SMS states */}
            { ! preferredMfaError && preferredMfaType === 'NOMFA' && (
              <Container>
                User preferred MFA setting cleared <span role="img" aria-label="check">✅</span>
              </Container>
            )}
            { ! preferredMfaError && preferredMfaType === 'SMS' && (
              <Container>
                User preferred MFA set to SMS <span role="img" aria-label="check">✅</span>
              </Container>
            )}
            { ! preferredMfaError && preferredMfaType === 'TOTP' && (
              <Container>
                User preferred MFA set to Software Token <span role="img" aria-label="check">✅</span>
              </Container>
            )}

            { preferredMfaError && (
              <Label as="span" color="red">
                Error ocurred while retrieving or setting MFA settings!
              </Label>
            )}
          </Segment>
        </Segment>
      </div>
    );
  }
}

export { MFASetting };
