/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class SyncDescriptor<T> {

  readonly ctor: any;
  readonly staticArguments: unknown[];

  constructor(ctor: new (...args: any[]) => T, staticArguments: unknown[] = []) {
    this.ctor = ctor;
    this.staticArguments = staticArguments;
  }
}