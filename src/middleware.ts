import { Context, Next } from 'hono'
import { AxiomLogger } from './axiom'
import { App, Environment } from './types'
import { getCFTrace } from './cftrace'

/** Adds cftrace in environment 'production' and sets invocationId */
export function useCFTraceMiddleware<T extends App>(environment: Environment) {
	return async (c: Context<T>, next: Next): Promise<void> => {
		c.set('invocationId', crypto.randomUUID())
		if (environment === 'production') {
			const trace = await getCFTrace()
			c.set('cfTrace', trace)
		}
		await next()
	}
}

export function useAxiomLogger<T extends App>(environment: Environment) {
	return async (c: Context<T>, next: Next): Promise<void> => {
		const start = Date.now()
		if (environment === 'production') {
			const trace = c.get('cfTrace')
			const logger = new AxiomLogger({
				ctx: c.executionCtx,
				dataset: c.env.AXIOM_DATASET,
				axiomApiKey: c.env.AXIOM_API_KEY,
				flushAfterMs: 15000,
				tags: {
					server: 'workers',
					source: 'uuid-rocks-content',
					handler: 'fetch',
					invocationId: c.get('invocationId'),
					env: environment ?? 'development',
					cf: {
						colo: trace?.colo,
						loc: trace?.loc,
					},
				},
			})
			c.set('logger', logger)
		}

		await next()

		const logger = c.get('logger')
		if (logger) {
			// Log the request
			const duration = Date.now() - start
			logger.info(`HTTP ${c.req.method} ${c.req.path}`, {
				request: {
					url: c.req.url,
					method: c.req.method,
					path: c.req.path,
					headers: JSON.stringify(Array.from(c.req.raw.headers)),
					ip: c.req.header('cf-connecting-ip') || c.req.header('x-real-ip') || c.req.header('x-forwarded-for'),
				},
				duration,
				msc: { r2Hit: c.get('r2Hit'), kvHit: c.get('kvHit') },
			})
			c.executionCtx.waitUntil(logger.flush())
		}
	}
}