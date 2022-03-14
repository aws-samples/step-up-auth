// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { Field, reduxForm } from 'redux-form';
import { Segment, Form, Icon, Button, Label } from 'semantic-ui-react';
import { Link } from 'react-router-dom';
import { InputField } from '../common/CustomSemanticUIControls';
import PropTypes from 'prop-types';
import {
  forgotPassword as forgotPasswordAction,
  confirmForgotPassword as confirmForgotPasswordAction } from '../../actions/AuthActions';
import './Common.css';
import './Forget.css';

class Forget extends Component {

  constructor(props) {
    super(props);
    this.renderAlert.bind(this);
  }


  onFormSubmit({ username, newPassword, code }) {
    const {
      forgotPasswordCode,
      history} = this.props;

    console.log('Forget.onFormSubmit() username, newPassword, code, forgotPasswordCode:', {username, newPassword, code, forgotPasswordCode});
    // Need to do something to log user in
    // we pass in the history function so we can navigate from forgotPasswordAction
    if (typeof forgotPasswordCode == 'undefined' || forgotPasswordCode == false) {
      this.props.forgotPasswordAction({ username }, history);
    } else {
      this.props.confirmForgotPasswordAction({username, code, newPassword}, history);
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
      forgotPasswordCode,
      fields: { username, newPassword, newPasswordConfirm, code }} = this.props;
    const invalidCredentialsMessage = this.renderAlert();

    return (
      <div>
        { !forgotPasswordCode && (
          <div className="forget-page">
            <Form onSubmit={handleSubmit(this.onFormSubmit.bind(this))}>
              <div className="fill-in">
                <Field
                  name="username"
                  component={InputField}
                  label={{ content: <Icon color="orange" name="user" size="large" /> }}
                  labelPosition="left"
                  type="text"
                  placeholder="Enter username" />
                <div className="error-message">
                  { invalidCredentialsMessage && (<Label basic color="red" pointing="above">{ invalidCredentialsMessage }</Label>) }
                </div>
              </div>
              <div className="button-holder">
                <Segment clearing className="button-holder-segment">
                  <Form.Field control={Button} compact
                    className="send-code-button"
                    floated="left"
                    type="submit">
                    Send Verification Code
                  </Form.Field>
                  <Link to="/login"><Button compact floated="right">Cancel</Button></Link>
                </Segment>
              </div>
            </Form>
          </div>
        )}

        { forgotPasswordCode && (
          <div className="forget-page">
            <Form onSubmit={handleSubmit(this.onFormSubmit.bind(this))}>
              <div className="fill-in">
                <Field
                  name="newPassword"
                  component={InputField}
                  label={{ content: <Icon color="orange" name="lock" size="large" /> }}
                  labelPosition="left"
                  type="password"
                  placeholder="Enter new password" />
                <Field
                  name="newPasswordConfirm"
                  component={InputField}
                  label={{ content: <Icon color="orange" name="lock" size="large" /> }}
                  labelPosition="left"
                  type="password"
                  placeholder="Re-enter new password" />
                <Field
                  name="code"
                  component={InputField}
                  label={{ content: <Icon color="orange" name="lock" size="large" /> }}
                  labelPosition="left"
                  type="text"
                  placeholder="Enter verification code" />

                <div className="error-message">
                  { invalidCredentialsMessage && (<Label basic color="red" pointing="above">{ invalidCredentialsMessage }</Label>) }
                </div>
              </div>
              <div className="button-holder">
                <Segment clearing className="button-holder-segment">
                  <Form.Field control={Button} compact
                    className="change-password-button"
                    floated="left"
                    type="submit">
                    Change Password
                  </Form.Field>
                  <Link to="/login"><Button compact floated="right">Cancel</Button></Link>
                </Segment>
              </div>
            </Form>
          </div>
        )}

      </div>
    );
  }
}

// Redux-form validation
function validate(formProps) {
  const errors = {};

  if (!formProps.username) {
    errors.username = 'Please enter verification code';
  }

  return errors;
}

// Runtime type checking for React props
Forget.propTypes = {
  forgotPasswordAction: PropTypes.func,
  confirmForgotPasswordAction: PropTypes.func,
  history: PropTypes.object,
  errorMessage: PropTypes.string,
  forgotPasswordCode: PropTypes.string,
  handleSubmit: PropTypes.func,
  fields: PropTypes.arrayOf(PropTypes.string)
};


function mapStateToProps(state) {
  return {
    authenticated: state.auth.authenticated,
    forgotPasswordCode: state.auth.forgotPasswordCode,
    errorMessage: state.auth.error
  };
}

function mapDispatchToProps(dispatch) {
  return {
    ...bindActionCreators({ forgotPasswordAction, confirmForgotPasswordAction }, dispatch),
    dispatch
  };
}


// Reference: https://redux-form.com/7.2.3/docs/faq/howtoconnect.md/
// eslint-disable-next-line no-class-assign
Forget = connect(
  mapStateToProps,
  mapDispatchToProps
)(Forget);

export default reduxForm({
  form: 'loginForm',
  fields: ['username'],
  validate
})(Forget);


