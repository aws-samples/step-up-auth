// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { Field, reduxForm } from 'redux-form';
import { Segment, Form, Icon, Button, Label } from 'semantic-ui-react';
import { InputField } from '../common/CustomSemanticUIControls';
import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';
import {
  register as registerAction,
  confirmRegistration as confirmRegistrationAction,
  resendConfirmationCode as resendCodeAction
} from '../../actions/AuthActions';
import store from '../../store';
import { AUTH_ERROR_CLEAR } from '../../actions/Types';
import './Common.css';
import './Register.css';

class Register extends Component {
  constructor(props) {
    super(props);
    this.renderAlert.bind(this);
  }

  dispatchResetError() {
    let counter = 6;
    const seconds = setInterval(() => {
      if (counter == 0) {
        clearInterval(seconds);
        // dispatch INIT_STATE
        console.log('Login.dispatchInitState() dispatching INIT_STATE');
        store.dispatch({ type: AUTH_ERROR_CLEAR });
      }
      counter = counter - 1;
    }, 1000);
  }

  onFormSubmit({ username, password, email, phone, code }) {
    console.log('Register.onFormSubmit() username, password, email, phone:', {username, password, email, phone});

    const {mfaRequired, resendCode} = this.props;

    if (
      (typeof mfaRequired == 'undefined' || mfaRequired == false) &&
      (typeof resendCode == 'undefined' || resendCode == false)) {

      // we pass in the history function so we can navigate from loginAction
      this.props.registerAction({ username, password, email, phone }, this.props.history);
    } else if (mfaRequired == true &&
      (typeof resendCode == 'undefined' || resendCode == false)) {

      console.log('Login.onFormSubmit(): invoking setPasswordAction()');
      const { cognitoUser } = this.props;

      this.props.confirmRegistrationAction({cognitoUser, code}, this.props.history);
    } else if (mfaRequired == true && resendCode == true) {

      console.log('Login.onFormSubmit(): invoking resendCodeAction()');
      const { cognitoUser } = this.props;

      this.props.resendCodeAction({cognitoUser}, this.props.history);
    }
  }

  renderAlert() {
    // consume errorMessage and then dispatch event after 4 seconds to clear the state such
    // that message disappears from the screen
    const { errorMessage } = this.props;

    if (typeof errorMessage != 'undefined' && errorMessage != '' ) {

      console.error('Login.renderAlert(): error! message: ', errorMessage);
      this.dispatchResetError();

      return errorMessage;
    }
  }

  render() {
    const {
      handleSubmit,
      mfaRequired,
      resendCode,
      fields: { username, password, email, phone }} = this.props;
    const invalidRegistration = this.renderAlert();

    return (
      <div className="register-page">

        { !mfaRequired && (
          <Form onSubmit={handleSubmit(this.onFormSubmit.bind(this))}>
            <div className="fill-in">
              <Field
                name="username"
                component={InputField}
                label={{ content: <Icon color="orange" name="user" size="large" /> }}
                labelPosition="left"
                type="text"
                placeholder="Enter username" />
              <Field
                name="password"
                component={InputField}
                label={{ content: <Icon color="orange" name="lock" size="large" /> }}
                labelPosition="left"
                type="password"
                placeholder="Enter password" />
              <Field
                name="email"
                component={InputField}
                label={{ content: <Icon color="orange" name="mail" size="large" /> }}
                labelPosition="left"
                type="email"
                placeholder="Enter email" />
              <Field
                name="phone"
                component={InputField}
                label={{ content: <Icon color="orange" name="phone" size="large" /> }}
                labelPosition="left"
                type="phone"
                placeholder="Enter phone number" />
              <div className="error-message">
                { invalidRegistration && (<Label basic color="red" pointing="above">{ invalidRegistration }</Label>) }
              </div>
              <div className="button-holder">
                <Segment clearing className="button-holder-segment">
                  <Form.Field control={Button} compact
                    className="register-button"
                    floated="left"
                    type="submit">
                    Register
                  </Form.Field>
                  <Link to="/login"><Button compact floated="right">Cancel</Button></Link>
                </Segment>
              </div>
            </div>
          </Form>
        )}

        { mfaRequired && (
          <Form onSubmit={handleSubmit(this.onFormSubmit.bind(this))}>
            <div className="fill-in">
              <Field
                name="code"
                component={InputField}
                label={{ content: <Icon color="orange" name="lock" size="large" /> }}
                labelPosition="left"
                type="text"
                placeholder="Enter verification code" />
              <div className="error-message">
                { invalidRegistration && (<Label basic color="red" pointing="above">{ invalidRegistration }</Label>) }
              </div>
              <div className="button-holder">
                <Segment clearing className="button-holder-segment">
                  <Form.Field control={Button} compact
                    className="verify-code-button"
                    floated="left"
                    type="submit">
                    Verify
                  </Form.Field>
                  { resendCode && (
                    <Form.Field control={Button} compact
                      className="resend-code-button"
                      floated="left"
                      type="submit">
                      Resend Code
                    </Form.Field>
                  )}
                </Segment>
              </div>
            </div>
          </Form>
        )}


      </div>
    );
  }
}

function validate(formProps) {
  const errors = {};

  if (!formProps.username) {
    errors.username = 'Please enter a valid username';
  }

  if (!formProps.password) {
    errors.password = 'Please enter a password';
  }

  if (!formProps.email) {
    errors.email = 'Please enter a valid email address';
  }

  if (!formProps.phone) {
    errors.phone = 'Phone number must be in this format +1416XXXYYYY';
  }

  return errors;
}

// Runtime type checking for React props
Register.propTypes = {
  registerAction: PropTypes.func,
  history: PropTypes.object,
  errorMessage: PropTypes.string,
  mfaRequired: PropTypes.bool,
  resendCode: PropTypes.bool,
  cognitoUser: PropTypes.object,
  handleSubmit: PropTypes.func,
  confirmRegistrationAction: PropTypes.func,
  resendCodeAction: PropTypes.func,
  fields: PropTypes.arrayOf(PropTypes.string)
};


// Reference: https://redux-form.com/7.2.3/docs/faq/howtoconnect.md/
function mapStateToProps(state, ownProps) {
  //console.log('Register.mapStateToProps() state:', state);
  //console.log('Register.mapStateToProps() ownProps:', ownProps);
  return {
    authenticated: state.auth.authenticated,
    errorMessage: state.auth.error,
    mfaRequired: state.auth.mfa,
    cognitoUser: state.auth.cognitoUser,
    resendCode: state.auth.resendCode
  };
}

function mapDispatchToProps(dispatch) {
  //console.log('Register.mapDispatchToProps() ');
  // return {
  //   ...bindActionCreators(actionCreators, dispatch),
  //   dispatch
  // };

  return {
    ...bindActionCreators({
      registerAction,
      confirmRegistrationAction,
      resendCodeAction
    }, dispatch),
    dispatch
  };
}

// Reference: https://redux-form.com/7.2.3/docs/faq/howtoconnect.md/
// eslint-disable-next-line no-class-assign
Register = connect(
  mapStateToProps,
  mapDispatchToProps
)(Register);

export default reduxForm({
  form: 'loginForm',
  fields: ['username', 'password', 'email', 'phone', 'code'],
  validate
})(Register);

