// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { Container, Segment, Label, Button } from 'semantic-ui-react';
import PropTypes from 'prop-types';
import {
  stepUpInitiate as stepUpInitiateAction,
  stepUpRespondToChallenge as stepUpRespondToChallengeAction } from '../../actions/StepUpActions';
import {
  info as infoAction,
  clearInfo,
  transfer as transferAction,
  clearTransfer
} from '../../actions/TransferActions';
import {
  STEP_UP_INITIATED
} from '../../actions/Types';

import ChallengeHandler from './ChallengeHandler';

class StepUp extends Component {
  constructor(props) {
    super(props);

    this.state = {
      transferSuccessMessage: '',
      transferErrorMessage: '',
      infoErrorMessage: '',
      infoSuccessMessage: ''
    };

    // this.parseAuthenticateHeader = this.parseAuthenticateHeader.bind(this);
    this.transfer = this.transfer.bind(this);
    this.info = this.info.bind(this);
    this.handleStepUpChallenge = this.handleStepUpChallenge.bind(this);
    this.renderChallengeResponse = this.renderChallengeResponse.bind(this);
    this.renderThrottleError = this.renderThrottleError.bind(this);
  }

  componentDidMount() {
    console.log('StepUp.componentDidMount(): called');
    // clean up store(s) so mount a clean component whenever user transitions into StepUp screen
    // we can also do this in componentWillUnmount()
    this.props.clearTransfer();
    this.props.clearInfo();
  }

  async transfer() {
    console.log('StepUp.transfer(): invoking /transfer api');
    this.props.transferAction(false);
  }

  async info() {
    console.log('StepUp.info(): invoking /info api');
    this.props.infoAction(false);
  }

  async handleStepUpChallenge(challengeResponse) {
    console.log('StepUp.handleStepUpChallenge(): received challengeResponse', challengeResponse);
    const { steppedUp, stepUpType } = this.props;
    console.log(`StepUp.handleStepUpChallenge(): steppedUp: ${steppedUp}, stepUpType: ${stepUpType}`);
    this.props.stepUpRespondToChallengeAction(false, stepUpType, challengeResponse);
  }

  renderChallengeResponse() {
    const {
      stepUpError,
      stepUpErrorOrigin,
      steppedUp,
      stepUpType
    } = this.props;

    console.log('StepUp.renderChallengeResponse(): stepUpError: ', stepUpError);
    console.log('StepUp.renderChallengeResponse(): stepUpErrorOrigin: ', stepUpError);
    console.log('StepUp.renderChallengeResponse(): stepUpType: ', stepUpType);

    // render segment containing ChallengeHandler
    let renderElements = (<></>);

    if (stepUpError && stepUpError.length > 0 && stepUpErrorOrigin === STEP_UP_INITIATED) {
      renderElements = (
        <Segment basic textAlign={"center"}>
          <Label as="span" color="orange">
            Check MFA Setting
          </Label>
          <Label as="span" color="red">
            Error Message:
            <Label.Detail>{stepUpError}</Label.Detail>
          </Label>
        </Segment>
      );
    }
    else {
      renderElements = (
        <Segment basic textAlign={"center"}>
          <ChallengeHandler
            handleChallenge={this.handleStepUpChallenge}
            showMessage={stepUpType === "MAYBE_SOFTWARE_TOKEN_STEP_UP" ? true : false}
            message="Please enter your one-time password code. If you don't have a software token configured, please add one from Settings -> Software Token"
            />
          { stepUpError && stepUpError.length > 0 && (
            <Container>
              <Label as="span" color="orange">
                Please try again
              </Label>
              <Label as="span" color="red">
                Error Message:
                <Label.Detail>{stepUpError}</Label.Detail>
              </Label>
            </Container>
          )}
          { steppedUp && (
            <Label as="span" color="green">
              Step-up Status:
              <Label.Detail>Complete! Invoke API again.</Label.Detail>
            </Label>
          )}
        </Segment>
      );
    }

    return renderElements;
  }

  renderThrottleError() {
    const { transferError } = this.props;

    // render segment containing ChallengeHandler
    let renderElements = (<></>);

    renderElements = (
      <Segment inverted color="red" textAlign={"center"}>
          {transferError}.
          Wait at least 30 minutes before invoking API.
          Or change Preferred MFA under Setting menu to Software Token.
      </Segment>
    );

    return renderElements;
  }

  render() {
    const { transferData, transferError, transferCode, infoData, infoError, infoCode } = this.props;

    console.log('render(): transferData: ', transferData);
    console.log('render(): transferError: ', transferError);
    console.log('render(): infoData: ', infoData);
    console.log('render(): infoError: ', infoError);

    return (
      <Segment basic textAlign="center" className="welcome-page">
        <Segment>
          <Label>This is a POST call to an API Gateway endpoint with Request Authorizer that triggers step-up authentication.</Label>
          <Button
            disabled={transferCode == 429 ? true : false}
            onClick={e => this.transfer(e)}>
            Invoke Transfer API
          </Button>
          { transferError && (
            <div>
              <Label as="span" color="orange">
                Response:
                <Label.Detail>{transferCode}</Label.Detail>
              </Label>

              {transferCode === 429 && this.renderThrottleError()}
              {transferCode !== 429 && this.renderChallengeResponse()}
            </div>
          )}
          { transferData && (
            <div>
              <Label as="span" color="green">
                Response:
                <Label.Detail>{transferCode}</Label.Detail>
              </Label>
              <Segment basic>
                data: {JSON.stringify(transferData)}
              </Segment>
            </div>
          )}
        </Segment>
        <Segment>
          <Label>This is a POST call to an unprotected API Gateway endpoint.</Label>
          <Button onClick={e => this.info(e)}>Invoke Info API</Button>
          { infoError && (
            <div>
              <Label as="span" color="orange">
                Response:
                <Label.Detail>{infoCode}</Label.Detail>
              </Label>

              {this.renderChallengeResponse()}
            </div>
          )}
          { infoData && (
            <div>
              <Label as="span" color="green">
                Response:
                <Label.Detail>{infoCode}</Label.Detail>
              </Label>
              <Segment basic>
                data: {JSON.stringify(infoData)}
              </Segment>
            </div>
          )}
        </Segment>
      </Segment>
    );
  }
}

StepUp.propTypes = {
  steppedUp: PropTypes.bool,
  stepUpType: PropTypes.string,
  stepUpError: PropTypes.string,
  stepUpErrorOrigin: PropTypes.string,
  stepUpInitiateAction: PropTypes.func,
  stepUpRespondToChallengeAction: PropTypes.func,
  infoAction: PropTypes.func,
  clearInfo: PropTypes.func,
  transferAction: PropTypes.func,
  clearTransfer: PropTypes.func,
  transferData: PropTypes.any,
  transferCode: PropTypes.number,
  transferError: PropTypes.string,
  infoData: PropTypes.any,
  infoCode: PropTypes.number,
  infoError: PropTypes.string
};

function mapStateToProps(state) {
  return {
    steppedUp: state.stepUp.steppedUp,
    stepUpType: state.stepUp.stepUpType,
    stepUpError: state.stepUp.error,
    stepUpErrorOrigin: state.stepUp.errorOrigin,
    // stepUpType: state.stepUp.step
    transferData: state.transfer.transferData,
    transferError: state.transfer.transferError,
    transferCode: state.transfer.transferCode,
    infoData: state.transfer.infoData,
    infoError: state.transfer.infoError,
    infoCode: state.transfer.infoCode
  };
}

function mapDispatchToProps(dispatch) {
  return {
    ...bindActionCreators({
      stepUpInitiateAction,
      stepUpRespondToChallengeAction,
      infoAction,
      clearInfo,
      transferAction,
      clearTransfer
    }, dispatch),
    dispatch
  };
}

export default connect(mapStateToProps, mapDispatchToProps)(StepUp);
