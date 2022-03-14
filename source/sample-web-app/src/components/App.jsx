// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { Switch } from "react-router-dom";
import PropTypes from 'prop-types';
import { DefaultRoute, PrivateRoute, PublicRoute } from './common/Routes';
import ErrorBoundary from './common/ErrorBoundary';
import { validateUserSession as validateUserAction } from '../actions/AuthActions';
import Login from './auth/Login';
import Forget from './auth/Forget';
import Register from './auth/Register';
import Main from './main';

import "./App.css";

class App extends Component {
  constructor(props) {
    super(props);
    this.handleWindowClose = this.handleWindowClose.bind(this);
  }

  UNSAFE_componentWillMount() {
    console.log('App.componentWillMount() props: ', this.props);
    // if session contains valid
    this.validateUser();
    window.addEventListener('beforeunload', this.handleWindowClose);
  }

  componentWillUnMount() {
    window.removeEventListener('beforeunload', this.handleWindowClose);
  }

  handleWindowClose(e) {
    e.preventDefault();
    // dispatch a UNAUTH_USER action to invoke Cognito
  }

  validateUser() {
    // get current authenticated user
    this.props.validateUserAction();
  }

  render() {
    const { authenticated } = this.props;

    console.log('App.render() called');

    return (
      <div className="app">
        {/* reason for adding ErrorBoundary inside Router is so we get a rference
            to this.props.history for navigation purposes */}
        <ErrorBoundary>
          <Switch>

            {/* All default traffic will /.  Typically if authentication is enabled,
              * then logged in user is routed to a landing page (overview for example)
              * and guest users end up on a login screen.  For the sake of this example
              * code we will by-pass login screen and assume all users are logged in
              * by manually setting authStatus to true in constructor.
              * PrivateRoute is used to route to a protected route / component
              * PublicRoute, when authStatus==false, will redirect the user to a non-protect component
              *              when authStatus==true, will redirect to a overview
              * DefaultRoute is a special public route which doesn't take a component.  It
              *              simply routes the user to either PublicRoute or a PrivateRoute
              *              based on the value of authStatus
              */}

            {/* <DefaultRoute exact path="/" authStatus={authStatus} />
            <PrivateRoute exact path="/overview" component={Overview} authStatus={authStatus} />
            <PrivateRoute exact path="/counter" component={BuggyCounter} authStatus={authStatus} />
            <PrivateRoute exact path="/service" component={Service} authStatus={authStatus} />
            <PrivateRoute exact path="/details" component={Details} authStatus={authStatus} />
            <PrivateRoute exact path="/calculator" component={Calculator} authStatus={authStatus} /> */}

            <DefaultRoute exact path="/" authStatus={authenticated} />
            <PublicRoute exact path="/login" component={Login} authStatus={authenticated} />
            <PublicRoute exact path="/forget" component={Forget} authStatus={authenticated} />
            <PublicRoute exact path="/register" component={Register} authStatus={authenticated} />
            <PrivateRoute exact path="/main" component={Main} authStatus={authenticated} />

          </Switch>
        </ErrorBoundary>
      </div>
    );
  }
}

// Runtime type checking for React props
App.propTypes = {
  validateUserAction: PropTypes.func,
  authenticated: PropTypes.bool,
  history: PropTypes.object,
  errorMessage: PropTypes.string
};


function mapStateToProps(state) {
  return {
    authenticated: state.auth.authenticated
  };
}

function mapDispatchToProps(dispatch) {
  return {
    ...bindActionCreators({
      validateUserAction}, dispatch),
    dispatch
  };
}

export default connect(mapStateToProps, mapDispatchToProps)(App);

