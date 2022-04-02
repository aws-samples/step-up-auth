// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { Routes, Route } from "react-router-dom";
import PropTypes from 'prop-types';
import { DefaultRoute, PrivateRoute, AuthRoute } from './common/Routes';
import ErrorBoundary from './common/ErrorBoundary';
import { validateUserSession as validateUserAction } from '../actions/AuthActions';
import Login from './auth/Login';
import Forget from './auth/Forget';
import Register from './auth/Register';
import Main from './main';
import { MFASetting } from './setting/MFASetting';
import StepUp from './stepup/StepUp';

import "./App.css";

class App extends Component {
  constructor(props) {
    super(props);
    this.handleWindowClose = this.handleWindowClose.bind(this);
    this.validateUser = this.validateUser.bind(this);
    this.renderContents = this.renderContents.bind(this);
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

  renderContents() {
    const { authenticated } = this.props;
    console.log('App.renderContents() authenticated: ', authenticated);

    // authenticated will be 'undefined' while we are still trying to resolve
    // validateUserAction().  We need to treat that differently
    if (typeof authenticated === 'undefined') {
      return (
        <>
          {console.log('App.renderContents() showing "Please wait"')}
          <span>Please wait</span>
        </>
      );
    } else {
      return (
        <Routes>
          <Route path="/" element={<DefaultRoute authStatus={authenticated} />}></Route>
          <Route path="/login" element={<AuthRoute authStatus={authenticated} />}>
            <Route path="/login" element={<Login/>}/>
          </Route>
          <Route path="/forget" element={<AuthRoute authStatus={authenticated} />}>
            <Route path="/forget" element={<Forget/>}/>
          </Route>
          <Route path="/register" element={<AuthRoute authStatus={authenticated} />}>
            <Route path="/register" element={<Register/>}/>
          </Route>
          <Route path="/main/*" element={<Main/>}>
            {/* <Route path="/main/*" element={<Main/>}/> */}
          </Route>
        </Routes>
      );
    }
  }

  render() {
    const { authenticated } = this.props;

    console.log('App.render() called.  authenticated:', authenticated);

    return (
      <div className="app">
        <ErrorBoundary>
          {this.renderContents()}
        </ErrorBoundary>
      </div>
    );
  }
}

// Runtime type checking for React props
App.propTypes = {
  validateUserAction: PropTypes.func,
  authenticated: PropTypes.bool,
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

