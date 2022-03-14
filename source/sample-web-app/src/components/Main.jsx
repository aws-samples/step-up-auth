// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { BrowserRouter as Router, Route, Switch, Link } from 'react-router-dom';
import {  Sidebar, Menu, Segment } from 'semantic-ui-react';
// import { RouteWithProps } from './common/Routes';
import { logout as logoutAction } from '../actions/AuthActions';
import { Welcome as WelcomeScreen } from './welcome/Welcome';
import { MFASetting } from './setting/MFASetting';
import StepUp from './stepup/StepUp';


import "./Main.css";

class Main extends Component {
  constructor(props) {
    super(props);
    this.onSignOut = this.onSignOut.bind(this);
  }

  UNSAFE_componentWillMount() {
    this.setState(() => {
      return {
        visible: true
      };
    });
  }

  onSignOut() {
    console.log('Main.onSignOut()');

    // logout
    this.props.action.logoutAction({username: 'admin'}, this.props.history);
  }

  render() {
    const { visible } = this.state || {};

    return (
      <div className="main">
        <Router>
          <Sidebar.Pushable as={Segment}>
            <Sidebar as={Menu} width="thin" visible={visible} vertical>
              <Menu.Item name="home">
                <Link to="/main" className="menu-text">Home</Link>
              </Menu.Item>
              <Menu.Item name="setting">
                <Link to="/main/setting" className="menu-text">Setting</Link>
              </Menu.Item>
              <Menu.Item name="stepup">
                <Link to="/main/stepup" className="menu-text">StepUp Auth</Link>
              </Menu.Item>
              <Menu.Item name="logout" onClick={this.onSignOut}>
                Logout
              </Menu.Item>
            </Sidebar>
            <Sidebar.Pusher>
              <Segment basic>
                <Switch>
                  <Route exact path="/main" component={WelcomeScreen} />
                  <Route exact path="/main/setting" component={MFASetting} />
                  <Route exact path="/main/stepup" component={StepUp} />
                  {/* following is just an example of how to mount a child component under same parent path */}
                  {/* <RouteWithProps exact path="/main/page1/stuff" component={WelcomeScreen} mode="parameter1" /> */}
                </Switch>
              </Segment>
            </Sidebar.Pusher>
          </Sidebar.Pushable>
        </Router>
      </div>
    );
  }
}

// Runtime type checking for React props
Main.propTypes = {
  action: PropTypes.object,
  history: PropTypes.object
};

function mapStateToProps(state) {
  return {
    authenticated: state.auth.authenticated
  };
}

function mapDispatchToProps(dispatch) {
  //console.log('Main.mapDispatchToProps() ');

  // approach #1
  // return {
  //   ...bindActionCreators({ logoutAction }, dispatch),
  //   dispatch
  // };

  // approach #2
  return {
    action: bindActionCreators({ logoutAction }, dispatch)
  };
}

export default connect(mapStateToProps, mapDispatchToProps)(Main);
