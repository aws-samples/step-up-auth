// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

export class UpdateException extends Error {
  readonly name = 'UpdateException';

  constructor(message: string) {
      super(message);
      Object.setPrototypeOf(this, new.target.prototype);
  }
}
