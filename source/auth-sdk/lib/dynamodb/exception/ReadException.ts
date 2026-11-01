// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

export class ReadException extends Error {
  readonly name = 'ReadException';

  constructor(message: string) {
      super(message);
      Object.setPrototypeOf(this, new.target.prototype);
  }
}
