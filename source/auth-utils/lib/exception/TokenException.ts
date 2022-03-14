// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

export class TokenException extends Error {
  readonly name = 'TokenException';

  constructor(message?: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);}
}
