// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React from 'react';
import PropTypes from 'prop-types';
import { Route, Redirect } from 'react-router-dom';

const unauthPath = '/login';
const defaultPath = '/main';

export const PublicRoute = ({ component: ReactComponent, authStatus, ...rest }) => {
  return (
    <Route {...rest} render={props =>
      typeof authStatus === 'undefined' || authStatus === false
        ? (<ReactComponent {...props} authStatus={authStatus} />) : (<Redirect to={defaultPath} />)
    } />
  );
};
PublicRoute.propTypes = {
  component: PropTypes.any,
  authStatus: PropTypes.bool,
  validateUserAction: PropTypes.func
};

export const PrivateRoute = ({ component: ReactComponent, authStatus, ...rest }) => {
  return (
    <Route {...rest} render={props =>
      typeof authStatus === 'undefined' || authStatus === false
        ? (<Redirect to={unauthPath} />) : (<ReactComponent {...props} authStatus={authStatus} />)
    } />);
};
PrivateRoute.propTypes = {
  component: PropTypes.any,
  authStatus: PropTypes.bool
};

export const DefaultRoute = ({ authStatus, ...rest }) => {
  return (
    <Route {...rest} render={() =>
      typeof authStatus === 'undefined' || authStatus === false
        ? (<Redirect to={unauthPath} />) : (<Redirect to={defaultPath} />)
    } />
  );
};
DefaultRoute.propTypes = {
  authStatus: PropTypes.bool
};

// Custom Route component that passes a property ('mode') to the routed component
export const RouteWithProps = ({ component: ReactComponent, mode, ...rest}) => {
  console.log('RouteWithProps() mode:', mode);
  return (
    <Route {...rest} render={props => ( <ReactComponent mode={mode} {...props} /> )} />
  );
};
RouteWithProps.propTypes = {
  component: PropTypes.any,
  mode: PropTypes.any
};

