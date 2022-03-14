// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Actions related to authentication
export const AUTH_USER = 'auth_user';
export const AUTH_MFA = 'auth_mfa';
export const AUTH_NEW_PASSWORD_REQUIRED = 'auth_new_password_required';
export const UNAUTH_USER = 'unauth_user';
export const REGISTER_USER = 'register_user';
export const REGISTER_USER_CONFIRM = 'register_user_confirm';
export const REGISTER_MFA = 'register_mfa';
export const REGISTER_USER_ERROR = 'register_user_error';
export const FORGOT_PASSWORD = 'forgot_password';
export const FORGOT_PASSWORD_CONFIRM = 'forgot_password_confirm';
export const AUTH_ERROR = 'auth_error';
export const AUTH_ERROR_CLEAR = 'auth_error_clear';

// Actions related to step-up authentication
export const STEP_UP_ERROR = 'step_up_error';
export const STEP_UP_INITIATED = 'step_up_initiated';
export const STEP_UP_COMPLETED = 'step_up_completed';
export const STEP_UP_CLEAR = 'step_up_clear';

// Actions related to sample api
export const TRANSFER_ERROR = 'transfer_error';
export const TRANSFER_SUCCESS = 'transfer_success';
export const TRANSFER_CLEAR = 'transfer_clear';
export const INFO_ERROR = 'info_error';
export const INFO_SUCCESS = 'info_success';
export const INFO_CLEAR = 'info_clear';
