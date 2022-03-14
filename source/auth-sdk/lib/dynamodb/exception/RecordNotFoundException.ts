// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

export class RecordNotFoundException extends Error {
  readonly name = 'RecordNotFoundException';

  constructor(message: string) {
      super(message);
      Object.setPrototypeOf(this, RecordNotFoundException.prototype);
  }
}
