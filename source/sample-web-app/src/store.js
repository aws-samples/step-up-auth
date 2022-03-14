// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { applyMiddleware, compose, createStore } from "redux";
// import { initialState } from "./store/state";
import reduxThunk from 'redux-thunk';
import rootReducer from './reducers/RootReducer';


const middlewares = [reduxThunk];

export const store = createStore(
    rootReducer,
    // initialState,
    compose(applyMiddleware(...middlewares)),
);

export default store;
