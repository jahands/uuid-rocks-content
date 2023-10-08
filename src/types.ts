export type Bindings = {
	R2: R2Bucket
	KV: KVNamespace
}

/** Global Hono variables */
export type Variables = {}

/** Top-level Hono app */
export interface App {
	Bindings: Bindings
	Variables: Variables
}
