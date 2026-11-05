// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// A failed call must not leave the data from an earlier successful call on screen: the panel would
// show an error response next to a stale success result.
import reducer from '../../src/reducers/TransferReducer';
import { TRANSFER_SUCCESS, TRANSFER_ERROR, INFO_SUCCESS, INFO_ERROR } from '../../src/actions/Types';

describe('TransferReducer', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('clears earlier /transfer data when a later /transfer call fails', () => {
    const ok = reducer({}, { type: TRANSFER_SUCCESS, payload: { data: 'dummy /transfer successful' } });
    const failed = reducer(ok, { type: TRANSFER_ERROR, payload: { message: 'Unauthorized', code: 401 } });
    expect(failed.transferCode).toBe(401);
    expect(failed.transferError).toBe('Unauthorized');
    expect(failed.transferData).toBeNull();
  });

  it('clears earlier /info data when a later /info call fails', () => {
    const ok = reducer({}, { type: INFO_SUCCESS, payload: { data: { name: 'info' } } });
    const failed = reducer(ok, { type: INFO_ERROR, payload: { message: 'Forbidden', code: 403 } });
    expect(failed.infoCode).toBe(403);
    expect(failed.infoError).toBe('Forbidden');
    expect(failed.infoData).toBeNull();
  });

  it('clears the error when a later call succeeds', () => {
    const failed = reducer({}, { type: TRANSFER_ERROR, payload: { message: 'Unauthorized', code: 401 } });
    const ok = reducer(failed, { type: TRANSFER_SUCCESS, payload: { data: 'dummy /transfer successful' } });
    expect(ok.transferError).toBe('');
    expect(ok.transferCode).toBe(200);
    expect(ok.transferData).toBe('dummy /transfer successful');
  });
});
