import { AxiomLogger } from './axiom'
import { CFTrace } from './cftrace'

export type Bindings = {
	// Vars
	VERSION: string

	// Bindings
	R2: R2Bucket
	KV: KVNamespace

	// Axiom
	AXIOM_API_KEY: string
	AXIOM_DATASET: string
}

/** Global Hono variables */
export const Hosts = ['i.uuid.rocks', 'dl.uuid.rocks', 'sh.uuid.rocks'] as const
export type Host = typeof Hosts[number]

export type Variables = {
	cfTrace: CFTrace
	invocationId: string
	logger: AxiomLogger
	// Some stuff differs by host - this gets set in middleware
	host: Host
	// debug stuff
	r2Hit: boolean
	kvHit: boolean
	cacheHit: boolean
	servedBy: 'r2' | 'kv' | 'cache' | 'unknown'
}

/** Top-level Hono app */
export interface App {
	Bindings: Bindings
	Variables: Variables
}

export type Environment = 'production' | undefined
