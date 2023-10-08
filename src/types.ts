import { AxiomLogger } from './axiom'
import { CFTrace } from './cftrace'

export type Bindings = {
	R2: R2Bucket
	KV: KVNamespace

	// Axiom
	AXIOM_API_KEY: string
	AXIOM_DATASET: string
}

/** Global Hono variables */
export type Variables = {
	cfTrace: CFTrace
	invocationId: string
	logger: AxiomLogger
	// debug stuff
	r2Hit: boolean
	kvHit: boolean
}

/** Top-level Hono app */
export interface App {
	Bindings: Bindings
	Variables: Variables
}

export type Environment = 'production' | undefined
