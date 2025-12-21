function getDecoratorFunction(descriptor: PropertyDescriptor): { fnKey: 'value' | 'get'; fn: Function } | null {
	if (typeof descriptor.value === 'function') {
		return { fnKey: 'value', fn: descriptor.value };
	}
	if (typeof descriptor.get === 'function') {
		return { fnKey: 'get', fn: descriptor.get };
	}
	return null;
}

function createDecorator(mapFn: (fn: Function, key: string) => Function): MethodDecorator {
	return (_target: Object, key: string | symbol, descriptor: TypedPropertyDescriptor<any>) => {
		if (typeof key === 'symbol') {
			throw new Error('Symbol keys are not supported');
		}

		const result = getDecoratorFunction(descriptor);
		if (!result) {
			throw new Error('Decorator can only be applied to methods or getters');
		}

		descriptor[result.fnKey] = mapFn(result.fn, key);
	};
}

export function memoize(_target: Object, key: string, descriptor: PropertyDescriptor) {
	const result = getDecoratorFunction(descriptor);
	if (!result) {
		throw new Error('Decorator can only be applied to methods or getters');
	}

	const { fnKey, fn } = result;

	if (fnKey === 'value' && fn.length !== 0) {
		console.warn('Memoize should only be used in functions with zero parameters', { fn, key });
	}

	const memoizeKey = `$memoize$${key}`;
	descriptor[fnKey!] = function (...args: any[]) {
		if (!this.hasOwnProperty(memoizeKey)) {
			Object.defineProperty(this, memoizeKey, {
				configurable: false,
				enumerable: false,
				writable: false,
				value: fn.apply(this, args)
			});
		}
		return (this as any)[memoizeKey];
	};
}

export function sequentialize(_target: Object, key: string, descriptor: PropertyDescriptor) {
	const result = getDecoratorFunction(descriptor);
	if (!result) {
		throw new Error('Decorator can only be applied to methods or getters');
	}

	const { fnKey, fn } = result;

	const currentKey = `__$sequence$${key}`;
	descriptor[fnKey!] = function (this: any, ...args: any[]) {
		const currentPromise = this[currentKey] as Promise<any> || Promise.resolve(null);
		const run = async () => await fn.apply(this, args);
		this[currentKey] = currentPromise.then(run, run);
		return this[currentKey];
	}
}

export interface IDebounceReducer<T> {
	(previousValue: T, ...args: any[]): T;
}

export function debounce<T>(delay: number, reducer?: IDebounceReducer<T>, initialValueProvider?: () => T) {
	return createDecorator((fn, key) => {
		const timerKey = `$debounce$${key}`;
		const resultKey = `$debounce$result$${key}`;

		return function (this: any, ...args: any[]) {
			if (!this[resultKey]) {
				this[resultKey] = initialValueProvider ? initialValueProvider() : undefined;
			}

			clearTimeout(this[timerKey]);

			if (reducer) {
				this[resultKey] = reducer(this[resultKey], ...args);
				args = [this[resultKey]];
			}

			this[timerKey] = setTimeout(() => {
				fn.apply(this, args);
				this[resultKey] = initialValueProvider ? initialValueProvider() : undefined;
			}, delay);
		};
	});
}

export function throttle<T>(_target: Object, key: string, descriptor: PropertyDescriptor) {
	const result = getDecoratorFunction(descriptor);
	if (!result) {
		throw new Error('Decorator can only be applied to methods or getters');
	}

	const { fnKey, fn } = result;
	const currentKey = `$throttle$current$${key}`;
	const nextKey = `$throttle$next$${key}`;

	descriptor[fnKey!] = function (this: any, ...args: any[]) {
		if (this[nextKey]) {
			return this[nextKey];
		}

		if (this[currentKey]) {
			this[nextKey] = Promise.resolve(this[currentKey]).then(() => {
				this[nextKey] = undefined;
				return descriptor[fnKey!].apply(this, args);
			});
			return this[nextKey];
		}

		this[currentKey] = fn!.apply(this, args) as Promise<T>;

		const clear = () => this[currentKey] = undefined;
		Promise.resolve(this[currentKey]).then(clear, clear);

		return this[currentKey];
	};
}