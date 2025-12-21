/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from "../base/disposable";
import { Event } from "../base/event";
import { RemoteSourcePublisher } from "./api/git";

export interface IRemoteSourcePublisherRegistry {
  readonly onDidAddRemoteSourcePublisher: Event<RemoteSourcePublisher>;
  readonly onDidRemoveRemoteSourcePublisher: Event<RemoteSourcePublisher>;

  getRemoteSourcePublishers(): RemoteSourcePublisher[];
  registerRemoteSourcePublisher(publisher: RemoteSourcePublisher): IDisposable;
}