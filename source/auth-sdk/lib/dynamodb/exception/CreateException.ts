// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

export class CreateException extends Error {
  readonly name = 'CreateException';

  constructor(message: string) {
      super(message);
      Object.setPrototypeOf(this, new.target.prototype);
  }
}
