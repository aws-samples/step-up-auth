// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React, { Component } from 'react';
import { Header } from 'semantic-ui-react';
import { useNavigate } from "react-router-dom";
import PropTypes from 'prop-types';
import "./AppHeader.css";

class AppHeader extends Component {
  constructor(props) {
    super(props);

    // This binding is necessary to make `this` work in the callback
    this.handleHomeButtonClick = this.handleHomeButtonClick.bind(this);
  }
  handleHomeButtonClick() {
    console.log('AppHeader.handleBackButtonClick() called');
    this.props.navigate('/');
  }
  render() {
    return (
      <div className="header-page">
        <Header className="header" attached="top">
          <div
            className="nav-logo"
            onClick={this.handleHomeButtonClick}>&nbsp;</div>
          {/* <Icon
            className="home-icon"
            size="large"
            name="home"
            onClick={this.handleHomeButtonClick} /> */}

          <span>Step-up Auth - Sample Web Client</span>
        </Header>
      </div>
    );
  }
}

// Runtime type checking for React props
AppHeader.propTypes = {
  navigate: PropTypes.func,
};

function WithNavigate(props) {
  let navigate = useNavigate();
  return <AppHeader {...props} navigate={navigate} />;
}

export default WithNavigate;
