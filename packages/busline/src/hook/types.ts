/**
 * The parameters of a hook, given the (optional) hook property's type.
 */
export type HookArgs<T> = T extends (...args: infer A) => unknown ? A : never;
