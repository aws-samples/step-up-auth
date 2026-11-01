// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React, { Component } from 'react';
// qrcode.react v4 has no default export; QRCodeCanvas renders the same <canvas> as v3
import { QRCodeCanvas as QRCode } from 'qrcode.react';
import {
  getCurrentUser,
  setUpTOTP,
  verifyTOTPSetup,
  updateMFAPreference,
  fetchMFAPreference
} from 'aws-amplify/auth';
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
    getCurrentUser().then(user => {
      console.log('MFASetting.setOtpMfaSetting() getCurrentUser() result:', user);
      setUpTOTP().then((totpSetupDetails) => {
        const code = totpSetupDetails.sharedSecret;
        const qrCodeString = `otpauth://totp/AWSCognito:${user.username}?secret=${code}&issuer=AWSCognito`;
        console.log('MFASetting.setSoftwareTokenSetting() setUpTOTP() qrCodeString:', qrCodeString);
        this.setState({
          qrCodeString: qrCodeString,
          softwareTokenError: false
        });
      })
      .catch(err => {
        console.log('MFASetting.setSoftwareTokenSetting() setUpTOTP() error:', err);
        this.setState({
          softwareTokenError: true
        });
      });
    })
    .catch(err => {
      console.log('MFASetting.setOtpMfaSetting() getCurrentUser() error:', err);
      this.setState({
        softwareTokenError: true
      });
    });
  }

  verifySoftwareTokenSetting(challengeAnswer) {
    getCurrentUser().then(user => {
      console.log('MFASetting.verifySoftwareTokenSetting() getCurrentUser() result:', user);
      verifyTOTPSetup({ code: challengeAnswer }).then((resp) => {
        console.log('MFASetting.verifySoftwareTokenSetting() verifyTOTPSetup() result:', resp);

        this.setState({
          softwareTokenError: false,
          softwareTokenVerified: true
        });

      }).catch( err => {
        // Token is not verified
        console.log('MFASetting.verifySoftwareTokenSetting() verifyTOTPSetup() error:', err);
        this.setState({
          softwareTokenError: true,
          softwareTokenVerified: false
        });
      });
    })
    .catch(err => {
      console.log('MFASetting.verifySoftwareTokenSetting() getCurrentUser() error:', err);
      this.setState({
        softwareTokenError: true,
        softwareTokenVerified: false
      });
    });
  }

  setPreferredMfaSetting(type) {
    // Amplify v4 setPreferredMFA(user, 'TOTP' | 'SMS' | 'NOMFA') mapped to v6 updateMFAPreference()
    let mfaPreference;
    if (type === 'TOTP') {
      mfaPreference = { totp: 'PREFERRED' };
    } else if (type === 'SMS') {
      mfaPreference = { sms: 'PREFERRED' };
    } else {
      mfaPreference = { sms: 'DISABLED', totp: 'DISABLED' };
    }

    getCurrentUser().then(user => {
      console.log('MFASetting.setPreferredMfaSetting() getCurrentUser() result:', user);

      updateMFAPreference(mfaPreference).then((data) => {
        console.log('MFASetting.setPreferredMfaSetting() updateMFAPreference() result:', data);
        this.setState({
          preferredMfaType: type,
          preferredMfaError: false
        });
      })
      .catch(err => {
        console.log('MFASetting.setPreferredMfaSetting() updateMFAPreference() error:', err);
        this.setState({
          preferredMfaType: type,
          preferredMfaError: true
        });
      });
    })
    .catch(err => {
      console.log('MFASetting.setPreferredMfaSetting() getCurrentUser() error:', err);
      this.setState({
        preferredMfaType: type,
        preferredMfaError: true
      });
    });
  }

  getCurrentMfaSetting() {
    getCurrentUser()
      .then(user => {
        console.log('MFASetting.getCurrentMfaSetting() getCurrentUser() result:', user);

        // fetchMFAPreference() always reads the MFA settings from Cognito (no local cache)
        fetchMFAPreference().then((data) => {
          const preferred = data && data.preferred;
          console.log('MFASetting.getCurrentMfaSetting() fetchMFAPreference(): current preferred MFA type is: ' + preferred);
          if (preferred === 'SMS') {
            this.setState({
              preferredMfaType: 'SMS',
              preferredMfaError: false
            });
          } else if (preferred === 'TOTP' ) {
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
        console.log('MFASetting.getCurrentMfaSetting() getCurrentUser() error:', err);
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
