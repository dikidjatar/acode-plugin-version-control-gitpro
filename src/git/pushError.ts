/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from "../base/disposable";
import { PushErrorHandler } from "./api/git";

export interface IPushErrorHandlerRegistry {
	registerPushErrorHandler(provider: PushErrorHandler): IDisposable;
	getPushErrorHandlers(): PushErrorHandler[];
}