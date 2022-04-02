// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { Route, Outlet, Routes, Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import {  Sidebar, Menu, Segment } from 'semantic-ui-react';
import { logout as logoutAction } from '../actions/AuthActions';
import { Welcome as WelcomeScreen } from './welcome/Welcome';
import { MFASetting } from './setting/MFASetting';
import StepUp from './stepup/StepUp';

import "./Main.css";

class Main extends Component {
  constructor(props) {
    super(props);
    this.onSignOut = this.onSignOut.bind(this);
    this.renderContents = this.renderContents.bind(this);
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
    this.props.action.logoutAction(this.props.navigate);
  }

  renderContents() {
    const { authenticated } = this.props;
    const { visible } = this.state || {};
    console.log('Main.renderContents() authenticated: ', authenticated);

    if (typeof authenticated === 'undefined' || authenticated == false) {
      return (
        <Navigate to="/" />
      );
    } else {
      return (
        <Sidebar.Pushable as={Segment}>
          <Sidebar as={Menu} width="thin" visible={visible} vertical>
            <Menu.Item name="home">
              <Link to="/main" className="menu-text">Home</Link>
            </Menu.Item>
            <Menu.Item name="setting">
              <Link to="setting" className="menu-text">Setting</Link>
            </Menu.Item>
            <Menu.Item name="stepup">
              <Link to="stepup" className="menu-text">StepUp Auth</Link>
            </Menu.Item>
            <Menu.Item name="logout" onClick={this.onSignOut}>
              Logout
            </Menu.Item>
          </Sidebar>
          <Sidebar.Pusher>
            <Segment basic>
              <Routes>
                <Route index element={<WelcomeScreen />}></Route>
                <Route element={<Outlet></Outlet>}>

                  <Route path="setting" element={<MFASetting />} />
                  <Route path="stepup" element={<StepUp />} />
                </Route>

                {/* <Route path="welcome" element={<Outlet />}> */}
                {/* </Route> */}

              </Routes>
            </Segment>
          </Sidebar.Pusher>
        </Sidebar.Pushable>
      );
    }
  }

  render() {
    return (
      <div className="main">
        {this.renderContents()}
      </div>
    );
  }
}

// Runtime type checking for React props
Main.propTypes = {
  action: PropTypes.object,
  authenticated: PropTypes.bool,
  navigate: PropTypes.func, // comes from useNavigation() hook
  params: PropTypes.object, // comes from useParams() hook
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

// Reference: https://redux-form.com/7.2.3/docs/faq/howtoconnect.md/
// eslint-disable-next-line no-class-assign
Main = connect(
  mapStateToProps,
  mapDispatchToProps
)(Main);

function WithNavigate(props) {
  let navigate = useNavigate();
  let params = useParams();
  return <Main {...props} params={params} navigate={navigate} />;
}

export default WithNavigate;
