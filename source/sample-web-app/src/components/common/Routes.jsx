// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';

const unAuthPath = '/login';
const defaultPath = '/main';

export const DefaultRoute = (auth) => {
  const {authStatus} = auth;
  console.log('DefaultRoute called. auth:', authStatus);
  // If authorized, return element that will navigate to a default page (logged in screen)
  // otherwise, return element that will navigate to login page
  return authStatus ? <Navigate to={defaultPath} /> : <Navigate to={unAuthPath} />;
};

export const PrivateRoute = (auth) => {
  const {authStatus} = auth;
  console.log('PrivateRoute called. auth:', authStatus);
  // If authorized, return an outlet that will render child elements
  // otherwise, return element that will navigate to login page
  return authStatus ? <Outlet /> : <Navigate to={unAuthPath} />;
};

export const PublicRoute = () => {
  console.log('PublicRoute called.');
  return <Outlet />;
};

export const AuthRoute = (auth) => {
  const {authStatus} = auth;
  console.log('AuthRoute called. auth:', authStatus);
  // If authorized, return defaultPath
  // otherwise, return an outlet that will render child elements
  return  authStatus ? <Navigate to={defaultPath} /> : <Outlet />;
};
