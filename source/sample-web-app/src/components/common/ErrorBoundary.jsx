// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React, { Component } from 'react';
import PropTypes from 'prop-types';
import './ErrorBoundary.css';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);

    this.state = { error: null, errorInfo: null };
  }
  componentDidCatch(error, errorInfo) {
    console.log('ErrorBoundary.componentDidCatch(): error, errorInfo', error, errorInfo);
    // Catch errors in any components below and re-render with error message
    this.setState({
      error: error,
      errorInfo: errorInfo
    });
    // TODO - also log error messages to an error reporting service here
  }
  render() {
    const { error, errorInfo } = this.state;
    console.log('ErrorBoundary.render(): error, errorInfo', error, errorInfo);

    if (errorInfo) {
      // Error path
      return (
        <div className="error-boundary">
          <h2>Something went wrong.</h2>
          <details>
            <summary data-testid="error-summary">{error && error.toString()}</summary>
            <p>
            {errorInfo.componentStack}
            </p>
          </details>
        </div>
      );
    }
    // Normally, just render children
    return this.props.children;
  }
}

// Runtime type checking for React props
ErrorBoundary.propTypes = {
  children: PropTypes.any,
};

export default ErrorBoundary;
